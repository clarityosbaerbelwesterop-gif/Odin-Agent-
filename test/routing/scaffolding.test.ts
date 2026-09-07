import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createFrontierEvaluationProfile,
  type FrontierEvaluationProfile,
} from "../../src/frontier-evals/index.js";
import {
  AMPLIFICATION_POLICY_VERSION,
  createEvaluationRecord,
  createWeakModelScaffoldingPlan,
  type ReasoningAmplificationPlan,
  type WeakModelThresholds,
} from "../../src/routing/index.js";
import type { ModelEvaluation } from "../../src/routing/types.js";

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
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function profile(options: {
  model?: string;
  context?: number;
  output?: number;
  toolUse?: boolean;
  structured?: boolean;
  strict?: boolean;
} = {}): FrontierEvaluationProfile {
  return createFrontierEvaluationProfile({
    contextWindowTokens: options.context ?? 64_000,
    imageInput: false,
    maxOutputTokens: options.output ?? 4_000,
    model: options.model ?? "reference-model",
    profileVersion: "profile-e-v1",
    provider: "fixture-provider",
    provenance: {
      evidenceHash: sha("profile-e-evidence"),
      kind: "evaluation",
      observedAt: "2026-09-07T05:00:00.000Z",
      reference: "phase-e-fixture",
    },
    reasoningEffort: "high",
    reasoningEfforts: ["high"],
    streaming: true,
    strictStructuredOutput: options.strict ?? false,
    structuredOutput: options.structured ?? true,
    textInput: true,
    toolUse: options.toolUse ?? false,
  });
}

function evaluation(
  current: FrontierEvaluationProfile,
  options: {
    quality?: number;
    passRate?: number;
    samples?: number;
    taskClass?: "coding" | "general" | "planning" | "research";
    observedAt?: string;
    model?: string;
  } = {},
): ModelEvaluation {
  return createEvaluationRecord({
    id: `eval-${options.taskClass ?? "coding"}`,
    inputTokensPerSample: 1_000,
    medianLatencyMs: 1_000,
    model: options.model ?? current.model,
    observedAt: options.observedAt ?? "2026-09-07T05:30:00.000Z",
    outputTokensPerSample: 500,
    passRateBps: options.passRate ?? 6_000,
    producer: {
      class: "independent_eval",
      id: "phase-e-evaluator",
      reference: "phase-e-held-out",
    },
    profileVersion: current.profileVersion,
    provider: current.provider,
    qualityScoreBps: options.quality ?? 6_500,
    reasoningEffort: current.reasoningEffort,
    samples: options.samples ?? 20,
    taskClass: options.taskClass ?? "coding",
  });
}

function amplification(
  current: FrontierEvaluationProfile,
  options: {
    domain?: ReasoningAmplificationPlan["domain"];
    strategies?: ReasoningAmplificationPlan["strategies"];
  } = {},
): ReasoningAmplificationPlan {
  const body = {
    benchmarkHash: sha("phase-e-benchmark"),
    branchCount: 2,
    contextTokenCeiling: 16_000,
    critiquePasses: 1,
    domain: options.domain ?? "coding",
    maxEstimatedTokens: 8_000,
    maxModelCalls: 4,
    policyVersion: AMPLIFICATION_POLICY_VERSION,
    profileHash: current.profileHash,
    reasonCodes: ["phase_e_fixture"],
    repairAttempts: 1,
    requiresIndependentVerification: true,
    strategies:
      options.strategies ??
      (["direct", "decompose", "retrieve_context", "strict_output", "targeted_repair"] as const),
    weaknessReportHash: sha("phase-e-weakness-report"),
  } as const;
  return Object.freeze({ ...body, planHash: hashJson(body) });
}

const thresholds: WeakModelThresholds = Object.freeze({
  maxEvaluationAgeMs: 60 * 60 * 1_000,
  minContextWindowTokens: 128_000,
  minOutputTokens: 8_000,
  minPassRateBps: 7_500,
  minQualityScoreBps: 8_000,
  minSamples: 50,
});

