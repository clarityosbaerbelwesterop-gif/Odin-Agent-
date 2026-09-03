import { assertSha256, safeInteger, sha256Json } from "./internal.js";
import type {
  ReasoningAttemptState,
  ReasoningBranch,
  ReasoningBranchKind,
  ReasoningControllerDecision,
  ReasoningEvidenceSignal,
  ReasoningPlan,
  RouteRequest,
  RoutingDecision,
} from "./types.js";
import { RoutingError } from "./types.js";

const BRANCH_KINDS: readonly ReasoningBranchKind[] = [
  "direct",
  "alternative",
  "adversarial",
  "decomposition",
];

export function createReasoningPlan(request: RouteRequest): ReasoningPlan {
  const desiredBranches =
    desiredByRisk(request.risk, 1, 2, 3, 4) + (request.uncertaintyBps >= 5_000 ? 1 : 0);
  const desiredCritiques =
    desiredByRisk(request.risk, 0, 1, 1, 2) + (request.uncertaintyBps >= 7_500 ? 1 : 0);
  const desiredRepairs = desiredByRisk(request.risk, 1, 1, 2, 2);
  const estimatedTokensPerCall = request.estimatedInputTokens + request.estimatedOutputTokens;
  const tokenCallCeiling =
    estimatedTokensPerCall === 0
      ? request.budget.maxModelCalls
      : Math.floor(request.budget.maxEstimatedTokens / estimatedTokensPerCall);
  const maxModelCalls = Math.min(request.budget.maxModelCalls, tokenCallCeiling);

  const branchCount = Math.min(desiredBranches, request.budget.maxBranches, maxModelCalls);
  if (branchCount < 1) {
    throw new RoutingError(
      "BUDGET_EXCEEDED",
      "Reasoning requires at least one bounded model call.",
    );
  }

  let remainingCalls = maxModelCalls - branchCount;
  const reservedRepairCalls = Math.min(
    desiredRepairs,
    request.budget.maxRepairs,
    remainingCalls > 0 ? 1 : 0,
  );
  const critiquePasses = Math.min(
    desiredCritiques,
    request.budget.maxCritiquePasses,
    Math.max(0, remainingCalls - reservedRepairCalls),
  );
  remainingCalls -= critiquePasses;
  const repairAttempts = Math.min(desiredRepairs, request.budget.maxRepairs, remainingCalls);
  const parallelism = Math.min(request.budget.maxParallelCalls, branchCount, maxModelCalls);
  const branches = Object.freeze(
    Array.from(
      { length: branchCount },
      (_, index): ReasoningBranch =>
        Object.freeze({
          id: `branch-${index + 1}`,
          kind: BRANCH_KINDS[index % BRANCH_KINDS.length] ?? "direct",
        }),
    ),
  );
  const planBody = {
    branchCount,
    branches,
    critiquePasses,
    estimatedTokensPerCall,
    maxEstimatedTokens: request.budget.maxEstimatedTokens,
    maxModelCalls,
    parallelism,
    repairAttempts,
  };
  return Object.freeze({ ...planBody, planHash: sha256Json(planBody) });
}

export class AdaptiveReasoningController {
  next(
    route: RoutingDecision,
    stateValue: ReasoningAttemptState,
    signalValue: ReasoningEvidenceSignal,
  ): ReasoningControllerDecision {
    const state = normalizeState(stateValue, route.reasoning);
    const signal = normalizeSignal(signalValue);

    if (signal.independent && signal.verdict === "PASS" && !signal.contradictory) {
      return decision(
        "ACCEPT",
        "Independent evidence accepted the current result.",
        route,
        state,
        signal,
      );
    }

    if (signal.contradictory) {
      return this.#escalateOrBlock(
        route,
        state,
        signal,
        "Contradictory evidence requires escalation or blocking.",
      );
    }

