import { BaseProvider, type ProviderAdapterOptions } from "./base.js";
import { ProviderError } from "./errors.js";
import {
  asFiniteInteger,
  asObject,
  asString,
  expectArray,
  expectObject,
  expectString,
  malformed,
  nonNegativeInteger,
  parseEventJson,
  parseJsonObject,
  parseJsonValue,
} from "./parse.js";
import { parseServerSentEvents } from "./sse.js";
import { ensureStreamingResponse, readJsonResponse, requestIdFrom } from "./transport.js";
import type {
  ConversationMessage,
  FinishReason,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  TokenUsage,
  ToolChoice,
} from "./types.js";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export interface AnthropicProviderOptions extends ProviderAdapterOptions {
  readonly anthropicVersion?: string;
  readonly defaultMaxOutputTokens?: number;
}

export class AnthropicProvider extends BaseProvider {
  readonly id = "anthropic";
  readonly #anthropicVersion: string;
  readonly #defaultMaxOutputTokens: number;

  constructor(options: AnthropicProviderOptions) {
    super(options, ANTHROPIC_BASE_URL, "messages");
    this.#anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.#defaultMaxOutputTokens = options.defaultMaxOutputTokens ?? 1_024;
    if (!Number.isInteger(this.#defaultMaxOutputTokens) || this.#defaultMaxOutputTokens <= 0) {
      throw new TypeError("defaultMaxOutputTokens must be a positive integer.");
    }
  }

  protected buildHeaders(credential: string, streaming: boolean): Record<string, string> {
    return {
      accept: streaming ? "text/event-stream" : "application/json",
      "anthropic-version": this.#anthropicVersion,
      "content-type": "application/json",
      "x-api-key": credential,
    };
  }

  protected mapRequest(request: ModelRequest, streaming: boolean): JsonObject {
    const { messages, system } = mapMessages(request);
    const mapped: Record<string, JsonValue> = {
      max_tokens: request.maxOutputTokens ?? this.#defaultMaxOutputTokens,
      messages,
      model: request.model,
      stream: streaming,
    };
    if (system.length > 0) mapped.system = system;
    if (request.temperature !== undefined) mapped.temperature = request.temperature;
    if (request.tools !== undefined && request.tools.length > 0) {
      mapped.tools = request.tools.map((tool) => ({
        description: tool.description,
        input_schema: tool.inputSchema,
        name: tool.name,
        strict: tool.strict ?? false,
      }));
      if (request.toolChoice !== undefined) mapped.tool_choice = mapToolChoice(request.toolChoice);
    }

    const outputConfig: Record<string, JsonValue> = {};
    if (request.reasoningEffort !== undefined) outputConfig.effort = request.reasoningEffort;
    if (request.responseFormat !== undefined && request.responseFormat.type !== "text") {
      outputConfig.format =
        request.responseFormat.type === "json_object"
          ? { type: "json_object" }
          : {
              schema: request.responseFormat.schema,
              type: "json_schema",
            };
    }
    if (Object.keys(outputConfig).length > 0) mapped.output_config = outputConfig;
    return mapped;
  }

  protected async parseResponse(response: Response, request: ModelRequest): Promise<ModelResponse> {
    const body = await readJsonResponse(this.id, response, this.maxResponseBytes);
    return normalizeAnthropicResponse(body, request, requestIdFrom(response.headers));
  }

  protected async *parseStream(
    response: Response,
    request: ModelRequest,
  ): AsyncIterable<ModelStreamEvent> {
    const body = await ensureStreamingResponse(this.id, response);
    const requestId = requestIdFrom(response.headers);
    const textParts = new Map<number, string>();
    const toolParts = new Map<number, { id: string; name: string; argumentsText: string }>();
    let id: string | undefined;
    let model: string | undefined;
    let stopReason: unknown;
    let usage: TokenUsage = emptyUsage();
    let terminal = false;

    for await (const event of parseServerSentEvents(body, { provider: this.id })) {
      const payload = parseEventJson(this.id, event.data);
      const type = asString(payload.type) ?? event.event;

      if (type === "message_start") {
        const message = expectObject(this.id, payload.message, "message_start message");
        id = expectString(this.id, message.id, "message id");
        model = expectString(this.id, message.model, "message model");
        usage = mergeUsage(usage, message.usage);
        yield { id, model, provider: this.id, type: "response_start" };
      } else if (type === "content_block_start") {
        const index = nonNegativeInteger(payload.index);
        const block = expectObject(this.id, payload.content_block, "content block");
        if (block.type === "text") {
          const initial = asString(block.text) ?? "";
          textParts.set(index, initial);
          if (initial !== "") yield { delta: initial, type: "text_delta" };
        } else if (block.type === "tool_use") {
          const input = asObject(block.input) ?? {};
          const tool = {
            argumentsText: Object.keys(input).length === 0 ? "" : JSON.stringify(input),
            id: expectString(this.id, block.id, "tool call id"),
            name: expectString(this.id, block.name, "tool call name"),
          };
          toolParts.set(index, tool);
          yield { id: tool.id, index, name: tool.name, type: "tool_call_start" };
        }
      } else if (type === "content_block_delta") {
        const index = nonNegativeInteger(payload.index);
        const delta = expectObject(this.id, payload.delta, "content block delta");
        if (delta.type === "text_delta") {
          const text = expectString(this.id, delta.text, "text delta");
          textParts.set(index, `${textParts.get(index) ?? ""}${text}`);
          yield { delta: text, type: "text_delta" };
        } else if (delta.type === "input_json_delta") {
          const partial = expectString(this.id, delta.partial_json, "tool arguments delta");
          const tool = toolParts.get(index);
          if (tool === undefined)
            malformed(this.id, "Tool arguments arrived before tool metadata.");
          tool.argumentsText += partial;
          yield { delta: partial, index, type: "tool_call_delta" };
        }
      } else if (type === "message_delta") {
        const delta = expectObject(this.id, payload.delta, "message delta");
        stopReason = delta.stop_reason;
        usage = mergeUsage(usage, payload.usage);
        yield { type: "usage", usage };
      } else if (type === "message_stop") {
        if (id === undefined || model === undefined) {
          malformed(this.id, "The Anthropic stream stopped before message metadata arrived.");
        }
        const content: JsonValue[] = [...textParts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, text]) => ({ text, type: "text" }));
        for (const [index, tool] of [...toolParts.entries()].sort(
          ([left], [right]) => left - right,
        )) {
          void index;
          content.push({
            id: tool.id,
            input: parseJsonObject(
              this.id,
              tool.argumentsText === "" ? "{}" : tool.argumentsText,
              "Tool call arguments",
            ),
            name: tool.name,
            type: "tool_use",
          });
        }
        const normalized = normalizeAnthropicResponse(
          {
            content,
            id,
            model,
            stop_reason: stopReason,
            type: "message",
            usage: toWireUsage(usage),
          },
          request,
          requestId,
        );
        yield { response: normalized, type: "completed" };
        terminal = true;
      } else if (type === "error") {
        const error = asObject(payload.error) ?? payload;
        throw new ProviderError({
          category: "unavailable",
          code: asString(error.type),
          message: asString(error.message) ?? "Anthropic reported a streaming error.",
          provider: this.id,
          retryable: true,
        });
      }
    }

