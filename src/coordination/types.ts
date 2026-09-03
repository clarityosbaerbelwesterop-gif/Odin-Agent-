export type SpecialistTrustClass = "test_fixture" | "untrusted_worker";
export type OwnershipNamespace = "repository" | "resource" | "state";
export type OwnershipAccess = "read" | "write";
export type SpecialistProposalOutcome = "BLOCKED" | "FAILED" | "SUCCESS";
export type SpecialistVerificationStatus =
  | "BLOCKED"
  | "FAILED"
  | "PARTIALLY_VERIFIED"
  | "UNVERIFIED"
  | "VERIFIED";
export type ReconciliationOutcome = "ACCEPTED" | "BLOCKED" | "RETRY_REQUIRED";
export type CoordinationDeferralReason =
  | "batch_limit"
  | "dependency_blocked"
  | "missing_specialist"
  | "missing_spec"
  | "ownership_conflict"
  | "runtime_capacity"
  | "task_already_leased"
  | "specialist_capacity";

export interface SpecialistProvenance {
  readonly source: string;
  readonly version: string;
  readonly contentHash: string;
}

export interface SpecialistProfile {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
  readonly maxConcurrency: number;
  readonly trustClass: SpecialistTrustClass;
  readonly provenance: SpecialistProvenance;
}

export interface SpecialistSummary {
  readonly id: string;
  readonly version: string;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
  readonly maxConcurrency: number;
  readonly trustClass: SpecialistTrustClass;
  readonly provenanceHash: string;
}

export interface OwnershipClaim {
  readonly namespace: OwnershipNamespace;
  readonly key: string;
  readonly access: OwnershipAccess;
}

export interface ContextPackageReference {
  readonly missionId: string;
  readonly taskId: string;
  readonly resultHash: string;
  readonly sourceFingerprint: string;
  readonly selectedIds: readonly string[];
}

export interface CoordinationTaskSpec {
  readonly taskId: string;
  readonly goal: string;
  readonly role: string;
  readonly requiredCapabilities: readonly string[];
  readonly ownership: readonly OwnershipClaim[];
  readonly context: ContextPackageReference;
}

export interface OwnershipLease {
  readonly id: string;
  readonly generation: number;
  readonly missionId: string;
  readonly taskId: string;
  readonly specialistId: string;
  readonly specialistVersion: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly claims: readonly OwnershipClaim[];
}

export interface SpecialistAssignment {
  readonly id: string;
  readonly missionId: string;
  readonly missionVersion: number;
  readonly taskId: string;
  readonly title: string;
  readonly goal: string;
  readonly role: string;
  readonly requiredCapabilities: readonly string[];
  readonly context: ContextPackageReference;
  readonly lease: OwnershipLease;
  readonly assignmentHash: string;
}

export interface CoordinationDeferral {
  readonly taskId: string;
  readonly reason: CoordinationDeferralReason;
  readonly conflictsWithTaskIds: readonly string[];
}

export interface CoordinationPlan {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly missionId: string;
  readonly missionVersion: number;
  readonly createdAt: string;
  readonly assignments: readonly SpecialistAssignment[];
  readonly deferred: readonly CoordinationDeferral[];
  readonly planHash: string;
}

export interface SpecialistEvidenceReference {
  readonly id: string;
  readonly kind: string;
  readonly reference: string;
  readonly contentHash: string;
  readonly observedAt: string;
  readonly producerClass: "independent_tool" | "specialist";
  readonly status: "FAIL" | "PASS";
}

export interface SpecialistArtifactReference {
  readonly id: string;
  readonly type: string;
  readonly reference: string;
  readonly contentHash: string;
}

export interface SpecialistProposal {
  readonly assignmentId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly specialistId: string;
  readonly specialistVersion: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: SpecialistProposalOutcome;
  readonly summary: string;
  readonly evidence: readonly SpecialistEvidenceReference[];
  readonly filesChanged: readonly string[];
  readonly artifacts: readonly SpecialistArtifactReference[];
  readonly assumptions: readonly string[];
  readonly risks: readonly string[];
  readonly remainingWork: readonly string[];
  readonly verificationStatus: SpecialistVerificationStatus;
}

export interface SpecialistResult extends SpecialistProposal {
  readonly resultHash: string;
}

export interface SpecialistWorker {
  execute(assignment: SpecialistAssignment, signal: AbortSignal): Promise<SpecialistProposal>;
}

export interface SpecialistEvidenceAuthority {
  attests(assignment: SpecialistAssignment, evidence: SpecialistEvidenceReference): boolean;
}

export type ReconciliationReason =
  | "failed_evidence"
  | "invalid_result"
  | "not_verified"
  | "specialist_blocked"
  | "specialist_failed"
  | "worker_failed"
  | "worker_timeout";

export interface TaskReconciliation {
  readonly assignmentId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly specialistId: string;
  readonly outcome: ReconciliationOutcome;
  readonly reasons: readonly ReconciliationReason[];
  readonly attestedEvidenceIds: readonly string[];
  readonly result?: SpecialistResult;
  readonly reconciliationHash: string;
}

export interface CoordinationBatchResult {
  readonly schemaVersion: 1;
  readonly missionId: string;
  readonly planHash: string;
  readonly completedAt: string;
  readonly reconciliations: readonly TaskReconciliation[];
  readonly acceptedTaskIds: readonly string[];
  readonly retryTaskIds: readonly string[];
  readonly blockedTaskIds: readonly string[];
  readonly resultHash: string;
}

export interface SpecialistCoordinatorOptions {
  readonly maxBatchSize: number;
  readonly maxActiveAssignments: number;
  readonly leaseDurationMs: number;
  readonly executionTimeoutMs: number;
  readonly maxPlanRecords?: number;
  readonly evidenceAuthority?: SpecialistEvidenceAuthority;
  readonly clock?: () => string;
}
