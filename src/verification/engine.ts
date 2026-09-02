import { createHash } from "node:crypto";
import { BuiltInAdversarialReviewer } from "./review.js";
import type {
  AdversarialReviewer,
  VerificationBinding,
  VerificationClaim,
  VerificationEvidence,
  VerificationFinding,
  VerificationFindingCode,
  VerificationGateResult,
  VerificationRequest,
  VerificationResult,
} from "./types.js";

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
    const verification = this.#verifyClaims(request);
    const review = this.#reviewer.review(request, verification);
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
    const evaluatedAt = parseTimestamp(request.evaluatedAt);
    if (request.missionId.trim() === "" || evaluatedAt === null) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          undefined,
          [],
          "Verification request mission or evaluation timestamp is invalid.",
        ),
      );
    }

    const claims = indexUnique(request.claims, (claim) => claim.id, () =>
      finding(
        "claim_invalid",
        "BLOCKING",
        undefined,
        [],
        "Verification claim IDs must be unique.",
      ),
    );
    if (claims.duplicate !== undefined) findings.push(claims.duplicate);

    const evidence = indexUnique(request.evidence, (item) => item.id, () =>
      finding(
        "evidence_duplicate",
        "BLOCKING",
        undefined,
        [],
        "Verification evidence IDs must be unique.",
      ),
    );
    if (evidence.duplicate !== undefined) findings.push(evidence.duplicate);

    const bindings = indexBindings(request.bindings, findings);
    const satisfiedClaimIds: string[] = [];

    for (const claim of request.claims) {
      const claimFindingsBefore = findings.length;
      this.#validateClaim(request, claim, evaluatedAt, findings);
      const binding = bindings.get(claim.id);
      if (binding === undefined || binding.evidenceIds.length === 0) {
        findings.push(
          finding(
            "claim_missing_evidence",
            "BLOCKING",
            claim.id,
            [],
            "Required claim has no bound evidence.",
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
              claim.id,
              [evidenceId],
              "Binding references evidence that does not exist.",
            ),
          );
          continue;
        }
        const accepted = this.#validateEvidenceForClaim(
          request,
          claim,
          item,
          evaluatedAt,
          findings,
        );
        if (accepted) seenKinds.add(item.kind);
      }

      for (const requiredKind of claim.requiredEvidenceKinds) {
        if (!seenKinds.has(requiredKind)) {
          findings.push(
            finding(
              "evidence_kind_mismatch",
              "BLOCKING",
              claim.id,
              binding.evidenceIds,
              `Claim is missing required evidence kind ${requiredKind}.`,
            ),
          );
        }
      }

      if (findings.length === claimFindingsBefore) satisfiedClaimIds.push(claim.id);
    }

    for (const binding of request.bindings) {
      if (!claims.values.has(binding.claimId)) {
        findings.push(
          finding(
            "claim_invalid",
            "BLOCKING",
            binding.claimId,
            binding.evidenceIds,
            "Evidence binding references an unknown claim.",
          ),
        );
      }
    }

    const conflicts = contradictoryEvidence(request.evidence);
    findings.push(...conflicts);

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
  ): void {
    if (
      claim.id.trim() === "" ||
      claim.taskId.trim() === "" ||
      claim.definitionOfDone.trim() === "" ||
      claim.requiredEvidenceKinds.length === 0 ||
      new Set(claim.requiredEvidenceKinds).size !== claim.requiredEvidenceKinds.length ||
      parseTimestamp(claim.requiredAfter) === null
    ) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          claim.id,
          [],
          "Verification claim metadata is malformed.",
        ),
      );
    }
    if (claim.missionId !== request.missionId) {
      findings.push(
        finding(
          "claim_foreign_scope",
          "BLOCKING",
          claim.id,
          [],
          "Verification claim belongs to another mission.",
        ),
      );
    }
    const requiredAfter = parseTimestamp(claim.requiredAfter);
    if (evaluatedAt !== null && requiredAfter !== null && requiredAfter > evaluatedAt) {
      findings.push(
        finding(
          "claim_invalid",
          "BLOCKING",
          claim.id,
          [],
          "Claim required-after timestamp is later than verification time.",
        ),
      );
    }
  }

  #validateEvidenceForClaim(
    request: VerificationRequest,
    claim: VerificationClaim,
    evidence: VerificationEvidence,
    evaluatedAt: number | null,
    findings: VerificationFinding[],
  ): boolean {
    let accepted = true;
    const observedAt = parseTimestamp(evidence.observedAt);
    const requiredAfter = parseTimestamp(claim.requiredAfter);
    if (
      evidence.id.trim() === "" ||
      evidence.taskId.trim() === "" ||
      evidence.subject.trim() === "" ||
      evidence.producer.id.trim() === "" ||
      !/^[a-f0-9]{64}$/u.test(evidence.contentHash) ||
      observedAt === null
    ) {
      findings.push(
        finding(
          "evidence_invalid",
          "BLOCKING",
          claim.id,
          [evidence.id],
          "Evidence metadata, hash, or timestamp is malformed.",
        ),
      );
      accepted = false;
    }
    if (evidence.missionId !== request.missionId || evidence.taskId !== claim.taskId) {
      findings.push(
        finding(
          "evidence_foreign_scope",
          "BLOCKING",
          claim.id,
          [evidence.id],
          "Evidence mission/task scope does not match the bound claim.",
        ),
      );
      accepted = false;
    }
    if (!claim.requiredEvidenceKinds.includes(evidence.kind)) {
      findings.push(
        finding(
          "evidence_kind_mismatch",
          "BLOCKING",
          claim.id,
          [evidence.id],
          "Evidence kind is not accepted by the bound claim.",
        ),
      );
      accepted = false;
    }
    if (evidence.status !== "PASS") {
      findings.push(
        finding(
          "evidence_failed",
          "BLOCKING",
          claim.id,
          [evidence.id],
          "Bound evidence reports a failing status.",
        ),
      );
      accepted = false;
    }
    if (observedAt !== null && requiredAfter !== null && observedAt < requiredAfter) {
      findings.push(
        finding(
          "evidence_too_early",
          "BLOCKING",
          claim.id,
          [evidence.id],
          "Evidence predates the claim's required-after boundary.",
        ),
      );
      accepted = false;
    }
    if (observedAt !== null && evaluatedAt !== null && observedAt > evaluatedAt) {
      findings.push(
        finding(
          "evidence_future",
          "BLOCKING",
          claim.id,
          [evidence.id],
          "Evidence observation timestamp is in the future.",
        ),
      );
      accepted = false;
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
          claim.id,
          [evidence.id],
          "Evidence exceeds the configured freshness bound.",
        ),
      );
      accepted = false;
    }
    return accepted;
  }
}

