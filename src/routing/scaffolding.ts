import type { BenchmarkV2Domain, FrontierEvaluationProfile } from "../frontier-evals/index.js";
import { validateFrontierEvaluationProfile } from "../frontier-evals/index.js";
import { AMPLIFICATION_POLICY_VERSION, type ReasoningAmplificationPlan } from "./amplification.js";
import { normalizeEvaluation } from "./evaluations.js";
import { canonicalTimestamp, exactKeys, objectValue, safeInteger, sha256Json } from "./internal.js";
import type { ModelEvaluation, RoutingTaskClass } from "./types.js";
import { RoutingError } from "./types.js";

export const WEAK_MODEL_SCAFFOLDING_VERSION = "intelligence-e-v1" as const;

export interface WeakModelThresholds {
  readonly minContextWindowTokens: number;
  readonly minOutputTokens: number;
  readonly minQualityScoreBps: number;
  readonly minPassRateBps: number;
  readonly minSamples: number;
  readonly maxEvaluationAgeMs: number;
}

export type ScaffoldingMode = "AMPLIFIED" | "STANDARD";
export type OutputDiscipline = "strict_structured" | "structured_validated" | "text_contract";
export type ToolGroundingMode = "required_if_available" | "unsupported" | "not_required";

export interface WeakModelScaffoldingRequest {
  readonly profile: FrontierEvaluationProfile;
  readonly evaluation: ModelEvaluation;
  readonly evaluatedAt: string;
  readonly domain: BenchmarkV2Domain;
  readonly thresholds: WeakModelThresholds;
  readonly amplification: ReasoningAmplificationPlan;
}

export interface WeakModelScaffoldingPlan {
  readonly version: typeof WEAK_MODEL_SCAFFOLDING_VERSION;
  readonly mode: ScaffoldingMode;
  readonly profileHash: string;
  readonly evaluationHash: string;
  readonly amplificationPlanHash: string;
  readonly domain: BenchmarkV2Domain;
  readonly deficiencies: readonly string[];
  readonly directives: readonly string[];
  readonly decompositionDepth: 1 | 2 | 3;
  readonly contextChunkBps: number;
  readonly outputDiscipline: OutputDiscipline;
  readonly toolGrounding: ToolGroundingMode;
  readonly requiresIndependentVerification: boolean;
  readonly surgicalRepairOnly: boolean;
  readonly rejectNoChangeRepair: boolean;
  readonly maxModelCalls: number;
  readonly maxEstimatedTokens: number;
  readonly planHash: string;
}

const TASK_CLASS_BY_DOMAIN: Readonly<Record<BenchmarkV2Domain, RoutingTaskClass>> = Object.freeze({
  coding: "coding",
  long_context: "general",
  long_mission: "planning",
  math: "general",
  reasoning: "general",
  recovery: "planning",
  research: "research",
  tool_use: "research",
});

