import { boundedInteger, exactKeys, hashJson, identifier, invalid, sha256 } from "./internal.js";
import type {
  FailureRecoveryAuthority,
  RecoveryAction,
  RecoveryAttempt,
  RecoveryBudget,
  RecoveryCapabilities,
  RecoveryDecision,
  RecoveryRequest,
} from "./types.js";

const ACTIONS = new Set<RecoveryAction>([
  "ALTERNATIVE_PLAN",
  "CHECKPOINT_AND_BLOCK",
  "ESCALATE_MODEL",
  "ESCALATE_VERIFIER",
  "REDUCE_CONTEXT",
  "ROLLBACK",
  "STOP_CANCELLED",
  "TARGETED_REPAIR",
  "TARGETED_RETRY",
]);
const OUTCOMES = new Set(["FAILED", "NO_PROGRESS", "SUCCEEDED"] as const);

export class ReliabilityController implements FailureRecoveryAuthority {
  decide(requestValue: RecoveryRequest): RecoveryDecision {
    const request = normalizeRequest(requestValue);
    const candidates = candidatesFor(request);
    for (const [action, reasonCode] of candidates) {
      if (!isExhausted(action, request.budget) && !repeatsFailedStrategy(action, request)) {
        return decision(action, reasonCode, request);
      }
    }
    return decision(
      request.failure.category === "CANCELLED" ? "STOP_CANCELLED" : "CHECKPOINT_AND_BLOCK",
      request.failure.category === "CANCELLED" ? "cancelled" : "no_safe_recovery_remaining",
      request,
    );
  }
}

function candidatesFor(request: RecoveryRequest): readonly (readonly [RecoveryAction, string])[] {
  const failure = request.failure;
  if (failure.category === "CANCELLED") return [["STOP_CANCELLED", "cancelled"]];
  if (failure.category === "POLICY" || failure.category === "BUDGET") {
    return [["CHECKPOINT_AND_BLOCK", "authority_or_budget_required"]];
  }
  if (failure.sideEffect === "IRREVERSIBLE_OR_UNKNOWN") {
    return [["CHECKPOINT_AND_BLOCK", "unsafe_side_effect_state"]];
  }
  if (failure.sideEffect === "REVERSIBLE" && failure.rollbackEvidenceHash !== undefined) {
    return [
      ["ROLLBACK", "restore_runtime_attested_preimage"],
      ["CHECKPOINT_AND_BLOCK", "rollback_unavailable"],
    ];
  }
  if (failure.category === "CONTEXT") {
    return [
      ...(request.capabilities.contextReduction
        ? ([["REDUCE_CONTEXT", "reduce_context_preserving_invariants"]] as const)
        : []),
      ...(failure.retryable
        ? ([["TARGETED_RETRY", "retry_after_context_reduction"]] as const)
        : []),
      ...(request.capabilities.modelEscalation
        ? ([["ESCALATE_MODEL", "context_reduction_unavailable"]] as const)
        : []),
    ];
  }
  if (failure.category === "TRANSIENT") {
    if (!failure.retryable || failure.sideEffect === "REVERSIBLE") {
      return [["CHECKPOINT_AND_BLOCK", "transient_retry_not_safe"]];
    }
    return [
      ["TARGETED_RETRY", "retry_typed_transient_failure"],
      ...(request.capabilities.modelEscalation
        ? ([["ESCALATE_MODEL", "transient_retry_exhausted"]] as const)
        : []),
    ];
  }
  if (failure.category === "VERIFICATION") {
    if (failure.contradictoryEvidence && request.capabilities.verifierEscalation) {
      return [
        ["ESCALATE_VERIFIER", "resolve_independent_evidence_conflict"],
        ["CHECKPOINT_AND_BLOCK", "verifier_escalation_exhausted"],
      ];
    }
    return [
      ["TARGETED_REPAIR", "repair_against_verification_evidence"],
      ...(request.capabilities.verifierEscalation
        ? ([["ESCALATE_VERIFIER", "repair_exhausted"]] as const)
        : []),
      ...(request.capabilities.modelEscalation
        ? ([["ESCALATE_MODEL", "verification_repair_exhausted"]] as const)
        : []),
    ];
  }
  if (failure.category === "PLAN" || failure.category === "CONFLICT") {
    return [
      ["ALTERNATIVE_PLAN", "replace_invalid_or_conflicting_plan"],
      ...(request.capabilities.modelEscalation
        ? ([["ESCALATE_MODEL", "alternative_plan_exhausted"]] as const)
        : []),
    ];
  }
  if (request.capabilities.modelEscalation) {
    return [
      ["ESCALATE_MODEL", "unknown_failure_requires_stronger_diagnosis"],
      ["CHECKPOINT_AND_BLOCK", "model_escalation_exhausted"],
    ];
  }
  return [["CHECKPOINT_AND_BLOCK", "unknown_failure_has_no_safe_recovery"]];
}

