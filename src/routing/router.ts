import { CapabilityRegistry } from "../providers/index.js";
import type { CapabilityProfile } from "../providers/types.js";
import { ModelEvaluationRegistry } from "./evaluations.js";
import {
  assertSha256,
  booleanValue,
  canonicalTimestamp,
  exactKeys,
  identifier,
  nonEmptyText,
  objectValue,
  safeInteger,
  sha256Json,
} from "./internal.js";
import { createReasoningPlan } from "./reasoning.js";
import {
  type EmpiricalRouterConfig,
  type ModelEvaluation,
  type ReasoningPlan,
  type RouteRequest,
  type RoutingCacheDecision,
  type RoutingCandidate,
  type RoutingDecision,
  RoutingError,
  type RoutingInputs,
  type RoutingRequirements,
  type RoutingRisk,
  type RoutingTaskClass,
} from "./types.js";

const TASK_CLASSES = new Set<RoutingTaskClass>(["coding", "general", "planning", "research"]);
const RISKS = new Set<RoutingRisk>(["critical", "high", "low", "medium"]);
const MAX_PROFILES = 256;
const MAX_EVALUATIONS = 4_096;
const DEFAULT_CONFIG: EmpiricalRouterConfig = Object.freeze({
  maxEvaluationAgeMs: 30 * 24 * 60 * 60 * 1_000,
  minimumQualityFloorBps: 6_500,
  riskUpliftBps: Object.freeze({ critical: 1_250, high: 750, low: 0, medium: 250 }),
  uncertaintyStepBps: 2_500,
  uncertaintyUpliftPerStepBps: 250,
});

export class EmpiricalModelRouter {
  readonly #config: EmpiricalRouterConfig;

