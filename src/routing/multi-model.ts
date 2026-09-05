import { createHash } from "node:crypto";
import type { ReasoningEffort } from "../providers/types.js";
import { EmpiricalModelRouter, normalizeRouteRequest } from "./router.js";
import {
  type RouteRequest,
  type RoutingDecision,
  RoutingError,
  type RoutingInputs,
  type RoutingTaskClass,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const EFFORTS = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh", "max"]);
const CATEGORIES = new Set<RouteFailureCategory>([
  "authentication",
  "budget",
  "capability_mismatch",
  "context",
  "malformed_response",
  "network",
  "policy_denied",
  "quality",
  "rate_limit",
  "timeout",
  "unknown",
  "verification",
]);
const IMMEDIATE_EXCLUSIONS = new Set<RouteFailureCategory>([
  "authentication",
  "capability_mismatch",
  "policy_denied",
]);

export type RouteFailureCategory =
  | "authentication"
  | "budget"
  | "capability_mismatch"
  | "context"
  | "malformed_response"
  | "network"
  | "policy_denied"
  | "quality"
  | "rate_limit"
  | "timeout"
  | "unknown"
  | "verification";

export interface RouteFailureInput {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
  readonly taskClass: RoutingTaskClass;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly failureSignature: string;
  readonly category: RouteFailureCategory;
  readonly observedAt: string;
}

export interface RouteFailure extends RouteFailureInput {
  readonly contentHash: string;
}

export interface FailureAwareRoutingPolicy {
  readonly maxFailureAgeMs: number;
  readonly repeatedFailureCeiling: number;
}

export interface FailureAwareRouteResult {
  readonly routing: RoutingDecision;
  readonly excludedRouteKeys: readonly string[];
  readonly consideredFailureHashes: readonly string[];
  readonly decisionHash: string;
}

export class FailureAwareModelRouter {
  readonly #router: EmpiricalModelRouter;
  readonly #policy: FailureAwareRoutingPolicy;

  constructor(
    policy: Partial<FailureAwareRoutingPolicy> = {},
    router: EmpiricalModelRouter = new EmpiricalModelRouter(),
  ) {
    this.#router = router;
    this.#policy = Object.freeze({
      maxFailureAgeMs: policy.maxFailureAgeMs ?? 15 * 60_000,
      repeatedFailureCeiling: policy.repeatedFailureCeiling ?? 2,
    });
    if (!Number.isSafeInteger(this.#policy.maxFailureAgeMs) || this.#policy.maxFailureAgeMs < 1) {
      throw new RoutingError(
        "INVALID_INPUT",
        "M21 maxFailureAgeMs must be a positive safe integer.",
      );
    }
    if (
      !Number.isSafeInteger(this.#policy.repeatedFailureCeiling) ||
      this.#policy.repeatedFailureCeiling < 1 ||
      this.#policy.repeatedFailureCeiling > 10
    ) {
      throw new RoutingError(
        "INVALID_INPUT",
        "M21 repeatedFailureCeiling must be between 1 and 10.",
      );
    }
  }

  route(
    requestValue: RouteRequest,
    inputs: RoutingInputs,
    failuresValue: readonly RouteFailure[],
  ): FailureAwareRouteResult {
    const request = normalizeRouteRequest(requestValue);
    if (
      inputs === null ||
      typeof inputs !== "object" ||
      !Array.isArray(inputs.evaluations) ||
      !Array.isArray(inputs.profiles)
    ) {
      throw new RoutingError(
        "INVALID_INPUT",
        "M21 routing inputs must contain profile and evaluation arrays.",
      );
    }
    if (!Array.isArray(failuresValue) || failuresValue.length > 1_000) {
      throw new RoutingError("INVALID_INPUT", "M21 failure history exceeds its collection bound.");
    }
    const evaluatedAt = Date.parse(request.evaluatedAt);
    const failures = failuresValue.map((failure) => normalizeRouteFailure(failure));
    const byId = new Map<string, RouteFailure>();
    for (const failure of failures) {
      const previous = byId.get(failure.id);
      if (previous !== undefined && previous.contentHash !== failure.contentHash) {
        throw new RoutingError(
          "EVALUATION_CONFLICT",
          "One M21 failure id identifies conflicting evidence.",
        );
      }
      byId.set(failure.id, failure);
    }

    const current = [...byId.values()]
      .filter((failure) => failure.taskClass === request.taskClass)
      .filter((failure) => {
        const observedAt = Date.parse(failure.observedAt);
        const age = evaluatedAt - observedAt;
        if (age < 0) {
          throw new RoutingError(
            "EVALUATION_INVALID",
            "Future M21 route failure evidence is invalid.",
          );
        }
        return age <= this.#policy.maxFailureAgeMs;
      })
      .sort((left, right) => left.contentHash.localeCompare(right.contentHash));

    const counts = new Map<string, number>();
    const excluded = new Set<string>();
    for (const failure of current) {
      const routeKey = exactRouteKey(failure);
      const signatureKey = `${routeKey}\u0000${failure.failureSignature}`;
      const count = (counts.get(signatureKey) ?? 0) + 1;
      counts.set(signatureKey, count);
      if (
        IMMEDIATE_EXCLUSIONS.has(failure.category) ||
        count >= this.#policy.repeatedFailureCeiling
      ) {
        excluded.add(routeKey);
      }
    }

    const evaluations = inputs.evaluations.filter(
      (evaluation) => !excluded.has(exactRouteKey(evaluation)),
    );
    const profileHasEvaluation = new Set(
      evaluations.map((evaluation) =>
        profileKey(evaluation.provider, evaluation.model, evaluation.profileVersion),
      ),
    );
    const profiles = inputs.profiles.filter((profile) =>
      profileHasEvaluation.has(profileKey(profile.provider, profile.model, profile.version)),
    );

    if (profiles.length === 0 || evaluations.length === 0) {
      throw new RoutingError(
        "NO_ELIGIBLE_MODEL",
        "No M21 route remains after quality/capability gates and bounded recent-failure exclusions.",
        [...excluded].sort(),
      );
    }

    let routing: RoutingDecision;
    try {
      routing = this.#router.route(request, { evaluations, profiles });
    } catch (error) {
      if (
        error instanceof RoutingError &&
        error.code === "NO_ELIGIBLE_MODEL" &&
        excluded.size > 0
      ) {
        throw new RoutingError(
          "NO_ELIGIBLE_MODEL",
          "No M21 route remains after quality/capability gates and bounded recent-failure exclusions.",
          [...excluded].sort(),
        );
      }
      throw error;
    }

    const excludedRouteKeys = Object.freeze([...excluded].sort());
    const consideredFailureHashes = Object.freeze(current.map((failure) => failure.contentHash));
    const body = {
      consideredFailureHashes,
      excludedRouteKeys,
      policy: this.#policy,
      routingDecisionHash: routing.decisionHash,
    };
    return Object.freeze({
      consideredFailureHashes,
      decisionHash: hashJson(body),
      excludedRouteKeys,
      routing,
    });
  }
}

export function createRouteFailure(value: RouteFailureInput): RouteFailure {
  const input = normalizeFailureInput(value);
  return Object.freeze({ ...input, contentHash: routeFailureHash(input) });
}

export function routeFailureHash(value: RouteFailureInput): string {
  return hashJson({
    category: value.category,
    failureSignature: value.failureSignature,
    id: value.id,
    model: value.model,
    observedAt: value.observedAt,
    profileVersion: value.profileVersion,
    provider: value.provider,
    reasoningEffort: value.reasoningEffort,
    taskClass: value.taskClass,
  });
}

function normalizeRouteFailure(value: RouteFailure): RouteFailure {
  exactObjectKeys(value, [
    "category",
    "contentHash",
    "failureSignature",
    "id",
    "model",
    "observedAt",
    "profileVersion",
    "provider",
    "reasoningEffort",
    "taskClass",
  ]);
  const input = normalizeFailureInput(value);
  if (!SHA256.test(value.contentHash) || routeFailureHash(input) !== value.contentHash) {
    throw new RoutingError("EVALUATION_INVALID", "M21 route failure content hash is invalid.");
  }
  return Object.freeze({ ...input, contentHash: value.contentHash });
}

function normalizeFailureInput(value: RouteFailureInput): RouteFailureInput {
  exactObjectKeys(
    value,
    [
      "category",
      "failureSignature",
      "id",
      "model",
      "observedAt",
      "profileVersion",
      "provider",
      "reasoningEffort",
      "taskClass",
    ],
    ["contentHash"],
  );
  const observedAt = canonicalTimestamp(value.observedAt, "M21 failure observedAt");
  if (!CATEGORIES.has(value.category)) {
    throw new RoutingError("EVALUATION_INVALID", "M21 route failure category is unsupported.");
  }
  if (value.reasoningEffort !== null && !EFFORTS.has(value.reasoningEffort)) {
    throw new RoutingError(
      "EVALUATION_INVALID",
      "M21 route failure reasoning effort is unsupported.",
    );
  }
  if (!SHA256.test(value.failureSignature)) {
    throw new RoutingError("EVALUATION_INVALID", "M21 failure signature must be a SHA-256 digest.");
  }
  return Object.freeze({
    category: value.category,
    failureSignature: value.failureSignature,
    id: identifier(value.id, "M21 failure id"),
    model: identifier(value.model, "M21 failure model"),
    observedAt,
    profileVersion: identifier(value.profileVersion, "M21 failure profileVersion"),
    provider: identifier(value.provider, "M21 failure provider"),
    reasoningEffort: value.reasoningEffort,
    taskClass: value.taskClass,
  });
}

function exactRouteKey(value: {
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
  readonly taskClass: RoutingTaskClass;
  readonly reasoningEffort: ReasoningEffort | null;
}): string {
  return [
    value.provider,
    value.model,
    value.profileVersion,
    value.taskClass,
    value.reasoningEffort ?? "none",
  ].join("/");
}

function profileKey(provider: string, model: string, version: string): string {
  return `${provider}/${model}/${version}`;
}

function canonicalTimestamp(value: string, label: string): string {
  if (typeof value !== "string")
    throw new RoutingError("EVALUATION_INVALID", `${label} is invalid.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new RoutingError("EVALUATION_INVALID", `${label} must be canonical UTC ISO-8601.`);
  }
  return value;
}

function identifier(value: string, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new RoutingError("EVALUATION_INVALID", `${label} is malformed.`);
  }
  return value;
}

function exactObjectKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RoutingError("EVALUATION_INVALID", "M21 route failure must be an object.");
  }
  const keys = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !keys.includes(key))) {
    throw new RoutingError(
      "EVALUATION_INVALID",
      "M21 route failure has unknown or missing fields.",
    );
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
