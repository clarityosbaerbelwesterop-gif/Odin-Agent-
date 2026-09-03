import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStoreConflictError } from "../../src/events/store.js";
import { createMissionCheckpoint } from "../../src/mission/checkpoint.js";
import {
  type MissionCreateInput,
  type MissionEventData,
  MissionRuntime,
} from "../../src/mission/runtime.js";
import {
  missionEventCodec,
  PersistenceCorruptionError,
  SQLiteEventStore,
  SQLiteMissionCheckpointStore,
} from "../../src/persistence/index.js";

const NOW = "2026-09-03T12:00:00.000Z";

const MISSION: MissionCreateInput = {
  budgetLimits: {
    attempts: 10,
    costMicros: 0,
    inputTokens: 10_000,
    outputTokens: 10_000,
    toolCalls: 10,
  },
  focus: "complex",
  id: "mission-durable",
  objective: "Prove restart-safe mission persistence.",
  tasks: [
    {
      definitionOfDone: ["durable replay passes"],
      id: "task-1",
      title: "Persist mission",
    },
  ],
};

test("SQLite mission events replay identically after close/reopen and continue at the next version", async () => {
  await withDatabase(async (databasePath) => {
    const firstStore = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    const firstRuntime = new MissionRuntime(firstStore, () => NOW);
    let snapshot = await firstRuntime.create(MISSION, "create");
    snapshot = await firstRuntime.transition(
      snapshot.id,
      snapshot.version,
      "UNDERSTANDING",
      "understand",
    );
    const beforeRestart = structuredClone(snapshot);
    firstStore.close();

    const reopenedStore = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    const reopenedRuntime = new MissionRuntime(reopenedStore, () => NOW);
    assert.deepEqual(await reopenedRuntime.load(MISSION.id), beforeRestart);
    const continued = await reopenedRuntime.transition(
      MISSION.id,
      beforeRestart.version,
      "RETRIEVING",
      "retrieve",
    );
    assert.equal(continued.version, beforeRestart.version + 1);
    assert.equal(continued.state, "RETRIEVING");
    reopenedStore.close();
  });
});

test("event idempotency survives reopen and conflicting replay is rejected", async () => {
  await withDatabase(async (databasePath) => {
    const item = {
      data: { input: MISSION, type: "mission.created" } as MissionEventData,
      occurredAt: NOW,
    };
    const firstStore = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    const first = await firstStore.append(MISSION.id, 0, "create", [item]);
    firstStore.close();

    const reopenedStore = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    const replay = await reopenedStore.append(MISSION.id, 999, "create", [item]);
    assert.deepEqual(replay, first);
    await assert.rejects(
      reopenedStore.append(MISSION.id, 1, "create", [
        { ...item, occurredAt: "2026-09-03T12:00:01.000Z" },
      ]),
      EventStoreConflictError,
    );
    assert.equal((await reopenedStore.load(MISSION.id)).length, 1);
    reopenedStore.close();
  });
});

test("validated checkpoints survive reopen and reject tampered persisted content", async () => {
  await withDatabase(async (databasePath) => {
    const eventStore = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    const runtime = new MissionRuntime(eventStore, () => NOW);
    const snapshot = await runtime.create(MISSION, "create");
    const checkpoint = createMissionCheckpoint(snapshot, snapshot.version);

    const checkpoints = new SQLiteMissionCheckpointStore(databasePath, () => NOW);
    await checkpoints.save(checkpoint);
    await checkpoints.save(checkpoint);
    checkpoints.close();
    eventStore.close();

    const reopened = new SQLiteMissionCheckpointStore(databasePath, () => NOW);
    assert.deepEqual(await reopened.load(MISSION.id), checkpoint);
    reopened.close();

    const raw = new DatabaseSync(databasePath);
    raw
      .prepare("UPDATE mission_checkpoints SET snapshot_hash = ? WHERE mission_id = ?")
      .run("0".repeat(64), MISSION.id);
    raw.close();

    const tampered = new SQLiteMissionCheckpointStore(databasePath, () => NOW);
    await assert.rejects(tampered.load(MISSION.id), PersistenceCorruptionError);
    tampered.close();
  });
});

test("persisted mission event corruption and unsupported schema versions fail closed", async () => {
  await withDatabase(async (databasePath) => {
    const store = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    await store.append(MISSION.id, 0, "create", [
      {
        data: { input: MISSION, type: "mission.created" },
        occurredAt: NOW,
      },
    ]);
    store.close();

    const raw = new DatabaseSync(databasePath);
    raw
      .prepare("UPDATE mission_events SET data_json = ? WHERE mission_id = ? AND sequence = 1")
      .run('{"type":"unknown"}', MISSION.id);
    raw.close();

    const corrupt = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    await assert.rejects(corrupt.load(MISSION.id), PersistenceCorruptionError);
    corrupt.close();
  });

  await withDatabase(async (databasePath) => {
    const store = new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec);
    store.close();
    const raw = new DatabaseSync(databasePath);
    raw.prepare("UPDATE odin_meta SET value = '99' WHERE key = 'schema_version'").run();
    raw.close();
    assert.throws(
      () => new SQLiteEventStore<MissionEventData>(databasePath, missionEventCodec),
      PersistenceCorruptionError,
    );
  });
});

async function withDatabase(work: (databasePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "odin-m8-"));
  try {
    await work(join(directory, "odin.sqlite"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
