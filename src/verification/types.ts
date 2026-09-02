export type VerificationEvidenceKind =
  | "audit"
  | "changed_file"
  | "quality_gate"
  | "test"
  | "review";

export type EvidenceStatus = "FAIL" | "PASS";
export type EvidenceProducerClass = "external" | "independent_tool" | "planner" | "runtime";
export type VerificationFindingSeverity = "BLOCKING" | "WARNING";
export type VerificationVerdict = "FAIL" | "PASS";
export type ReviewVerdict = "ACCEPT" | "BLOCK" | "REPAIR_REQUIRED";

export interface VerificationClaim {
  readonly id: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly definitionOfDone: string;
  readonly requiredEvidenceKinds: readonly VerificationEvidenceKind[];
  readonly requiredAfter: string;
}

export interface VerificationEvidence {
  readonly id: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly kind: VerificationEvidenceKind;
  readonly subject: string;
  readonly producer: {
    readonly id: string;
    readonly class: EvidenceProducerClass;
  };
  readonly observedAt: string;
  readonly contentHash: string;
  readonly status: EvidenceStatus;
}

export interface VerificationBinding {
  readonly claimId: string;
  readonly evidenceIds: readonly string[];
}

export interface VerificationRequest {
  readonly missionId: string;
  readonly evaluatedAt: string;
  readonly claims: readonly VerificationClaim[];
  readonly evidence: readonly VerificationEvidence[];
  readonly bindings: readonly VerificationBinding[];
}

export type VerificationFindingCode =
  | "claim_missing_evidence"
  | "claim_duplicate_binding"
  | "claim_foreign_scope"
  | "claim_invalid"
  | "evidence_conflict"
  | "evidence_duplicate"
  | "evidence_failed"
  | "evidence_foreign_scope"
  | "evidence_future"
  | "evidence_invalid"
  | "evidence_kind_mismatch"
  | "evidence_missing"
  | "evidence_reused"
  | "evidence_self_authored"
  | "evidence_stale"
  | "evidence_too_early";

export interface VerificationFinding {
  readonly code: VerificationFindingCode;
  readonly severity: VerificationFindingSeverity;
  readonly claimId?: string;
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

export interface VerificationResult {
  readonly missionId: string;
  readonly evaluatedAt: string;
  readonly verdict: VerificationVerdict;
  readonly findings: readonly VerificationFinding[];
  readonly satisfiedClaimIds: readonly string[];
  readonly resultHash: string;
}

export interface RepairRequest {
  readonly claimIds: readonly string[];
  readonly reasonCodes: readonly VerificationFindingCode[];
  readonly instruction: string;
}

export interface AdversarialReviewResult {
  readonly missionId: string;
  readonly verdict: ReviewVerdict;
  readonly findings: readonly VerificationFinding[];
  readonly repairRequest?: RepairRequest;
  readonly resultHash: string;
}

export interface VerificationGateResult {
  readonly verification: VerificationResult;
  readonly review: AdversarialReviewResult;
  readonly outcome: "BLOCK" | "PASS" | "REPAIR_REQUIRED";
  readonly resultHash: string;
}

export interface AdversarialReviewer {
  review(request: VerificationRequest, result: VerificationResult): AdversarialReviewResult;
}

export interface VerificationAuthority {
  verify(request: VerificationRequest): VerificationGateResult;
}
