import { booleanValue, exactKeys, hashJson, identifier, invalid, sha256 } from "./internal.js";
import type {
  ClassifiedFailure,
  FailureCategory,
  FailureSideEffect,
  FailureSignal,
  FailureSource,
} from "./types.js";

const SOURCES = new Set<FailureSource>([
  "persistence",
  "planner",
  "provider",
  "runtime",
  "sandbox",
  "tool",
  "verification",
]);
const SIDE_EFFECTS = new Set<FailureSideEffect>([
  "IDEMPOTENT",
  "IRREVERSIBLE_OR_UNKNOWN",
  "NONE",
  "REVERSIBLE",
]);

const CATEGORY_BY_REASON: Readonly<Record<string, FailureCategory>> = Object.freeze({
  aborted: "CANCELLED",
  budget_exceeded: "BUDGET",
  cancelled: "CANCELLED",
  conflict: "CONFLICT",
  context_overflow: "CONTEXT",
  denied: "POLICY",
  dependency_cycle: "PLAN",
  invalid_input: "PLAN",
  malformed_response: "PLAN",
  network: "TRANSIENT",
  permission: "POLICY",
  provider_timeout: "TRANSIENT",
  quality_gate_failed: "VERIFICATION",
  quota: "BUDGET",
  rate_limit: "TRANSIENT",
  retryable: "TRANSIENT",
  require_approval: "POLICY",
  stale_preimage: "CONFLICT",
  timeout: "TRANSIENT",
  unavailable: "TRANSIENT",
  verification_contradiction: "VERIFICATION",
  verification_failed: "VERIFICATION",
});

export function classifyFailure(value: FailureSignal): ClassifiedFailure {
  exactKeys(
    value,
    [
      "missionId",
      "taskId",
      "source",
      "phase",
      "reasonCode",
      "retryable",
      "sideEffect",
      "independentEvidence",
      "contradictoryEvidence",
    ],
    ["evidenceHash", "rollbackEvidenceHash"],
    "failure signal",
  );
  const missionId = identifier(value.missionId, "missionId");
  const taskId = identifier(value.taskId, "taskId");
  const phase = identifier(value.phase, "phase");
  const reasonCode = identifier(value.reasonCode, "reasonCode");
  if (!SOURCES.has(value.source)) invalid("failure source is unsupported.");
  if (!SIDE_EFFECTS.has(value.sideEffect)) invalid("failure side effect is unsupported.");
  const retryable = booleanValue(value.retryable, "retryable");
  const independentEvidence = booleanValue(value.independentEvidence, "independentEvidence");
  const contradictoryEvidence = booleanValue(value.contradictoryEvidence, "contradictoryEvidence");
  const evidenceHash =
    value.evidenceHash === undefined ? undefined : sha256(value.evidenceHash, "evidenceHash");
  const rollbackEvidenceHash =
    value.rollbackEvidenceHash === undefined
      ? undefined
      : sha256(value.rollbackEvidenceHash, "rollbackEvidenceHash");
  if (independentEvidence && evidenceHash === undefined) {
    invalid("Independent failure evidence requires evidenceHash.");
  }
  if (contradictoryEvidence && !independentEvidence) {
    invalid("Contradictory evidence must be independently produced.");
  }
  if (rollbackEvidenceHash !== undefined && value.sideEffect !== "REVERSIBLE") {
    invalid("Rollback evidence is valid only for reversible side effects.");
  }

  const category = classifyCategory(value.source, reasonCode, contradictoryEvidence);
  const body = {
    category,
    contradictoryEvidence,
    ...(evidenceHash === undefined ? {} : { evidenceHash }),
    independentEvidence,
    missionId,
    phase,
    reasonCode,
    retryable,
    ...(rollbackEvidenceHash === undefined ? {} : { rollbackEvidenceHash }),
    sideEffect: value.sideEffect,
    source: value.source,
    taskId,
  };
  return Object.freeze({ ...body, signature: hashJson(body) });
}

function classifyCategory(
  source: FailureSource,
  reasonCode: string,
  contradictoryEvidence: boolean,
): FailureCategory {
  if (contradictoryEvidence) return "VERIFICATION";
  const explicit = CATEGORY_BY_REASON[reasonCode];
  if (explicit !== undefined) return explicit;
  if (source === "verification") return "VERIFICATION";
  if (source === "planner") return "PLAN";
  if (source === "tool" || source === "sandbox") return "EXECUTION";
  if (source === "persistence") return "CONFLICT";
  return "UNKNOWN";
}
