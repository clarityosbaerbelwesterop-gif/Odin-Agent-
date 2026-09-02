import { createHash } from "node:crypto";
import type {
  AdversarialReviewResult,
  AdversarialReviewer,
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
    const evaluatedAt = Date.parse(request.evaluatedAt);
    const claimById = new Map(request.claims.map((claim) => [claim.id, claim]));
    const evidenceById = new Map(request.evidence.map((evidence) => [evidence.id, evidence]));

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
      if (uniqueClaims.length > 1) {
        const definitions = new Set(
          uniqueClaims.map((claimId) => claimById.get(claimId)?.definitionOfDone ?? claimId),
        );
        if (definitions.size > 1) {
          findings.push(
            finding(
              "evidence_reused",
              "WARNING",
              uniqueClaims[0],
              [evidenceId],
              "One evidence item is reused across unrelated claims.",
            ),
          );
        }
      }
    }

    const grouped = new Map<string, typeof request.evidence>();
    for (const evidence of request.evidence) {
      const key = `${evidence.taskId}\u0000${evidence.kind}\u0000${evidence.subject}`;
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
            "Contradictory pass and fail evidence exists for the same subject.",
          ),
        );
      }
    }

    for (const evidence of request.evidence) {
      const boundClaims = claimsByEvidence.get(evidence.id) ?? [];
      const primaryClaim = [...new Set(boundClaims)].sort()[0];
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
      }

      const observedAt = Date.parse(evidence.observedAt);
      if (
        Number.isFinite(evaluatedAt) &&
        Number.isFinite(observedAt) &&
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
        const requiredAfter = Date.parse(claim.requiredAfter);
        if (
          Number.isFinite(requiredAfter) &&
          Number.isFinite(observedAt) &&
          observedAt < requiredAfter
        ) {
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
    const verdict = result.verdict === "FAIL" || blocking ? "BLOCK" : repairable ? "REPAIR_REQUIRED" : "ACCEPT";
    const repairRequest = verdict === "REPAIR_REQUIRED" ? buildRepairRequest(sorted) : undefined;
    const unsigned = {
      findings: sorted,
      missionId: request.missionId,
      ...(repairRequest === undefined ? {} : { repairRequest }),
      verdict,
    } as const;
    return { ...unsigned, resultHash: stableHash(unsigned) };
  }
}

function buildRepairRequest(findings: readonly VerificationFinding[]): RepairRequest {
  const claimIds = [
    ...new Set(findings.map((item) => item.claimId).filter((value): value is string => value !== undefined)),
  ].sort();
  const reasonCodes = [...new Set(findings.map((item) => item.code))].sort() as VerificationFindingCode[];
  return {
    claimIds,
    instruction: "Collect fresh independent evidence for the referenced claims before retrying verification.",
    reasonCodes,
  };
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