  constructor(config: Partial<EmpiricalRouterConfig> = {}) {
    this.#config = normalizeConfig({
      ...DEFAULT_CONFIG,
      ...config,
      riskUpliftBps: { ...DEFAULT_CONFIG.riskUpliftBps, ...config.riskUpliftBps },
    });
  }

  route(requestValue: unknown, inputs: RoutingInputs): RoutingDecision {
    const request = normalizeRouteRequest(requestValue);
    const reasoning = createReasoningPlan(request);
    const profiles = normalizeProfiles(inputs.profiles, request.evaluatedAt);
    const evaluations = normalizeEvaluations(inputs.evaluations, profiles, request.evaluatedAt);
    const effectiveQualityFloorBps = effectiveQualityFloor(request, this.#config);
    const fresh = freshestEvaluations(evaluations, request, this.#config.maxEvaluationAgeMs);
    const reasons: string[] = [];
    const candidates: RoutingCandidate[] = [];

    for (const evaluation of fresh) {
      const profile = profiles.get(profileKey(evaluation.provider, evaluation.model));
      if (profile === undefined) {
        throw new RoutingError(
          "EVALUATION_INVALID",
          "Evaluation references a model profile that is not part of this routing input.",
        );
      }
      const capabilityReason = capabilityMismatch(profile, request.requirements);
      if (capabilityReason !== null) {
        reasons.push(`${candidateLabel(evaluation)}:${capabilityReason}`);
        continue;
      }
      if (evaluation.qualityScoreBps < effectiveQualityFloorBps) {
        reasons.push(`${candidateLabel(evaluation)}:below_quality_floor`);
        continue;
      }
      const estimatedCostMicros = estimatedWorstCaseCostMicros(profile, request, reasoning);
      if (estimatedCostMicros === null) {
        reasons.push(`${candidateLabel(evaluation)}:pricing_unavailable_or_currency_mismatch`);
        continue;
      }
      if (estimatedCostMicros > request.budget.maxEstimatedCostMicros) {
        reasons.push(`${candidateLabel(evaluation)}:estimated_cost_exceeds_budget`);
        continue;
      }
      candidates.push(
        freezeCandidate({
          estimatedCostMicros,
          evaluationHash: evaluation.contentHash,
          evaluationId: evaluation.id,
          medianLatencyMs: evaluation.medianLatencyMs,
          model: evaluation.model,
          passRateBps: evaluation.passRateBps,
          profileVersion: evaluation.profileVersion,
          provider: evaluation.provider,
          qualityScoreBps: evaluation.qualityScoreBps,
          reasoningEffort: evaluation.reasoningEffort,
        }),
      );
    }

    candidates.sort(comparePrimaryCandidates);
    const primary = candidates[0];
    if (primary === undefined) {
      throw new RoutingError(
        "NO_ELIGIBLE_MODEL",
        "No model satisfies capabilities, empirical quality, freshness, and budget simultaneously.",
        Object.freeze([...new Set(reasons)].sort()),
      );
    }

    const escalations = Object.freeze(
      candidates
        .slice(1)
        .filter((candidate) => candidate.qualityScoreBps > primary.qualityScoreBps)
        .sort(compareEscalations)
        .map(freezeCandidate),
    );
    const cache = cacheDecision(request, primary, reasoning, effectiveQualityFloorBps);
    const stableReasons = Object.freeze([
      `quality_floor_bps:${effectiveQualityFloorBps}`,
      `primary_cost_micros:${primary.estimatedCostMicros}`,
      `primary_quality_bps:${primary.qualityScoreBps}`,
    ]);
    const body = {
      cache,
      effectiveQualityFloorBps,
      escalations,
      missionId: request.missionId,
      primary,
      reasoning,
      reasons: stableReasons,
      taskClass: request.taskClass,
      taskId: request.taskId,
    };
    return Object.freeze({ ...body, decisionHash: sha256Json(body) });
  }
}

export function normalizeRouteRequest(value: unknown): RouteRequest {
  const object = objectValue(value, "route request");
  exactKeys(
    object,
    [
      "baseQualityFloorBps",
      "budget",
      "cache",
      "currency",
      "estimatedInputTokens",
      "estimatedOutputTokens",
      "evaluatedAt",
      "missionId",
      "requirements",
      "risk",
      "taskClass",
      "taskId",
      "uncertaintyBps",
    ],
    [],
    "route request",
  );
  const taskClass = nonEmptyText(object.taskClass, "route taskClass", 32) as RoutingTaskClass;
  if (!TASK_CLASSES.has(taskClass)) {
    throw new RoutingError("INVALID_INPUT", "Route task class is unsupported.");
  }
  const risk = nonEmptyText(object.risk, "route risk", 32) as RoutingRisk;
  if (!RISKS.has(risk)) throw new RoutingError("INVALID_INPUT", "Route risk is unsupported.");
  const requirements = normalizeRequirements(object.requirements);
  const budget = normalizeBudget(object.budget);
  const cache = normalizeCacheRequest(object.cache);
  return Object.freeze({
    baseQualityFloorBps: safeInteger(
      object.baseQualityFloorBps,
      "route baseQualityFloorBps",
      0,
      10_000,
    ),
    budget,
    cache,
    currency: nonEmptyText(object.currency, "route currency", 16),
    estimatedInputTokens: safeInteger(object.estimatedInputTokens, "route estimatedInputTokens", 0),
    estimatedOutputTokens: safeInteger(
      object.estimatedOutputTokens,
      "route estimatedOutputTokens",
      0,
    ),
    evaluatedAt: canonicalTimestamp(object.evaluatedAt, "route evaluatedAt"),
    missionId: identifier(object.missionId, "route missionId"),
    requirements,
    risk,
    taskClass,
    taskId: identifier(object.taskId, "route taskId"),
    uncertaintyBps: safeInteger(object.uncertaintyBps, "route uncertaintyBps", 0, 10_000),
  });
}

function normalizeRequirements(value: unknown): RoutingRequirements {
  const object = objectValue(value, "routing requirements");
  exactKeys(
    object,
    ["imageInput", "strictStructuredOutput", "structuredOutput", "toolUse"],
    ["minContextWindowTokens", "minOutputTokens"],
    "routing requirements",
  );
  const structuredOutput = booleanValue(object.structuredOutput, "requirements structuredOutput");
  const strictStructuredOutput = booleanValue(
    object.strictStructuredOutput,
    "requirements strictStructuredOutput",
  );
  if (strictStructuredOutput && !structuredOutput) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Strict structured output cannot be required while structured output is disabled.",
    );
  }
  return Object.freeze({
    imageInput: booleanValue(object.imageInput, "requirements imageInput"),
    ...(object.minContextWindowTokens === undefined
      ? {}
      : {
          minContextWindowTokens: safeInteger(
            object.minContextWindowTokens,
            "requirements minContextWindowTokens",
            1,
          ),
        }),
    ...(object.minOutputTokens === undefined
      ? {}
      : {
          minOutputTokens: safeInteger(object.minOutputTokens, "requirements minOutputTokens", 1),
        }),
    strictStructuredOutput,
    structuredOutput,
    toolUse: booleanValue(object.toolUse, "requirements toolUse"),
  });
}

