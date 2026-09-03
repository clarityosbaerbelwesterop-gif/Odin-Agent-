import type { DurableJobStatus, JobLifecycleType } from "../durable/types.js";
import type { BudgetCounters, FocusClass, MissionState, TaskStatus } from "../mission/runtime.js";

export interface ClientProtocolVersion {
  readonly major: number;
  readonly minor: number;
}

export const CLIENT_PROTOCOL_VERSION: ClientProtocolVersion = Object.freeze({ major: 1, minor: 0 });

export type ClientCommandName = "mission.pause" | "mission.resume" | "mission.cancel";

export interface ClientCapabilityGrant {
  readonly id: string;
  readonly sessionId: string;
  readonly missionId: string;
  readonly canRead: boolean;
  readonly commands: readonly ClientCommandName[];
  readonly expiresAt: string;
}

export interface ClientTaskProjection {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly priority: number;
  readonly status: TaskStatus;
}

export type ClientJobCounts = Readonly<Record<DurableJobStatus, number>>;

export type ClientVerificationStatus = "UNAVAILABLE" | "PENDING" | "VERIFIED" | "BLOCKED";

export interface ClientVerificationSummary {
  readonly status: ClientVerificationStatus;
  readonly evidenceRefs: readonly string[];
}

export interface ClientMissionProjection {
  readonly missionId: string;
  readonly version: number;
  readonly objective: string;
  readonly focus: FocusClass;
  readonly state: MissionState;
  readonly resumeState: MissionState | null;
  readonly tasks: readonly ClientTaskProjection[];
  readonly budgetLimits: BudgetCounters;
  readonly budgetUsage: BudgetCounters;
  readonly jobs: ClientJobCounts;
  readonly verification: ClientVerificationSummary;
}

export interface ClientLifecycleEvent {
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

export interface ClientStateRequest {
  readonly protocol: ClientProtocolVersion;
  readonly requestId: string;
  readonly sessionId: string;
  readonly missionId: string;
  readonly capabilityId: string;
  readonly requestedAt: string;
  readonly afterCursor: number;
  readonly limit: number;
}

export interface ClientStateResponse {
  readonly protocol: ClientProtocolVersion;
  readonly requestId: string;
  readonly sessionId: string;
  readonly missionId: string;
  readonly emittedAt: string;
  readonly fromCursor: number;
  readonly nextCursor: number;
  readonly hasMore: boolean;
  readonly projection: ClientMissionProjection;
  readonly events: readonly ClientLifecycleEvent[];
}

export interface ClientCommandRequest {
  readonly protocol: ClientProtocolVersion;
  readonly requestId: string;
  readonly sessionId: string;
  readonly missionId: string;
  readonly capabilityId: string;
  readonly issuedAt: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly command: ClientCommandName;
}

export interface ClientCommandResponse {
  readonly protocol: ClientProtocolVersion;
  readonly requestId: string;
  readonly sessionId: string;
  readonly missionId: string;
  readonly emittedAt: string;
  readonly command: ClientCommandName;
  readonly projection: ClientMissionProjection;
}

export interface ClientReducerState {
  readonly missionId: string;
  readonly sessionId: string;
  readonly cursor: number;
  readonly projection: ClientMissionProjection;
  readonly recentEventHashes: Readonly<Record<string, string>>;
}

export type ClientProtocolErrorCode =
  | "MALFORMED"
  | "UNSUPPORTED_VERSION"
  | "DENIED"
  | "STALE_VERSION"
  | "CONFLICT"
  | "RESYNC_REQUIRED";

export class ClientProtocolError extends Error {
  readonly code: ClientProtocolErrorCode;

  constructor(code: ClientProtocolErrorCode, message: string) {
    super(message);
    this.name = "ClientProtocolError";
    this.code = code;
  }
}
