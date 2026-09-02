import type { JsonObject, JsonValue } from "../providers/types.js";

export type ToolRiskClass = "low" | "medium" | "high";
export type ToolOperation = "execute" | "read" | "search" | "write";
export type ToolTrustClass = "builtin" | "project";
export type ToolFailureCategory =
  | "cancelled"
  | "conflict"
  | "denied"
  | "handler_error"
  | "invalid_input"
  | "require_approval"
  | "retryable"
  | "timeout";

export interface ToolProvenance {
  readonly kind: "project" | "system";
  readonly reference: string;
  readonly observedAt: string;
}

export interface ToolRetryPolicy {
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly retryableCategories: readonly ToolFailureCategory[];
}

export interface ToolManifest {
  readonly name: string;
  readonly version: string;
  readonly summary: string;
  readonly description: string;
  readonly riskClass: ToolRiskClass;
  readonly operation: ToolOperation;
  readonly sideEffecting: boolean;
  readonly inputSchema: JsonObject;
  readonly retryPolicy: ToolRetryPolicy;
  readonly provenance: ToolProvenance;
  readonly trustClass: ToolTrustClass;
}

export interface ToolSummary {
  readonly name: string;
  readonly version: string;
  readonly summary: string;
  readonly riskClass: ToolRiskClass;
  readonly operation: ToolOperation;
  readonly trustClass: ToolTrustClass;
}

export interface ToolHandlerContext {
  readonly missionId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export type ToolHandler = (
  input: JsonObject,
  context: ToolHandlerContext,
) => JsonValue | Promise<JsonValue>;

export type ToolResourceResolver = (input: JsonObject) => string;

export interface ToolRegistration {
  readonly manifest: ToolManifest;
  readonly handler: ToolHandler;
  readonly resourceFromInput: ToolResourceResolver;
}

export interface ApprovalEvidence {
  readonly approvalId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly tool: string;
  readonly expiresAt: string;
}

export interface CapabilityGrant {
  readonly grantId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly tool: string;
  readonly operation: ToolOperation;
  readonly resourcePrefix: string;
  readonly maxCalls: number;
  readonly expiresAt: string;
}

export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface PolicyAuthorization {
  readonly decision: PolicyDecision;
  readonly grantId?: string;
  readonly reason: string;
}

export interface ToolPolicyRequest {
  readonly missionId: string;
  readonly taskId: string;
  readonly tool: string;
  readonly operation: ToolOperation;
  readonly riskClass: ToolRiskClass;
  readonly resource: string;
  readonly approval?: ApprovalEvidence;
  readonly now: string;
}

export interface ToolExecutionRequest {
  readonly missionId: string;
  readonly taskId: string;
  readonly tool: string;
  readonly version: string;
  readonly input: JsonObject;
  readonly idempotencyKey?: string;
  readonly approval?: ApprovalEvidence;
  readonly signal?: AbortSignal;
}

export interface ToolExecutionResult {
  readonly output: JsonValue;
  readonly attempts: number;
  readonly replayed: boolean;
}

export type ToolAuditResultClass =
  | "cancelled"
  | "conflict"
  | "denied"
  | "failure"
  | "replay"
  | "success"
  | "timeout";

export interface ToolAuditRecord {
  readonly missionId: string;
  readonly taskId: string;
  readonly tool: string;
  readonly version: string;
  readonly operation: ToolOperation;
  readonly resource: string;
  readonly inputHash: string;
  readonly policyDecision: PolicyDecision | "REPLAY";
  readonly resultClass: ToolAuditResultClass;
  readonly attempt: number;
  readonly sideEffecting: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly grantId?: string;
  readonly errorCategory?: ToolFailureCategory;
}

export interface ToolAuditSink {
  append(record: ToolAuditRecord): Promise<void>;
}

export class ToolRuntimeError extends Error {
  readonly category: ToolFailureCategory;
  readonly retryable: boolean;

  constructor(category: ToolFailureCategory, message: string, retryable = false) {
    super(message);
    this.name = "ToolRuntimeError";
    this.category = category;
    this.retryable = retryable;
  }
}
