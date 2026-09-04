import type { SkillRecord } from "../skills/types.js";

export type SkillIntakeCompleteness = "COMPLETE" | "FAILED" | "PARTIAL";
export type SkillIntakeDecision = "ACCEPT" | "QUARANTINE" | "REJECT";
export type SkillIntakeSeverity = "CRITICAL" | "HIGH" | "INFO" | "LOW" | "MEDIUM";
export type SkillSnapshotFileKind = "binary" | "symlink" | "text";

export type SkillRiskRuleId =
  | "CREDENTIAL_COLLECTION"
  | "DEPENDENCY_INSTALL"
  | "DESTRUCTIVE_WRITE"
  | "EXFILTRATION"
  | "HOOK_WORKFLOW"
  | "MCP_TOOL_POISONING"
  | "MEMORY_POLICY_POISONING"
  | "PRIVILEGE_ESCALATION"
  | "PROMPT_INJECTION"
  | "REMOTE_EXECUTION"
  | "SELF_PROMOTION"
  | "SHELL_EXECUTION";

export interface SkillIntakeLimits {
  readonly maxDepth: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxFindings: number;
  readonly maxTotalBytes: number;
}

export interface SkillIntakeRequest {
  readonly observedAt: string;
  readonly ref: string;
  readonly repository: string;
  readonly skillPath: string;
}

export interface SkillSourceLicense {
  readonly path: string | null;
  readonly spdx: string | null;
}

export interface SkillSnapshotFile {
  readonly byteLength?: number;
  readonly content?: string;
  readonly kind: SkillSnapshotFileKind;
  readonly path: string;
  readonly target?: string;
}

export interface SkillSourceSnapshot {
  readonly commitSha: string;
  readonly files: readonly SkillSnapshotFile[];
  readonly inventoryComplete: boolean;
  readonly license: SkillSourceLicense;
  readonly limitations?: readonly string[];
  readonly ref: string;
  readonly repository: string;
  readonly skillPath: string;
}

export interface SkillSourceResolver {
  resolve(request: SkillIntakeRequest): Promise<unknown>;
}

export interface SkillIntakeManifest {
  readonly description: string;
  readonly instructionBytes: number;
  readonly instructionHash: string;
  readonly name: string;
}

export interface SkillIntakeFinding {
  readonly evidenceHash: string;
  readonly filePath: string;
  readonly fingerprint: string;
  readonly line: number;
  readonly message: string;
  readonly ruleId: SkillRiskRuleId;
  readonly severity: SkillIntakeSeverity;
}

export interface SkillIntakeFileEvidence {
  readonly contentHash: string;
  readonly path: string;
  readonly sizeBytes: number;
}

export interface SkillIntakeReport {
  readonly analyzedBytes: number;
  readonly analyzedFiles: number;
  readonly commitSha: string;
  readonly completeness: SkillIntakeCompleteness;
  readonly decision: SkillIntakeDecision;
  readonly fileEvidence: readonly SkillIntakeFileEvidence[];
  readonly findings: readonly SkillIntakeFinding[];
  readonly license: SkillSourceLicense;
  readonly limitations: readonly string[];
  readonly manifest: SkillIntakeManifest | null;
  readonly observedAt: string;
  readonly ref: string;
  readonly reportHash: string;
  readonly repository: string;
  readonly skillPath: string;
}

export interface SkillIntakeResult {
  readonly candidate?: SkillRecord;
  readonly report: SkillIntakeReport;
}

export interface CommunitySkillRegistry {
  registerCandidate(value: unknown): SkillRecord;
}

export type SkillIntakeErrorCode = "CONFLICT" | "DENIED" | "INVALID_INPUT" | "INCOMPLETE";

export class SkillIntakeError extends Error {
  readonly code: SkillIntakeErrorCode;

  constructor(code: SkillIntakeErrorCode, message: string) {
    super(message);
    this.name = "SkillIntakeError";
    this.code = code;
  }
}
