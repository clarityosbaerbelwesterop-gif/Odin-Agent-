export type FailureSource =
  | "persistence"
  | "planner"
  | "provider"
  | "runtime"
  | "sandbox"
  | "tool"
  | "verification";

export type FailureCategory =
  | "BUDGET"
  | "CANCELLED"
  | "CONFLICT"
  | "CONTEXT"
  | "EXECUTION"
  | "PLAN"
  | "POLICY"
  | "TRANSIENT"
  | "UNKNOWN"
  | "VERIFICATION";

export type FailureSideEffect = "IDEMPOTENT" | "IRREVERSIBLE_OR_UNKNOWN" | "NONE" | "REVERSIBLE";

export type RecoveryAction =
  | "ALTERNATIVE_PLAN"
  | "CHECKPOINT_AND_BLOCK"
  | "ESCALATE_MODEL"
  | "ESCALATE_VERIFIER"
  | "REDUCE_CONTEXT"
  | "ROLLBACK"
  | "STOP_CANCELLED"
  | "TARGETED_REPAIR"
  | "TARGETED_RETRY";

export type RecoveryOutcome = "FAILED" | "NO_PROGRESS" | "SUCCEEDED";

export interface FailureSignal {
  readonly missionId: string;
  readonly taskId: string;
  readonly source: FailureSource;
  readonly phase: string;
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly sideEffect: FailureSideEffect;
  readonly evidenceHash?: string;
  readonly rollbackEvidenceHash?: string;
  readonly independentEvidence: boolean;
  readonly contradictoryEvidence: boolean;
}

export interface ClassifiedFailure extends FailureSignal {
  readonly category: FailureCategory;
  readonly signature: string;
}

export interface RecoveryAttempt {
  readonly failureSignature: string;
  readonly action: RecoveryAction;
  readonly outcome: RecoveryOutcome;
  readonly decisionHash: string;
}

export interface RecoveryBudget {
  readonly retriesRemaining: number;
  readonly repairsRemaining: number;
  readonly alternativePlansRemaining: number;
  readonly rollbacksRemaining: number;
  readonly verifierEscalationsRemaining: number;
  readonly modelEscalationsRemaining: number;
  readonly maxRepeatedStrategyFailures: number;
}

export interface RecoveryCapabilities {
  readonly contextReduction: boolean;
  readonly modelEscalation: boolean;
  readonly verifierEscalation: boolean;
}

export interface RecoveryRequest {
  readonly failure: ClassifiedFailure;
  readonly attempts: readonly RecoveryAttempt[];
  readonly budget: RecoveryBudget;
  readonly capabilities: RecoveryCapabilities;
}

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly reasonCode: string;
  readonly failureSignature: string;
  readonly decisionHash: string;
}

export interface FailureRecoveryAuthority {
  decide(request: RecoveryRequest): RecoveryDecision;
}

export type ReliabilityErrorCode = "INVALID_INPUT" | "TAMPERED_INPUT";

export class ReliabilityError extends Error {
  readonly code: ReliabilityErrorCode;

  constructor(code: ReliabilityErrorCode, message: string) {
    super(message);
    this.name = "ReliabilityError";
    this.code = code;
  }
}
