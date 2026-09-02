export type JsonPrimitive = boolean | null | number | string;
export type JsonArray = readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

export interface ImageUrlContent {
  readonly type: "image_url";
  readonly url: string;
  readonly mediaType?: string;
}

export type MessageContent = ImageUrlContent | TextContent;

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export interface ConversationMessage {
  readonly role: "assistant" | "system" | "user";
  readonly content: readonly MessageContent[];
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolResultMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export type ModelMessage = ConversationMessage | ToolResultMessage;

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly strict?: boolean;
}

export type ToolChoice = "auto" | "none" | "required" | { readonly name: string };

export type ResponseFormat =
  | { readonly type: "text" }
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly name: string;
      readonly description?: string;
      readonly schema: JsonObject;
      readonly strict?: boolean;
    };

export interface ModelRequest {
  readonly model: string;
  readonly messages: readonly ModelMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly responseFormat?: ResponseFormat;
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ToolChoice;
}

export interface ProviderCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export type FinishReason =
  | "stop"
  | "length"
  | "tool_call"
  | "safety"
  | "cancelled"
  | "error"
  | "unknown";

export interface ModelResponse {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly message: ConversationMessage & { readonly role: "assistant" };
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
  readonly structuredOutput?: JsonValue;
  readonly requestId?: string;
}

export type ModelStreamEvent =
  | {
      readonly type: "response_start";
      readonly id: string;
      readonly provider: string;
      readonly model: string;
    }
  | { readonly type: "text_delta"; readonly delta: string }
  | {
      readonly type: "tool_call_start";
      readonly index: number;
      readonly id: string;
      readonly name: string;
    }
  | { readonly type: "tool_call_delta"; readonly index: number; readonly delta: string }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "completed"; readonly response: ModelResponse };

export interface ModelCapabilities {
  readonly textInput: boolean;
  readonly imageInput: boolean;
  readonly toolUse: boolean;
  readonly strictToolSchema: boolean;
  readonly strictStructuredOutput: boolean;
  readonly structuredOutput: boolean;
  readonly streaming: boolean;
  readonly temperature: boolean;
  readonly reasoningEfforts: readonly ReasoningEffort[];
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
}

export type CapabilitySourceKind = "provider" | "project_config" | "user_override";

export interface CapabilityProvenance {
  readonly kind: CapabilitySourceKind;
  readonly reference: string;
  readonly observedAt: string;
}

export type RelativeClass = "low" | "medium" | "high" | "unknown";

export interface ModelRoutingMetadata {
  readonly costClass: RelativeClass;
  readonly latencyClass: RelativeClass;
  readonly reasoningScore?: number;
  readonly codingScore?: number;
}

export interface ModelPricing {
  readonly currency: string;
  readonly inputPerMillionTokens: number;
  readonly outputPerMillionTokens: number;
  readonly cachedInputPerMillionTokens?: number;
  readonly cacheWritePerMillionTokens?: number;
}

export interface CapabilityProfile {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly capabilities: ModelCapabilities;
  readonly provenance: CapabilityProvenance;
  readonly routing?: ModelRoutingMetadata;
  readonly pricing?: ModelPricing;
}

export interface ModelProvider {
  readonly id: string;
  capabilities(model: string): CapabilityProfile;
  generate(request: ModelRequest, options?: ProviderCallOptions): Promise<ModelResponse>;
  stream(request: ModelRequest, options?: ProviderCallOptions): AsyncIterable<ModelStreamEvent>;
}

export type CredentialResolver = () => Promise<string> | string;
