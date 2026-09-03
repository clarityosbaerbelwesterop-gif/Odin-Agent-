import assert from "node:assert/strict";
import test from "node:test";
import {
  DurableJobRunner,
  type JobHandler,
  LeaseRejectedError,
  SqliteDurableStore,
} from "../../src/durable/index.js";
import type { JobEnqueueInput } from "../../src/durable/types.js";
import { createMissionCheckpoint } from "../../src/mission/checkpoint.js";
import { MissionRuntime } from "../../src/mission/runtime.js";
import { artifact, missionInput, plusMs, T0, temporaryDatabase } from "./helpers.js";

function durableJob(jobId: string, missionId = "mission-long"): JobEnqueueInput {
  return {
    availableAt: T0,
    createdAt: T0,
    idempotencyKey: `enqueue-${jobId}`,
    jobId,
    maxAttempts: 3,
    missionId,
    payload: artifact(`payload-${jobId}`),
    priority: 50,
    taskId: `task-${jobId}`,
  };
}

test("fresh process replays mission/checkpoint, reclaims expired work, and fences stale completion", async () => {
  const temporary = await temporaryDatabase();
  try {
    const first = new SqliteDurableStore(temporary.path);
    const firstRuntime = new MissionRuntime(first, () => T0);
    const created = await firstRuntime.create(missionInput("mission-recovery"), "create");
    const transitioned = await firstRuntime.transition(
      created.id,
      created.version,
      "UNDERSTANDING",
      "understanding",
    );
    const checkpoint = createMissionCheckpoint(transitioned, transitioned.version);
    await first.saveCheckpoint(checkpoint, T0);
    await first.enqueueJob(durableJob("recovery-job", "mission-recovery"));
    const staleLease = await first.claimJob({
      leaseMs: 1_000,
      now: T0,
      workerId: "worker-before-crash",
    });
    assert.ok(staleLease);
    const beforeCrashEvents = await first.readJobEvents("mission-recovery", 0, 20);
    const resumeCursor = beforeCrashEvents.at(-1)?.cursor ?? 0;
    first.close();

    const reopened = new SqliteDurableStore(temporary.path);
    const freshRuntime = new MissionRuntime(reopened, () => plusMs(T0, 2_000));
    assert.deepEqual(await freshRuntime.load("mission-recovery"), transitioned);
    assert.deepEqual(await reopened.loadCheckpoint("mission-recovery"), checkpoint);

    const freshLease = await reopened.claimJob({
      leaseMs: 2_000,
      now: plusMs(T0, 1_001),
      workerId: "worker-after-crash",
    });
    assert.ok(freshLease);
    assert.equal(freshLease.generation, staleLease.generation + 1);
    assert.equal(freshLease.attempt, staleLease.attempt + 1);

    await assert.rejects(
      reopened.settleJobSuccess(staleLease, artifact("stale-result"), plusMs(T0, 1_100)),
      LeaseRejectedError,
    );
    assert.equal(
      (await reopened.settleJobSuccess(freshLease, artifact("fresh-result"), plusMs(T0, 1_100)))
        .status,
      "SUCCEEDED",
    );

    const resumedEvents = await reopened.readJobEvents("mission-recovery", resumeCursor, 20);
    assert.ok(resumedEvents.length >= 2);
    assert.ok(resumedEvents.every((event) => event.cursor > resumeCursor));
    assert.equal(resumedEvents[0]?.type, "job.reclaimed");
    assert.equal(resumedEvents.at(-1)?.type, "job.succeeded");
    reopened.close();
  } finally {
    await temporary.cleanup();
  }
});

test("32-job fixture drains deterministically across reopen with retry, block, cancel, and cursor paging", async () => {
  const temporary = await temporaryDatabase();
  try {
    const first = new SqliteDurableStore(temporary.path);
    for (let index = 0; index < 32; index += 1) {
      const jobId = `job-${String(index).padStart(2, "0")}`;
      await first.enqueueJob(durableJob(jobId));
    }
    assert.equal((await first.cancelJob("job-07", T0)).status, "CANCELLED");

    const handler: JobHandler = {
      async execute(lease) {
        if (lease.jobId === "job-05" && lease.attempt === 1) {
          return { outcome: "RETRY", reasonCode: "fixture_retry", retryAfterMs: 0 };
        }
        if (lease.jobId === "job-06") {
          return { outcome: "BLOCKED", reasonCode: "fixture_block" };
        }
        return { outcome: "SUCCEEDED", result: artifact(`result-${lease.jobId}`) };
      },
    };
    const firstRunner = new DurableJobRunner(
      first,
      handler,
      { heartbeatMs: 50, leaseMs: 1_000, timeoutMs: 500, workerId: "worker-one" },
      () => T0,
    );
    const firstBatch = await firstRunner.drain(10);
    assert.equal(firstBatch.length, 10);
    const cursorBeforeReopen =
      (await first.readJobEvents("mission-long", 0, 100)).at(-1)?.cursor ?? 0;
    first.close();

    const reopened = new SqliteDurableStore(temporary.path);
    const secondRunner = new DurableJobRunner(
      reopened,
      handler,
      { heartbeatMs: 50, leaseMs: 1_000, timeoutMs: 500, workerId: "worker-two" },
      () => T0,
    );
    const secondBatch = await secondRunner.drain(100);
    assert.ok(secondBatch.length >= 22);

    const counts = await reopened.jobCounts("mission-long");
    assert.deepEqual(counts, {
      BLOCKED: 1,
      CANCELLED: 1,
      CANCELLING: 0,
      PENDING: 0,
      RETRY_WAIT: 0,
      RUNNING: 0,
      SUCCEEDED: 30,
    });
    assert.equal((await reopened.getJob("job-05"))?.attemptCount, 2);
    assert.equal((await reopened.getJob("job-06"))?.status, "BLOCKED");
    assert.equal((await reopened.getJob("job-07"))?.status, "CANCELLED");

    const postReopenEvents = await reopened.readJobEvents("mission-long", cursorBeforeReopen, 100);
    assert.ok(postReopenEvents.length > 0);
    assert.ok(postReopenEvents.every((event) => event.cursor > cursorBeforeReopen));

    const allEvents = [];
    let cursor = 0;
    while (true) {
      const page = await reopened.readJobEvents("mission-long", cursor, 7);
      if (page.length === 0) break;
      allEvents.push(...page);
      cursor = page.at(-1)?.cursor ?? cursor;
    }
    const cursors = allEvents.map((event) => event.cursor);
    assert.equal(new Set(cursors).size, cursors.length);
    assert.ok(cursors.every((value, index) => index === 0 || value > (cursors[index - 1] ?? -1)));
    assert.equal(allEvents.filter((event) => event.type === "job.enqueued").length, 32);
    assert.equal(allEvents.filter((event) => event.type === "job.succeeded").length, 30);
    assert.equal(allEvents.filter((event) => event.type === "job.blocked").length, 1);
    assert.ok(allEvents.some((event) => event.type === "job.retry_scheduled"));
    reopened.close();
  } finally {
    await temporary.cleanup();
  }
});
