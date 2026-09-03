import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStoreConflictError } from "../../src/events/store.js";
import { createMissionCheckpoint } from "../../src/mission/checkpoint.js";
import { MissionRuntime } from "../../src/mission/runtime.js";
import {
  DurableStoreConflictError,
  DurableStoreCorruptionError,
  SqliteDurableStore,
} from "../../src/durable/index.js";
import { missionInput, plusMs, T0, temporaryDatabase } from "./helpers.js";

test("SQLite mission events survive close/reopen with idempotency and exact replay", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    const runtime = new MissionRuntime(store, () => T0);
    const created = await runtime.create(missionInput("mission-reopen"), "create");
    assert.equal(created.version, 1);

    const transitioned = await runtime.transition(
      created.id,
      created.version,
      "UNDERSTANDING",
      "to-understanding",
    );
    assert.equal(transitioned.version, 2);
    store.close();

    const reopened = new SqliteDurableStore(temporary.path);
    const freshRuntime = new MissionRuntime(reopened, () => plusMs(T0, 1_000));
    const replayed = await freshRuntime.load("mission-reopen");
    assert.deepEqual(replayed, transitioned);

    const idempotent = await reopened.append("mission-reopen", 1, "to-understanding", [
      {
        data: {
          from: "CREATED",
          to: "UNDERSTANDING",
          type: "mission.transitioned",
        },
        occurredAt: T0,
      },
    ]);
    assert.equal(idempotent.length, 1);
    assert.equal(idempotent[0]?.sequence, 2);

    await assert.rejects(
      reopened.append("mission-reopen", 2, "to-understanding", [
        {
          data: {
            from: "UNDERSTANDING",
            to: "RETRIEVING",
            type: "mission.transitioned",
          },
          occurredAt: T0,
        },
      ]),
      EventStoreConflictError,
    );

    const next = await freshRuntime.transition(
      replayed.id,
      replayed.version,
      "RETRIEVING",
      "to-retrieving",
    );
    assert.equal(next.version, 3);
    assert.equal(next.state, "RETRIEVING");
    reopened.close();
  } finally {
    await temporary.cleanup();
  }
});

test("durable checkpoints are idempotent, reject regression, and reproject from canonical events", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    const runtime = new MissionRuntime(store, () => T0);
    const created = await runtime.create(missionInput("mission-checkpoint"), "create");
    const checkpointV1 = createMissionCheckpoint(created, created.version);
    const transitioned = await runtime.transition(
      created.id,
      created.version,
      "UNDERSTANDING",
      "advance",
    );
    const checkpointV2 = createMissionCheckpoint(transitioned, transitioned.version);

    assert.deepEqual(await store.saveCheckpoint(checkpointV2, plusMs(T0, 10)), checkpointV2);
    assert.deepEqual(await store.saveCheckpoint(checkpointV2, plusMs(T0, 20)), checkpointV2);
    await assert.rejects(
      store.saveCheckpoint(checkpointV1, plusMs(T0, 30)),
      DurableStoreConflictError,
    );
    store.close();

    const reopened = new SqliteDurableStore(temporary.path);
    assert.deepEqual(await reopened.loadCheckpoint("mission-checkpoint"), checkpointV2);
    assert.deepEqual(await new MissionRuntime(reopened).load("mission-checkpoint"), transitioned);
    reopened.close();
  } finally {
    await temporary.cleanup();
  }
});

test("tampered checkpoint payloads and newer SQLite schema versions fail closed", async () => {
  const temporary = await temporaryDatabase();
  try {
    const store = new SqliteDurableStore(temporary.path);
    const runtime = new MissionRuntime(store, () => T0);
    const created = await runtime.create(missionInput("mission-corrupt"), "create");
    const checkpoint = createMissionCheckpoint(created, created.version);
    await store.saveCheckpoint(checkpoint, T0);
    store.close();

    const raw = new DatabaseSync(temporary.path);
    const tampered = structuredClone(checkpoint);
    const mutableSnapshot = tampered.snapshot as {
      objective: string;
    };
    mutableSnapshot.objective = "tampered objective";
    raw
      .prepare("UPDATE mission_checkpoints SET checkpoint_json = ? WHERE mission_id = ?")
      .run(JSON.stringify(tampered), "mission-corrupt");
    raw.close();

    const reopened = new SqliteDurableStore(temporary.path);
    await assert.rejects(
      reopened.loadCheckpoint("mission-corrupt"),
      DurableStoreCorruptionError,
    );
    reopened.close();

    const newer = new DatabaseSync(temporary.path);
    newer.exec("PRAGMA user_version = 99");
    newer.close();
    assert.throws(() => new SqliteDurableStore(temporary.path), DurableStoreCorruptionError);
  } finally {
    await temporary.cleanup();
  }
});
