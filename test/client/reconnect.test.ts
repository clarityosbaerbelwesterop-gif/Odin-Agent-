import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientProtocolError,
  ClientProtocolGateway,
  InMemoryClientCapabilityPolicy,
  reduceClientState,
} from "../../src/client/index.js";
import { SqliteDurableStore } from "../../src/durable/index.js";
import {
  capability,
  executingMission,
  job,
  plusMs,
  stateRequest,
  T0,
  temporaryDatabase,
} from "./helpers.js";

function gateway(store: SqliteDurableStore): ClientProtocolGateway {
  return new ClientProtocolGateway({
    activity: store,
    capabilities: new InMemoryClientCapabilityPolicy([capability()]),
    clock: () => T0,
    events: store,
  });
}

test("bootstrap and paged reconnect reduce deterministically independent of page chunking", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await executingMission(store);
    for (const id of ["job-a", "job-b", "job-c"]) await store.enqueueJob(job(id));
    const lease = await store.claimJob({ leaseMs: 1_000, now: T0, workerId: "worker" });
    assert.ok(lease);
    await store.settleJobSuccess(
      lease,
      { artifactId: "result", sha256: "1".repeat(64) },
      plusMs(T0, 1),
    );

    const api = gateway(store);
    const first = await api.state(stateRequest("mission-client", { limit: 2 }));
    assert.equal(first.hasMore, true);
    let paged = reduceClientState(null, first);
    while (true) {
      const page = await api.state(
        stateRequest("mission-client", {
          afterCursor: paged.cursor,
          limit: 2,
          requestId: `page-${paged.cursor}`,
        }),
      );
      paged = reduceClientState(paged, page);
      if (!page.hasMore) break;
    }

    const all = await api.state(stateRequest("mission-client", { limit: 99, requestId: "all" }));
    const oneShot = reduceClientState(null, all);
    assert.equal(paged.cursor, oneShot.cursor);
    assert.deepEqual(paged.projection, oneShot.projection);
    assert.deepEqual(paged.recentEventHashes, oneShot.recentEventHashes);
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("duplicate pages are idempotent while changed hashes, cursor gaps, and foreign sessions require resync", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await executingMission(store);
    await store.enqueueJob(job("job-duplicate"));
    const api = gateway(store);
    const first = await api.state(stateRequest());
    const initial = reduceClientState(null, first);
    assert.deepEqual(reduceClientState(initial, first), initial);

    const tampered = structuredClone(first);
    const event = tampered.events[0];
    assert.ok(event);
    const tamperedResponse = {
      ...tampered,
      events: [{ ...event, eventHash: "0".repeat(64) }, ...tampered.events.slice(1)],
    };
    assert.throws(
      () => reduceClientState(initial, tamperedResponse),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "RESYNC_REQUIRED",
    );

    const gap = await api.state(
      stateRequest("mission-client", {
        afterCursor: initial.cursor + 1,
        requestId: "gap",
      }),
    );
    assert.throws(
      () => reduceClientState(initial, gap),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "RESYNC_REQUIRED",
    );

    assert.throws(
      () => reduceClientState(initial, { ...first, sessionId: "other-session" }),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "RESYNC_REQUIRED",
    );
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("a fresh gateway over reopened M8 SQLite resumes strictly after the stored lifecycle cursor", async () => {
  const temporary = await temporaryDatabase();
  try {
    const firstStore = new SqliteDurableStore(temporary.path);
    await executingMission(firstStore);
    await firstStore.enqueueJob(job("job-before-reopen"));
    const first = await gateway(firstStore).state(stateRequest());
    const beforeReopen = reduceClientState(null, first);
    firstStore.close();

    const reopened = new SqliteDurableStore(temporary.path);
    await reopened.enqueueJob(job("job-after-reopen"));
    const resumedResponse = await gateway(reopened).state(
      stateRequest("mission-client", {
        afterCursor: beforeReopen.cursor,
        requestId: "after-reopen",
      }),
    );
    assert.equal(resumedResponse.fromCursor, beforeReopen.cursor);
    assert.ok(resumedResponse.events.length > 0);
    assert.ok(resumedResponse.events.every((event) => event.cursor > beforeReopen.cursor));
    const resumed = reduceClientState(beforeReopen, resumedResponse);
    assert.ok(resumed.cursor > beforeReopen.cursor);
    reopened.close();
  } finally {
    await temporary.cleanup();
  }
});

test("client projection omits lease bearer tokens, definitions of done, failure signatures, and raw worker text", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await executingMission(store);
    await store.enqueueJob(job("job-private"));
    const lease = await store.claimJob({ leaseMs: 1_000, now: T0, workerId: "worker-private" });
    assert.ok(lease);
    await store.settleJobRetry(lease, "handler_error", 0, plusMs(T0, 1));

    const response = await gateway(store).state(stateRequest());
    const serialized = JSON.stringify(response);
    assert.equal(serialized.includes(lease.token), false);
    assert.equal(serialized.includes("definitionOfDone"), false);
    assert.equal(serialized.includes("failureCounts"), false);
    assert.equal(serialized.includes("raw-worker-secret"), false);
    assert.equal(serialized.includes("handler_error"), true);
    store.close();
  } finally {
    await temporary.cleanup();
  }
});
