import {
  FINDING_CODES,
  finding,
  isBoundedText,
  isEvidenceKind,
  isEvidenceStatus,
  isProducerClass,
  isRecord,
  isSha256,
  MAX_REPAIR_CLAIMS,
  MAX_REPAIR_REASONS,
  parseCanonicalTimestamp,
  sortFindings,
  stableHash,
} from "./internal.js";
import { BuiltInAdversarialReviewer } from "./review.js";
import type {
  AdversarialReviewer,
  AdversarialReviewResult,
  RepairRequest,
  VerificationBinding,
  VerificationClaim,
  VerificationEvidence,
  VerificationFinding,
  VerificationGateResult,
  VerificationRequest,
  VerificationResult,
} from "./types.js";

const MAX_ITEMS = 256;
const MAX_EVIDENCE_PER_BINDING = 32;

export interface VerificationEngineOptions {
  readonly maxEvidenceAgeMs: number;
  readonly reviewer?: AdversarialReviewer;
}

export class IndependentVerificationEngine {
  readonly #maxEvidenceAgeMs: number;
  readonly #reviewer: AdversarialReviewer;

  constructor(options: VerificationEngineOptions) {
    if (!Number.isSafeInteger(options.maxEvidenceAgeMs) || options.maxEvidenceAgeMs < 0) {
      throw new TypeError("maxEvidenceAgeMs must be a non-negative safe integer.");
    }
    this.#maxEvidenceAgeMs = options.maxEvidenceAgeMs;
    this.#reviewer =
      options.reviewer ??
      new BuiltInAdversarialReviewer({ maxEvidenceAgeMs: options.maxEvidenceAgeMs });
  }

