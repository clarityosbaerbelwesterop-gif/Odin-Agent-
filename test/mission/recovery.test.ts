import assert from "node:assert/strict";
import test from "node:test";
import {
  type EventAppendItem,
  EventStoreConflictError,
  InMemoryEventStore,
} from "../../src/events/index.js";
import {
  createMissionCheckpoint,
  MissionDomainError,
  type MissionEventData,
  MissionRuntime,
  projectMission,
  restoreMissionCheckpoint,
} from "../../src/mission/index.js";
import { fixedClock, missionInput } from "./helpers.js";

test("event store provides optimistic concurrency, atomic batches, and strict idempotency", async () => {
  const store = new InMemoryEventStore<{ readonly value: number }>();
  const batch: readonly EventAppendItem<{ readonly value: number }>[] = [
    { data: { value: 1 }, occurredAt: "2026-09-02T20:00:00.000Z" },
    { data: { value: 2 }, occurredAt: "2026-09-02T20:00:01.000Z" },
  ];
  const firstItem = batch[0];
  if (firstItem === undefined) throw new Error("Test fixture is missing its first event.");
  const first = await store.append("m", 0, "batch-1", batch);
  assert.deepEqual(
    first.map((event) => event.sequence),
    [1, 2],
  );

  const replay = await store.append("m", 0, "batch-1", batch);
  assert.deepEqual(replay, first);
  await assert.rejects(
    store.append("m", 0, "batch-1", [{ ...firstItem, data: { value: 9 } }]),
    /different event batch/,
  );
  await assert.rejects(store.append("m", 0, "stale-writer", [firstItem]), EventStoreConflictError);
  assert.equal((await store.load("m")).length, 2);
});

test("mission replay is equivalent to live projection", async () => {
  const store = new InMemoryEventStore<MissionEventData>();
  const runtime = new MissionRuntime(store, fixedClock());
  let live = await runtime.create(missionInput("replay"), "create");
  live = await runtime.transition(live.id, live.version, "UNDERSTANDING", "understand");
  live = await runtime.setTaskStatus(live.id, live.version, "inspect", "RUNNING", "task-run");

  const replayed = projectMission(await store.load(live.id));
  assert.deepEqual(replayed, live);
});

test("checkpoints round-trip and reject foreign or tampered state", async () => {
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), fixedClock());
  let snapshot = await runtime.create(missionInput("checkpoint"), "create");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "UNDERSTANDING", "understand");
  const checkpoint = createMissionCheckpoint(snapshot, snapshot.version);
  assert.deepEqual(restoreMissionCheckpoint(checkpoint, snapshot.id), snapshot);

  assert.throws(() => restoreMissionCheckpoint(checkpoint, "other-mission"), /identity/);
  const tampered = structuredClone(checkpoint);
  (tampered.snapshot as { objective: string }).objective = "Tampered objective";
  assert.throws(() => restoreMissionCheckpoint(tampered, snapshot.id), /integrity/);
  assert.throws(() => createMissionCheckpoint(snapshot, snapshot.version + 1), /must match/);
});

test("an interrupted runtime recovers from events and continues deterministically", async () => {
  const store = new InMemoryEventStore<MissionEventData>();
  const firstProcess = new MissionRuntime(store, fixedClock());
  let beforeCrash = await firstProcess.create(missionInput("resume"), "create");
  beforeCrash = await firstProcess.transition(
    beforeCrash.id,
    beforeCrash.version,
    "UNDERSTANDING",
    "understand",
  );

  const restartedProcess = new MissionRuntime(store, fixedClock());
  const recovered = await restartedProcess.load(beforeCrash.id);
  assert.deepEqual(recovered, beforeCrash);
  const continued = await restartedProcess.transition(
    recovered.id,
    recovered.version,
    "RETRIEVING",
    "retrieve-after-restart",
  );
  assert.equal(continued.state, "RETRIEVING");
  assert.equal(continued.version, recovered.version + 1);
});

test("projection rejects a foreign mission identity at stream creation", async () => {
  const store = new InMemoryEventStore<MissionEventData>();
  await store.append("stream-id", 0, "create", [
    {
      data: { input: missionInput("different-id"), type: "mission.created" },
      occurredAt: "2026-09-02T20:00:00.000Z",
    },
  ]);
  const events = await store.load("stream-id");
  assert.throws(() => projectMission(events), MissionDomainError);
});
