import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CoordinationPlan,
  SpecialistCoordinator,
  type SpecialistProposal,
} from "../../src/coordination/index.js";
import {
  CallbackWorker,
  coordinatorOptions,
  HASH_B,
  missionSnapshot,
  profile,
  registryWith,
  successfulProposal,
  successWorker,
  task,
  taskSpec,
} from "./helpers.js";

test("tampered, foreign, released, and replayed plans never reach a worker", async () => {
  let calls = 0;
  const worker = new CallbackWorker(async (assignment) => {
    calls += 1;
    return successfulProposal(assignment);
  });
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("integrity-worker"), worker]]),
    coordinatorOptions(),
  );
  const snapshot = missionSnapshot([task("integrity", 1)]);
  const specs = [taskSpec("integrity")];
  const original = coordinator.plan(snapshot, specs);
  const tampered: CoordinationPlan = { ...original, missionVersion: original.missionVersion + 1 };

  await assert.rejects(coordinator.execute(tampered), /integrity/u);
  assert.equal(calls, 0);
  assert.equal(coordinator.activeLeases().length, 0);
  await assert.rejects(coordinator.execute(original), /released|replayed/u);

  const valid = coordinator.plan(snapshot, specs);
  const result = await coordinator.execute(valid);
  assert.deepEqual(result.acceptedTaskIds, ["integrity"]);
  assert.equal(calls, 1);
  assert.equal(coordinator.activeLeases().length, 0);
  await assert.rejects(coordinator.execute(valid), /released|replayed/u);

  await assert.rejects(
    coordinator.execute({ ...valid, planHash: "f".repeat(64) }),
    /unknown|foreign/u,
  );
  assert.equal(calls, 1);
});

test("two distinct specialists execute independent ownership in parallel", async () => {
  let started = 0;
  let releaseGate = (): void => {
    throw new Error("Parallel gate was not initialized.");
  };
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const parallelWorker = new CallbackWorker(async (assignment) => {
    assert.equal(Object.isFrozen(assignment), true);
    assert.equal(Object.isFrozen(assignment.context), true);
    started += 1;
    if (started === 2) releaseGate();
    await gate;
    return successfulProposal(assignment, {
      filesChanged: [`src/${assignment.taskId}.ts`],
    });
  });
  const coordinator = new SpecialistCoordinator(
    registryWith([
      [profile("implementer", { roles: ["implementer"] }), parallelWorker],
      [profile("reviewer", { roles: ["reviewer"] }), parallelWorker],
    ]),
    coordinatorOptions(),
  );
  const snapshot = missionSnapshot([task("implementation", 20), task("review", 10)]);
  const plan = coordinator.plan(snapshot, [
    taskSpec("implementation", [
      { access: "write", key: "src/implementation.ts", namespace: "repository" },
    ]),
    taskSpec("review", [{ access: "write", key: "src/review.ts", namespace: "repository" }], {
      role: "reviewer",
    }),
  ]);

  const result = await coordinator.execute(plan);

  assert.equal(started, 2);
  assert.deepEqual(result.acceptedTaskIds, ["implementation", "review"]);
  assert.deepEqual(result.retryTaskIds, []);
  assert.deepEqual(result.blockedTaskIds, []);
  assert.deepEqual(result.reconciliations[0]?.attestedEvidenceIds, ["evidence:implementation"]);
  assert.equal(coordinator.activeLeases().length, 0);
});

test("one failed worker preserves an independently accepted sibling result", async () => {
  const coordinator = new SpecialistCoordinator(
    registryWith([
      [profile("good", { roles: ["implementer"] }), successWorker()],
      [
        profile("broken", { roles: ["reviewer"] }),
        new CallbackWorker(async () => {
          throw new Error("sensitive raw worker detail");
        }),
      ],
    ]),
    coordinatorOptions(),
  );
  const snapshot = missionSnapshot([task("good-task", 20), task("broken-task", 10)]);
  const plan = coordinator.plan(snapshot, [
    taskSpec("good-task"),
    taskSpec("broken-task", [], { role: "reviewer" }),
  ]);

  const result = await coordinator.execute(plan);

  assert.deepEqual(result.acceptedTaskIds, ["good-task"]);
  assert.deepEqual(result.retryTaskIds, ["broken-task"]);
  assert.equal(result.reconciliations[1]?.reasons[0], "worker_failed");
  assert.equal(JSON.stringify(result).includes("sensitive raw worker detail"), false);
  assert.equal(coordinator.activeLeases().length, 0);
});

test("malformed identity, extra reasoning fields, future timestamps, and unowned writes are blocked", async () => {
  const cases: readonly (
    | ((base: SpecialistProposal) => SpecialistProposal)
    | ((base: SpecialistProposal) => unknown)
  )[] = [
    (base) => ({ ...base, taskId: "foreign-task" }),
    (base) => ({ ...base, confidence: 0.99 }),
    (base) => ({ ...base, completedAt: "2026-09-03T12:00:01.000Z" }),
    (base) => ({ ...base, filesChanged: ["src/unowned.ts"] }),
    (base) => ({ ...base, evidence: [base.evidence[0], base.evidence[0]] }),
  ];

  for (const mutate of cases) {
    const worker = new CallbackWorker(
      async (assignment) => mutate(successfulProposal(assignment)) as SpecialistProposal,
    );
    const coordinator = new SpecialistCoordinator(
      registryWith([[profile("untrusted"), worker]]),
      coordinatorOptions(),
    );
    const snapshot = missionSnapshot([task("bounded", 1)]);
    const plan = coordinator.plan(snapshot, [
      taskSpec("bounded", [{ access: "write", key: "src/owned.ts", namespace: "repository" }]),
    ]);

    const result = await coordinator.execute(plan);
    assert.deepEqual(result.blockedTaskIds, ["bounded"]);
    assert.deepEqual(result.reconciliations[0]?.reasons, ["invalid_result"]);
    assert.equal(coordinator.activeLeases().length, 0);
  }
});

