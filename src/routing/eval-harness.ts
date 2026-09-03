import { identifier, safeInteger, sha256Json } from "./internal.js";
import type { EmpiricalModelRouter } from "./router.js";
import type { RouteRequest, RoutingDecision, RoutingInputs } from "./types.js";
import { RoutingError } from "./types.js";

export interface RoutingEvaluationCase {
  readonly id: string;
  readonly request: RouteRequest;
  readonly inputs: RoutingInputs;
}

export interface RoutingEvaluationOutcome {
  readonly id: string;
  readonly status: "BLOCKED" | "ROUTED";
  readonly decisionHash?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly estimatedCostMicros?: number;
  readonly errorCode?: string;
}

export interface RoutingEvaluationSummary {
  readonly cases: number;
  readonly routed: number;
  readonly blocked: number;
  readonly totalEstimatedCostMicros: number;
  readonly outcomes: readonly RoutingEvaluationOutcome[];
  readonly resultHash: string;
}

export function evaluateRoutingFixture(
  router: EmpiricalModelRouter,
  casesValue: readonly RoutingEvaluationCase[],
): RoutingEvaluationSummary {
  if (!Array.isArray(casesValue) || casesValue.length === 0 || casesValue.length > 1_000) {
    throw new RoutingError("INVALID_INPUT", "Routing evaluation cases are malformed.");
  }
  const cases = [...casesValue]
    .map((entry) => ({ ...entry, id: identifier(entry.id, "routing evaluation case id") }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(cases.map((entry) => entry.id)).size !== cases.length) {
    throw new RoutingError("INVALID_INPUT", "Routing evaluation case ids must be unique.");
  }

  const outcomes = Object.freeze(cases.map((entry) => runCase(router, entry)));
  const routed = outcomes.filter((outcome) => outcome.status === "ROUTED").length;
  const blocked = outcomes.length - routed;
  const totalEstimatedCostMicros = outcomes.reduce(
    (sum, outcome) => sum + (outcome.estimatedCostMicros ?? 0),
    0,
  );
  safeInteger(totalEstimatedCostMicros, "routing fixture total estimated cost", 0);
  const body = { blocked, cases: outcomes.length, outcomes, routed, totalEstimatedCostMicros };
  return Object.freeze({ ...body, resultHash: sha256Json(body) });
}

function runCase(
  router: EmpiricalModelRouter,
  entry: RoutingEvaluationCase,
): RoutingEvaluationOutcome {
  try {
    const route: RoutingDecision = router.route(entry.request, entry.inputs);
    return Object.freeze({
      decisionHash: route.decisionHash,
      estimatedCostMicros: route.primary.estimatedCostMicros,
      id: entry.id,
      model: route.primary.model,
      provider: route.primary.provider,
      status: "ROUTED" as const,
    });
  } catch (error: unknown) {
    if (!(error instanceof RoutingError)) throw error;
    return Object.freeze({
      errorCode: error.code,
      id: entry.id,
      status: "BLOCKED" as const,
    });
  }
}
