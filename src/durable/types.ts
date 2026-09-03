import type { MissionCheckpoint } from "../mission/checkpoint.js";

export interface JsonCodec<T> {
  decode(value: unknown): T;
}

export interface DurableStoreLimits {
  readonly maxEventBatch: number;
  readonly maxMissionEvents: number;
  readonly maxEventBytes: number;
  readonly maxCheckpointBytes: number;
  readonly maxJobs: number;
  readonly maxJobEvents: number;
  readonly maxJobEventPage: number;
  readonly maxLeaseMs: number;
  readonly maxRetryDelayMs: number;
}

export const DEFAULT_DURABLE_LIMITS: DurableStoreLimits = Object.freeze({
  maxCheckpointBytes: 512_000,
  maxEventBatch: 64,
  maxEventBytes: 128_000,
  maxJobEventPage: 100,
  maxJobEvents: 100_000,
  maxJobs: 10_000,
  maxLeaseMs: 300_000,
  maxMissionEvents: 100_000,
  maxRetryDelayMs: 3_600_000,
});

export interface ArtifactReference {
  readonly artifactId: string;
  readonly sha256: string;
}

export type DurableJobStatus =
  | "PENDING"
  | "RUNNING"
  | "RETRY_WAIT"
  | "CANCELLING"
  | "CANCELLED"
  | "SUCCEEDED"
  | "BLOCKED";

export interface JobEnqueueInput {
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly priority: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly createdAt: string;
  readonly payload: ArtifactReference;
}

export interface DurableJobRecord {
  readonly jobId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly priority: number;
  readonly status: DurableJobStatus;
  readonly maxAttempts: number;
  readonly attemptCount: number;
  readonly availableAt: string;
  readonly payload: ArtifactReference;
  readonly leaseGeneration: number;
  readonly leaseWorkerId: string | null;
  readonly leaseExpiresAt: string | null;
  readonly result: ArtifactReference | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobLease {
  readonly jobId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly attempt: number;
  readonly generation: number;
  readonly token: string;
  readonly expiresAt: string;
  readonly payload: ArtifactReference;
}

export interface JobClaimInput {
  readonly workerId: string;
  readonly now: string;
  readonly leaseMs: number;
}

export type JobHeartbeatState = "RUNNING" | "CANCELLING";

export interface JobHeartbeatResult {
  readonly state: JobHeartbeatState;
  readonly expiresAt: string;
}

export type JobLifecycleType =
  | "job.enqueued"
  | "job.claimed"
  | "job.reclaimed"
  | "job.heartbeat"
  | "job.retry_scheduled"
  | "job.succeeded"
  | "job.blocked"
  | "job.cancelling"
  | "job.cancelled";

export interface JobLifecycleEvent {
  readonly cursor: number;
  readonly missionId: string;
  readonly jobId: string;
  readonly type: JobLifecycleType;
  readonly status: DurableJobStatus;
  readonly generation: number;
  readonly occurredAt: string;
  readonly reasonCode: string | null;
  readonly eventHash: string;
}

export type JobHandlerResult =
  | { readonly outcome: "SUCCEEDED"; readonly result: ArtifactReference }
  | { readonly outcome: "RETRY"; readonly reasonCode: string; readonly retryAfterMs: number }
  | { readonly outcome: "BLOCKED"; readonly reasonCode: string }
  | { readonly outcome: "CANCELLED" };

export interface JobHandler {
  execute(lease: Readonly<JobLease>, signal: AbortSignal): Promise<JobHandlerResult>;
}

export interface JobRunnerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly timeoutMs: number;
}

export interface JobRunResult {
  readonly jobId: string;
  readonly generation: number;
  readonly finalStatus: DurableJobStatus;
}

export interface DurableCheckpointStore {
  saveCheckpoint(checkpoint: MissionCheckpoint, savedAt: string): Promise<MissionCheckpoint>;
  loadCheckpoint(missionId: string): Promise<MissionCheckpoint | null>;
}

export class DurableStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableStoreError";
  }
}

export class DurableStoreConflictError extends DurableStoreError {
  constructor(message: string) {
    super(message);
    this.name = "DurableStoreConflictError";
  }
}

export class DurableStoreCorruptionError extends DurableStoreError {
  constructor(message: string) {
    super(message);
    this.name = "DurableStoreCorruptionError";
  }
}

export class LeaseRejectedError extends DurableStoreConflictError {
  constructor(message: string) {
    super(message);
    this.name = "LeaseRejectedError";
  }
}
