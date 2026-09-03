import {
  finding,
  MAX_REPAIR_CLAIMS,
  MAX_REPAIR_REASONS,
  parseCanonicalTimestamp,
  sortFindings,
  stableHash,
} from "./internal.js";
import type {
  AdversarialReviewer,
  AdversarialReviewResult,
  RepairRequest,
  VerificationFinding,
  VerificationFindingCode,
  VerificationRequest,
  VerificationResult,
} from "./types.js";

export interface AdversarialReviewOptions {
  readonly maxEvidenceAgeMs: number;
}

export class BuiltInAdversarialReviewer implements AdversarialReviewer {
  readonly #maxEvidenceAgeMs: number;

  constructor(options: AdversarialReviewOptions) {
    if (!Number.isSafeInteger(options.maxEvidenceAgeMs) || options.maxEvidenceAgeMs < 0) {
      throw new TypeError("maxEvidenceAgeMs must be a non-negative safe integer.");
    }
    this.#maxEvidenceAgeMs = options.maxEvidenceAgeMs;
  }

  review(request: VerificationRequest, result: VerificationResult): AdversarialReviewResult {
    const findings: VerificationFinding[] = [];
    const evaluatedAt = parseCanonicalTimestamp(request.evaluatedAt);
    const claimById = new Map(request.claims.map((claim) => [claim.id, claim]));
    const claimsByEvidence = new Map<string, string[]>();

    for (const binding of request.bindings) {
      for (const evidenceId of binding.evidenceIds) {
        const claims = claimsByEvidence.get(evidenceId) ?? [];
        claims.push(binding.claimId);
        claimsByEvidence.set(evidenceId, claims);
      }
    }

    for (const [evidenceId, claimIds] of claimsByEvidence) {
      const uniqueClaims = [...new Set(claimIds)].sort();
      const taskIds = new Set(
        uniqueClaims.map((claimId) => claimById.get(claimId)?.taskId).filter(Boolean),
      );
      if (taskIds.size > 1) {
        for (const claimId of uniqueClaims) {
          findings.push(
            finding(
              "evidence_reused",
              "WARNING",
              claimId,
              [evidenceId],
              "One evidence item is reused across claims owned by different tasks.",
            ),
          );
        }
      }
    }

    const grouped = new Map<string, typeof request.evidence>();
    for (const evidence of request.evidence) {
      const key = `${evidence.missionId}\u0000${evidence.taskId}\u0000${evidence.kind}\u0000${evidence.subject}`;
      const group = grouped.get(key) ?? [];
      grouped.set(key, [...group, evidence]);
    }
    for (const group of grouped.values()) {
      const statuses = new Set(group.map((evidence) => evidence.status));
      if (statuses.size > 1) {
        findings.push(
          finding(
            "evidence_conflict",
            "BLOCKING",
            undefined,
            group.map((evidence) => evidence.id).sort(),
            "Contradictory pass and fail evidence exists for the same scoped subject.",
          ),
        );
      }
    }

    for (const evidence of request.evidence) {
      const boundClaims = [...new Set(claimsByEvidence.get(evidence.id) ?? [])].sort();
      const primaryClaim = boundClaims[0];
      if (evidence.producer.class === "planner" || evidence.producer.class === "runtime") {
        findings.push(
          finding(
            "evidence_self_authored",
            "WARNING",
            primaryClaim,
            [evidence.id],
            "Evidence is self-authored by planning/runtime code rather than an independent source.",
          ),
        );
      } else if (evidence.producer.class === "external") {
        findings.push(
          finding(
            "evidence_weak_provenance",
            "WARNING",
            primaryClaim,
            [evidence.id],
            "External evidence lacks an independent deterministic tool attestation.",
          ),
        );
      }

      const observedAt = parseCanonicalTimestamp(evidence.observedAt);
      if (
        evaluatedAt !== null &&
        observedAt !== null &&
        evaluatedAt - observedAt > this.#maxEvidenceAgeMs
      ) {
        findings.push(
          finding(
            "evidence_stale",
            "WARNING",
            primaryClaim,
            [evidence.id],
            "Evidence is older than the configured adversarial freshness bound.",
          ),
        );
      }

      for (const claimId of boundClaims) {
        const claim = claimById.get(claimId);
        if (claim === undefined) continue;
        const requiredAfter = parseCanonicalTimestamp(claim.requiredAfter);
        if (requiredAfter !== null && observedAt !== null && observedAt < requiredAfter) {
          findings.push(
            finding(
              "evidence_too_early",
              "WARNING",
              claimId,
              [evidence.id],
              "Evidence was observed before the claim's required-after boundary.",
            ),
          );
        }
      }
    }

    const sorted = sortFindings(findings);
    const blocking = sorted.some((item) => item.severity === "BLOCKING");
    const repairable = sorted.some((item) => item.severity === "WARNING");
    const verdict =
      result.verdict === "FAIL" || blocking ? "BLOCK" : repairable ? "REPAIR_REQUIRED" : "ACCEPT";
    const repairRequest = verdict === "REPAIR_REQUIRED" ? buildRepairRequest(sorted) : undefined;
    const unsigned = {
      findings: sorted,
      missionId: request.missionId,
      ...(repairRequest === undefined ? {} : { repairRequest }),
      verificationResultHash: result.resultHash,
      verdict,
    } as const;
    return { ...unsigned, resultHash: stableHash(unsigned) };
  }
}

function buildRepairRequest(findings: readonly VerificationFinding[]): RepairRequest {
  const claimIds = [
    ...new Set(
      findings.map((item) => item.claimId).filter((value): value is string => value !== undefined),
    ),
  ]
    .sort()
    .slice(0, MAX_REPAIR_CLAIMS);
  const reasonCodes = [...new Set(findings.map((item) => item.code))]
    .sort()
    .slice(0, MAX_REPAIR_REASONS) as VerificationFindingCode[];
  return {
    claimIds,
    instruction:
      "Collect fresh independent evidence for the referenced claims before retrying verification.",
    reasonCodes,
  };
}
