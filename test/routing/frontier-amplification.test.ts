import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BENCHMARK_V2_DOMAIN_COUNTS,
  BENCHMARK_V2_DOMAINS,
  type BenchmarkV2Case,
  type BenchmarkV2Domain,
  createBenchmarkV2Case,
  createBenchmarkV2Suite,
  createFrontierArmResult,
  createFrontierBudgetProfile,
  createFrontierCase,
  createFrontierEvaluationProfile,
  type FrontierArmResult,
} from "../../src/frontier-evals/index.js";
import {
  createFrontierAmplificationCandidate,
  evaluateFrontierAmplification,
  type FrontierAmplificationComponent,
  type ReasoningAmplificationPlan,
  type WeakModelScaffoldingPlan,
} from "../../src/routing/index.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const profile = createFrontierEvaluationProfile({
  contextWindowTokens: 128_000,
  imageInput: true,
  maxOutputTokens: 16_000,
  model: "fixture-model",
  profileVersion: "fixture-profile-v1",
  provider: "fixture-provider",
  provenance: {
    evidenceHash: sha("phase-f-profile"),
    kind: "evaluation",
    observedAt: "2026-09-07T00:00:00.000Z",
    reference: "phase-f-fixture",
  },
  reasoningEffort: "high",
  reasoningEfforts: ["low", "high"],
  streaming: true,
  strictStructuredOutput: false,
  structuredOutput: true,
  textInput: true,
  toolUse: true,
});

const budget = createFrontierBudgetProfile({
  id: "phase-f-budget",
  maxInputTokens: 20_000,
  maxLatencyMs: 120_000,
  maxModelCalls: 4,
  maxOutputTokens: 8_000,
  maxRecoveries: 2,
  maxRepairs: 2,
  maxToolCalls: 12,
});

function taskClass(domain: BenchmarkV2Domain) {
  switch (domain) {
    case "coding":
      return "coding" as const;
    case "math":
    case "reasoning":
    case "long_context":
      return "reasoning" as const;
    case "tool_use":
    case "research":
      return "tool_use" as const;
    case "recovery":
      return "recovery" as const;
    case "long_mission":
      return "long_mission" as const;
  }
}

function benchmarkCases(): readonly BenchmarkV2Case[] {
  let index = 0;
  return BENCHMARK_V2_DOMAINS.flatMap((domain) =>
    Array.from({ length: BENCHMARK_V2_DOMAIN_COUNTS[domain] }, () => {
      const current = index;
      index += 1;
      return createBenchmarkV2Case({
        domain,
        frontierCase: createFrontierCase({
          budget,
          hiddenAcceptanceHash: sha(`phase-f-hidden-${current}`),
          id: `phase-f-case-${String(current).padStart(3, "0")}`,
          publicInputHash: sha(`phase-f-public-${current}`),
          suiteVersion: "phase-f-suite-v1",
          taskClass: taskClass(domain),
        }),
      });
    }),
  );
}

const benchmark = createBenchmarkV2Suite({
  cases: benchmarkCases(),
  profile,
  suiteVersion: "phase-f-suite-v1",
});

function amplificationPlan(
  domain: BenchmarkV2Domain,
  overrides: Partial<Omit<ReasoningAmplificationPlan, "planHash">> = {},
): ReasoningAmplificationPlan {
  const body = {
    benchmarkHash: benchmark.benchmarkHash,
    branchCount: 2,
    contextTokenCeiling: 10_000,
    critiquePasses: 1,
    domain,
    maxEstimatedTokens: 8_000,
    maxModelCalls: 3,
    policyVersion: "intelligence-d-v1" as const,
    profileHash: profile.profileHash,
    reasonCodes: ["phase_f_fixture"],
    repairAttempts: 1,
    requiresIndependentVerification: true,
    strategies: ["direct", "decompose"] as const,
    weaknessReportHash: sha(`phase-f-weakness-${domain}`),
    ...overrides,
  };
  return Object.freeze({ ...body, planHash: hashJson(body) }) as ReasoningAmplificationPlan;
}

