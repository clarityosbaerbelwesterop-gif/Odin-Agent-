export type SoakEventKind =
  | "checkpoint"
  | "restart"
  | "lease_reclaimed"
  | "job_settled"
  | "cancel_requested"
  | "retry_failed"
  | "budget_consumed"
  | "heartbeat";

export type SoakTerminalState = "PASS" | "BLOCKED" | "CANCELLED";

export interface SoakProfile {
  readonly id: "soak-6h-v1" | "soak-12h-v1" | "soak-24h-v1";
  readonly durationMs: number;
  readonly maxEvents: number;
  readonly maxRestarts: number;
  readonly maxRecoveries: number;
  readonly maxEquivalentFailures: number;
  readonly maxBudgetUnits: number;
  readonly minCheckpoints: number;
}

export interface SoakObservationBody {
  readonly kind: SoakEventKind;
  readonly atMs: number;
  readonly jobId?: string;
  readonly generation?: number;
  readonly checkpointHash?: string;
  readonly failureSignature?: string;
  readonly budgetUnits?: number;
  readonly settlement?: "SUCCEEDED" | "BLOCKED" | "CANCELLED";
}

export interface SoakObservation extends SoakObservationBody {
  readonly sequence: number;
  readonly previousHash: string | null;
  readonly eventHash: string;
}

export interface SoakReport {
  readonly profileId: SoakProfile["id"];
  readonly coveredDurationMs: number;
  readonly eventCount: number;
  readonly checkpointCount: number;
  readonly restartCount: number;
  readonly recoveryCount: number;
  readonly peakPendingJobs: number;
  readonly budgetUnitsConsumed: number;
  readonly terminalState: SoakTerminalState;
  readonly finalEventHash: string;
  readonly reportHash: string;
}

export class AutonomyIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutonomyIntegrityError";
  }
}
