import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientProtocolError,
  ClientProtocolGateway,
  InMemoryClientCapabilityPolicy,
} from "../../src/client/index.js";
import { SqliteDurableStore } from "../../src/durable/index.js";
import { createMissionCheckpoint } from "../../src/mission/checkpoint.js";
import {
  capability,
  commandRequest,
  executingMission,
  plusMs,
  stateRequest,
  T0,
  temporaryDatabase,
} from "./helpers.js";

test("pause, resume, and cancel are atomic M2 command sequences with durable idempotency", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    const executing = await executingMission(store);
    assert.equal(executing.state, "EXECUTING");
    assert.equal(executing.version, 6);
    await store.saveCheckpoint(createMissionCheckpoint(executing, executing.version), T0);

    const gateway = new ClientProtocolGateway({
      activity: store,
      capabilities: new InMemoryClientCapabilityPolicy([capability()]),
      clock: () => T0,
      events: store,
    });

    const paused = await gateway.command(commandRequest("mission.pause", executing.version));
    assert.equal(paused.outcome, "APPLIED");
    assert.equal(paused.projection.state, "PAUSED");
    assert.equal(paused.projection.resumeState, "EXECUTING");
    assert.equal(paused.projection.version, 8);
    assert.equal(paused.projection.checkpointVersion, 6);

    const replay = await gateway.command(
      commandRequest("mission.pause", executing.version, "mission-client", {
        requestId: "pause-replay",
      }),
    );
    assert.equal(replay.outcome, "REPLAYED");
    assert.equal(replay.projection.version, 8);
    assert.equal(replay.projection.checkpointVersion, 6);
    assert.equal((await store.load("mission-client")).length, 8);

    const resumed = await gateway.command(commandRequest("mission.resume", 8));
    assert.equal(resumed.outcome, "APPLIED");
    assert.equal(resumed.projection.state, "EXECUTING");
    assert.equal(resumed.projection.resumeState, null);
    assert.equal(resumed.projection.version, 10);

    const cancelled = await gateway.command(commandRequest("mission.cancel", 10));
    assert.equal(cancelled.outcome, "APPLIED");
    assert.equal(cancelled.projection.state, "CANCELLED");
    assert.equal(cancelled.projection.version, 12);
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("stale commands and conflicting idempotency replay fail without extra mission events", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    const executing = await executingMission(store);
    const gateway = new ClientProtocolGateway({
      activity: store,
      capabilities: new InMemoryClientCapabilityPolicy([capability()]),
      clock: () => T0,
      events: store,
    });
    await gateway.command(commandRequest("mission.pause", executing.version));

    await assert.rejects(
      gateway.command(
        commandRequest("mission.cancel", executing.version, "mission-client", {
          idempotencyKey: "different-stale-key",
        }),
      ),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "STALE_VERSION",
    );
    await assert.rejects(
      gateway.command(
        commandRequest("mission.cancel", executing.version, "mission-client", {
          idempotencyKey: "idem-mission.pause",
        }),
      ),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "CONFLICT",
    );
    assert.equal((await store.load("mission-client")).length, 8);
    store.close();
  } finally {
    await temporary.cleanup();
  }
});

test("client capabilities enforce exact mission/session/read/command scope and runtime expiry", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    await executingMission(store);
    const readOnly = capability("mission-client", {
      commands: [],
      id: "cap-read",
    });
    const expired = capability("mission-client", {
      expiresAt: T0,
      id: "cap-expired",
    });
    const gateway = new ClientProtocolGateway({
      activity: store,
      capabilities: new InMemoryClientCapabilityPolicy([readOnly, expired]),
      clock: () => T0,
      events: store,
    });

    const state = await gateway.state(stateRequest("mission-client", { capabilityId: "cap-read" }));
    assert.equal(state.projection.state, "EXECUTING");
    assert.equal(state.projection.checkpointVersion, null);

    await assert.rejects(
      gateway.command(
        commandRequest("mission.cancel", 6, "mission-client", { capabilityId: "cap-read" }),
      ),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "DENIED",
    );
    await assert.rejects(
      gateway.state(stateRequest("mission-client", { capabilityId: "cap-expired" })),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "DENIED",
    );
    await assert.rejects(
      gateway.state(
        stateRequest("mission-client", {
          capabilityId: "cap-read",
          sessionId: "foreign-session",
        }),
      ),
      ClientProtocolError,
    );
    await assert.rejects(
      gateway.state(
        stateRequest("mission-client", {
          capabilityId: "cap-read",
          requestedAt: plusMs(T0, 10 * 60 * 1_000),
        }),
      ),
      (error: unknown) => error instanceof ClientProtocolError && error.code === "DENIED",
    );
    store.close();
  } finally {
    await temporary.cleanup();
  }
});
