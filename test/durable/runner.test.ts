import assert from "node:assert/strict";
import test from "node:test";
import {
  DurableJobRunner,
  type JobHandler,
  SqliteDurableStore,
} from "../../src/durable/index.js";
import type { JobEnqueueInput } from "../../src/durable/types.js";
import { artifact, T0, temporaryDatabase } from "./helpers.js";

function enqueue(jobId: string, maxAttempts = 3): JobEnqueueInput {
  return {
    availableAt: T0,
    createdAt: T0,
    idempotencyKey: `enqueue-${jobId}`,
    jobId,
    maxAttempts,
    missionId: "mission-runner",
    payload: artifact(`payload-${jobId}`),
    priority: 50,
    taskId: `task-${jobId}`,
  };
}

function runner(
  store: SqliteDurableStore,
  handler: JobHandler,
  options: Partial<{
    heartbeatMs: number;
    leaseMs: number;
    timeoutMs: number;
  }> = {},
): DurableJobRunner {
  return new DurableJobRunner(
    store,
    handler,
    {
      heartbeatMs: options.heartbeatMs ?? 20,
      leaseMs: options.leaseMs ?? 1_000,
      timeoutMs: options.timeoutMs ?? 500,
      workerId: "runner-worker",
    },
    () => T0,
  );
}

test("runner settles a bounded structured success without giving the handler store authority", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await store.enqueueJob(enqueue("job-success"));
    const handler: JobHandler = {
      async execute(lease, signal) {
        assert.equal(signal.aborted, false);
        assert.equal(lease.jobId, "job-success");
        assert.equal("store" in lease, false);
        return { outcome: "SUCCEEDED", result: artifact("runner-success") };
      },
    };

    const result = await runner(store, handler).runNext();
    assert.deepEqual(result, {
      finalStatus: "SUCCEEDED",
      generation: 1,
      jobId: "job-success",
    });
    assert.equal((await store.getJob("job-success"))?.status, "SUCCEEDED");
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("handler exceptions normalize to a stable retry code without persisting raw error text", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await store.enqueueJob(enqueue("job-error"));
    const secretMessage = "raw-worker-secret-should-never-persist";
    const handler: JobHandler = {
      async execute() {
        throw new Error(secretMessage);
      },
    };

    const result = await runner(store, handler).runNext();
    assert.equal(result?.finalStatus, "RETRY_WAIT");
    const events = await store.readJobEvents("mission-runner", 0, 20);
    const retry = events.find((event) => event.type === "job.retry_scheduled");
    assert.equal(retry?.reasonCode, "handler_error");
    assert.equal(JSON.stringify(events).includes(secretMessage), false);
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("runner timeout aborts cooperatively and normalizes to handler_timeout", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await store.enqueueJob(enqueue("job-timeout"));
    let observedAbort = false;
    const handler: JobHandler = {
      async execute(_lease, signal) {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true },
          );
        });
        return { outcome: "SUCCEEDED", result: artifact("should-not-win") };
      },
    };

    const result = await runner(store, handler, {
      heartbeatMs: 2,
      leaseMs: 100,
      timeoutMs: 8,
    }).runNext();
    assert.equal(observedAbort, true);
    assert.equal(result?.finalStatus, "RETRY_WAIT");
    const events = await store.readJobEvents("mission-runner", 0, 20);
    assert.equal(
      events.find((event) => event.type === "job.retry_scheduled")?.reasonCode,
      "handler_timeout",
    );
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("runner heartbeat observes CANCELLING and cancellation defeats worker success", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await store.enqueueJob(enqueue("job-cooperative-cancel"));
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    let observedAbort = false;
    const handler: JobHandler = {
      async execute(_lease, signal) {
        startedResolve?.();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true },
          );
        });
        return { outcome: "SUCCEEDED", result: artifact("late-worker-success") };
      },
    };

    const running = runner(store, handler, {
      heartbeatMs: 3,
      leaseMs: 100,
      timeoutMs: 500,
    }).runNext();
    await started;
    assert.equal((await store.cancelJob("job-cooperative-cancel", T0)).status, "CANCELLING");
    const result = await running;
    assert.equal(observedAbort, true);
    assert.equal(result?.finalStatus, "CANCELLED");
    assert.equal((await store.getJob("job-cooperative-cancel"))?.result, null);
    store.close();
  } finally {
    await temporary.cleanup();
  }
});
