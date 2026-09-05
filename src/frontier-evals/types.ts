export type FrontierTaskClass =
  | "coding"
  | "reasoning"
  | "tool_use"
  | "recovery"
  | "long_mission";

export type FrontierArm = "model_alone" | "odin";
export type FrontierEvidenceStatus = "COMPLETE" | "PARTIAL" | "INCONCLUSIVE";
export type FrontierVerification = "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE";
export type FrontierOutcomeClass = "SUCCESS" | "TASK_TERMINAL" | "INFRASTRUCTURE_AMBIGUOUS";
export type FrontierFailureCategory =
  | "none"
  | "quality"
  | "verification"
  | "budget"
  | "contract"
  | "timeout"
  | "network"
  | "authentication"
  | "rate_limit"
  | "unavailable"
  | "malformed_response"
  | "unknown";

export interface FrontierBudgetProfile {
  readonly id: string;
  readonly maxModelCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxLatencyMs: number;
  readonly maxToolCalls: number;
  readonly maxRepairs: number;
  readonly maxRecoveries: number;
  readonly budgetHash: string;
}

export interface FrontierCaseInput {
  readonly id: string;
  readonly suiteVersion: string;
  readonly taskClass: FrontierTaskClass;
  readonly publicInputHash: string;
  readonly hiddenAcceptanceHash: string;
  readonly budget: FrontierBudgetProfile;
}

export interface FrontierCase extends FrontierCaseInput {
  readonly caseHash: string;
}

export interface FrontierModelFacingCase {
  readonly id: string;
  readonly suiteVersion: string;
  readonly taskClass: FrontierTaskClass;
  readonly publicInputHash: string;
  readonly budget: FrontierBudgetProfile;
  readonly caseHash: string;
}

export interface FrontierArmResultInput {
  readonly caseHash: string;
  readonly arm: FrontierArm;
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
  readonly reasoningEffort: string | null;
  readonly harnessVersion: string;
  readonly budgetHash: string;
  readonly completed: boolean;
  readonly attributable: boolean;
  readonly outcomeClass: FrontierOutcomeClass;
  readonly failureCategory: FrontierFailureCategory;
  readonly verification: FrontierVerification;
  readonly qualityBps: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly repairs: number;
  readonly recoveries: number;
}

export interface FrontierArmResult extends FrontierArmResultInput {
  readonly resultHash: string;
}

export interface FrontierAggregateMetrics {
  readonly completePairs: number;
  readonly baselineQualityBps: number | null;
  readonly odinQualityBps: number | null;
  readonly qualityLiftBps: number | null;
  readonly baselineTokens: number | null;
  readonly odinTokens: number | null;
  readonly tokenDeltaBps: number | null;
  readonly baselineLatencyMs: number | null;
  readonly odinLatencyMs: number | null;
  readonly latencyDeltaBps: number | null;
  readonly baselineModelCalls: number | null;
  readonly odinModelCalls: number | null;
}

export interface FrontierEvaluationReport {
  readonly suiteVersion: string;
  readonly harnessVersion: string;
  readonly caseCount: number;
  readonly matchedPairCount: number;
  readonly incompletePairCount: number;
  readonly status: FrontierEvidenceStatus;
  readonly caseHashes: readonly string[];
  readonly resultHashes: readonly string[];
  readonly metrics: FrontierAggregateMetrics;
  readonly reportHash: string;
}

export class FrontierEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontierEvaluationError";
  }
}
