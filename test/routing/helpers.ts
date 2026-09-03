import type {
  CapabilityProfile,
  ModelCapabilities,
  ModelPricing,
  ReasoningEffort,
} from "../../src/providers/index.js";
import { makeCapabilities } from "../../src/providers/index.js";
import {
  createEvaluationRecord,
  type ModelEvaluation,
  type RouteRequest,
} from "../../src/routing/index.js";

export const NOW = "2026-09-03T12:00:00.000Z";
export const CONTEXT_HASH = "a".repeat(64);
export const EVIDENCE_HASH = "b".repeat(64);

export function routingProfile(
  provider: string,
  model: string,
  options: {
    readonly version?: string;
    readonly capabilities?: Partial<ModelCapabilities>;
    readonly pricing?: Partial<ModelPricing>;
  } = {},
): CapabilityProfile {
  return {
    capabilities: makeCapabilities({
      contextWindowTokens: 128_000,
      imageInput: true,
      maxOutputTokens: 16_384,
      reasoningEfforts: ["low", "high"],
      streaming: true,
      strictStructuredOutput: true,
      strictToolSchema: true,
      structuredOutput: true,
      temperature: true,
      toolUse: true,
      ...options.capabilities,
    }),
    model,
    pricing: {
      currency: "USD",
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 2,
      ...options.pricing,
    },
    provider,
    provenance: {
      kind: "project_config",
      observedAt: "2026-09-02T00:00:00.000Z",
      reference: "M11 routing fixture",
    },
    version: options.version ?? "v1",
  };
}

export function routingEvaluation(
  provider: string,
  model: string,
  options: {
    readonly id?: string;
    readonly version?: string;
    readonly taskClass?: "coding" | "general" | "planning" | "research";
    readonly effort?: ReasoningEffort | null;
    readonly quality?: number;
    readonly passRate?: number;
    readonly latencyMs?: number;
    readonly observedAt?: string;
    readonly producerClass?: "independent_eval" | "project_eval";
  } = {},
): ModelEvaluation {
  return createEvaluationRecord({
    id: options.id ?? `${provider}.${model}.${options.effort ?? "default"}`,
    inputTokensPerSample: 1_000,
    medianLatencyMs: options.latencyMs ?? 1_000,
    model,
    observedAt: options.observedAt ?? "2026-09-03T10:00:00.000Z",
    outputTokensPerSample: 500,
    passRateBps: options.passRate ?? options.quality ?? 8_000,
    producer: {
      class: options.producerClass ?? "independent_eval",
      id: "eval-suite",
      reference: "offline-routing-eval:v1",
    },
    profileVersion: options.version ?? "v1",
    provider,
    qualityScoreBps: options.quality ?? 8_000,
    reasoningEffort: options.effort ?? "low",
    samples: 100,
    taskClass: options.taskClass ?? "coding",
  });
}

export function routeRequest(
  overrides: Partial<RouteRequest> = {},
): RouteRequest {
  const base: RouteRequest = {
    baseQualityFloorBps: 7_000,
    budget: {
      maxBranches: 4,
      maxCritiquePasses: 2,
      maxEstimatedCostMicros: 100_000,
      maxModelCalls: 6,
      maxParallelCalls: 3,
      maxRepairs: 2,
    },
    cache: {
      allowRead: true,
      allowWrite: true,
      contextHash: CONTEXT_HASH,
      evidenceHash: EVIDENCE_HASH,
      maxAgeMs: 60_000,
      sensitive: false,
    },
    currency: "USD",
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 500,
    evaluatedAt: NOW,
    missionId: "mission-m11",
    requirements: {
      imageInput: false,
      strictStructuredOutput: false,
      structuredOutput: false,
      toolUse: true,
    },
    risk: "low",
    taskClass: "coding",
    taskId: "task-route",
    uncertaintyBps: 0,
  };
  return {
    ...base,
    ...overrides,
    budget: { ...base.budget, ...overrides.budget },
    cache: { ...base.cache, ...overrides.cache },
    requirements: { ...base.requirements, ...overrides.requirements },
  };
}
