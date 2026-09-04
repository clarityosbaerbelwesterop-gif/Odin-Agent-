import type { MemorySensitivity, MemoryWriteResult } from "../memory/types.js";

export type LearningStatus = "ARCHIVED" | "CANDIDATE" | "CONFLICTED" | "ESTABLISHED";
export type LearningTier = "COLD" | "HOT" | "WARM";
export type LearningConfidence = "ESTABLISHED" | "TENTATIVE";

export interface LearningScope {
  readonly userId: string;
  readonly projectId: string;
}

export interface LearningTaskScope extends LearningScope {
  readonly missionId: string;
  readonly taskId: string;
}

export interface LearningAttestationRequest extends LearningTaskScope {
  readonly learningKeyHash: string;
  readonly lessonContentHash: string;
  readonly sensitivity: Extract<MemorySensitivity, "internal" | "public">;
}

export interface VerifiedLearningAttestation extends LearningAttestationRequest {
  readonly verdict: "PASS";
  readonly evaluatedAt: string;
  readonly verificationResultHash: string;
  readonly evidenceRefs: readonly string[];
}

export interface LearningEvidenceAuthority {
  attestVerifiedTask(
    request: LearningAttestationRequest,
  ): Promise<VerifiedLearningAttestation | null>;
}

export interface LearningProposal extends LearningTaskScope {
  readonly idempotencyKey: string;
  readonly key: string;
  readonly lesson: string;
  readonly observedAt: string;
  readonly sensitivity: Extract<MemorySensitivity, "internal" | "public">;
  readonly sourceReference: string;
  readonly tags: readonly string[];
}

export interface LearningSupport {
  readonly missionId: string;
  readonly taskId: string;
  readonly evaluatedAt: string;
  readonly verificationResultHash: string;
  readonly learningKeyHash: string;
  readonly lessonContentHash: string;
  readonly evidenceRefs: readonly string[];
}

export interface LearningRecord extends LearningScope {
  readonly id: string;
  readonly key: string;
  readonly lesson: string;
  readonly contentHash: string;
  readonly sensitivity: Extract<MemorySensitivity, "internal" | "public">;
  readonly tags: readonly string[];
  readonly status: LearningStatus;
  readonly tier: LearningTier;
  readonly supports: readonly LearningSupport[];
  readonly supportCount: number;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly sourceReferences: readonly string[];
  readonly evidenceDigest: string;
  readonly memoryId?: string;
  readonly archivedAt?: string;
}

export interface LearningRecordResult {
  readonly record: LearningRecord;
  readonly replayed: boolean;
  readonly supportAdded: boolean;
}

export interface LearningNudgeQuery extends LearningScope {
  readonly evaluatedAt: string;
  readonly limit: number;
  readonly maxCharacters: number;
  readonly text: string;
  readonly tags?: readonly string[];
}

export interface LearningNudge {
  readonly recordId: string;
  readonly key: string;
  readonly lesson: string;
  readonly confidence: LearningConfidence;
  readonly tier: LearningTier;
  readonly supportCount: number;
  readonly contentHash: string;
  readonly evidenceDigest: string;
  readonly evidenceRefs: readonly string[];
  readonly score: number;
}

export interface LearningMaintenanceRequest extends LearningScope {
  readonly evaluatedAt: string;
  readonly coldAfterDays: number;
  readonly archiveAfterDays: number;
}

export interface LearningMaintenanceResult {
  readonly cooledIds: readonly string[];
  readonly archivedIds: readonly string[];
  readonly reestablishedIds: readonly string[];
}

export interface LearningMemoryCommitResult {
  readonly learning: LearningRecord;
  readonly memory: MemoryWriteResult;
}

export type LearningErrorCode =
  | "CONFLICT"
  | "DENIED"
  | "INVALID_INPUT"
  | "NOT_ELIGIBLE"
  | "NOT_FOUND";

export class LearningError extends Error {
  readonly code: LearningErrorCode;

  constructor(code: LearningErrorCode, message: string) {
    super(message);
    this.name = "LearningError";
    this.code = code;
  }
}
