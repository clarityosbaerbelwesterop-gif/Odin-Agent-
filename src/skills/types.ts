export type SkillTrustClass = "builtin" | "community" | "learned" | "project";
export type SkillLifecycle = "ACTIVE" | "CANDIDATE" | "REVOKED" | "VERIFIED";
export type SkillLifecycleAction =
  | "ACTIVATED"
  | "REGISTERED"
  | "REVOKED"
  | "ROLLED_BACK"
  | "SUPERSEDED"
  | "VERIFIED";
export type SkillVerificationProducer =
  | "independent_test"
  | "independent_verifier"
  | "model"
  | "runtime"
  | "trusted_user"
  | "worker";
export type SkillPromotionActor = "trusted_runtime" | "user_approved";

export interface SkillProvenance {
  readonly kind: "community" | "learned" | "project" | "system";
  readonly reference: string;
  readonly observedAt: string;
  readonly sourceMissionId?: string;
  readonly sourceTaskId?: string;
}

export interface SkillPackageInput {
  readonly name: string;
  readonly version: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly requiredTools: readonly string[];
  readonly instructions: string;
  readonly provenance: SkillProvenance;
  readonly trustClass: SkillTrustClass;
  readonly testRefs: readonly string[];
}

export interface SkillPackage extends SkillPackageInput {
  readonly contentHash: string;
}

export interface SkillRecord {
  readonly package: SkillPackage;
  readonly lifecycle: SkillLifecycle;
  readonly verifiedAt: string | null;
  readonly activatedAt: string | null;
  readonly revokedAt: string | null;
}

export interface SkillSummary {
  readonly name: string;
  readonly version: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly requiredTools: readonly string[];
  readonly trustClass: SkillTrustClass;
  readonly lifecycle: SkillLifecycle;
  readonly contentHash: string;
}

export interface SkillLifecycleEvent {
  readonly sequence: number;
  readonly action: SkillLifecycleAction;
  readonly name: string;
  readonly version: string;
  readonly contentHash: string;
  readonly from: SkillLifecycle | null;
  readonly to: SkillLifecycle;
  readonly occurredAt: string;
  readonly actor: SkillPromotionActor | null;
  readonly producerClass: SkillVerificationProducer | null;
  readonly evidenceRefs: readonly string[];
}

export interface SkillVerificationEvidence {
  readonly name: string;
  readonly version: string;
  readonly contentHash: string;
  readonly producerClass: SkillVerificationProducer;
  readonly observedAt: string;
  readonly status: "FAIL" | "PASS";
  readonly evidenceRefs: readonly string[];
}

export interface SkillPromotionRequest {
  readonly name: string;
  readonly version: string;
  readonly actor: SkillPromotionActor;
  readonly promotedAt: string;
}

export interface SkillRevocationRequest {
  readonly name: string;
  readonly version: string;
  readonly actor: SkillPromotionActor;
  readonly revokedAt: string;
}

export interface SkillCandidateProposal {
  readonly name: string;
  readonly version: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly requiredTools: readonly string[];
  readonly instructions: string;
  readonly testRefs: readonly string[];
  readonly missionId: string;
  readonly taskId: string;
  readonly sourceReference: string;
  readonly observedAt: string;
  readonly idempotencyKey: string;
}

export interface SkillRegistryLimits {
  readonly maxInstructionsBytes: number;
  readonly maxSummaryBytes: number;
  readonly maxTags: number;
  readonly maxTools: number;
  readonly maxTestRefs: number;
}

export type SkillErrorCode =
  | "CONFLICT"
  | "DENIED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "VERIFICATION_FAILED";

export class SkillError extends Error {
  readonly code: SkillErrorCode;

  constructor(code: SkillErrorCode, message: string) {
    super(message);
    this.name = "SkillError";
    this.code = code;
  }
}