  verify(request: VerificationRequest): VerificationGateResult {
    assertRequestCollections(request);
    const verification = this.#verifyClaims(request);
    let review: AdversarialReviewResult;
    try {
      review = normalizeReview(request, verification, this.#reviewer.review(request, verification));
    } catch {
      review = invalidReview(request.missionId, verification.resultHash);
    }
    const outcome =
      verification.verdict === "FAIL" || review.verdict === "BLOCK"
        ? "BLOCK"
        : review.verdict === "REPAIR_REQUIRED"
          ? "REPAIR_REQUIRED"
          : "PASS";
    const unsigned = { outcome, review, verification } as const;
    return { ...unsigned, resultHash: stableHash(unsigned) };
  }

  #verifyClaims(request: VerificationRequest): VerificationResult {
    const findings: VerificationFinding[] = [];
    const evaluatedAt = parseCanonicalTimestamp(request.evaluatedAt);
    if (!isBoundedText(request.missionId, 128) || evaluatedAt === null) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          undefined,
          [],
          "Verification request mission or canonical evaluation timestamp is invalid.",
        ),
      );
    }
    if (request.claims.length === 0) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          undefined,
          [],
          "Verification requires at least one definition-of-done claim.",
        ),
      );
    }

    const claims = indexUnique(request.claims, (claim) => safeString(claim.id));
    for (const duplicateId of claims.duplicates) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          duplicateId || undefined,
          [],
          "Verification claim IDs must be unique.",
        ),
      );
    }

    const evidence = indexUnique(request.evidence, (item) => safeString(item.id));
    for (const duplicateId of evidence.duplicates) {
      findings.push(
        finding(
          "evidence_duplicate",
          "BLOCKING",
          undefined,
          duplicateId === "" ? [] : [duplicateId],
          "Verification evidence IDs must be unique.",
        ),
      );
    }

    const conflicts = contradictoryEvidence(request.evidence);
    findings.push(...conflicts.findings);
    const evidenceValidity = new Map<string, boolean>();
    for (const item of request.evidence) {
      const id = safeString(item.id);
      const valid = this.#validateEvidenceEnvelope(request, item, evaluatedAt, findings);
      evidenceValidity.set(
        id,
        valid && !evidence.duplicates.has(id) && !conflicts.evidenceIds.has(id),
      );
    }

    const bindings = indexBindings(request.bindings, findings);
    const satisfiedClaimIds = new Set<string>();

    for (const claim of request.claims) {
      const claimId = safeString(claim.id);
      let satisfied =
        this.#validateClaim(request, claim, evaluatedAt, findings) &&
        !claims.duplicates.has(claimId) &&
        !bindings.invalidClaimIds.has(claimId);
      const binding = bindings.values.get(claimId);
      if (binding === undefined || binding.evidenceIds.length === 0) {
        findings.push(
          finding(
            "claim_missing_evidence",
            "BLOCKING",
            claimId || undefined,
            [],
            "Required claim has no valid bound evidence.",
          ),
        );
        continue;
      }

      const seenKinds = new Set<string>();
      for (const evidenceId of binding.evidenceIds) {
        const item = evidence.values.get(evidenceId);
        if (item === undefined) {
          findings.push(
            finding(
              "evidence_missing",
              "BLOCKING",
              claimId || undefined,
              [evidenceId],
              "Binding references evidence that does not exist or is duplicated.",
            ),
          );
          satisfied = false;
          continue;
        }
        const accepted =
          evidenceValidity.get(evidenceId) === true &&
          this.#validateEvidenceForClaim(claim, item, findings);
        if (accepted) seenKinds.add(item.kind);
        else satisfied = false;
      }

      for (const requiredKind of claim.requiredEvidenceKinds) {
        if (!seenKinds.has(requiredKind)) {
          findings.push(
            finding(
              "evidence_kind_mismatch",
              "BLOCKING",
              claimId || undefined,
              binding.evidenceIds,
              `Claim is missing required evidence kind ${String(requiredKind)}.`,
            ),
          );
          satisfied = false;
        }
      }

      if (satisfied) satisfiedClaimIds.add(claimId);
    }

    for (const binding of request.bindings) {
      const claimId = safeString(binding.claimId);
      if (!claims.values.has(claimId)) {
        findings.push(
          finding(
            "claim_invalid",
            "BLOCKING",
            claimId || undefined,
            safeStringArray(binding.evidenceIds),
            "Evidence binding references an unknown or duplicated claim.",
          ),
        );
      }
    }

    const sorted = sortFindings(findings);
    const verdict = sorted.some((item) => item.severity === "BLOCKING") ? "FAIL" : "PASS";
    const unsigned = {
      evaluatedAt: request.evaluatedAt,
      findings: sorted,
      missionId: request.missionId,
      satisfiedClaimIds: [...satisfiedClaimIds].sort(),
      verdict,
    } as const;
    return { ...unsigned, resultHash: stableHash(unsigned) };
  }

  #validateClaim(
    request: VerificationRequest,
    claim: VerificationClaim,
    evaluatedAt: number | null,
    findings: VerificationFinding[],
  ): boolean {
    let valid = true;
    const requiredAfter = parseCanonicalTimestamp(claim.requiredAfter);
    if (
      !isBoundedText(claim.id, 128) ||
      !isBoundedText(claim.taskId, 128) ||
      !isBoundedText(claim.definitionOfDone, 1_000) ||
      claim.requiredEvidenceKinds.length === 0 ||
      claim.requiredEvidenceKinds.length > 5 ||
      claim.requiredEvidenceKinds.some((kind) => !isEvidenceKind(kind)) ||
      new Set(claim.requiredEvidenceKinds).size !== claim.requiredEvidenceKinds.length ||
      requiredAfter === null
    ) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          safeString(claim.id) || undefined,
          [],
          "Verification claim metadata or required evidence kinds are malformed.",
        ),
      );
      valid = false;
    }
    if (claim.missionId !== request.missionId) {
      findings.push(
        finding(
          "claim_foreign_scope",
          "BLOCKING",
          safeString(claim.id) || undefined,
          [],
          "Verification claim belongs to another mission.",
        ),
      );
      valid = false;
    }
    if (evaluatedAt !== null && requiredAfter !== null && requiredAfter > evaluatedAt) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          safeString(claim.id) || undefined,
          [],
          "Claim required-after timestamp is later than verification time.",
        ),
      );
      valid = false;
    }
    return valid;
  }

  #validateEvidenceEnvelope(
    request: VerificationRequest,
    evidence: VerificationEvidence,
    evaluatedAt: number | null,
    findings: VerificationFinding[],
  ): boolean {
    let valid = true;
    const evidenceId = safeString(evidence.id);
    const observedAt = parseCanonicalTimestamp(evidence.observedAt);
    if (
      !isBoundedText(evidence.id, 128) ||
      !isBoundedText(evidence.taskId, 128) ||
      !isBoundedText(evidence.subject, 500) ||
      !isRecord(evidence.producer) ||
      !isBoundedText(evidence.producer.id, 128) ||
      !isProducerClass(evidence.producer.class) ||
      !isEvidenceKind(evidence.kind) ||
      !isEvidenceStatus(evidence.status) ||
      !isSha256(evidence.contentHash) ||
      observedAt === null
    ) {
      findings.push(
        finding(
          "evidence_invalid",
          "BLOCKING",
          undefined,
          evidenceId === "" ? [] : [evidenceId],
          "Evidence metadata, kind, provenance, hash, status, or timestamp is malformed.",
        ),
      );
      valid = false;
    }
    if (evidence.missionId !== request.missionId) {
      findings.push(
        finding(
          "evidence_foreign_scope",
          "BLOCKING",
          undefined,
          evidenceId === "" ? [] : [evidenceId],
          "Evidence belongs to another mission.",
        ),
      );
      valid = false;
    }
    if (isEvidenceStatus(evidence.status) && evidence.status !== "PASS") {
      findings.push(
        finding(
          "evidence_failed",
          "BLOCKING",
          undefined,
          evidenceId === "" ? [] : [evidenceId],
          "Supplied evidence reports a failing status.",
        ),
      );
      valid = false;
    }
    if (observedAt !== null && evaluatedAt !== null && observedAt > evaluatedAt) {
      findings.push(
        finding(
          "evidence_future",
          "BLOCKING",
          undefined,
          evidenceId === "" ? [] : [evidenceId],
          "Evidence observation timestamp is in the future.",
        ),
      );
      valid = false;
    }
    if (
      observedAt !== null &&
      evaluatedAt !== null &&
      evaluatedAt >= observedAt &&
      evaluatedAt - observedAt > this.#maxEvidenceAgeMs
    ) {
      findings.push(
        finding(
          "evidence_stale",
          "BLOCKING",
          undefined,
          evidenceId === "" ? [] : [evidenceId],
          "Evidence exceeds the configured freshness bound.",
        ),
      );
      valid = false;
    }
    return valid;
  }

  #validateEvidenceForClaim(
    claim: VerificationClaim,
    evidence: VerificationEvidence,
    findings: VerificationFinding[],
  ): boolean {
    let accepted = true;
    const claimId = safeString(claim.id) || undefined;
    const evidenceId = safeString(evidence.id);
    const observedAt = parseCanonicalTimestamp(evidence.observedAt);
    const requiredAfter = parseCanonicalTimestamp(claim.requiredAfter);
    if (evidence.taskId !== claim.taskId || evidence.missionId !== claim.missionId) {
      findings.push(
        finding(
          "evidence_foreign_scope",
          "BLOCKING",
          claimId,
          [evidenceId],
          "Evidence mission/task scope does not match the bound claim.",
        ),
      );
      accepted = false;
    }
    if (!isEvidenceKind(evidence.kind) || !claim.requiredEvidenceKinds.includes(evidence.kind)) {
      findings.push(
        finding(
          "evidence_kind_mismatch",
          "BLOCKING",
          claimId,
          [evidenceId],
          "Evidence kind is not accepted by the bound claim.",
        ),
      );
      accepted = false;
    }
    if (observedAt !== null && requiredAfter !== null && observedAt < requiredAfter) {
      findings.push(
        finding(
          "evidence_too_early",
          "BLOCKING",
          claimId,
          [evidenceId],
          "Evidence predates the claim's required-after boundary.",
        ),
      );
      accepted = false;
    }
    return accepted;
  }
}