test("Phase E amplifies explicit lower capability and quality evidence without enlarging budgets", () => {
  const current = profile();
  const base = amplification(current);
  const plan = createWeakModelScaffoldingPlan({
    amplification: base,
    domain: "coding",
    evaluatedAt: "2026-09-07T06:00:00.000Z",
    evaluation: evaluation(current),
    profile: current,
    thresholds,
  });

  assert.equal(plan.mode, "AMPLIFIED");
  assert.deepEqual(plan.deficiencies, [
    "context_window_below_floor",
    "output_limit_below_floor",
    "pass_rate_below_floor",
    "quality_below_floor",
    "sample_support_below_floor",
  ]);
  assert.equal(plan.decompositionDepth, 3);
  assert.equal(plan.contextChunkBps, 5_000);
  assert.equal(plan.outputDiscipline, "structured_validated");
  assert.equal(plan.surgicalRepairOnly, true);
  assert.equal(plan.rejectNoChangeRepair, true);
  assert.ok(plan.directives.includes("surgical_repair_only"));
  assert.ok(plan.directives.includes("reject_no_change_repair"));
  assert.equal(plan.maxModelCalls, base.maxModelCalls);
  assert.equal(plan.maxEstimatedTokens, base.maxEstimatedTokens);
});

test("strong explicit envelope stays standard regardless of provider/model naming", () => {
  const current = profile({
    context: 1_000_000,
    model: "tiny-looking-name",
    output: 64_000,
    strict: true,
    structured: true,
    toolUse: true,
  });
  const base = amplification(current, { strategies: ["direct"] });
  const plan = createWeakModelScaffoldingPlan({
    amplification: base,
    domain: "coding",
    evaluatedAt: "2026-09-07T06:00:00.000Z",
    evaluation: evaluation(current, { passRate: 9_000, quality: 9_000, samples: 100 }),
    profile: current,
    thresholds,
  });

  assert.equal(plan.mode, "STANDARD");
  assert.deepEqual(plan.deficiencies, []);
  assert.equal(plan.decompositionDepth, 1);
  assert.deepEqual(plan.directives, []);
  assert.equal(plan.outputDiscipline, "strict_structured");
});

test("unsupported tool capability remains explicit and is never synthesized", () => {
  const current = profile({ toolUse: false });
  const plan = createWeakModelScaffoldingPlan({
    amplification: amplification(current, { domain: "tool_use", strategies: ["direct", "tool_ground"] }),
    domain: "tool_use",
    evaluatedAt: "2026-09-07T06:00:00.000Z",
    evaluation: evaluation(current, { taskClass: "research" }),
    profile: current,
    thresholds,
  });

  assert.equal(plan.toolGrounding, "unsupported");
  assert.ok(plan.directives.includes("tool_grounding_unavailable"));
  assert.ok(!plan.directives.includes("tool_grounding"));
});

test("foreign, stale, and self-tampered evidence fails closed", () => {
  const current = profile();
  const base = amplification(current);
  const foreignEvaluation = evaluation(current, { model: "other-model" });
  assert.throws(
    () =>
      createWeakModelScaffoldingPlan({
        amplification: base,
        domain: "coding",
        evaluatedAt: "2026-09-07T06:00:00.000Z",
        evaluation: foreignEvaluation,
        profile: current,
        thresholds,
      }),
    /exact profile/u,
  );

  assert.throws(
    () =>
      createWeakModelScaffoldingPlan({
        amplification: base,
        domain: "coding",
        evaluatedAt: "2026-09-07T08:00:00.000Z",
        evaluation: evaluation(current),
        profile: current,
        thresholds,
      }),
    /stale/u,
  );

  const tampered = { ...base, maxModelCalls: base.maxModelCalls + 10 } as ReasoningAmplificationPlan;
  assert.throws(
    () =>
      createWeakModelScaffoldingPlan({
        amplification: tampered,
        domain: "coding",
        evaluatedAt: "2026-09-07T06:00:00.000Z",
        evaluation: evaluation(current),
        profile: current,
        thresholds,
      }),
    /plan hash/u,
  );
});

test("task-domain evidence mismatch and future evidence fail closed", () => {
  const current = profile();
  const base = amplification(current, { domain: "reasoning" });
  assert.throws(
    () =>
      createWeakModelScaffoldingPlan({
        amplification: base,
        domain: "reasoning",
        evaluatedAt: "2026-09-07T06:00:00.000Z",
        evaluation: evaluation(current, { taskClass: "coding" }),
        profile: current,
        thresholds,
      }),
    /task domain/u,
  );

  assert.throws(
    () =>
      createWeakModelScaffoldingPlan({
        amplification: amplification(current),
        domain: "coding",
        evaluatedAt: "2026-09-07T05:00:00.000Z",
        evaluation: evaluation(current),
        profile: current,
        thresholds,
      }),
    /future-dated/u,
  );
});
