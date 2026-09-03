import {
  assertCanonicalTimestamp,
  assertIdentifier,
  assertSha256,
  assertText,
  assertToken,
  MAX_COLLECTION_ITEMS,
  MAX_REFERENCE_LENGTH,
  MAX_SUMMARY_LENGTH,
  normalizeRepositoryPath,
  stableHash,
} from "./internal.js";
import { pathIsOwnedForWrite } from "./ownership.js";
import type {
  ReconciliationOutcome,
  ReconciliationReason,
  SpecialistArtifactReference,
  SpecialistAssignment,
  SpecialistEvidenceAuthority,
  SpecialistEvidenceReference,
  SpecialistProposal,
  SpecialistResult,
  TaskReconciliation,
} from "./types.js";

const PROPOSAL_KEYS = [
  "artifacts",
  "assignmentId",
  "assumptions",
  "completedAt",
  "evidence",
  "filesChanged",
  "missionId",
  "outcome",
  "remainingWork",
  "risks",
  "specialistId",
  "specialistVersion",
  "startedAt",
  "summary",
  "taskId",
  "verificationStatus",
] as const;
const EVIDENCE_KEYS = [
  "contentHash",
  "id",
  "kind",
  "observedAt",
  "producerClass",
  "reference",
  "status",
] as const;
const ARTIFACT_KEYS = ["contentHash", "id", "reference", "type"] as const;
const PROPOSAL_OUTCOMES = new Set<SpecialistProposal["outcome"]>(["BLOCKED", "FAILED", "SUCCESS"]);
const VERIFICATION_STATUSES = new Set<SpecialistProposal["verificationStatus"]>([
  "BLOCKED",
  "FAILED",
  "PARTIALLY_VERIFIED",
  "UNVERIFIED",
  "VERIFIED",
]);

export function reconcileProposal(
  assignment: SpecialistAssignment,
  value: unknown,
  receivedAtMs: number,
  evidenceAuthority: SpecialistEvidenceAuthority,
): TaskReconciliation {
  try {
    const result = validateProposal(assignment, value, receivedAtMs);
    if (result.outcome === "BLOCKED") {
      return createReconciliation(assignment, "BLOCKED", ["specialist_blocked"], [], result);
    }
    if (result.outcome === "FAILED") {
      return createReconciliation(assignment, "RETRY_REQUIRED", ["specialist_failed"], [], result);
    }

    const attestedEvidenceIds = result.evidence
      .filter(
        (item) =>
          item.producerClass === "independent_tool" &&
          item.status === "PASS" &&
          safelyAttested(evidenceAuthority, assignment, item),
      )
      .map((item) => item.id)
      .sort();
    const reasons: ReconciliationReason[] = [];
    if (result.evidence.some((item) => item.status === "FAIL")) reasons.push("failed_evidence");
    if (result.verificationStatus !== "VERIFIED" || attestedEvidenceIds.length === 0) {
      reasons.push("not_verified");
    }
    if (reasons.length > 0) {
      return createReconciliation(
        assignment,
        "RETRY_REQUIRED",
        reasons,
        attestedEvidenceIds,
        result,
      );
    }
    return createReconciliation(assignment, "ACCEPTED", [], attestedEvidenceIds, result);
  } catch {
    return createReconciliation(assignment, "BLOCKED", ["invalid_result"], []);
  }
}

export function executionFailureReconciliation(
  assignment: SpecialistAssignment,
  reason: "worker_failed" | "worker_timeout",
): TaskReconciliation {
  return createReconciliation(assignment, "RETRY_REQUIRED", [reason], []);
}