function assertRequestCollections(request: VerificationRequest): void {
  if (!isRecord(request)) throw new TypeError("Verification request must be an object.");
  if (typeof request.missionId !== "string" || typeof request.evaluatedAt !== "string") {
    throw new TypeError("Verification request mission and evaluation time must be strings.");
  }
  const collections = [request.claims, request.evidence, request.bindings];
  if (collections.some((value) => !Array.isArray(value) || value.length > MAX_ITEMS)) {
    throw new TypeError(`Verification collections must be arrays of at most ${MAX_ITEMS} items.`);
  }
  if (
    request.claims.some(
      (claim) => !isRecord(claim) || !Array.isArray(claim.requiredEvidenceKinds),
    ) ||
    request.evidence.some((evidence) => !isRecord(evidence) || !isRecord(evidence.producer)) ||
    request.bindings.some(
      (binding) =>
        !isRecord(binding) ||
        !Array.isArray(binding.evidenceIds) ||
        binding.evidenceIds.length > MAX_EVIDENCE_PER_BINDING,
    )
  ) {
    throw new TypeError("Verification claim, evidence, or binding structure is malformed.");
  }
}

function indexBindings(
  bindings: readonly VerificationBinding[],
  findings: VerificationFinding[],
): {
  readonly invalidClaimIds: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, VerificationBinding>;
} {
  const values = new Map<string, VerificationBinding>();
  const invalidClaimIds = new Set<string>();
  for (const binding of bindings) {
    const claimId = safeString(binding.claimId);
    const evidenceIds = safeStringArray(binding.evidenceIds);
    const malformed =
      !isBoundedText(binding.claimId, 128) ||
      evidenceIds.length !== binding.evidenceIds.length ||
      evidenceIds.length === 0 ||
      evidenceIds.some((id) => !isBoundedText(id, 128)) ||
      new Set(evidenceIds).size !== evidenceIds.length;
    if (values.has(claimId) || invalidClaimIds.has(claimId)) {
      invalidClaimIds.add(claimId);
      values.delete(claimId);
      findings.push(
        finding(
          "claim_duplicate_binding",
          "BLOCKING",
          claimId || undefined,
          evidenceIds,
          "Claim has more than one binding record.",
        ),
      );
      continue;
    }
    if (malformed) {
      invalidClaimIds.add(claimId);
      findings.push(
        finding(
          "claim_duplicate_binding",
          "BLOCKING",
          claimId || undefined,
          evidenceIds,
          "Claim binding is empty, malformed, or contains duplicate evidence IDs.",
        ),
      );
      continue;
    }
    values.set(claimId, { claimId, evidenceIds: [...evidenceIds].sort() });
  }
  return { invalidClaimIds, values };
}

