import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemoryEventStore } from "../../src/events/store.js";
import { restoreMissionCheckpoint } from "../../src/mission/checkpoint.js";
import {
  MissionDomainError,
  type MissionEventData,
  MissionRuntime,
} from "../../src/mission/runtime.js";
import type {
  FailureRecoveryAuthority,
  RecoveryDecision,
  RecoveryRequest,
} from "../../src/reliability/index.js";
import { ReliabilityController } from "../../src/reliability/index.js";
import { CodingOrchestrator, CodingVerificationGateError } from "../../src/runtime/coding.js";
import { InMemoryToolAuditSink } from "../../src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../../src/tools/policy.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { createRepositoryToolRegistrations } from "../../src/tools/repository.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import type { CapabilityGrant } from "../../src/tools/types.js";
import { IndependentVerificationEngine } from "../../src/verification/engine.js";
import type {
  VerificationAuthority,
  VerificationGateResult,
  VerificationRequest,
} from "../../src/verification/types.js";
import {
  FIXED_NOW,
  FixtureQualityRunner,
  FixtureWorkspace,
  fixtureFiles,
  modelResponse,
  ScriptedProvider,
  TARGET_PATH,
} from "./coding-fixtures.js";

const WRONG_CONTENT = "export function add(a: number, b: number): number {\n  return a - b;\n}\n";
const REPAIRED_CONTENT =
  "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
const SECOND_WRONG_CONTENT =
  "export function add(a: number, b: number): number {\n  return b;\n}\n";

const BUDGETS = {
  attempts: 30,
  costMicros: 0,
  inputTokens: 10_000,
  outputTokens: 10_000,
  toolCalls: 30,
} as const;

function plan(expectedSha: string, qualityCommandId = "verify", content = WRONG_CONTENT) {
  return modelResponse(
    {
      change: { content, expectedSha, path: TARGET_PATH },
      qualityCommandId,
      task: {
        definitionOfDone: ["add returns the sum of both arguments"],
        dependsOn: [],
        id: "change-math",
        priority: 10,
        title: "Fix add implementation",
      },
    },
    40,
    20,
  );
}

class CapturingVerificationAuthority implements VerificationAuthority {
  readonly requests: VerificationRequest[] = [];
  readonly #engine = new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 });
  readonly #transform: (request: VerificationRequest) => VerificationRequest;

  constructor(
    transform: (request: VerificationRequest) => VerificationRequest = (request) => request,
  ) {
    this.#transform = transform;
  }

  verify(request: VerificationRequest): VerificationGateResult {
    const captured = structuredClone(request);
    this.requests.push(captured);
    return this.#engine.verify(this.#transform(structuredClone(captured)));
  }
}

class CapturingRecoveryAuthority implements FailureRecoveryAuthority {
  readonly requests: RecoveryRequest[] = [];
  readonly #controller = new ReliabilityController();

  decide(request: RecoveryRequest): RecoveryDecision {
    this.requests.push(structuredClone(request));
    return this.#controller.decide(request);
  }
}

function repair(expectedSha: string, content = REPAIRED_CONTENT) {
  return modelResponse({ content, expectedSha, path: TARGET_PATH }, 30, 10);
}

function buildTools(
  workspace: FixtureWorkspace,
  quality: FixtureQualityRunner,
  audit: InMemoryToolAuditSink,
  policy = new InMemoryCapabilityPolicy(),
) {
  const registry = new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace }));
  return {
    grants: policy,
    tools: new ToolRuntime(registry, policy, audit, () => FIXED_NOW),
  };
}

function orchestrator(input: {
  provider: ScriptedProvider;
  mission: MissionRuntime;
  workspace: FixtureWorkspace;
  quality: FixtureQualityRunner;
  audit: InMemoryToolAuditSink;
  grants?: InMemoryCapabilityPolicy;
  verification?: VerificationAuthority;
  reliability?: FailureRecoveryAuthority;
}) {
  const toolStack = buildTools(input.workspace, input.quality, input.audit, input.grants);
  return new CodingOrchestrator({
    audit: input.audit,
    clock: () => FIXED_NOW,
    grants: toolStack.grants,
    mission: input.mission,
    model: "fixture-model",
    provider: input.provider,
    quality: input.quality,
    ...(input.reliability === undefined ? {} : { reliability: input.reliability }),
    tools: toolStack.tools,
    verification:
      input.verification ?? new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 }),
  });
}

function textHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("M4 connects discovery, strict planning, scoped patch, failed gate, repair, and evidence", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const provider = new ScriptedProvider([
    plan(workspace.sha(TARGET_PATH)),
    repair(textHash(WRONG_CONTENT)),
  ]);
  const runtime = new MissionRuntime(store, () => FIXED_NOW);
  const verification = new CapturingVerificationAuthority();
  const coding = orchestrator({
    audit,
    mission: runtime,
    provider,
    quality,
    verification,
    workspace,
  });

  const result = await coding.start({
    budgetLimits: BUDGETS,
    missionId: "m4-happy",
    objective: "Fix add function",
  });

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.report.state, "COMPLETED");
  assert.equal(result.report.taskStatuses["change-math"], "VERIFIED");
  assert.equal(result.report.taskStatuses.__m4_quality__, "VERIFIED");
  assert.deepEqual(result.report.changedFiles, [TARGET_PATH]);
  assert.equal(result.report.quality.commandId, "verify");
  assert.equal(result.report.quality.finalExitCode, 0);
  assert.equal(result.report.verification.outcome, "PASS");
  assert.match(result.report.verification.resultHash, /^[a-f0-9]{64}$/u);
  assert.match(
    result.report.quality.firstFailureSignature ?? "",
    /^quality:verify:exit:1:sha256:/u,
  );
  assert.deepEqual(result.report.modelUsage, { inputTokens: 70, outputTokens: 30 });
  assert.ok(result.report.toolCalls >= 8);
  assert.ok(result.report.attempts >= result.report.toolCalls + 2);
  assert.ok(result.report.auditReferences.length >= result.report.toolCalls);
  assert.equal(workspace.content(TARGET_PATH), REPAIRED_CONTENT);
  assert.equal(workspace.patches.length, 2);
  assert.deepEqual(quality.seenCommandIds, ["verify", "verify"]);
  assert.equal(verification.requests.length, 1);
  const verificationRequest = verification.requests[0];
  assert.ok(verificationRequest !== undefined);
  assert.equal(verificationRequest.claims.length, 3);
  assert.equal(verificationRequest.bindings.length, verificationRequest.claims.length);
  assert.ok(
    verificationRequest.evidence.every(
      (evidence) => evidence.producer.class === "independent_tool",
    ),
  );

  assert.equal(provider.requests.length, 2);
  for (const request of provider.requests) {
    assert.equal(request.responseFormat?.type, "json_schema");
    if (request.responseFormat?.type === "json_schema") {
      assert.equal(request.responseFormat.strict, true);
    }
  }
  const planRequest = provider.requests[0]?.messages[1];
  assert.equal(planRequest?.role, "user");
  if (planRequest?.role === "user") {
    const text = planRequest.content[0];
    assert.equal(text?.type, "text");
    if (text?.type === "text") {
      assert.equal(text.text.includes("dist/generated.js"), false);
      assert.equal(text.text.includes("node_modules/pkg/index.js"), false);
      assert.equal(text.text.includes(TARGET_PATH), true);
    }
  }
});

test("M17 coding integration classifies a failed quality gate before targeted repair", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const provider = new ScriptedProvider([
    plan(workspace.sha(TARGET_PATH)),
    repair(textHash(WRONG_CONTENT)),
  ]);
  const reliability = new CapturingRecoveryAuthority();
  const coding = orchestrator({
    audit,
    mission: new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW),
    provider,
    quality,
    reliability,
    workspace,
  });

  const result = await coding.start({
    budgetLimits: BUDGETS,
    missionId: "mission-m17-recovery",
    objective: "Fix add so it returns the sum",
  });

  assert.equal(result.status, "completed");
  assert.equal(reliability.requests.length, 1);
  assert.equal(reliability.requests[0]?.failure.category, "VERIFICATION");
  assert.equal(reliability.requests[0]?.failure.reasonCode, "quality_gate_failed");
  assert.equal(reliability.requests[0]?.failure.sideEffect, "REVERSIBLE");
  const captured = reliability.requests[0];
  assert.ok(captured !== undefined);
  assert.equal(new ReliabilityController().decide(captured).action, "TARGETED_REPAIR");
});

