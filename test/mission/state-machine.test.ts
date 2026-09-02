import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryEventStore } from "../../src/events/index.js";
import {
  MissionDomainError,
  MissionRuntime,
  type MissionEventData,
} from "../../src/mission/index.js";
import { fixedClock, missionInput } from "./helpers.js";

test("mission lifecycle enforces the closed transition table", async () => {
  const store = new InMemoryEventStore<MissionEventData>();
  const runtime = new MissionRuntime(store, fixedClock());
  let snapshot = await runtime.create(missionInput(), "create");
  assert.equal(snapshot.state, "CREATED");
  assert.equal(snapshot.version, 1);

  await assert.rejects(
    runtime.transition(snapshot.id, snapshot.version, "EXECUTING", "bad-transition"),
    MissionDomainError,
  );
  assert.equal((await store.load(snapshot.id)).length, 1);

  snapshot = await runtime.transition(snapshot.id, snapshot.version, "UNDERSTANDING", "understand");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "RETRIEVING", "retrieve");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "PLANNING", "plan");
  assert.equal(snapshot.state, "PLANNING");
  assert.equal(snapshot.version, 4);
});

test("pause and resume return to the exact captured safe state", async () => {
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), fixedClock());
  let snapshot = await runtime.create(missionInput("pause-mission"), "create");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "UNDERSTANDING", "understand");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "PAUSING", "pause-requested");
  assert.equal(snapshot.resumeState, "UNDERSTANDING");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "PAUSED", "paused");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "RESUMING", "resume-requested");

  await assert.rejects(
    runtime.transition(snapshot.id, snapshot.version, "RETRIEVING", "wrong-resume"),
    /captured pre-pause state/,
  );
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "UNDERSTANDING", "resumed");
  assert.equal(snapshot.state, "UNDERSTANDING");
  assert.equal(snapshot.resumeState, null);
});

test("cancellation is deterministic and terminal", async () => {
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), fixedClock());
  let snapshot = await runtime.create(missionInput("cancel-mission"), "create");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "UNDERSTANDING", "understand");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "CANCELLING", "cancel-requested");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "CANCELLED", "cancelled");
  assert.equal(snapshot.state, "CANCELLED");

  await assert.rejects(
    runtime.transition(snapshot.id, snapshot.version, "UNDERSTANDING", "revive"),
    /terminal/,
  );
  await assert.rejects(
    runtime.setTaskStatus(snapshot.id, snapshot.version, "inspect", "RUNNING", "mutate-terminal"),
    /terminal/,
  );
});
