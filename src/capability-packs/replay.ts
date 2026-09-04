import type { CapabilityCandidateRef, CapabilityCurationReport } from "./types.js";
import { CapabilityCurationError } from "./types.js";

export type CapabilityReplayAction = "COMPRESS" | "DEDUPLICATE" | "KEEP" | "RETEST" | "REVIEW";

export interface CapabilityReplayPolicy {
  readonly contextCompressionBytes: number;
  readonly lowAverageLiftBps: number;
  readonly maxProposals: number;
  readonly maxReports: number;
  readonly staleAfterMs: number;
}

export interface CapabilityReplayProposal {
  readonly action: CapabilityReplayAction;
  readonly candidate: CapabilityCandidateRef;
  readonly reasons: readonly string[];
  readonly reportHash: string;
}

export interface CapabilityReplayResult {
  readonly observedAt: string;
  readonly proposals: readonly CapabilityReplayProposal[];
}

const DEFAULT_POLICY: CapabilityReplayPolicy = Object.freeze({
  contextCompressionBytes: 16_384,
  lowAverageLiftBps: 150,
  maxProposals: 64,
  maxReports: 256,
  staleAfterMs: 30 * 24 * 60 * 60 * 1_000,
});

export function proposeCapabilityReplay(
  reportsValue: readonly CapabilityCurationReport[],
  observedAtValue: string,
  policyValue: Partial<CapabilityReplayPolicy> = {},
): CapabilityReplayResult {
  const policy = normalizePolicy({ ...DEFAULT_POLICY, ...policyValue });
  const observedAt = canonicalTimestamp(observedAtValue, "replay observedAt");
  if (!Array.isArray(reportsValue) || reportsValue.length > policy.maxReports) {
    invalid("Replay report collection is malformed.");
  }
  const reports = [...reportsValue].sort((left, right) =>
    left.reportHash.localeCompare(right.reportHash),
  );
  if (new Set(reports.map((report) => report.reportHash)).size !== reports.length) {
    invalid("Replay report hashes must be unique.");
  }

  const proposals: CapabilityReplayProposal[] = [];
  for (const report of reports) {
    if (!/^[a-f0-9]{64}$/u.test(report.reportHash)) invalid("Replay report hash is invalid.");
    const proposal = proposalFor(report, observedAt, policy);
    proposals.push(proposal);
    if (proposals.length > policy.maxProposals) {
      invalid("Replay proposal output exceeds its configured bound.");
    }
  }
  return Object.freeze({ observedAt, proposals: Object.freeze(proposals) });
}

function proposalFor(
  report: CapabilityCurationReport,
  observedAt: string,
  policy: CapabilityReplayPolicy,
): CapabilityReplayProposal {
  const reasons: string[] = [];
  let action: CapabilityReplayAction = "KEEP";

  if (report.decision === "REDUNDANT") {
    action = "DEDUPLICATE";
    reasons.push("NO_NOVEL_PROCEDURE");
  } else if (report.decision === "FAIL") {
    const authorityRisk = report.reasons.some(
      (reason) => reason.includes(":AUTHORITY") || reason.includes(":SAFETY"),
    );
    action = authorityRisk ? "REVIEW" : "RETEST";
    reasons.push(authorityRisk ? "SAFETY_OR_AUTHORITY_FAILURE" : "EVALUATION_FAILURE");
  } else if (report.evaluatedAt === null) {
    action = "REVIEW";
    reasons.push("PASS_WITHOUT_EVALUATION_TIME");
  } else if (Date.parse(observedAt) - Date.parse(report.evaluatedAt) > policy.staleAfterMs) {
    action = "RETEST";
    reasons.push("STALE_EVALUATION");
  } else if (report.candidateContextBytes > policy.contextCompressionBytes) {
    action = "COMPRESS";
    reasons.push("CONTEXT_COMPRESSION_OPPORTUNITY");
  } else if (
    report.cases.length > 0 &&
    report.totalLiftBps < policy.lowAverageLiftBps * report.cases.length
  ) {
    action = "REVIEW";
    reasons.push("LOW_MEASURED_LIFT");
  }

  return Object.freeze({
    action,
    candidate: Object.freeze({ ...report.candidate }),
    reasons: Object.freeze(reasons),
    reportHash: report.reportHash,
  });
}

function normalizePolicy(value: CapabilityReplayPolicy): CapabilityReplayPolicy {
  return Object.freeze({
    contextCompressionBytes: safeInteger(
      value.contextCompressionBytes,
      "replay contextCompressionBytes",
      1,
      1_048_576,
    ),
    lowAverageLiftBps: safeInteger(value.lowAverageLiftBps, "replay lowAverageLiftBps", 0, 10_000),
    maxProposals: safeInteger(value.maxProposals, "replay maxProposals", 1, 1_024),
    maxReports: safeInteger(value.maxReports, "replay maxReports", 1, 4_096),
    staleAfterMs: safeInteger(
      value.staleAfterMs,
      "replay staleAfterMs",
      1,
      365 * 24 * 60 * 60 * 1_000,
    ),
  });
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    invalid(`${label} must be canonical UTC.`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${label} is outside its allowed integer range.`);
  }
  return value as number;
}

function invalid(message: string): never {
  throw new CapabilityCurationError("INVALID_INPUT", message);
}