    if (!terminal) malformed(this.id, "The Anthropic stream ended without message_stop.");
  }
}

function mapMessages(request: ModelRequest): { messages: JsonValue[]; system: JsonValue[] } {
  const messages: Array<{ role: string; content: JsonValue[] }> = [];
  const system: JsonValue[] = [];
  let sawConversation = false;

  for (const message of request.messages) {
    if (message.role === "system") {
      if (sawConversation) invalid("Anthropic system messages must precede conversation messages.");
      for (const part of message.content) {
        if (part.type !== "text") invalid("Anthropic system messages may only contain text.");
        system.push({ text: part.text, type: "text" });
      }
      continue;
    }
    sawConversation = true;

    if (message.role === "tool") {
      pushMessage(messages, "user", [
        {
          content: message.content,
          is_error: message.isError ?? false,
          tool_use_id: message.toolCallId,
          type: "tool_result",
        },
      ]);
      continue;
    }

    const content: JsonValue[] = message.content.map((part) => {
      if (part.type === "text") return { text: part.text, type: "text" };
      return { source: anthropicImageSource(part.url, part.mediaType), type: "image" };
    });
    for (const call of message.toolCalls ?? []) {
      content.push({ id: call.id, input: call.arguments, name: call.name, type: "tool_use" });
    }
    pushMessage(messages, message.role, content);
  }

  return { messages, system };
}

