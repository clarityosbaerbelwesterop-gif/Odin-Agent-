import type { CapabilityProfile, ReasoningEffort } from "../providers/types.js";

export type RoutingTaskClass = "coding" | "general" | "planning" | "research";
export type RoutingRisk = "critical" | "high" | "low" | "medium";
export type EvaluationProducerClass =
  | "independent_eval"
  | "model"
  | "project_eval"
  | "runtime"
  | "worker";
export type ReasoningBranchKind = "adversarial" | "alternative" | "decomposition" | "direct";
export type EvidenceVerdict = "FAIL" | "NONE" | "PASS" | "REPAIR_REQUIRED";
export type ReasoningNextAction = "ACCEPT" | "BLOCK" | "CRITIQUE" | "ESCALATE" | "REPAIR";

export type RoutingErrorCode =
  | "BUDGET_EXCEEDED"
  | "EVALUATION_CONFLICT"
  | "EVALUATION_INVALID"
  | "EVALUATION_STALE"
  | "INVALID_INPUT"
  | "NO_ELIGIBLE_MODEL";

export class RoutingError extends Error {
  readonly code: RoutingErrorCode;
  readonly reasons: readonly string[];

  constructor(code: RoutingErrorCode, message: string, reasons: readonly string[] = []) {
    super(message);
    this.name = "RoutingError";
    this.code = code;
    this.reasons = Object.freeze([...reasons]);
  }
}

export interface EvaluationProducer {
  readonly class: EvaluationProducerClass;
  readonly id: string;
  readonly reference: string;
}

export interface ModelEvaluationInput {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
  readonly taskClass: RoutingTaskClass;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly samples: number;
  readonly qualityScoreBps: number;
  readonly passRateBps: number;
  readonly medianLatencyMs: number;
  readonly inputTokensPerSample: number;
  readonly outputTokensPerSample: number;
  readonly observedAt: string;
  readonly producer: EvaluationProducer;
}

export interface ModelEvaluation extends ModelEvaluationInput {
  readonly contentHash: string;
}

export interface RoutingRequirements {
  readonly imageInput: boolean;
  readonly toolUse: boolean;
  readonly structuredOutput: boolean;
  readonly strictStructuredOutput: boolean;
  readonly minContextWindowTokens?: number;
  readonly minOutputTokens?: number;
}

export interface RoutingBudget {
  readonly maxEstimatedCostMicros: number;
  readonly maxModelCalls: number;
  readonly maxParallelCalls: number;
  readonly maxBranches: number;
  readonly maxCritiquePasses: number;
  readonly maxRepairs: number;
}

export interface RoutingCacheRequest {
  readonly allowRead: boolean;
  readonly allowWrite: boolean;
  readonly sensitive: boolean;
  readonly maxAgeMs: number;
  readonly contextHash: string;
  readonly evidenceHash: string;
}

export interface RouteRequest {
  readonly missionId: string;
  readonly taskId: string;
  readonly taskClass: RoutingTaskClass;
  readonly evaluatedAt: string;
  readonly risk: RoutingRisk;
  readonly uncertaintyBps: number;
  readonly baseQualityFloorBps: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly currency: string;
  readonly requirements: RoutingRequirements;
  readonly budget: RoutingBudget;
  readonly cache: RoutingCacheRequest;
}

export interface EmpiricalRouterConfig {
  readonly maxEvaluationAgeMs: number;
  readonly minimumQualityFloorBps: number;
  readonly uncertaintyStepBps: number;
  readonly uncertaintyUpliftPerStepBps: number;
  readonly riskUpliftBps: Readonly<Record<RoutingRisk, number>>;
}

export interface RoutingCandidate {
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly qualityScoreBps: number;
  readonly passRateBps: number;
  readonly medianLatencyMs: number;
  readonly estimatedCostMicros: number;
  readonly reasoningEffort: ReasoningEffort | null;
}

export interface ReasoningBranch {
  readonly id: string;
  readonly kind: ReasoningBranchKind;
}

export interface ReasoningPlan {
  readonly branchCount: number;
  readonly branches: readonly ReasoningBranch[];
  readonly critiquePasses: number;
  readonly repairAttempts: number;
  readonly maxModelCalls: number;
  readonly parallelism: number;
  readonly planHash: string;
}

export interface RoutingCacheDecision {
  readonly readAllowed: boolean;
  readonly writeAllowed: boolean;
  readonly maxAgeMs: number;
  readonly key?: string;
}

export interface RoutingDecision {
  readonly missionId: string;
  readonly taskId: string;
  readonly taskClass: RoutingTaskClass;
  readonly effectiveQualityFloorBps: number;
  readonly primary: RoutingCandidate;
  readonly escalations: readonly RoutingCandidate[];
  readonly reasoning: ReasoningPlan;
  readonly cache: RoutingCacheDecision;
  readonly reasons: readonly string[];
  readonly decisionHash: string;
}

export interface RoutingInputs {
  readonly profiles: readonly CapabilityProfile[];
  readonly evaluations: readonly ModelEvaluation[];
}

export interface ReasoningEvidenceSignal {
  readonly verdict: EvidenceVerdict;
  readonly independent: boolean;
  readonly evidenceHash?: string;
  readonly contradictory: boolean;
}

export interface ReasoningAttemptState {
  readonly modelCallsUsed: number;
  readonly critiquePassesUsed: number;
  readonly repairsUsed: number;
  readonly escalationIndex: number;
}

export interface ReasoningControllerDecision {
  readonly action: ReasoningNextAction;
  readonly nextEscalationIndex?: number;
  readonly reason: string;
  readonly decisionHash: string;
}

export interface CachedRoutingResult {
  readonly key: string;
  readonly decisionHash: string;
  readonly artifactRef: string;
  readonly resultHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
