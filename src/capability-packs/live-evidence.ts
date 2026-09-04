export type LiveComparisonStatus = "MEASURED" | "PARTIAL" | "INCONCLUSIVE";

export interface LiveComparableArm {
  readonly measurementComplete: boolean;
  readonly qualityBps: number;
}

export interface LiveComparablePair {
  readonly baseline: LiveComparableArm;
  readonly candidate: LiveComparableArm;
}

export interface LiveComparisonSummary {
  readonly status: LiveComparisonStatus;
  readonly cases: number;
  readonly completePairs: number;
  readonly incompletePairs: number;
  readonly baselineQualityBps: number | null;
  readonly candidateQualityBps: number | null;
  readonly totalLiftBps: number | null;
  readonly averageLiftBps: number | null;
}

export interface LiveFailureDiagnostic {
  readonly errorClass: string;
  readonly errorCode: string;
}

const PROVIDER_CATEGORIES = new Set([
  "aborted",
  "authentication",
  "context_overflow",
  "invalid_request",
  "malformed_response",
  "network",
  "permission",
  "quota",
  "rate_limit",
  "timeout",
  "unavailable",
  "unsupported",
  "unknown",
]);

const BUDGET_DIMENSIONS = new Set([
  "attempts",
  "costMicros",
  "inputTokens",
  "outputTokens",
  "toolCalls",
]);

const MISSION_DOMAIN_CODES = new Map<string, string>([
  ["Repository discovery found no bounded relevant source files.", "repository_discovery_empty"],
  ["M4 planning requires strict structured-output support.", "strict_output_unsupported"],
  ["Planning provider did not return a structured JSON object.", "plan_structured_output_missing"],
  [
    "Model plan targets a file outside bounded repository discovery.",
    "plan_target_outside_discovery",
  ],
  [
    "Model plan expectedSha does not match discovered repository state.",
    "plan_expected_sha_mismatch",
  ],
  ["Model plan does not change the target file.", "plan_no_change"],
  ["Model plan selected an unregistered quality command.", "plan_quality_command_unknown"],
  ["The M4 model change task must be dependency-free.", "plan_dependencies_forbidden"],
  ["Model task id collides with an Odin-reserved task id.", "plan_reserved_task_id"],
  ["Repair provider did not return a structured JSON object.", "repair_structured_output_missing"],
  ["Repair proposal may not change the persisted target path.", "repair_target_mismatch"],
  ["Repair expectedSha is stale or mismatched.", "repair_expected_sha_mismatch"],
  ["Repair proposal does not change the target file.", "repair_no_change"],
  [
    "Required quality gate is still failing after the bounded repair.",
    "quality_failed_after_repair",
  ],
  ["Completion requires the mission to be in VERIFYING.", "completion_state_invalid"],
  ["The required quality command is no longer registered.", "quality_command_missing"],
  ["M4 tool output must be a JSON object.", "tool_output_not_object"],
  ["Tool attempt count is invalid.", "tool_attempt_count_invalid"],
  ["Provider token usage must use non-negative safe integers.", "provider_usage_invalid"],
  ["Provider total token usage is inconsistent.", "provider_usage_inconsistent"],
]);

export function summarizeLiveComparisons(
  pairs: readonly LiveComparablePair[],
): LiveComparisonSummary {
  if (pairs.length === 0) throw new TypeError("Live comparison requires at least one case.");
  for (const pair of pairs) {
    validateArm(pair.baseline);
    validateArm(pair.candidate);
  }

  const complete = pairs.filter(
    (pair) => pair.baseline.measurementComplete && pair.candidate.measurementComplete,
  );
  const completePairs = complete.length;
  const incompletePairs = pairs.length - completePairs;
  const status: LiveComparisonStatus =
    completePairs === pairs.length ? "MEASURED" : completePairs === 0 ? "INCONCLUSIVE" : "PARTIAL";

  if (completePairs === 0) {
    return Object.freeze({
      averageLiftBps: null,
      baselineQualityBps: null,
      candidateQualityBps: null,
      cases: pairs.length,
      completePairs,
      incompletePairs,
      status,
      totalLiftBps: null,
    });
  }

  const baselineTotal = complete.reduce((sum, pair) => sum + pair.baseline.qualityBps, 0);
  const candidateTotal = complete.reduce((sum, pair) => sum + pair.candidate.qualityBps, 0);
  const totalLiftBps = candidateTotal - baselineTotal;

  return Object.freeze({
    averageLiftBps: Math.round(totalLiftBps / completePairs),
    baselineQualityBps: Math.round(baselineTotal / completePairs),
    candidateQualityBps: Math.round(candidateTotal / completePairs),
    cases: pairs.length,
    completePairs,
    incompletePairs,
    status,
    totalLiftBps,
  });
}

export function classifyLiveFailure(error: unknown): LiveFailureDiagnostic {
  if (!(error instanceof Error)) {
    return Object.freeze({ errorClass: "UnknownError", errorCode: "unknown_error" });
  }

  const errorClass = safeErrorClass(error.name);
  const record = asRecord(error);

  if (error.name === "ProviderError") {
    const category = typeof record.category === "string" ? record.category : "unknown";
    return Object.freeze({
      errorClass,
      errorCode: PROVIDER_CATEGORIES.has(category) ? `provider_${category}` : "provider_unknown",
    });
  }

  if (error.name === "BudgetExceededError") {
    const dimension = typeof record.dimension === "string" ? record.dimension : "unknown";
    return Object.freeze({
      errorClass,
      errorCode: BUDGET_DIMENSIONS.has(dimension) ? `budget_${dimension}` : "budget_unknown",
    });
  }

  if (error.name === "CodingVerificationGateError") {
    return Object.freeze({ errorClass, errorCode: "verification_gate_denied" });
  }

  if (error.name === "MissionDomainError") {
    return Object.freeze({
      errorClass,
      errorCode: MISSION_DOMAIN_CODES.get(error.message) ?? "mission_domain_unknown",
    });
  }

  return Object.freeze({ errorClass, errorCode: "unclassified_error" });
}

function validateArm(arm: LiveComparableArm): void {
  if (typeof arm.measurementComplete !== "boolean") {
    throw new TypeError("Live measurementComplete must be boolean.");
  }
  if (!Number.isSafeInteger(arm.qualityBps) || arm.qualityBps < 0 || arm.qualityBps > 10_000) {
    throw new TypeError("Live qualityBps must be an integer from 0 to 10000.");
  }
}

function safeErrorClass(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value) ? value : "Error";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : Object.create(null);
}