function validateProposal(
  assignment: SpecialistAssignment,
  value: unknown,
  receivedAtMs: number,
): SpecialistResult {
  const proposal = requireRecord(value, "proposal");
  assertExactKeys(proposal, PROPOSAL_KEYS, "proposal");

  const identity = {
    assignmentId: requireString(proposal, "assignmentId"),
    missionId: requireString(proposal, "missionId"),
    specialistId: requireString(proposal, "specialistId"),
    specialistVersion: requireString(proposal, "specialistVersion"),
    taskId: requireString(proposal, "taskId"),
  };
  if (
    identity.assignmentId !== assignment.id ||
    identity.missionId !== assignment.missionId ||
    identity.taskId !== assignment.taskId ||
    identity.specialistId !== assignment.lease.specialistId ||
    identity.specialistVersion !== assignment.lease.specialistVersion
  ) {
    throw new TypeError("Proposal identity does not match its assignment.");
  }

  const startedAt = requireString(proposal, "startedAt");
  const completedAt = requireString(proposal, "completedAt");
  const startedMs = assertCanonicalTimestamp(startedAt, "proposal.startedAt");
  const completedMs = assertCanonicalTimestamp(completedAt, "proposal.completedAt");
  const issuedMs = assertCanonicalTimestamp(assignment.lease.issuedAt, "lease.issuedAt");
  const expiresMs = assertCanonicalTimestamp(assignment.lease.expiresAt, "lease.expiresAt");
  if (
    startedMs < issuedMs ||
    completedMs < startedMs ||
    completedMs > receivedAtMs ||
    receivedAtMs >= expiresMs
  ) {
    throw new TypeError("Proposal timestamps fall outside the active assignment lease.");
  }

  const outcome = requireString(proposal, "outcome") as SpecialistProposal["outcome"];
  const verificationStatus = requireString(
    proposal,
    "verificationStatus",
  ) as SpecialistProposal["verificationStatus"];
  if (!PROPOSAL_OUTCOMES.has(outcome) || !VERIFICATION_STATUSES.has(verificationStatus)) {
    throw new TypeError("Proposal outcome or verification status is unsupported.");
  }
  if (
    (outcome === "BLOCKED" && verificationStatus !== "BLOCKED") ||
    (outcome === "FAILED" && verificationStatus !== "FAILED") ||
    (outcome === "SUCCESS" && (verificationStatus === "BLOCKED" || verificationStatus === "FAILED"))
  ) {
    throw new TypeError("Proposal outcome and verification status contradict each other.");
  }

  const summary = requireString(proposal, "summary");
  assertText(summary, "proposal.summary", MAX_SUMMARY_LENGTH);
  const evidence = normalizeEvidence(requireArray(proposal, "evidence"), startedMs, completedMs);
  const artifacts = normalizeArtifacts(requireArray(proposal, "artifacts"));
  const filesChanged = normalizeFilesChanged(requireArray(proposal, "filesChanged"), assignment);
  const assumptions = normalizeTextList(requireArray(proposal, "assumptions"), "assumptions");
  const risks = normalizeTextList(requireArray(proposal, "risks"), "risks");
  const remainingWork = normalizeTextList(requireArray(proposal, "remainingWork"), "remainingWork");

  const normalized: SpecialistProposal = {
    artifacts,
    assignmentId: identity.assignmentId,
    assumptions,
    completedAt,
    evidence,
    filesChanged,
    missionId: identity.missionId,
    outcome,
    remainingWork,
    risks,
    specialistId: identity.specialistId,
    specialistVersion: identity.specialistVersion,
    startedAt,
    summary,
    taskId: identity.taskId,
    verificationStatus,
  };
  return { ...normalized, resultHash: stableHash(normalized) };
}

