import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CoordinationError,
  SpecialistCoordinator,
  type SpecialistCoordinatorOptions,
} from "../../src/coordination/index.js";
import {
  coordinatorOptions,
  missionSnapshot,
  NOW,
  profile,
  registryWith,
  successWorker,
  task,
  taskSpec,
} from "./helpers.js";

test("planning assigns only dependency-ready tasks and reports missing specifications", () => {
  const tasks = [
    task("verify", 20, ["implement"]),
    task("document", 15),
    task("implement", 10, ["inspect"]),
    task("inspect", 5),
  ];
  const snapshot = missionSnapshot(tasks, {
    implement: "PENDING",
    inspect: "VERIFIED",
    verify: "PENDING",
    document: "PENDING",
  });
  const registry = registryWith([
    [profile("z-specialist"), successWorker()],
    [profile("a-specialist"), successWorker()],
  ]);
  const coordinator = new SpecialistCoordinator(registry, coordinatorOptions());

  const plan = coordinator.plan(snapshot, [taskSpec("implement"), taskSpec("verify")]);

  assert.deepEqual(
    plan.assignments.map((item) => item.taskId),
    ["implement"],
  );
  assert.equal(plan.assignments[0]?.lease.specialistId, "a-specialist");
  assert.deepEqual(plan.deferred, [
    { conflictsWithTaskIds: [], reason: "dependency_blocked", taskId: "verify" },
    { conflictsWithTaskIds: [], reason: "missing_spec", taskId: "document" },
  ]);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.assignments[0]), true);
});

test("equivalent fresh coordinators produce the same task order, specialist, IDs, and hashes", () => {
  const snapshot = missionSnapshot([task("lower", 1), task("higher", 9)]);
  const specs = [taskSpec("lower"), taskSpec("higher")];
  const makeCoordinator = (): SpecialistCoordinator =>
    new SpecialistCoordinator(
      registryWith([
        [profile("specialist-b"), successWorker()],
        [profile("specialist-a"), successWorker()],
      ]),
      coordinatorOptions(),
    );

  const left = makeCoordinator().plan(snapshot, specs);
  const right = makeCoordinator().plan(snapshot, [...specs].reverse());

  assert.deepEqual(left, right);
  assert.deepEqual(
    left.assignments.map((item) => item.taskId),
    ["higher", "lower"],
  );
  assert.deepEqual(
    left.assignments.map((item) => item.lease.specialistId),
    ["specialist-a", "specialist-a"],
  );
});

test("batch, runtime, and per-specialist concurrency bounds return typed deferrals", () => {
  const snapshot = missionSnapshot([task("one", 30), task("two", 20), task("three", 10)]);
  const specs = [taskSpec("one"), taskSpec("two"), taskSpec("three")];

  const batchCoordinator = new SpecialistCoordinator(
    registryWith([[profile("batch-worker"), successWorker()]]),
    coordinatorOptions({ maxBatchSize: 1 }),
  );
  const batchPlan = batchCoordinator.plan(snapshot, specs);
  assert.deepEqual(
    batchPlan.assignments.map((item) => item.taskId),
    ["one"],
  );
  assert.deepEqual(
    batchPlan.deferred.map((item) => item.reason),
    ["batch_limit", "batch_limit"],
  );

  const workerCoordinator = new SpecialistCoordinator(
    registryWith([[profile("single-worker", { maxConcurrency: 1 }), successWorker()]]),
    coordinatorOptions(),
  );
  const workerPlan = workerCoordinator.plan(snapshot, specs);
  assert.deepEqual(
    workerPlan.assignments.map((item) => item.taskId),
    ["one"],
  );
  assert.deepEqual(
    workerPlan.deferred.map((item) => item.reason),
    ["specialist_capacity", "specialist_capacity"],
  );

  const runtimeCoordinator = new SpecialistCoordinator(
    registryWith([[profile("runtime-worker"), successWorker()]]),
    coordinatorOptions({ maxActiveAssignments: 1 }),
  );
  const runtimePlan = runtimeCoordinator.plan(snapshot, specs);
  assert.deepEqual(
    runtimePlan.assignments.map((item) => item.taskId),
    ["one"],
  );
  assert.deepEqual(
    runtimePlan.deferred.map((item) => item.reason),
    ["runtime_capacity", "runtime_capacity"],
  );
});

test("read sharing is allowed while repository ancestor writes conflict", () => {
  const snapshot = missionSnapshot([
    task("reader-a", 40),
    task("reader-b", 30),
    task("writer", 20),
    task("other", 10),
  ]);
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("ownership-worker"), successWorker()]]),
    coordinatorOptions(),
  );
  const plan = coordinator.plan(snapshot, [
    taskSpec("reader-a", [{ access: "read", key: "src/shared", namespace: "repository" }]),
    taskSpec("reader-b", [{ access: "read", key: "src/shared/file.ts", namespace: "repository" }]),
    taskSpec("writer", [{ access: "write", key: "src/shared/file.ts", namespace: "repository" }]),
    taskSpec("other", [{ access: "write", key: "src/other.ts", namespace: "repository" }]),
  ]);

  assert.deepEqual(
    plan.assignments.map((item) => item.taskId),
    ["reader-a", "reader-b", "other"],
  );
  assert.deepEqual(plan.deferred, [
    {
      conflictsWithTaskIds: ["reader-a", "reader-b"],
      reason: "ownership_conflict",
      taskId: "writer",
    },
  ]);
});

