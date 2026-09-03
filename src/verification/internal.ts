import { createHash } from "node:crypto";
import type {
  EvidenceProducerClass,
  EvidenceStatus,
  VerificationEvidenceKind,
  VerificationFinding,
  VerificationFindingCode,
} from "./types.js";

const EVIDENCE_KINDS = new Set<VerificationEvidenceKind>([
  "audit",
  "changed_file",
  "quality_gate",
  "review",
  "test",
]);
const PRODUCER_CLASSES = new Set<EvidenceProducerClass>([
  "external",
  "independent_tool",
  "planner",
  "runtime",
]);
const EVIDENCE_STATUSES = new Set<EvidenceStatus>(["FAIL", "PASS"]);
export const FINDING_CODES = new Set<VerificationFindingCode>([
  "claim_missing_evidence",
  "claim_duplicate_binding",
  "claim_foreign_scope",
  "claim_invalid",
  "evidence_conflict",
  "evidence_duplicate",
  "evidence_failed",
  "evidence_foreign_scope",
  "evidence_future",
  "evidence_invalid",
  "evidence_kind_mismatch",
  "evidence_missing",
  "evidence_reused",
  "evidence_self_authored",
  "evidence_stale",
  "evidence_too_early",
  "evidence_weak_provenance",
  "review_invalid",
]);

export const MAX_REPAIR_CLAIMS = 32;
export const MAX_REPAIR_REASONS = 32;

export function isEvidenceKind(value: unknown): value is VerificationEvidenceKind {
  return typeof value === "string" && EVIDENCE_KINDS.has(value as VerificationEvidenceKind);
}

export function isProducerClass(value: unknown): value is EvidenceProducerClass {
  return typeof value === "string" && PRODUCER_CLASSES.has(value as EvidenceProducerClass);
}

export function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return typeof value === "string" && EVIDENCE_STATUSES.has(value as EvidenceStatus);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximum;
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === value ? parsed : null;
}

export function finding(
  code: VerificationFindingCode,
  severity: VerificationFinding["severity"],
  claimId: string | undefined,
  evidenceIds: readonly string[],
  reason: string,
): VerificationFinding {
  return {
    code,
    evidenceIds: [...evidenceIds].sort(),
    ...(claimId === undefined ? {} : { claimId }),
    reason,
    severity,
  };
}

export function sortFindings(findings: readonly VerificationFinding[]): VerificationFinding[] {
  return [...findings].sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.claimId ?? "").localeCompare(right.claimId ?? "") ||
      left.evidenceIds.join("\u0000").localeCompare(right.evidenceIds.join("\u0000")) ||
      left.reason.localeCompare(right.reason) ||
      left.severity.localeCompare(right.severity),
  );
}

export function stableHash(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new TypeError("Cannot hash an undefined verification value.");
  return createHash("sha256").update(encoded).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, canonicalize(object[key])]),
  );
}