function normalizeRequest(value: RecoveryRequest): RecoveryRequest {
  exactKeys(value, ["failure", "attempts", "budget", "capabilities"], [], "recovery request");
  sha256(value.failure.signature, "failure signature");
  const { signature, ...failureBody } = value.failure;
  if (hashJson(failureBody) !== signature) invalid("Failure signature does not match its content.");
  if (!Array.isArray(value.attempts) || value.attempts.length > 100) {
    invalid("Recovery attempts exceed their collection bound.");
  }
  const normalizedAttempts = value.attempts.map(normalizeAttempt);
  const attemptsByDecision = new Map<string, RecoveryAttempt>();
  for (const attempt of normalizedAttempts) {
    const previous = attemptsByDecision.get(attempt.decisionHash);
    if (previous !== undefined && hashJson(previous) !== hashJson(attempt)) {
      invalid("One recovery decision hash cannot identify conflicting attempts.");
    }
    attemptsByDecision.set(attempt.decisionHash, attempt);
  }
  const attempts = Object.freeze(
    [...attemptsByDecision.values()].sort((left, right) =>
      left.decisionHash.localeCompare(right.decisionHash),
    ),
  );
  const budget = normalizeBudget(value.budget);
  if (budget.maxRepeatedStrategyFailures < 1) {
    invalid("maxRepeatedStrategyFailures must permit at least one strategy failure.");
  }
  const capabilities = normalizeCapabilities(value.capabilities);
  return Object.freeze({
    attempts,
    budget,
    capabilities,
    failure: Object.freeze({ ...value.failure }),
  });
}

function normalizeAttempt(value: RecoveryAttempt): RecoveryAttempt {
  exactKeys(value, ["failureSignature", "action", "outcome", "decisionHash"], [], "attempt");
  const failureSignature = sha256(value.failureSignature, "attempt failureSignature");
  const decisionHash = sha256(value.decisionHash, "attempt decisionHash");
  if (!ACTIONS.has(value.action)) invalid("attempt action is unsupported.");
  if (!OUTCOMES.has(value.outcome)) invalid("attempt outcome is unsupported.");
  return Object.freeze({
    action: value.action,
    decisionHash,
    failureSignature,
    outcome: value.outcome,
  });
}

function normalizeBudget(value: RecoveryBudget): RecoveryBudget {
  exactKeys(
    value,
    [
      "retriesRemaining",
      "repairsRemaining",
      "alternativePlansRemaining",
      "rollbacksRemaining",
      "verifierEscalationsRemaining",
      "modelEscalationsRemaining",
      "maxRepeatedStrategyFailures",
    ],
    [],
    "recovery budget",
  );
  return Object.freeze({
    alternativePlansRemaining: boundedInteger(
      value.alternativePlansRemaining,
      "alternativePlansRemaining",
    ),
    maxRepeatedStrategyFailures: boundedInteger(
      value.maxRepeatedStrategyFailures,
      "maxRepeatedStrategyFailures",
      10,
    ),
    modelEscalationsRemaining: boundedInteger(
      value.modelEscalationsRemaining,
      "modelEscalationsRemaining",
    ),
    repairsRemaining: boundedInteger(value.repairsRemaining, "repairsRemaining"),
    retriesRemaining: boundedInteger(value.retriesRemaining, "retriesRemaining"),
    rollbacksRemaining: boundedInteger(value.rollbacksRemaining, "rollbacksRemaining"),
    verifierEscalationsRemaining: boundedInteger(
      value.verifierEscalationsRemaining,
      "verifierEscalationsRemaining",
    ),
  });
}

function normalizeCapabilities(value: RecoveryCapabilities): RecoveryCapabilities {
  exactKeys(
    value,
    ["contextReduction", "modelEscalation", "verifierEscalation"],
    [],
    "recovery capabilities",
  );
  if (
    typeof value.contextReduction !== "boolean" ||
    typeof value.modelEscalation !== "boolean" ||
    typeof value.verifierEscalation !== "boolean"
  ) {
    invalid("Recovery capabilities must be boolean.");
  }
  return Object.freeze({ ...value });
}

function isExhausted(action: RecoveryAction, budget: RecoveryBudget): boolean {
  switch (action) {
    case "TARGETED_RETRY":
      return budget.retriesRemaining === 0;
    case "TARGETED_REPAIR":
      return budget.repairsRemaining === 0;
    case "ALTERNATIVE_PLAN":
      return budget.alternativePlansRemaining === 0;
    case "ROLLBACK":
      return budget.rollbacksRemaining === 0;
    case "ESCALATE_VERIFIER":
      return budget.verifierEscalationsRemaining === 0;
    case "ESCALATE_MODEL":
      return budget.modelEscalationsRemaining === 0;
    default:
      return false;
  }
}

function repeatsFailedStrategy(action: RecoveryAction, request: RecoveryRequest): boolean {
  const failures = request.attempts.filter(
    (attempt) =>
      attempt.failureSignature === request.failure.signature &&
      attempt.action === action &&
      attempt.outcome !== "SUCCEEDED",
  ).length;
  return failures >= request.budget.maxRepeatedStrategyFailures;
}

function decision(
  action: RecoveryAction,
  reasonCode: string,
  request: RecoveryRequest,
): RecoveryDecision {
  identifier(reasonCode, "recovery reasonCode");
  const body = {
    action,
    attempts: request.attempts,
    budget: request.budget,
    capabilities: request.capabilities,
    failureSignature: request.failure.signature,
    reasonCode,
  };
  return Object.freeze({
    action,
    decisionHash: hashJson(body),
    failureSignature: request.failure.signature,
    reasonCode,
  });
}