    if (signal.verdict === "FAIL" || signal.verdict === "REPAIR_REQUIRED") {
      if (
        state.repairsUsed < route.reasoning.repairAttempts &&
        state.modelCallsUsed < route.reasoning.maxModelCalls
      ) {
        return decision(
          "REPAIR",
          "Verification evidence requires a bounded targeted repair.",
          route,
          state,
          signal,
        );
      }
      return this.#escalateOrBlock(
        route,
        state,
        signal,
        "Repair budget is exhausted; escalation is required when available.",
      );
    }

    if (
      state.critiquePassesUsed < route.reasoning.critiquePasses &&
      state.modelCallsUsed < route.reasoning.maxModelCalls
    ) {
      return decision(
        "CRITIQUE",
        signal.verdict === "PASS"
          ? "Self-authored success cannot complete work; bounded critique remains."
          : "No independent pass exists; bounded critique remains.",
        route,
        state,
        signal,
      );
    }

    return this.#escalateOrBlock(
      route,
      state,
      signal,
      signal.verdict === "PASS"
        ? "Self-authored success cannot complete work."
        : "No independent pass exists and local reasoning budget is exhausted.",
    );
  }

  #escalateOrBlock(
    route: RoutingDecision,
    state: ReasoningAttemptState,
    signal: ReasoningEvidenceSignal,
    reason: string,
  ): ReasoningControllerDecision {
    if (
      state.escalationIndex < route.escalations.length &&
      state.modelCallsUsed < route.reasoning.maxModelCalls
    ) {
      return decision("ESCALATE", reason, route, state, signal, state.escalationIndex);
    }
    return decision("BLOCK", `${reason} No safe escalation remains.`, route, state, signal);
  }
}

function normalizeState(value: ReasoningAttemptState, plan: ReasoningPlan): ReasoningAttemptState {
  const modelCallsUsed = safeInteger(value.modelCallsUsed, "reasoning modelCallsUsed", 0);
  const critiquePassesUsed = safeInteger(
    value.critiquePassesUsed,
    "reasoning critiquePassesUsed",
    0,
  );
  const repairsUsed = safeInteger(value.repairsUsed, "reasoning repairsUsed", 0);
  const escalationIndex = safeInteger(value.escalationIndex, "reasoning escalationIndex", 0);
  if (
    modelCallsUsed > plan.maxModelCalls ||
    critiquePassesUsed > plan.critiquePasses ||
    repairsUsed > plan.repairAttempts
  ) {
    throw new RoutingError(
      "BUDGET_EXCEEDED",
      "Reasoning attempt state exceeds its route ceilings.",
    );
  }
  return Object.freeze({ critiquePassesUsed, escalationIndex, modelCallsUsed, repairsUsed });
}

function normalizeSignal(value: ReasoningEvidenceSignal): ReasoningEvidenceSignal {
  const verdicts = new Set(["FAIL", "NONE", "PASS", "REPAIR_REQUIRED"] as const);
  if (!verdicts.has(value.verdict)) {
    throw new RoutingError("INVALID_INPUT", "Reasoning evidence verdict is unsupported.");
  }
  if (typeof value.independent !== "boolean" || typeof value.contradictory !== "boolean") {
    throw new RoutingError("INVALID_INPUT", "Reasoning evidence flags must be boolean.");
  }
  if (value.evidenceHash !== undefined) assertSha256(value.evidenceHash, "reasoning evidenceHash");
  if (value.independent && value.verdict !== "NONE" && value.evidenceHash === undefined) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Independent reasoning evidence requires a hash-addressed evidence reference.",
    );
  }
  return Object.freeze({
    contradictory: value.contradictory,
    ...(value.evidenceHash === undefined ? {} : { evidenceHash: value.evidenceHash }),
    independent: value.independent,
    verdict: value.verdict,
  });
}

function desiredByRisk(
  risk: RouteRequest["risk"],
  low: number,
  medium: number,
  high: number,
  critical: number,
): number {
  switch (risk) {
    case "low":
      return low;
    case "medium":
      return medium;
    case "high":
      return high;
    case "critical":
      return critical;
  }
}

function decision(
  action: ReasoningControllerDecision["action"],
  reason: string,
  route: RoutingDecision,
  state: ReasoningAttemptState,
  signal: ReasoningEvidenceSignal,
  nextEscalationIndex?: number,
): ReasoningControllerDecision {
  const body = {
    action,
    ...(nextEscalationIndex === undefined ? {} : { nextEscalationIndex }),
    reason,
    routeHash: route.decisionHash,
    signal,
    state,
  };
  return Object.freeze({
    action,
    ...(nextEscalationIndex === undefined ? {} : { nextEscalationIndex }),
    decisionHash: sha256Json(body),
    reason,
  });
}