function scaffoldingPlan(
  domain: BenchmarkV2Domain,
  amplification: ReasoningAmplificationPlan,
  overrides: Partial<Omit<WeakModelScaffoldingPlan, "planHash">> = {},
): WeakModelScaffoldingPlan {
  const body = {
    amplificationPlanHash: amplification.planHash,
    contextChunkBps: 5_000,
    decompositionDepth: 2 as const,
    deficiencies: ["quality_below_floor"],
    directives: ["decompose_before_execution", "independent_verification_required"],
    domain,
    evaluationHash: sha(`phase-f-evaluation-${domain}`),
    maxEstimatedTokens: amplification.maxEstimatedTokens,
    maxModelCalls: amplification.maxModelCalls,
    mode: "AMPLIFIED" as const,
    outputDiscipline: "structured_validated" as const,
    profileHash: profile.profileHash,
    rejectNoChangeRepair: true,
    requiresIndependentVerification: true,
    surgicalRepairOnly: true,
    toolGrounding:
      domain === "tool_use" || domain === "research"
        ? ("required_if_available" as const)
        : ("not_required" as const),
    version: "intelligence-e-v1" as const,
    ...overrides,
  };
  return Object.freeze({ ...body, planHash: hashJson(body) }) as WeakModelScaffoldingPlan;
}

function components(): readonly FrontierAmplificationComponent[] {
  return BENCHMARK_V2_DOMAINS.map((domain) => {
    const amplification = amplificationPlan(domain);
    return Object.freeze({
      amplification,
      domain,
      scaffolding: scaffoldingPlan(domain, amplification),
    });
  });
}

function result(
  current: BenchmarkV2Case,
  arm: "model_alone" | "odin",
  options: {
    infrastructure?: boolean;
    terminalQualityFailure?: boolean;
    model?: string;
  } = {},
): FrontierArmResult {
  if (options.infrastructure) {
    return createFrontierArmResult({
      arm,
      attributable: false,
      budgetHash: current.frontierCase.budget.budgetHash,
      caseHash: current.frontierCase.caseHash,
      completed: false,
      failureCategory: "timeout",
      harnessVersion: "phase-f-harness-v1",
      inputTokens: 0,
      latencyMs: 120_000,
      model: options.model ?? profile.model,
      modelCalls: 1,
      outcomeClass: "INFRASTRUCTURE_AMBIGUOUS",
      outputTokens: 0,
      profileVersion: profile.profileVersion,
      provider: profile.provider,
      qualityBps: null,
      reasoningEffort: profile.reasoningEffort,
      recoveries: 0,
      repairs: 0,
      toolCalls: 0,
      verification: "INCOMPLETE",
    });
  }
  const terminal = options.terminalQualityFailure === true;
  return createFrontierArmResult({
    arm,
    attributable: true,
    budgetHash: current.frontierCase.budget.budgetHash,
    caseHash: current.frontierCase.caseHash,
    completed: true,
    failureCategory: terminal ? "quality" : "none",
    harnessVersion: "phase-f-harness-v1",
    inputTokens: arm === "odin" ? 900 : 1_000,
    latencyMs: arm === "odin" ? 900 : 1_000,
    model: options.model ?? profile.model,
    modelCalls: 1,
    outcomeClass: terminal ? "TASK_TERMINAL" : "SUCCESS",
    outputTokens: arm === "odin" ? 450 : 500,
    profileVersion: profile.profileVersion,
    provider: profile.provider,
    qualityBps: terminal ? 6_000 : arm === "odin" ? 8_000 : 7_000,
    reasoningEffort: profile.reasoningEffort,
    recoveries: 0,
    repairs: arm === "odin" ? 1 : 0,
    toolCalls: 1,
    verification: terminal ? "FAIL" : "PASS",
  });
}

function completeResults(): readonly FrontierArmResult[] {
  let firstCoding = true;
  return benchmark.cases.flatMap((current) => {
    const terminalQualityFailure = current.domain === "coding" && firstCoding;
    if (terminalQualityFailure) firstCoding = false;
    return [
      result(current, "model_alone", { terminalQualityFailure }),
      result(current, "odin"),
    ];
  });
}

test("Phase F creates one immutable evaluation-only candidate for all Benchmark 2.0 domains", () => {
  const candidate = createFrontierAmplificationCandidate({ benchmark, components: components() });
  assert.equal(candidate.authority, "evaluation_only");
  assert.equal(candidate.routingEligible, false);
  assert.equal(candidate.promotionEligible, false);
  assert.equal(candidate.components.length, 8);
  assert.equal(candidate.benchmarkHash, benchmark.benchmarkHash);
  assert.equal(candidate.profileHash, profile.profileHash);
});