test("verification claims require independent passing evidence and no failed evidence", async () => {
  const scenarios: readonly [
    Partial<SpecialistProposal>,
    "BLOCKED" | "RETRY_REQUIRED",
    readonly string[],
  ][] = [
    [{ evidence: [], verificationStatus: "UNVERIFIED" }, "RETRY_REQUIRED", ["not_verified"]],
    [
      {
        evidence: [
          {
            contentHash: "a".repeat(64),
            id: "evidence:evidence",
            kind: "test_run",
            observedAt: "2026-09-03T12:00:00.000Z",
            producerClass: "independent_tool",
            reference: "test:evidence",
            status: "PASS",
          },
          {
            contentHash: HASH_B,
            id: "evidence:fail",
            kind: "test_run",
            observedAt: "2026-09-03T12:00:00.000Z",
            producerClass: "independent_tool",
            reference: "test:fail",
            status: "FAIL",
          },
        ],
      },
      "RETRY_REQUIRED",
      ["failed_evidence"],
    ],
    [
      { evidence: [], outcome: "FAILED", verificationStatus: "FAILED" },
      "RETRY_REQUIRED",
      ["specialist_failed"],
    ],
    [
      { evidence: [], outcome: "BLOCKED", verificationStatus: "BLOCKED" },
      "BLOCKED",
      ["specialist_blocked"],
    ],
  ];

  for (const [overrides, expectedOutcome, reasons] of scenarios) {
    const coordinator = new SpecialistCoordinator(
      registryWith([[profile("evidence-worker"), successWorker(overrides)]]),
      coordinatorOptions(),
    );
    const snapshot = missionSnapshot([task("evidence", 1)]);
    const result = await coordinator.execute(coordinator.plan(snapshot, [taskSpec("evidence")]));
    assert.equal(result.reconciliations[0]?.outcome, expectedOutcome);
    assert.deepEqual(result.reconciliations[0]?.reasons, reasons);
  }
});

test("a worker cannot self-assert independent evidence without runtime attestation", async () => {
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("self-certifier"), successWorker()]]),
    {
      clock: () => "2026-09-03T12:00:00.000Z",
      executionTimeoutMs: 200,
      leaseDurationMs: 60_000,
      maxActiveAssignments: 1,
      maxBatchSize: 1,
    },
  );
  const snapshot = missionSnapshot([task("unsupported", 1)]);
  const result = await coordinator.execute(coordinator.plan(snapshot, [taskSpec("unsupported")]));

  assert.deepEqual(result.retryTaskIds, ["unsupported"]);
  assert.deepEqual(result.reconciliations[0]?.reasons, ["not_verified"]);
  assert.deepEqual(result.reconciliations[0]?.attestedEvidenceIds, []);
});

test("worker timeout aborts the assignment, returns a bounded retry, and releases its lease", async () => {
  let observedSignal: AbortSignal | undefined;
  const worker = new CallbackWorker(
    async (_assignment, signal) =>
      new Promise<SpecialistProposal>(() => {
        observedSignal = signal;
      }),
  );
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("slow-worker"), worker]]),
    coordinatorOptions({ executionTimeoutMs: 5 }),
  );
  const snapshot = missionSnapshot([task("slow", 1)]);
  const result = await coordinator.execute(coordinator.plan(snapshot, [taskSpec("slow")]));

  assert.deepEqual(result.retryTaskIds, ["slow"]);
  assert.deepEqual(result.reconciliations[0]?.reasons, ["worker_timeout"]);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(coordinator.activeLeases().length, 0);
});

test("explicit release during execution prevents a late proposal from being accepted", async () => {
  let returnProposal = (): void => {
    throw new Error("Worker gate was not initialized.");
  };
  const workerGate = new Promise<void>((resolve) => {
    returnProposal = resolve;
  });
  const worker = new CallbackWorker(async (assignment) => {
    await workerGate;
    return successfulProposal(assignment);
  });
  const coordinator = new SpecialistCoordinator(
    registryWith([[profile("cancel-worker"), worker]]),
    coordinatorOptions(),
  );
  const snapshot = missionSnapshot([task("cancelled", 1)]);
  const plan = coordinator.plan(snapshot, [taskSpec("cancelled")]);

  const execution = coordinator.execute(plan);
  assert.equal(coordinator.releasePlan(plan.planHash), true);
  returnProposal();
  await assert.rejects(execution, /released during execution/u);
  assert.equal(coordinator.activeLeases().length, 0);
});

test("equivalent proposals produce deterministic reconciliation and batch hashes", async () => {
  const run = async () => {
    const coordinator = new SpecialistCoordinator(
      registryWith([[profile("stable-worker"), successWorker()]]),
      coordinatorOptions(),
    );
    const snapshot = missionSnapshot([task("stable", 1)]);
    return coordinator.execute(coordinator.plan(snapshot, [taskSpec("stable")]));
  };

  assert.deepEqual(await run(), await run());
});