test("resource and state writes conflict only in their exact namespace", () => {
  const snapshot = missionSnapshot([
    task("resource-owner", 50),
    task("resource-reader", 40),
    task("state-owner", 30),
    task("state-reader", 20),
    task("different-namespace", 10),
  ]);
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("shared-worker"), successWorker()]]),
    coordinatorOptions(),
  );
  const plan = coordinator.plan(snapshot, [
    taskSpec("resource-owner", [{ access: "write", key: "database:users", namespace: "resource" }]),
    taskSpec("resource-reader", [{ access: "read", key: "database:users", namespace: "resource" }]),
    taskSpec("state-owner", [{ access: "write", key: "release:status", namespace: "state" }]),
    taskSpec("state-reader", [{ access: "read", key: "release:status", namespace: "state" }]),
    taskSpec("different-namespace", [
      { access: "read", key: "release:status", namespace: "resource" },
    ]),
  ]);

  assert.deepEqual(
    plan.assignments.map((item) => item.taskId),
    ["resource-owner", "state-owner", "different-namespace"],
  );
  assert.deepEqual(
    plan.deferred.map((item) => [item.taskId, item.reason, item.conflictsWithTaskIds]),
    [
      ["resource-reader", "ownership_conflict", ["resource-owner"]],
      ["state-reader", "ownership_conflict", ["state-owner"]],
    ],
  );
});

test("active task leases prevent duplicate assignment and expired leases can be replaced", async () => {
  let current = NOW;
  const options: SpecialistCoordinatorOptions = coordinatorOptions({ clock: () => current });
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("lease-worker"), successWorker()]]),
    options,
  );
  const snapshot = missionSnapshot([task("leased", 1)]);
  const specs = [taskSpec("leased")];

  const first = coordinator.plan(snapshot, specs);
  assert.equal(coordinator.activeLeases().length, 1);
  const duplicate = coordinator.plan(snapshot, specs);
  assert.equal(duplicate.assignments.length, 0);
  assert.equal(duplicate.deferred[0]?.reason, "task_already_leased");

  current = "2026-09-03T12:01:00.000Z";
  assert.equal(coordinator.activeLeases().length, 0);
  await assert.rejects(coordinator.execute(first), /released|replayed/u);
  const replacement = coordinator.plan(snapshot, specs);
  assert.equal(replacement.assignments[0]?.lease.generation, 2);
});

test("active cross-plan ownership is respected until its plan releases the lease", () => {
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("cross-plan-worker"), successWorker()]]),
    coordinatorOptions(),
  );
  const snapshot = missionSnapshot([task("owner", 20), task("contender", 10)]);
  const ownerPlan = coordinator.plan(snapshot, [
    taskSpec("owner", [{ access: "write", key: "src/shared", namespace: "repository" }]),
  ]);
  const contenderPlan = coordinator.plan(snapshot, [
    taskSpec("contender", [{ access: "read", key: "src/shared/file.ts", namespace: "repository" }]),
  ]);

  assert.deepEqual(contenderPlan.assignments, []);
  assert.deepEqual(
    contenderPlan.deferred.map((item) => [item.taskId, item.reason, item.conflictsWithTaskIds]),
    [
      ["owner", "missing_spec", []],
      ["contender", "ownership_conflict", ["owner"]],
    ],
  );
  assert.equal(coordinator.releasePlan(ownerPlan.planHash), true);
  const afterRelease = coordinator.plan(snapshot, [taskSpec("contender")]);
  assert.deepEqual(
    afterRelease.assignments.map((item) => item.taskId),
    ["contender"],
  );
});

test("missing role or capability matches are reported without reserving ownership", () => {
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("typescript-only"), successWorker()]]),
    coordinatorOptions(),
  );
  const snapshot = missionSnapshot([task("security", 1)]);
  const plan = coordinator.plan(snapshot, [
    taskSpec("security", [], { requiredCapabilities: ["security"], role: "reviewer" }),
  ]);

  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.deferred[0]?.reason, "missing_specialist");
  assert.equal(coordinator.activeLeases().length, 0);
});

test("clock rollback fails closed instead of extending active leases", () => {
  let current = NOW;
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("clock-worker"), successWorker()]]),
    coordinatorOptions({ clock: () => current }),
  );
  const snapshot = missionSnapshot([task("clock", 1)]);
  coordinator.plan(snapshot, [taskSpec("clock")]);
  current = "2026-09-03T11:59:59.999Z";

  assert.throws(() => coordinator.activeLeases(), /cannot move backwards/u);
});

test("invalid state, unknown tasks, malformed context, ownership, and configuration fail closed", () => {
  const registry = registryWith([[profile("validator"), successWorker()]]);
  const coordinator = new SpecialistCoordinator(registry, coordinatorOptions());
  const snapshot = missionSnapshot([task("valid", 1)]);

  assert.throws(
    () => coordinator.plan({ ...snapshot, state: "PLANNING" }, [taskSpec("valid")]),
    CoordinationError,
  );
  assert.throws(() => coordinator.plan(snapshot, [taskSpec("unknown")]), /unknown task/u);
  assert.throws(
    () =>
      coordinator.plan(snapshot, [
        taskSpec("valid", [], {
          context: { ...taskSpec("valid").context, missionId: "foreign" },
        }),
      ]),
    /foreign/u,
  );
  assert.throws(
    () =>
      coordinator.plan(snapshot, [
        taskSpec("valid", [{ access: "write", key: "../escape", namespace: "repository" }]),
      ]),
    /workspace-relative/u,
  );
  assert.throws(
    () =>
      new SpecialistCoordinator(registry, {
        ...coordinatorOptions(),
        executionTimeoutMs: 61_000,
      }),
    /executionTimeoutMs/u,
  );
});