test("Phase F reports matched quality, efficiency, verification, recovery, repair, and weakness deltas", () => {
  const candidate = createFrontierAmplificationCandidate({ benchmark, components: components() });
  const report = evaluateFrontierAmplification({
    benchmark,
    candidate,
    harnessVersion: "phase-f-harness-v1",
    results: completeResults(),
  });

  assert.equal(report.authority, "analytics_only");
  assert.equal(report.routingEligible, false);
  assert.equal(report.promotionEligible, false);
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.domains.length, 8);

  const math = report.domains.find((current) => current.domain === "math");
  assert.ok(math !== undefined);
  assert.equal(math.completePairs, 20);
  assert.equal(math.incompletePairs, 0);
  assert.equal(math.qualityLiftBps, 1_000);
  assert.equal(math.tokenDeltaBps, -1_000);
  assert.equal(math.latencyDeltaBps, -1_000);
  assert.equal(math.verificationPassDeltaBps, 0);
  assert.equal(math.recoveryDelta, 0);
  assert.equal(math.repairDelta, 20);

  const coding = report.domains.find((current) => current.domain === "coding");
  assert.ok(coding !== undefined);
  assert.equal(coding.verificationPassDeltaBps, 400);
  assert.deepEqual(coding.weaknessDeltas, [
    {
      affectedDelta: -1,
      baselineAffected: 1,
      failureCategory: "quality",
      odinAffected: 0,
    },
  ]);
});

test("Phase F preserves incomplete and infrastructure evidence instead of cherry-picking it away", () => {
  const candidate = createFrontierAmplificationCandidate({ benchmark, components: components() });
  const results = [...completeResults()];
  const target = benchmark.cases.find((current) => current.domain === "coding");
  assert.ok(target !== undefined);
  const odinIndex = results.findIndex(
    (current) => current.caseHash === target.frontierCase.caseHash && current.arm === "odin",
  );
  assert.notEqual(odinIndex, -1);
  results[odinIndex] = result(target, "odin", { infrastructure: true });

  const report = evaluateFrontierAmplification({
    benchmark,
    candidate,
    harnessVersion: "phase-f-harness-v1",
    results,
  });
  assert.equal(report.status, "PARTIAL");
  const coding = report.domains.find((current) => current.domain === "coding");
  assert.ok(coding !== undefined);
  assert.equal(coding.completePairs, 24);
  assert.equal(coding.incompletePairs, 1);
  assert.equal(coding.infrastructurePairs, 1);
});

test("Phase F rejects component substitution, budget inflation, and authority escalation", () => {
  const validComponents = [...components()];
  const codingIndex = validComponents.findIndex((current) => current.domain === "coding");
  const mathComponent = validComponents.find((current) => current.domain === "math");
  assert.notEqual(codingIndex, -1);
  assert.ok(mathComponent !== undefined);
  const coding = validComponents[codingIndex];
  assert.ok(coding !== undefined);

  const substitutedScaffolding = scaffoldingPlan("coding", coding.amplification, {
    amplificationPlanHash: mathComponent.amplification.planHash,
  });
  validComponents[codingIndex] = {
    ...coding,
    scaffolding: substitutedScaffolding,
  };
  assert.throws(
    () => createFrontierAmplificationCandidate({ benchmark, components: validComponents }),
    /does not bind the exact Phase D plan/u,
  );

  const inflatedAmplification = amplificationPlan("coding", { maxModelCalls: 5 });
  const inflatedComponents = components().map((component) =>
    component.domain === "coding"
      ? {
          amplification: inflatedAmplification,
          domain: "coding" as const,
          scaffolding: scaffoldingPlan("coding", inflatedAmplification, { maxModelCalls: 5 }),
        }
      : component,
  );
  assert.throws(
    () => createFrontierAmplificationCandidate({ benchmark, components: inflatedComponents }),
    /model-call ceiling exceeds/u,
  );

  const candidate = createFrontierAmplificationCandidate({ benchmark, components: components() });
  const escalated = { ...candidate, routingEligible: true } as unknown as typeof candidate;
  assert.throws(
    () =>
      evaluateFrontierAmplification({
        benchmark,
        candidate: escalated,
        harnessVersion: "phase-f-harness-v1",
        results: completeResults(),
      }),
    /candidate authority is invalid/u,
  );
});

test("Phase F rejects profile/model mismatch before analytics can claim a gain", () => {
  const candidate = createFrontierAmplificationCandidate({ benchmark, components: components() });
  const results = [...completeResults()];
  const target = benchmark.cases[0];
  assert.ok(target !== undefined);
  const odinIndex = results.findIndex(
    (current) => current.caseHash === target.frontierCase.caseHash && current.arm === "odin",
  );
  assert.notEqual(odinIndex, -1);
  results[odinIndex] = result(target, "odin", { model: "foreign-model" });

  assert.throws(
    () =>
      evaluateFrontierAmplification({
        benchmark,
        candidate,
        harnessVersion: "phase-f-harness-v1",
        results,
      }),
    /same model profile/u,
  );
});