export function createWeakModelScaffoldingPlan(
  value: WeakModelScaffoldingRequest,
): WeakModelScaffoldingPlan {
  const input = normalizeRequest(value);
  const profile = validateFrontierEvaluationProfile(input.profile);
  const evaluation = normalizeEvaluation(input.evaluation);
  const amplification = validateAmplificationPlan(input.amplification);
  const thresholds = normalizeThresholds(input.thresholds);

  assertEvaluationBinding(profile, evaluation, input.domain, input.evaluatedAt, thresholds);
  if (amplification.profileHash !== profile.profileHash) {
    throw new RoutingError("INVALID_INPUT", "Amplification plan is bound to a different profile.");
  }
  if (amplification.domain !== input.domain) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Amplification plan is bound to a different task domain.",
    );
  }

  const deficiencies: string[] = [];
  if (profile.contextWindowTokens < thresholds.minContextWindowTokens) {
    deficiencies.push("context_window_below_floor");
  }
  if (profile.maxOutputTokens < thresholds.minOutputTokens) {
    deficiencies.push("output_limit_below_floor");
  }
  if (evaluation.qualityScoreBps < thresholds.minQualityScoreBps) {
    deficiencies.push("quality_below_floor");
  }
  if (evaluation.passRateBps < thresholds.minPassRateBps) {
    deficiencies.push("pass_rate_below_floor");
  }
  if (evaluation.samples < thresholds.minSamples) {
    deficiencies.push("sample_support_below_floor");
  }

  const mode: ScaffoldingMode = deficiencies.length === 0 ? "STANDARD" : "AMPLIFIED";
  const directives = new Set<string>();
  if (mode === "AMPLIFIED") {
    directives.add("decompose_before_execution");
    directives.add("ground_claims_before_mutation");
    directives.add("independent_verification_required");
    directives.add("reserve_repair_headroom");
  }
  if (amplification.strategies.includes("retrieve_context")) {
    directives.add("bounded_context_chunks");
  }
  if (amplification.strategies.includes("tool_ground")) {
    directives.add(profile.toolUse ? "tool_grounding" : "tool_grounding_unavailable");
  }
  if (amplification.strategies.includes("strict_output")) {
    directives.add("output_contract_guard");
  }
  if (amplification.strategies.includes("targeted_repair")) {
    directives.add("surgical_repair_only");
    directives.add("reject_no_change_repair");
  }

  const outputDiscipline: OutputDiscipline = profile.strictStructuredOutput
    ? "strict_structured"
    : profile.structuredOutput
      ? "structured_validated"
      : "text_contract";
  const toolGrounding: ToolGroundingMode =
    input.domain === "tool_use" || input.domain === "research"
      ? profile.toolUse
        ? "required_if_available"
        : "unsupported"
      : "not_required";
  const decompositionDepth: 1 | 2 | 3 =
    mode === "STANDARD"
      ? 1
      : deficiencies.length >= 3 || evaluation.qualityScoreBps < thresholds.minQualityScoreBps / 2
        ? 3
        : 2;
  const contextChunkBps =
    mode === "AMPLIFIED" &&
    (deficiencies.includes("context_window_below_floor") ||
      amplification.strategies.includes("retrieve_context"))
      ? 5_000
      : 10_000;

  const body = {
    amplificationPlanHash: amplification.planHash,
    contextChunkBps,
    decompositionDepth,
    deficiencies: Object.freeze([...deficiencies].sort()),
    directives: Object.freeze([...directives].sort()),
    domain: input.domain,
    evaluationHash: evaluation.contentHash,
    maxEstimatedTokens: amplification.maxEstimatedTokens,
    maxModelCalls: amplification.maxModelCalls,
    mode,
    outputDiscipline,
    profileHash: profile.profileHash,
    rejectNoChangeRepair: amplification.strategies.includes("targeted_repair"),
    requiresIndependentVerification:
      mode === "AMPLIFIED" || amplification.requiresIndependentVerification,
    surgicalRepairOnly: amplification.strategies.includes("targeted_repair"),
    toolGrounding,
    version: WEAK_MODEL_SCAFFOLDING_VERSION,
  } as const;
  return Object.freeze({ ...body, planHash: sha256Json(body) });
}

function normalizeRequest(value: WeakModelScaffoldingRequest): WeakModelScaffoldingRequest {
  const input = objectValue(value, "weak-model scaffolding request");
  exactKeys(
    input,
    ["profile", "evaluation", "evaluatedAt", "domain", "thresholds", "amplification"],
    [],
    "weak-model scaffolding request",
  );
  if (typeof input.domain !== "string" || !(input.domain in TASK_CLASS_BY_DOMAIN)) {
    throw new RoutingError("INVALID_INPUT", "Weak-model scaffolding domain is unsupported.");
  }
  const domain = input.domain as BenchmarkV2Domain;
  return Object.freeze({
    amplification: input.amplification as ReasoningAmplificationPlan,
    domain,
    evaluatedAt: canonicalTimestamp(input.evaluatedAt, "scaffolding evaluatedAt"),
    evaluation: input.evaluation as ModelEvaluation,
    profile: input.profile as FrontierEvaluationProfile,
    thresholds: input.thresholds as WeakModelThresholds,
  });
}