test("M4 restart replays mission state and resumes from DIAGNOSING with fresh runtime objects", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const firstProvider = new ScriptedProvider([plan(workspace.sha(TARGET_PATH))]);
  const firstRuntime = new MissionRuntime(store, () => FIXED_NOW);
  const firstCoding = orchestrator({
    audit,
    mission: firstRuntime,
    provider: firstProvider,
    quality,
    workspace,
  });

  const interrupted = await firstCoding.start(
    { budgetLimits: BUDGETS, missionId: "m4-resume", objective: "Fix add function" },
    { interruptAfterFirstFailure: true },
  );
  assert.equal(interrupted.status, "interrupted");
  if (interrupted.status !== "interrupted") return;
  assert.equal(interrupted.mission.state, "DIAGNOSING");
  assert.equal(restoreMissionCheckpoint(interrupted.checkpoint, "m4-resume").state, "DIAGNOSING");
  assert.equal(workspace.patches.length, 1);

  const resumedProvider = new ScriptedProvider([repair(textHash(WRONG_CONTENT))]);
  const freshRuntime = new MissionRuntime(store, () => FIXED_NOW);
  const freshCoding = orchestrator({
    audit,
    mission: freshRuntime,
    provider: resumedProvider,
    quality,
    workspace,
  });
  const report = await freshCoding.resume("m4-resume");

  assert.equal(report.state, "COMPLETED");
  assert.deepEqual(report.modelUsage, { inputTokens: 70, outputTokens: 30 });
  assert.deepEqual(report.changedFiles, [TARGET_PATH]);
  assert.equal(report.quality.firstFailureSignature, interrupted.failureSignature);
  assert.equal(workspace.content(TARGET_PATH), REPAIRED_CONTENT);
  assert.equal(workspace.patches.length, 2);
  assert.deepEqual(quality.seenCommandIds, ["verify", "verify"]);
  assert.equal(resumedProvider.requests.length, 1);
  assert.ok(report.auditReferences.length >= 1);
});

test("malformed provider plan is rejected before any repository write", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const provider = new ScriptedProvider([
    modelResponse(
      {
        change: {
          content: WRONG_CONTENT,
          expectedSha: workspace.sha(TARGET_PATH),
          path: TARGET_PATH,
        },
        task: {
          definitionOfDone: ["valid looking task but incomplete root plan"],
          dependsOn: [],
          id: "change-math",
          priority: 10,
          title: "Fix add implementation",
        },
      },
      10,
      5,
    ),
  ]);
  const coding = orchestrator({
    audit,
    mission: new MissionRuntime(store, () => FIXED_NOW),
    provider,
    quality,
    workspace,
  });

  await assert.rejects(
    coding.start({ budgetLimits: BUDGETS, missionId: "m4-invalid", objective: "Fix add function" }),
  );
  assert.equal(workspace.patches.length, 0);
  assert.deepEqual(quality.seenCommandIds, []);
  assert.deepEqual(await store.load("m4-invalid"), []);
});

test("model-provided arbitrary command text cannot become a quality execution", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const provider = new ScriptedProvider([plan(workspace.sha(TARGET_PATH), "verify && rm -rf /")]);
  const coding = orchestrator({
    audit,
    mission: new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW),
    provider,
    quality,
    workspace,
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m4-command-deny",
      objective: "Fix add function",
    }),
    /unregistered quality command/u,
  );
  assert.equal(workspace.patches.length, 0);
  assert.deepEqual(quality.seenCommandIds, []);
});

test("a still-failing required quality gate transitions the mission to FAILED, never COMPLETED", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const provider = new ScriptedProvider([
    plan(workspace.sha(TARGET_PATH)),
    repair(textHash(WRONG_CONTENT), SECOND_WRONG_CONTENT),
  ]);
  const runtime = new MissionRuntime(store, () => FIXED_NOW);
  const coding = orchestrator({ audit, mission: runtime, provider, quality, workspace });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m4-fail-closed",
      objective: "Fix add function",
    }),
    (error: unknown) => {
      assert.ok(error instanceof MissionDomainError);
      assert.match(error.message, /quality gate is still failing/u);
      return true;
    },
  );
  assert.equal((await runtime.load("m4-fail-closed")).state, "FAILED");
  assert.equal(workspace.patches.length, 2);
  assert.deepEqual(quality.seenCommandIds, ["verify", "verify"]);
});