function contradictoryEvidence(evidence: readonly VerificationEvidence[]): {
  readonly evidenceIds: ReadonlySet<string>;
  readonly findings: readonly VerificationFinding[];
} {
  const grouped = new Map<string, VerificationEvidence[]>();
  for (const item of evidence) {
    if (
      !isBoundedText(item.missionId, 128) ||
      !isBoundedText(item.taskId, 128) ||
      !isEvidenceKind(item.kind) ||
      !isBoundedText(item.subject, 500) ||
      !isEvidenceStatus(item.status)
    ) {
      continue;
    }
    const key = `${item.missionId}\u0000${item.taskId}\u0000${item.kind}\u0000${item.subject}`;
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  const findings: VerificationFinding[] = [];
  const evidenceIds = new Set<string>();
  for (const group of grouped.values()) {
    if (new Set(group.map((item) => item.status)).size > 1) {
      const ids = group
        .map((item) => safeString(item.id))
        .filter(Boolean)
        .sort();
      for (const id of ids) evidenceIds.add(id);
      findings.push(
        finding(
          "evidence_conflict",
          "BLOCKING",
          undefined,
          ids,
          "Conflicting pass and fail evidence exists for the same scoped subject.",
        ),
      );
    }
  }
  return { evidenceIds, findings };
}

function indexUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
): { readonly duplicates: ReadonlySet<string>; readonly values: ReadonlyMap<string, T> } {
  const result = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const id = key(value);
    if (result.has(id) || duplicates.has(id)) {
      result.delete(id);
      duplicates.add(id);
    } else {
      result.set(id, value);
    }
  }
  return { duplicates, values: result };
}