function normalizeThresholds(value: WeakModelThresholds): WeakModelThresholds {
  const thresholds = objectValue(value, "weak-model thresholds");
  exactKeys(
    thresholds,
    [
      "minContextWindowTokens",
      "minOutputTokens",
      "minQualityScoreBps",
      "minPassRateBps",
      "minSamples",
      "maxEvaluationAgeMs",
    ],
    [],
    "weak-model thresholds",
  );
  return Object.freeze({
    maxEvaluationAgeMs: safeInteger(
      thresholds.maxEvaluationAgeMs,
      "maxEvaluationAgeMs",
      1,
      365 * 24 * 60 * 60 * 1_000,
    ),
    minContextWindowTokens: safeInteger(
      thresholds.minContextWindowTokens,
      "minContextWindowTokens",
      1,
      100_000_000,
    ),
    minOutputTokens: safeInteger(thresholds.minOutputTokens, "minOutputTokens", 1, 10_000_000),
    minPassRateBps: safeInteger(thresholds.minPassRateBps, "minPassRateBps", 0, 10_000),
    minQualityScoreBps: safeInteger(thresholds.minQualityScoreBps, "minQualityScoreBps", 0, 10_000),
    minSamples: safeInteger(thresholds.minSamples, "minSamples", 1, 1_000_000),
  });
}

function assertEvaluationBinding(
  profile: FrontierEvaluationProfile,
  evaluation: ModelEvaluation,
  domain: BenchmarkV2Domain,
  evaluatedAt: string,
  thresholds: WeakModelThresholds,
): void {
  if (
    evaluation.provider !== profile.provider ||
    evaluation.model !== profile.model ||
    evaluation.profileVersion !== profile.profileVersion ||
    evaluation.reasoningEffort !== profile.reasoningEffort
  ) {
    throw new RoutingError(
      "EVALUATION_INVALID",
      "Quality evidence does not match the exact profile.",
    );
  }
  if (evaluation.taskClass !== TASK_CLASS_BY_DOMAIN[domain]) {
    throw new RoutingError(
      "EVALUATION_INVALID",
      "Quality evidence does not match the task domain.",
    );
  }
  const ageMs = Date.parse(evaluatedAt) - Date.parse(evaluation.observedAt);
  if (ageMs < 0) {
    throw new RoutingError("EVALUATION_INVALID", "Quality evidence is future-dated.");
  }
  if (ageMs > thresholds.maxEvaluationAgeMs) {
    throw new RoutingError(
      "EVALUATION_STALE",
      "Quality evidence is stale for weak-model amplification.",
    );
  }
}

function validateAmplificationPlan(value: ReasoningAmplificationPlan): ReasoningAmplificationPlan {
  const plan = objectValue(value, "reasoning amplification plan");
  exactKeys(
    plan,
    [
      "policyVersion",
      "benchmarkHash",
      "profileHash",
      "weaknessReportHash",
      "domain",
      "strategies",
      "branchCount",
      "critiquePasses",
      "repairAttempts",
      "maxModelCalls",
      "maxEstimatedTokens",
      "contextTokenCeiling",
      "requiresIndependentVerification",
      "reasonCodes",
      "planHash",
    ],
    [],
    "reasoning amplification plan",
  );
  if (plan.policyVersion !== AMPLIFICATION_POLICY_VERSION) {
    throw new RoutingError("INVALID_INPUT", "Amplification policy version is unsupported.");
  }
  if (!Array.isArray(plan.strategies) || !Array.isArray(plan.reasonCodes)) {
    throw new RoutingError("INVALID_INPUT", "Amplification plan collections are malformed.");
  }
  const body = {
    benchmarkHash: plan.benchmarkHash,
    branchCount: plan.branchCount,
    contextTokenCeiling: plan.contextTokenCeiling,
    critiquePasses: plan.critiquePasses,
    domain: plan.domain,
    maxEstimatedTokens: plan.maxEstimatedTokens,
    maxModelCalls: plan.maxModelCalls,
    policyVersion: plan.policyVersion,
    profileHash: plan.profileHash,
    reasonCodes: plan.reasonCodes,
    repairAttempts: plan.repairAttempts,
    requiresIndependentVerification: plan.requiresIndependentVerification,
    strategies: plan.strategies,
    weaknessReportHash: plan.weaknessReportHash,
  } as const;
  if (sha256Json(body) !== plan.planHash) {
    throw new RoutingError("INVALID_INPUT", "Amplification plan hash does not match its contents.");
  }
  return value;
}