test("M5 stale evidence blocks M4 completion even after the quality command passes", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW);
  const verification = new CapturingVerificationAuthority((request) => ({
    ...request,
    claims: request.claims.map((claim) => ({
      ...claim,
      requiredAfter: "2026-09-02T19:55:00.000Z",
    })),
    evidence: request.evidence.map((evidence) => ({
      ...evidence,
      observedAt: "2026-09-02T19:55:00.000Z",
    })),
  }));
  const coding = orchestrator({
    audit,
    mission: runtime,
    provider: new ScriptedProvider([plan(workspace.sha(TARGET_PATH), "verify", REPAIRED_CONTENT)]),
    quality,
    verification,
    workspace,
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m5-stale-block",
      objective: "Fix add function",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CodingVerificationGateError);
      assert.equal(error.gate?.outcome, "BLOCK");
      assert.ok(
        error.gate?.verification.findings.some((finding) => finding.code === "evidence_stale"),
      );
      return true;
    },
  );
  assert.equal((await runtime.load("m5-stale-block")).state, "BLOCKED");
  assert.deepEqual(quality.seenCommandIds, ["verify"]);
});

test("M5 contradictory evidence blocks M4 completion", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW);
  const verification = new CapturingVerificationAuthority((request) => {
    const existing = request.evidence[0];
    if (existing === undefined) throw new Error("M4 verification fixture evidence is missing.");
    return {
      ...request,
      evidence: [
        ...request.evidence,
        {
          ...existing,
          contentHash: "c".repeat(64),
          id: "evidence-contradiction",
          status: "FAIL",
        },
      ],
    };
  });
  const coding = orchestrator({
    audit,
    mission: runtime,
    provider: new ScriptedProvider([plan(workspace.sha(TARGET_PATH), "verify", REPAIRED_CONTENT)]),
    quality,
    verification,
    workspace,
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m5-conflict-block",
      objective: "Fix add function",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CodingVerificationGateError);
      assert.equal(error.gate?.outcome, "BLOCK");
      assert.ok(
        error.gate?.review.findings.some((finding) => finding.code === "evidence_conflict"),
      );
      return true;
    },
  );
  assert.equal((await runtime.load("m5-conflict-block")).state, "BLOCKED");
});

test("M5 repair-required review returns a bounded request and still prevents completion", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW);
  const verification = new CapturingVerificationAuthority((request) => ({
    ...request,
    evidence: request.evidence.map((evidence) => ({
      ...evidence,
      producer: { class: "runtime", id: "coding-runtime" },
    })),
  }));
  const coding = orchestrator({
    audit,
    mission: runtime,
    provider: new ScriptedProvider([plan(workspace.sha(TARGET_PATH), "verify", REPAIRED_CONTENT)]),
    quality,
    verification,
    workspace,
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m5-repair-block",
      objective: "Fix add function",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CodingVerificationGateError);
      assert.equal(error.gate?.outcome, "REPAIR_REQUIRED");
      assert.ok((error.gate?.review.repairRequest?.claimIds.length ?? 0) > 0);
      assert.ok((error.gate?.review.repairRequest?.claimIds.length ?? 0) <= 32);
      return true;
    },
  );
  assert.equal((await runtime.load("m5-repair-block")).state, "BLOCKED");
});

test("a failed verification authority fails closed and leaves a blocked mission", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const runtime = new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW);
  const verification: VerificationAuthority = {
    verify() {
      throw new Error("fixture verifier unavailable");
    },
  };
  const coding = orchestrator({
    audit,
    mission: runtime,
    provider: new ScriptedProvider([plan(workspace.sha(TARGET_PATH), "verify", REPAIRED_CONTENT)]),
    quality,
    verification,
    workspace,
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m5-authority-failure",
      objective: "Fix add function",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CodingVerificationGateError);
      assert.equal(error.gate, null);
      assert.match(error.message, /failed closed/u);
      return true;
    },
  );
  assert.equal((await runtime.load("m5-authority-failure")).state, "BLOCKED");
});

test("missing capability registration denies bootstrap discovery before adapters are mutated", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const policy = new InMemoryCapabilityPolicy();
  const registry = new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace }));
  const tools = new ToolRuntime(registry, policy, audit, () => FIXED_NOW);
  const noOpGrantSink = { register(_grant: CapabilityGrant): void {} };
  const coding = new CodingOrchestrator({
    audit,
    clock: () => FIXED_NOW,
    grants: noOpGrantSink,
    mission: new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW),
    model: "fixture-model",
    provider: new ScriptedProvider([]),
    quality,
    tools,
    verification: new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 }),
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m4-policy-deny",
      objective: "Fix add function",
    }),
    /No scoped capability grant/u,
  );
  assert.equal(workspace.patches.length, 0);
  assert.deepEqual(quality.seenCommandIds, []);
});