function normalizeReview(
  request: VerificationRequest,
  verification: VerificationResult,
  review: AdversarialReviewResult,
): AdversarialReviewResult {
  if (!isRecord(review) || review.missionId !== request.missionId) {
    throw new TypeError("Reviewer mission scope is invalid.");
  }
  if (!Array.isArray(review.findings) || review.findings.length > MAX_ITEMS) {
    throw new TypeError("Reviewer findings are invalid.");
  }
  if (!review.findings.every(isValidFinding)) {
    throw new TypeError("Reviewer finding contract is invalid.");
  }
  if (!(["ACCEPT", "BLOCK", "REPAIR_REQUIRED"] as const).includes(review.verdict)) {
    throw new TypeError("Reviewer verdict is invalid.");
  }
  if (review.verificationResultHash !== verification.resultHash) {
    throw new TypeError("Reviewer result is not bound to the current verification result.");
  }
  const findings = sortFindings(review.findings);
  const hasBlocking = findings.some((item) => item.severity === "BLOCKING");
  const hasWarning = findings.some((item) => item.severity === "WARNING");
  const repairRequest = normalizeRepairRequest(request, review.repairRequest);
  if (
    (review.verdict === "ACCEPT" && (findings.length > 0 || repairRequest !== undefined)) ||
    (review.verdict === "REPAIR_REQUIRED" &&
      (!hasWarning || hasBlocking || repairRequest === undefined)) ||
    (review.verdict === "BLOCK" && repairRequest !== undefined)
  ) {
    throw new TypeError("Reviewer verdict and findings are inconsistent.");
  }
  const unsigned = {
    findings,
    missionId: request.missionId,
    ...(repairRequest === undefined ? {} : { repairRequest }),
    verificationResultHash: verification.resultHash,
    verdict: review.verdict,
  } as const;
  if (!isSha256(review.resultHash) || review.resultHash !== stableHash(unsigned)) {
    throw new TypeError("Reviewer result hash is invalid.");
  }
  return { ...unsigned, resultHash: review.resultHash };
}

function normalizeRepairRequest(
  request: VerificationRequest,
  repair: RepairRequest | undefined,
): RepairRequest | undefined {
  if (repair === undefined) return undefined;
  if (
    !isRecord(repair) ||
    !Array.isArray(repair.claimIds) ||
    repair.claimIds.length === 0 ||
    repair.claimIds.length > MAX_REPAIR_CLAIMS ||
    !Array.isArray(repair.reasonCodes) ||
    repair.reasonCodes.length === 0 ||
    repair.reasonCodes.length > MAX_REPAIR_REASONS ||
    !isBoundedText(repair.instruction, 500)
  ) {
    throw new TypeError("Reviewer repair request is malformed or unbounded.");
  }
  const knownClaimIds = new Set(request.claims.map((claim) => claim.id));
  if (
    repair.claimIds.some((id) => !isBoundedText(id, 128) || !knownClaimIds.has(id)) ||
    new Set(repair.claimIds).size !== repair.claimIds.length ||
    repair.reasonCodes.some((code) => !FINDING_CODES.has(code)) ||
    new Set(repair.reasonCodes).size !== repair.reasonCodes.length
  ) {
    throw new TypeError("Reviewer repair request references invalid claims or reasons.");
  }
  return {
    claimIds: [...repair.claimIds].sort(),
    instruction: repair.instruction,
    reasonCodes: [...repair.reasonCodes].sort(),
  };
}

function isValidFinding(value: unknown): value is VerificationFinding {
  if (!isRecord(value)) return false;
  if (
    !FINDING_CODES.has(value.code as VerificationFinding["code"]) ||
    (value.severity !== "BLOCKING" && value.severity !== "WARNING") ||
    !Array.isArray(value.evidenceIds) ||
    value.evidenceIds.length > MAX_EVIDENCE_PER_BINDING ||
    value.evidenceIds.some((id) => !isBoundedText(id, 128)) ||
    !isBoundedText(value.reason, 500)
  ) {
    return false;
  }
  return value.claimId === undefined || isBoundedText(value.claimId, 128);
}

function invalidReview(missionId: string, verificationResultHash: string): AdversarialReviewResult {
  const findings = [
    finding(
      "review_invalid",
      "BLOCKING",
      undefined,
      [],
      "Adversarial reviewer failed or returned an invalid result contract.",
    ),
  ];
  const unsigned = { findings, missionId, verificationResultHash, verdict: "BLOCK" } as const;
  return { ...unsigned, resultHash: stableHash(unsigned) };
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeStringArray(value: readonly string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
