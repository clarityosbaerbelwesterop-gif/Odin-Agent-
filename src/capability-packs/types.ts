import type {
  SkillPackage,
  SkillRecord,
  SkillVerificationProducer,
} from "../skills/types.js";

export type CapabilityDomain =
  | "coding"
  | "data-documents"
  | "marketing"
  | "product-business"
  | "research"
  | "security";

export type CapabilityGateStatus = "FAIL" | "PASS";
export type CapabilityCurationDecision = "FAIL" | "PASS" | "REDUNDANT";

export interface CapabilityCandidateRef {
  readonly name: string;
  readonly version: string;
  readonly contentHash: string;
}

export interface CapabilityMeasurement {
  readonly authority: CapabilityGateStatus;
  readonly latencyMs: number;
  readonly qualityBps: number;
  readonly safety: CapabilityGateStatus;
  readonly totalTokens: number;
}

export interface CapabilityEvaluationCase {
  readonly baseline: CapabilityMeasurement;
  readonly candidate: CapabilityMeasurement;
  readonly evidenceRef: string;
  readonly id: string;
  readonly maxCandidateLatencyMs: number;
  readonly maxCandidateTokens: number;
  readonly requiredQualityBps: number;
  readonly taskClass: string;
}

export interface CapabilityEvaluationAttestation {
  readonly candidate: CapabilityCandidateRef;
  readonly cases: readonly CapabilityEvaluationCase[];
  readonly domain: CapabilityDomain;
  readonly evaluatedAt: string;
  readonly producerClass: SkillVerificationProducer;
}

export interface CapabilityCurationRequest {
  readonly candidate: CapabilityCandidateRef;
  readonly domain: CapabilityDomain;
  readonly observedAt: string;
  readonly procedureKeys: readonly string[];
  readonly taskClasses: readonly string[];
}

export interface CapabilityEvaluationRequest extends CapabilityCurationRequest {
  readonly package: SkillPackage;
  readonly novelProcedureKeys: readonly string[];
}

export interface CapabilityEvaluationAuthority {
  evaluate(request: CapabilityEvaluationRequest): Promise<unknown>;
}

export interface CapabilitySkillRegistry {
  resolveForReview(name: string, version: string): SkillRecord;
  verify(value: unknown): SkillRecord;
}

export interface CapabilityCurationPolicy {
  readonly maxCases: number;
  readonly maxContextBytes: number;
  readonly maxEvidenceAgeMs: number;
  readonly maxProcedureKeys: number;
  readonly maxTaskClasses: number;
  readonly minAverageLiftBps: number;
}

export interface CapabilityCurationCaseResult {
  readonly candidateQualityBps: number;
  readonly evidenceRef: string;
  readonly id: string;
  readonly liftBps: number;
  readonly passed: boolean;
  readonly taskClass: string;
}

export interface CapabilityCurationReport {
  readonly candidate: CapabilityCandidateRef;
  readonly candidateContextBytes: number;
  readonly cases: readonly CapabilityCurationCaseResult[];
  readonly decision: CapabilityCurationDecision;
  readonly domain: CapabilityDomain;
  readonly evaluatedAt: string | null;
  readonly evidenceRefs: readonly string[];
  readonly novelProcedureKeys: readonly string[];
  readonly procedureKeys: readonly string[];
  readonly reportHash: string;
  readonly taskClasses: readonly string[];
  readonly totalLiftBps: number;
}

export interface CapabilityCurationResult {
  readonly report: CapabilityCurationReport;
  readonly verified?: SkillRecord;
}

export type CapabilityCurationErrorCode =
  | "CONFLICT"
  | "DENIED"
  | "EVALUATION_FAILED"
  | "INVALID_INPUT";

export class CapabilityCurationError extends Error {
  readonly code: CapabilityCurationErrorCode;

  constructor(code: CapabilityCurationErrorCode, message: string) {
    super(message);
    this.name = "CapabilityCurationError";
    this.code = code;
  }
}
