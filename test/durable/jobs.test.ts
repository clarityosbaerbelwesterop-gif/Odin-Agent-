import assert from "node:assert/strict";
import test from "node:test";
import {
  DurableStoreConflictError,
  LeaseRejectedError,
  SqliteDurableStore,
} from "../../src/durable/index.js";
import type { JobEnqueueInput } from "../../src/durable/types.js";
import { artifact, plusMs, T0, temporaryDatabase } from "./helpers.js";

function job(
  jobId: string,
  options: Partial<Pick<JobEnqueueInput, "idempotencyKey" | "maxAttempts" | "missionId" | "priority">> = {},
): JobEnqueueInput {
  return {
    availableAt: T0,
    createdAt: T0,
    idempotencyKey: options.idempotencyKey ?? `enqueue-${jobId}`,
    jobId,
    maxAttempts: options.maxAttempts ?? 3,
    missionId: options.missionId ?? "mission-jobs",
    payload: artifact(`payload-${jobId}`),
    priority: options.priority ?? 50,
    taskId: `task-${jobId}`,
  };
}

test("job enqueue is durable and idempotent but conflicting immutable input fails", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    const input = job("job-idempotent");
    const first = await store.enqueueJob(input);
    const replay = await store.enqueueJob(input);
    assert.deepEqual(replay, first);

    await assert.rejects(
      store.enqueueJob({ ...input, priority: input.priority + 1 }),
      DurableStoreConflictError,
    );
    await assert.rejects(
      store.enqueueJob({ ...job("job-other"), idempotencyKey: input.idempotencyKey }),
      DurableStoreConflictError,
    );
    store.close();

    const reopened = new SqliteDurableStore(temporary.path);
    assert.deepEqual(await reopened.enqueueJob(input), first);
    reopened.close();
  } finally {
    await temporary.cleanup();
  }
});

test("two SQLite connections cannot hold the same valid lease and stale fencing cannot settle", async () => {
  const temporary = await temporaryDatabase();
  try {
    const firstStore = new SqliteDurableStore(temporary.path);
    const secondStore = new SqliteDurableStore(temporary.path);
    await firstStore.enqueueJob(job("job-fenced"));

    const firstLease = await firstStore.claimJob({ leaseMs: 1_000, now: T0, workerId: "worker-a" });
    assert.ok(firstLease);
    assert.equal(firstLease.generation, 1);
    assert.equal(
      await secondStore.claimJob({ leaseMs: 1_000, now: plusMs(T0, 500), workerId: "worker-b" }),
      null,
    );

    const secondLease = await secondStore.claimJob({
      leaseMs: 1_000,
      now: plusMs(T0, 1_001),
      workerId: "worker-b",
    });
    assert.ok(secondLease);
    assert.equal(secondLease.generation, 2);
    assert.equal(secondLease.attempt, 2);

    await assert.rejects(
      firstStore.settleJobSuccess(firstLease, artifact("stale-result"), plusMs(T0, 1_100)),
      LeaseRejectedError,
    );
    const settled = await secondStore.settleJobSuccess(
      secondLease,
      artifact("fresh-result"),
      plusMs(T0, 1_100),
    );
    assert.equal(settled.status, "SUCCEEDED");
    assert.equal(settled.leaseGeneration, 2);
    assert.deepEqual(settled.result, artifact("fresh-result"));

    firstStore.close();
    secondStore.close();
  } finally {
    await temporary.cleanup();
  }
});

test("retry consumes attempts and the configured ceiling becomes BLOCKED", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await store.enqueueJob(job("job-retry", { maxAttempts: 2 }));
    const firstLease = await store.claimJob({ leaseMs: 5_000, now: T0, workerId: "worker" });
    assert.ok(firstLease);
    const retry = await store.settleJobRetry(firstLease, "transient_failure", 0, plusMs(T0, 1));
    assert.equal(retry.status, "RETRY_WAIT");
    assert.equal(retry.attemptCount, 1);

    const secondLease = await store.claimJob({
      leaseMs: 5_000,
      now: plusMs(T0, 2),
      workerId: "worker",
    });
    assert.ok(secondLease);
    const exhausted = await store.settleJobRetry(
      secondLease,
      "same_strategy_failed",
      0,
      plusMs(T0, 3),
    );
    assert.equal(exhausted.status, "BLOCKED");
    assert.equal(exhausted.attemptCount, 2);
    assert.equal(
      await store.claimJob({ leaseMs: 5_000, now: plusMs(T0, 10), workerId: "worker" }),
      null,
    );
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("cancellation wins over a late success proposal", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await store.enqueueJob(job("job-cancel"));
    const lease = await store.claimJob({ leaseMs: 10_000, now: T0, workerId: "worker" });
    assert.ok(lease);
    const cancelling = await store.cancelJob("job-cancel", plusMs(T0, 1));
    assert.equal(cancelling.status, "CANCELLING");

    const cancelled = await store.settleJobSuccess(
      lease,
      artifact("too-late"),
      plusMs(T0, 2),
    );
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.result, null);
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("mission-scoped lifecycle cursors resume strictly after the supplied cursor", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await store.enqueueJob(job("job-a", { missionId: "mission-cursor" }));
    await store.enqueueJob(job("foreign", { missionId: "mission-foreign" }));
    await store.enqueueJob(job("job-b", { missionId: "mission-cursor" }));
    const lease = await store.claimJob({ leaseMs: 5_000, now: T0, workerId: "worker" });
    assert.ok(lease);

    const firstPage = await store.readJobEvents("mission-cursor", 0, 2);
    assert.equal(firstPage.length, 2);
    assert.ok(firstPage[0] && firstPage[1]);
    assert.ok(firstPage[0].cursor < firstPage[1].cursor);
    const secondPage = await store.readJobEvents(
      "mission-cursor",
      firstPage[1].cursor,
      10,
    );
    const cursors = [...firstPage, ...secondPage].map((event) => event.cursor);
    assert.equal(new Set(cursors).size, cursors.length);
    assert.ok(cursors.every((cursor, index) => index === 0 || cursor > (cursors[index - 1] ?? -1)));
    assert.ok([...firstPage, ...secondPage].every((event) => event.missionId === "mission-cursor"));
    store.close();
  } finally {
    await temporary.cleanup();
  }
});