function normalizeBudget(value: unknown): RouteRequest["budget"] {
  const object = objectValue(value, "routing budget");
  exactKeys(
    object,
    [
      "maxBranches",
      "maxCritiquePasses",
      "maxEstimatedCostMicros",
      "maxModelCalls",
      "maxParallelCalls",
      "maxRepairs",
    ],
    [],
    "routing budget",
  );
  const maxModelCalls = safeInteger(object.maxModelCalls, "budget maxModelCalls", 1, 1_000);
  const maxParallelCalls = safeInteger(
    object.maxParallelCalls,
    "budget maxParallelCalls",
    1,
    1_000,
  );
  if (maxParallelCalls > maxModelCalls) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Parallel model calls cannot exceed total model calls.",
    );
  }
  return Object.freeze({
    maxBranches: safeInteger(object.maxBranches, "budget maxBranches", 1, 64),
    maxCritiquePasses: safeInteger(object.maxCritiquePasses, "budget maxCritiquePasses", 0, 64),
    maxEstimatedCostMicros: safeInteger(
      object.maxEstimatedCostMicros,
      "budget maxEstimatedCostMicros",
      0,
    ),
    maxModelCalls,
    maxParallelCalls,
    maxRepairs: safeInteger(object.maxRepairs, "budget maxRepairs", 0, 64),
  });
}

function normalizeCacheRequest(value: unknown): RouteRequest["cache"] {
  const object = objectValue(value, "routing cache request");
  exactKeys(
    object,
    ["allowRead", "allowWrite", "contextHash", "evidenceHash", "maxAgeMs", "sensitive"],
    [],
    "routing cache request",
  );
  return Object.freeze({
    allowRead: booleanValue(object.allowRead, "cache allowRead"),
    allowWrite: booleanValue(object.allowWrite, "cache allowWrite"),
    contextHash: assertSha256(object.contextHash, "cache contextHash"),
    evidenceHash: assertSha256(object.evidenceHash, "cache evidenceHash"),
    maxAgeMs: safeInteger(object.maxAgeMs, "cache maxAgeMs", 0),
    sensitive: booleanValue(object.sensitive, "cache sensitive"),
  });
}

function normalizeConfig(value: EmpiricalRouterConfig): EmpiricalRouterConfig {
  const risk = value.riskUpliftBps;
  for (const key of RISKS) safeInteger(risk[key], `routing risk uplift ${key}`, 0, 10_000);
  return Object.freeze({
    maxEvaluationAgeMs: safeInteger(value.maxEvaluationAgeMs, "maxEvaluationAgeMs", 0),
    minimumQualityFloorBps: safeInteger(
      value.minimumQualityFloorBps,
      "minimumQualityFloorBps",
      0,
      10_000,
    ),
    riskUpliftBps: Object.freeze({ ...risk }),
    uncertaintyStepBps: safeInteger(value.uncertaintyStepBps, "uncertaintyStepBps", 1, 10_000),
    uncertaintyUpliftPerStepBps: safeInteger(
      value.uncertaintyUpliftPerStepBps,
      "uncertaintyUpliftPerStepBps",
      0,
      10_000,
    ),
  });
}

