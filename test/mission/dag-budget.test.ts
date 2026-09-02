import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryEventStore } from "../../src/events/index.js";
import {
  BudgetExceededError,
  canRetry,
  MissionDomainError,
  MissionRuntime,
  runnableTasks,
  type MissionEventData,
  validateTaskGraph,
} from "../../src/mission/index.js";
import { fixedClock, missionInput, ZERO } from "./helpers.js";

test("task DAG validation rejects malformed dependency graphs", () => {
  const base = {
    definitionOfDone: ["done"],
    title: "Task",
  };
  assert.throws(
    () => validateTaskGraph([{ ...base, id: "a" }, { ...base, id: "a" }]),
    /Duplicate task id/,
  );
  assert.throws(
    () => validateTaskGraph([{ ...base, dependsOn: ["missing"], id: "a" }]),
    /missing task/,
  );
  assert.throws(
    () => validateTaskGraph([{ ...base, dependsOn: ["a"], id: "a" }]),
    /depend on itself/,
  );
  assert.throws(
    () =>
      validateTaskGraph([
        { ...base, dependsOn: ["b"], id: "a" },
        { ...base, dependsOn: ["a"], id: "b" },
      ]),
    /cycle/,
  );
  assert.throws(
    () => validateTaskGraph([{ ...base, dependsOn: ["b", "b"], id: "a" }, { ...base, id: "b" }]),
    /duplicate dependencies/,
  );
});

test("scheduler selects only dependency-ready work with stable priority ordering", async () => {
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), fixedClock());
  let snapshot = await runtime.create(missionInput("scheduler"), "create");
  assert.deepEqual(runnableTasks(snapshot).map((task) => task.id), ["inspect"]);

  snapshot = await runtime.setTaskStatus(snapshot.id, snapshot.version, "inspect", "RUNNING", "inspect-run");
  snapshot = await runtime.setTaskStatus(snapshot.id, snapshot.version, "inspect", "VERIFIED", "inspect-ok");
  assert.deepEqual(runnableTasks(snapshot).map((task) => task.id), ["verify", "implement"]);
});

test("budget accounting accepts the boundary and rejects any overrun without appending", async () => {
  const store = new InMemoryEventStore<MissionEventData>();
  const runtime = new MissionRuntime(store, fixedClock());
  let snapshot = await runtime.create(missionInput("budget"), "create");
  snapshot = await runtime.debitBudget(
    snapshot.id,
    snapshot.version,
    {
      attempts: 4,
      costMicros: 100_000,
      inputTokens: 10_000,
      outputTokens: 5_000,
      toolCalls: 20,
    },
    "full-budget",
  );
  assert.deepEqual(snapshot.budgetUsage, snapshot.budgetLimits);
  const versionBeforeRejection = snapshot.version;

  await assert.rejects(
    runtime.debitBudget(snapshot.id, snapshot.version, { ...ZERO, toolCalls: 1 }, "over-budget"),
    (error: unknown) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.dimension, "toolCalls");
      return true;
    },
  );
  assert.equal((await runtime.load(snapshot.id)).version, versionBeforeRejection);
  await assert.rejects(
    runtime.debitBudget(snapshot.id, snapshot.version, { ...ZERO, attempts: -1 }, "negative"),
    MissionDomainError,
  );
});

test("equivalent failure circuit breaker fails the mission at its configured bound", async () => {
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), fixedClock());
  let snapshot = await runtime.create(missionInput("breaker"), "create");
  snapshot = await runtime.transition(snapshot.id, snapshot.version, "UNDERSTANDING", "understand");
  assert.equal(canRetry(snapshot, "lint:same", 2), true);

  snapshot = await runtime.recordFailure(snapshot.id, snapshot.version, "lint:same", 2, "failure-1");
  assert.equal(snapshot.failureCounts["lint:same"], 1);
  assert.equal(snapshot.state, "UNDERSTANDING");

  snapshot = await runtime.recordFailure(snapshot.id, snapshot.version, "lint:same", 2, "failure-2");
  assert.equal(snapshot.failureCounts["lint:same"], 2);
  assert.equal(snapshot.state, "FAILED");
  assert.equal(canRetry(snapshot, "lint:same", 2), false);
  await assert.rejects(
    runtime.recordFailure(snapshot.id, snapshot.version, "lint:same", 2, "failure-3"),
    /actively executing/,
  );
});
