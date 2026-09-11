import type { MissionState } from "../mission/runtime.js";
import type { ModelMessage, ModelProvider, TokenUsage } from "../providers/types.js";

export type ChatMode = "chat" | "coding" | "thinking" | "research" | "ultra";
export type ProductPlan = "free" | "pro" | "developer" | "ultra";
export interface ChatModel {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly provider: ModelProvider;
  readonly plan?: ProductPlan;
  readonly summary?: string;
  readonly recommendedFor?: readonly string[];
  /** Shared hosted capacity is quota-metered; BYOK models leave this unset/false. */
  readonly sharedCapacity?: boolean;
}
export interface ChatLimits {
  readonly maxCalls: number;
  readonly maxToolCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxTurnMs: number;
}
export interface ChatConversation {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
}
export interface ChatTurn {
  readonly id: string;
  readonly conversationId: string;
  readonly mode: ChatMode;
  readonly modelId: string;
  readonly objective: string;
  readonly createdAt: string;
}
export interface ChatEvent {
  readonly cursor: number;
  readonly conversationId: string;
  readonly turnId: string | null;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: string;
}
export interface ChatTurnView extends ChatTurn {
  readonly state: MissionState;
  readonly version: number;
  readonly usage: TokenUsage;
}
export interface ChatSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly excerpt: string;
  readonly retrievedAt: string;
}
export interface ResearchAdapter {
  readonly name: string;
  search(query: string, signal: AbortSignal): Promise<readonly ChatSource[]>;
}
export interface ChatChange {
  readonly path: string;
  readonly before: string | null;
  readonly after: string;
  readonly sha: string;
}
export interface AgentCheckpoint {
  readonly messages: readonly ModelMessage[];
  readonly calls: number;
  readonly toolCalls: number;
  readonly sources: readonly ChatSource[];
  readonly changes: readonly ChatChange[];
  readonly reviewed: boolean;
  readonly steeringCursor: number;
  readonly usageUnknown: boolean;
  readonly usage: TokenUsage;
}
export class ChatError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ChatError";
  }
}