function normalizeProfiles(
  values: readonly CapabilityProfile[],
  evaluatedAt: string,
): ReadonlyMap<string, CapabilityProfile> {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_PROFILES) {
    throw new RoutingError("INVALID_INPUT", "Routing profiles collection is malformed.");
  }
  const registry = new CapabilityRegistry();
  const profiles = new Map<string, CapabilityProfile>();
  for (const value of values) {
    registry.register(value);
    const profile = registry.resolve(value.provider, value.model);
    const key = profileKey(profile.provider, profile.model);
    if (profiles.has(key)) {
      throw new RoutingError(
        "INVALID_INPUT",
        `Duplicate routing profile ${profile.provider}/${profile.model}.`,
      );
    }
    if (Date.parse(profile.provenance.observedAt) > Date.parse(evaluatedAt)) {
      throw new RoutingError("INVALID_INPUT", "A model profile cannot originate in the future.");
    }
    profiles.set(key, profile);
  }
  return profiles;
}

function normalizeEvaluations(
  values: readonly ModelEvaluation[],
  profiles: ReadonlyMap<string, CapabilityProfile>,
  evaluatedAt: string,
): readonly ModelEvaluation[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_EVALUATIONS) {
    throw new RoutingError("INVALID_INPUT", "Routing evaluations collection is malformed.");
  }
  const registry = new ModelEvaluationRegistry(values);
  const normalized = registry.list();
  for (const evaluation of normalized) {
    const profile = profiles.get(profileKey(evaluation.provider, evaluation.model));
    if (profile === undefined || profile.version !== evaluation.profileVersion) {
      throw new RoutingError(
        "EVALUATION_INVALID",
        "Evaluation scope does not match an exact supplied model profile version.",
      );
    }
    if (Date.parse(evaluation.observedAt) > Date.parse(evaluatedAt)) {
      throw new RoutingError("EVALUATION_INVALID", "Evaluation cannot originate in the future.");
    }
    if (
      evaluation.reasoningEffort !== null &&
      !profile.capabilities.reasoningEfforts.includes(evaluation.reasoningEffort)
    ) {
      throw new RoutingError(
        "EVALUATION_INVALID",
        "Evaluation reasoning effort is unsupported by its model profile.",
      );
    }
  }
  return normalized;
}

function freshestEvaluations(
  values: readonly ModelEvaluation[],
  request: RouteRequest,
  maxAgeMs: number,
): readonly ModelEvaluation[] {
  const matching = values.filter((value) => value.taskClass === request.taskClass);
  const groups = new Map<string, ModelEvaluation[]>();
  for (const value of matching) {
    const key = evaluationRouteKey(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  const selected: ModelEvaluation[] = [];
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const time = Date.parse(right.observedAt) - Date.parse(left.observedAt);
      return time !== 0 ? time : left.id.localeCompare(right.id);
    });
    const first = group[0];
    if (first === undefined) continue;
    const sameTimestamp = group.filter((value) => value.observedAt === first.observedAt);
    if (sameTimestamp.length > 1) {
      throw new RoutingError(
        "EVALUATION_CONFLICT",
        "Multiple evaluations claim the same freshest model/effort timestamp.",
      );
    }
    const ageMs = Date.parse(request.evaluatedAt) - Date.parse(first.observedAt);
    if (ageMs <= maxAgeMs) selected.push(first);
  }
  return Object.freeze(
    selected.sort((left, right) =>
      evaluationRouteKey(left).localeCompare(evaluationRouteKey(right)),
    ),
  );
}

function effectiveQualityFloor(request: RouteRequest, config: EmpiricalRouterConfig): number {
  const base = Math.max(request.baseQualityFloorBps, config.minimumQualityFloorBps);
  const uncertaintySteps = Math.floor(request.uncertaintyBps / config.uncertaintyStepBps);
  return Math.min(
    10_000,
    base +
      config.riskUpliftBps[request.risk] +
      uncertaintySteps * config.uncertaintyUpliftPerStepBps,
  );
}

function capabilityMismatch(
  profile: CapabilityProfile,
  requirements: RoutingRequirements,
): string | null {
  const capabilities = profile.capabilities;
  if (requirements.imageInput && !capabilities.imageInput) return "image_input_unsupported";
  if (requirements.toolUse && !capabilities.toolUse) return "tool_use_unsupported";
  if (requirements.structuredOutput && !capabilities.structuredOutput) {
    return "structured_output_unsupported";
  }
  if (requirements.strictStructuredOutput && !capabilities.strictStructuredOutput) {
    return "strict_structured_output_unsupported";
  }
  if (
    requirements.minContextWindowTokens !== undefined &&
    (capabilities.contextWindowTokens === undefined ||
      capabilities.contextWindowTokens < requirements.minContextWindowTokens)
  ) {
    return "context_window_insufficient";
  }
  if (
    requirements.minOutputTokens !== undefined &&
    (capabilities.maxOutputTokens === undefined ||
      capabilities.maxOutputTokens < requirements.minOutputTokens)
  ) {
    return "output_limit_insufficient";
  }
  return null;
}