function anthropicImageSource(url: string, mediaType: string | undefined): JsonObject {
  if (url.startsWith("data:")) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
    if (match === null) invalid("Anthropic image data URLs must contain base64 data.");
    return {
      data: match[2] ?? "",
      media_type: mediaType ?? match[1] ?? "application/octet-stream",
      type: "base64",
    };
  }
  return { type: "url", url };
}

function pushMessage(
  messages: Array<{ role: string; content: JsonValue[] }>,
  role: string,
  content: JsonValue[],
): void {
  const previous = messages.at(-1);
  if (previous?.role === role) previous.content.push(...content);
  else messages.push({ content, role });
}

function mapToolChoice(choice: ToolChoice): JsonValue {
  if (choice === "required") return { type: "any" };
  if (typeof choice === "string") return { type: choice };
  return { name: choice.name, type: "tool" };
}

function normalizeAnthropicResponse(
  value: unknown,
  request: ModelRequest,
  requestId: string | undefined,
): ModelResponse {
  const provider = "anthropic";
  const body = expectObject(provider, value, "response");
  const textParts: string[] = [];
  const toolCalls: Array<{ id: string; name: string; arguments: JsonObject }> = [];

  for (const rawContent of expectArray(provider, body.content, "response content")) {
    const content = expectObject(provider, rawContent, "content block");
    if (content.type === "text") {
      textParts.push(expectString(provider, content.text, "response text"));
    } else if (content.type === "tool_use") {
      toolCalls.push({
        arguments: expectObject(provider, content.input, "tool input") as JsonObject,
        id: expectString(provider, content.id, "tool call id"),
        name: expectString(provider, content.name, "tool call name"),
      });
    }
  }

  const text = textParts.join("");
  const message: ConversationMessage & { readonly role: "assistant" } = {
    content: text === "" ? [] : [{ text, type: "text" }],
    role: "assistant",
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };
  const usage = mergeUsage(emptyUsage(), body.usage);
  const structuredOutput = parseStructuredOutput(provider, text, request, toolCalls.length > 0);
  return {
    finishReason: anthropicFinishReason(body.stop_reason),
    id: expectString(provider, body.id, "response id"),
    message,
    model: expectString(provider, body.model, "response model"),
    provider,
    usage,
    ...(requestId === undefined ? {} : { requestId }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
  };
}

function mergeUsage(current: TokenUsage, value: unknown): TokenUsage {
  const usage = asObject(value) ?? {};
  const input = asFiniteInteger(usage.input_tokens);
  const output = asFiniteInteger(usage.output_tokens);
  const inputTokens = input !== undefined && input >= 0 ? input : current.inputTokens;
  const outputTokens = output !== undefined && output >= 0 ? output : current.outputTokens;
  const cachedInputTokens = Math.max(
    current.cachedInputTokens ?? 0,
    nonNegativeInteger(usage.cache_read_input_tokens),
  );
  return {
    cachedInputTokens,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function emptyUsage(): TokenUsage {
  return { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function toWireUsage(usage: TokenUsage): JsonObject {
  return {
    cache_read_input_tokens: usage.cachedInputTokens ?? 0,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  };
}

function anthropicFinishReason(value: unknown): FinishReason {
  if (value === "end_turn" || value === "stop_sequence") return "stop";
  if (value === "max_tokens") return "length";
  if (value === "tool_use") return "tool_call";
  if (value === "refusal") return "safety";
  return "unknown";
}

function parseStructuredOutput(
  provider: string,
  text: string,
  request: ModelRequest,
  hasToolCalls: boolean,
): JsonValue | undefined {
  if (
    hasToolCalls ||
    text === "" ||
    request.responseFormat === undefined ||
    request.responseFormat.type === "text"
  ) {
    return undefined;
  }
  return parseJsonValue(provider, text, "Structured output");
}

function invalid(message: string): never {
  throw new ProviderError({
    category: "invalid_request",
    message,
    provider: "anthropic",
    retryable: false,
  });
}
