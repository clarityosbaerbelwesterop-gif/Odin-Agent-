export type ContextPriority = "P0" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
export type ContextSourceClass =
  | "history"
  | "memory"
  | "mission"
  | "observation"
  | "repository"
  | "system"
  | "task";
export type ContextSensitivity = "internal" | "public" | "sensitive";

export interface ContextSource {
  readonly class: ContextSourceClass;
  readonly reference: string;
  readonly version: string;
  readonly observedAt: string;
  readonly contentHash: string;
}

export interface ContextCandidate {
  readonly id: string;
  readonly semanticKey: string;
  readonly priority: ContextPriority;
  readonly content: string;
  readonly relevance: number;
  readonly sensitivity: ContextSensitivity;
  readonly source: ContextSource;
}

export interface ContextBudget {
  readonly totalTokens: number;
  readonly maxItemTokens: number;
  readonly perPriority: Readonly<Record<ContextPriority, number>>;
}

export interface ContextCompileRequest {
  readonly missionId: string;
  readonly taskId: string;
  readonly policyVersion: string;
  readonly candidates: readonly ContextCandidate[];
  readonly budget: ContextBudget;
}

export type ContextDropReason = "duplicate" | "item_limit" | "section_budget" | "total_budget";

export interface CompiledContextItem extends ContextCandidate {
  readonly estimatedTokens: number;
}

export interface DroppedContextItem {
  readonly id: string;
  readonly reason: ContextDropReason;
}

export interface CompiledContextSection {
  readonly priority: ContextPriority;
  readonly estimatedTokens: number;
  readonly items: readonly CompiledContextItem[];
}

export interface CompiledContext {
  readonly schemaVersion: 1;
  readonly missionId: string;
  readonly taskId: string;
  readonly policyVersion: string;
  readonly sections: readonly CompiledContextSection[];
  readonly selectedIds: readonly string[];
  readonly dropped: readonly DroppedContextItem[];
  readonly estimatedTokens: number;
  readonly tokenEstimateMethod: "utf8-bytes-divided-by-3-plus-overhead-v1";
  readonly sourceFingerprint: string;
  readonly resultHash: string;
  readonly cacheHit: boolean;
}