function estimatedWorstCaseCostMicros(
  profile: CapabilityProfile,
  request: RouteRequest,
  reasoning: ReasoningPlan,
): number | null {
  const pricing = profile.pricing;
  if (pricing === undefined || pricing.currency !== request.currency) return null;
  const perCall = Math.ceil(
    request.estimatedInputTokens * pricing.inputPerMillionTokens +
      request.estimatedOutputTokens * pricing.outputPerMillionTokens,
  );
  const worstCase = perCall * reasoning.maxModelCalls;
  if (!Number.isSafeInteger(worstCase) || worstCase < 0) {
    throw new RoutingError("INVALID_INPUT", "Estimated routing cost exceeds safe integer bounds.");
  }
  return worstCase;
}

function cacheDecision(
  request: RouteRequest,
  primary: RoutingCandidate,
  reasoning: ReasoningPlan,
  effectiveQualityFloorBps: number,
): RoutingCacheDecision {
  const enabled = !request.cache.sensitive && request.cache.maxAgeMs > 0;
  if (!enabled || (!request.cache.allowRead && !request.cache.allowWrite)) {
    return Object.freeze({
      maxAgeMs: request.cache.maxAgeMs,
      readAllowed: false,
      writeAllowed: false,
    });
  }
  const key = sha256Json({
    contextHash: request.cache.contextHash,
    effectiveQualityFloorBps,
    estimatedInputTokens: request.estimatedInputTokens,
    estimatedOutputTokens: request.estimatedOutputTokens,
    evidenceHash: request.cache.evidenceHash,
    missionId: request.missionId,
    primary: {
      evaluationHash: primary.evaluationHash,
      model: primary.model,
      profileVersion: primary.profileVersion,
      provider: primary.provider,
      reasoningEffort: primary.reasoningEffort,
    },
    reasoningPlanHash: reasoning.planHash,
    requirements: request.requirements,
    taskClass: request.taskClass,
    taskId: request.taskId,
  });
  return Object.freeze({
    key,
    maxAgeMs: request.cache.maxAgeMs,
    readAllowed: request.cache.allowRead,
    writeAllowed: request.cache.allowWrite,
  });
}

function comparePrimaryCandidates(left: RoutingCandidate, right: RoutingCandidate): number {
  return (
    left.estimatedCostMicros - right.estimatedCostMicros ||
    left.medianLatencyMs - right.medianLatencyMs ||
    right.qualityScoreBps - left.qualityScoreBps ||
    right.passRateBps - left.passRateBps ||
    candidateKey(left).localeCompare(candidateKey(right))
  );
}

function compareEscalations(left: RoutingCandidate, right: RoutingCandidate): number {
  return (
    left.qualityScoreBps - right.qualityScoreBps ||
    left.estimatedCostMicros - right.estimatedCostMicros ||
    left.medianLatencyMs - right.medianLatencyMs ||
    candidateKey(left).localeCompare(candidateKey(right))
  );
}

function freezeCandidate(value: RoutingCandidate): RoutingCandidate {
  return Object.freeze({ ...value });
}

function candidateKey(value: RoutingCandidate): string {
  return [
    value.provider,
    value.model,
    value.profileVersion,
    value.reasoningEffort ?? "none",
    value.evaluationId,
  ].join("\u0000");
}

function candidateLabel(value: ModelEvaluation): string {
  return `${value.provider}/${value.model}@${value.profileVersion}:${value.reasoningEffort ?? "default"}`;
}

function profileKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

function evaluationRouteKey(value: ModelEvaluation): string {
  return [value.provider, value.model, value.profileVersion, value.reasoningEffort ?? "none"].join(
    "\u0000",
  );
}