function normalizeEvidence(
  values: readonly unknown[],
  startedMs: number,
  completedMs: number,
): readonly SpecialistEvidenceReference[] {
  assertCollectionBound(values, "proposal.evidence");
  const evidence = values.map((value, index): SpecialistEvidenceReference => {
    const item = requireRecord(value, `proposal.evidence[${index}]`);
    assertExactKeys(item, EVIDENCE_KEYS, `proposal.evidence[${index}]`);
    const id = requireString(item, "id");
    const kind = requireString(item, "kind");
    const reference = requireString(item, "reference");
    const contentHash = requireString(item, "contentHash");
    const observedAt = requireString(item, "observedAt");
    const producerClass = requireString(item, "producerClass");
    const status = requireString(item, "status");
    assertIdentifier(id, "evidence.id");
    assertToken(kind, "evidence.kind");
    assertText(reference, "evidence.reference", MAX_REFERENCE_LENGTH);
    assertSha256(contentHash, "evidence.contentHash");
    const observedMs = assertCanonicalTimestamp(observedAt, "evidence.observedAt");
    if (observedMs < startedMs || observedMs > completedMs) {
      throw new TypeError("Evidence timestamp falls outside proposal execution.");
    }
    if (producerClass !== "independent_tool" && producerClass !== "specialist") {
      throw new TypeError("Evidence producer class is unsupported.");
    }
    if (status !== "FAIL" && status !== "PASS") {
      throw new TypeError("Evidence status is unsupported.");
    }
    return { contentHash, id, kind, observedAt, producerClass, reference, status };
  });
  assertUniqueIds(evidence, "evidence");
  return evidence.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeArtifacts(values: readonly unknown[]): readonly SpecialistArtifactReference[] {
  assertCollectionBound(values, "proposal.artifacts");
  const artifacts = values.map((value, index): SpecialistArtifactReference => {
    const item = requireRecord(value, `proposal.artifacts[${index}]`);
    assertExactKeys(item, ARTIFACT_KEYS, `proposal.artifacts[${index}]`);
    const id = requireString(item, "id");
    const type = requireString(item, "type");
    const reference = requireString(item, "reference");
    const contentHash = requireString(item, "contentHash");
    assertIdentifier(id, "artifact.id");
    assertToken(type, "artifact.type");
    assertText(reference, "artifact.reference", MAX_REFERENCE_LENGTH);
    assertSha256(contentHash, "artifact.contentHash");
    return { contentHash, id, reference, type };
  });
  assertUniqueIds(artifacts, "artifacts");
  return artifacts.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeFilesChanged(
  values: readonly unknown[],
  assignment: SpecialistAssignment,
): readonly string[] {
  assertCollectionBound(values, "proposal.filesChanged");
  const files = values.map((value) => {
    if (typeof value !== "string") throw new TypeError("filesChanged entries must be strings.");
    const normalized = normalizeRepositoryPath(value, "filesChanged");
    if (!pathIsOwnedForWrite(normalized, assignment.lease.claims)) {
      throw new TypeError("A changed file falls outside reserved write ownership.");
    }
    return normalized;
  });
  assertUniqueStrings(files, "filesChanged");
  return files.sort();
}

function normalizeTextList(values: readonly unknown[], name: string): readonly string[] {
  assertCollectionBound(values, `proposal.${name}`);
  const normalized = values.map((value) => {
    if (typeof value !== "string") throw new TypeError(`${name} entries must be strings.`);
    assertText(value, `proposal.${name}`, MAX_REFERENCE_LENGTH);
    return value;
  });
  assertUniqueStrings(normalized, name);
  return normalized.sort();
}

function createReconciliation(
  assignment: SpecialistAssignment,
  outcome: ReconciliationOutcome,
  reasons: readonly ReconciliationReason[],
  attestedEvidenceIds: readonly string[],
  result?: SpecialistResult,
): TaskReconciliation {
  const base = {
    assignmentId: assignment.id,
    attestedEvidenceIds: [...attestedEvidenceIds],
    missionId: assignment.missionId,
    outcome,
    reasons: [...reasons],
    specialistId: assignment.lease.specialistId,
    taskId: assignment.taskId,
    ...(result === undefined ? {} : { result }),
  };
  return { ...base, reconciliationHash: stableHash(base) };
}

function safelyAttested(
  authority: SpecialistEvidenceAuthority,
  assignment: SpecialistAssignment,
  evidence: SpecialistEvidenceReference,
): boolean {
  try {
    return authority.attests(structuredClone(assignment), structuredClone(evidence)) === true;
  } catch {
    return false;
  }
}

function assertCollectionBound(values: readonly unknown[], name: string): void {
  if (values.length > MAX_COLLECTION_ITEMS) {
    throw new TypeError(`${name} is limited to ${MAX_COLLECTION_ITEMS} entries.`);
  }
}

function assertUniqueIds(values: readonly { readonly id: string }[], name: string): void {
  assertUniqueStrings(
    values.map((value) => value.id),
    `${name} ids`,
  );
}

function assertUniqueStrings(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${name} must not contain duplicates.`);
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new TypeError(`${key} must be a string.`);
  return value;
}

function requireArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new TypeError(`${key} must be an array.`);
  return value;
}

function assertExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} contains missing or unsupported fields.`);
  }
}