function indexBindings(
  bindings: readonly VerificationBinding[],
  findings: VerificationFinding[],
): Map<string, VerificationBinding> {
  const result = new Map<string, VerificationBinding>();
  for (const binding of bindings) {
    if (result.has(binding.claimId)) {
      findings.push(
        finding(
          "claim_duplicate_binding",
          "BLOCKING",
          binding.claimId,
          binding.evidenceIds,
          "Claim has more than one binding record.",
        ),
      );
      continue;
    }
    if (
      binding.claimId.trim() === "" ||
      binding.evidenceIds.length === 0 ||
      binding.evidenceIds.some((id) => id.trim() === "") ||
      new Set(binding.evidenceIds).size !== binding.evidenceIds.length
    ) {
      findings.push(
        finding(
          "claim_duplicate_binding",
          "BLOCKING",
          binding.claimId,
          binding.evidenceIds,
          "Claim binding is empty, malformed, or contains duplicate evidence IDs.",
        ),
      );
    }
    result.set(binding.claimId, {
      claimId: binding.claimId,
      evidenceIds: [...binding.evidenceIds].sort(),
    });
  }
  return result;
}

function contradictoryEvidence(
  evidence: readonly VerificationEvidence[],
): VerificationFinding[] {
  const grouped = new Map<string, VerificationEvidence[]>();
  for (const item of evidence) {
    const key = `${item.missionId}\u0000${item.taskId}\u0000${item.kind}\u0000${item.subject}`;
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  const findings: VerificationFinding[] = [];
  for (const group of grouped.values()) {
    if (new Set(group.map((item) => item.status)).size > 1) {
      findings.push(
        finding(
          "evidence_conflict",
          "BLOCKING",
          undefined,
          group.map((item) => item.id).sort(),
          "Conflicting pass and fail evidence exists for the same scoped subject.",
        ),
      );
    }
  }
  return findings;
}

function indexUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  duplicateFinding: () => VerificationFinding,
): { readonly values: Map<string, T>; readonly duplicate?: VerificationFinding } {
  const result = new Map<string, T>();
  let duplicate: VerificationFinding | undefined;
  for (const value of values) {
    const id = key(value);
    if (result.has(id)) duplicate ??= duplicateFinding();
    else result.set(id, value);
  }
  return { values: result, ...(duplicate === undefined ? {} : { duplicate }) };
}

function parseTimestamp(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function finding(
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

function sortFindings(findings: readonly VerificationFinding[]): VerificationFinding[] {
  return [...findings].sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.claimId ?? "").localeCompare(right.claimId ?? "") ||
      left.evidenceIds.join("\u0000").localeCompare(right.evidenceIds.join("\u0000")),
  );
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalize(object[key])]),
  );
}
