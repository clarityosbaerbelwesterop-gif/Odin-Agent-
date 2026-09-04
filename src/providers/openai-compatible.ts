import { BaseProvider, type ProviderAdapterOptions } from "./base.js";
import { ProviderError } from "./errors.js";
import {
  asArray,
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
  ReasoningEffort,
  TokenUsage,
  ToolChoice,
} from "./types.js";

export type CompatibleReasoningParameter = "reasoning" | "reasoning_effort";

export interface OpenAICompatibleProviderOptions extends ProviderAdapterOptions {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly endpoint?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly reasoningParameter?: CompatibleReasoningParameter;
}

export class OpenAICompatibleProvider extends BaseProvider {
  readonly id: string;
  readonly #extraHeaders: Readonly<Record<string, string>>;
  readonly #reasoningParameter: CompatibleReasoningParameter | undefined;

  constructor(options: OpenAICompatibleProviderOptions) {
    super(options, options.baseUrl, options.endpoint ?? "chat/completions");
    if (options.providerId.trim() === "") throw new TypeError("providerId must be non-empty.");
    this.id = options.providerId;
    this.#extraHeaders = validateExtraHeaders(options.extraHeaders ?? {});
    this.#reasoningParameter = options.reasoningParameter;
  }

  protected buildHeaders(credential: string, streaming: boolean): Record<string, string> {
    return {
      accept: streaming ? "text/event-stream" : "application/json",
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
      ...this.#extraHeaders,
    };
  }

  protected mapRequest(request: ModelRequest, streaming: boolean): JsonObject {
    const mapped: Record<string, JsonValue> = {
      messages: request.messages.map(mapMessage),
      model: request.model,
      stream: streaming,
    };
    if (request.maxOutputTokens !== undefined) mapped.max_tokens = request.maxOutputTokens;
    if (request.temperature !== undefined) mapped.temperature = request.temperature;
    if (request.reasoningEffort !== undefined) {
      mapReasoning(this.id, mapped, request.reasoningEffort, this.#reasoningParameter);
    }
    if (request.tools !== undefined && request.tools.length > 0) {
      mapped.tools = request.tools.map((tool) => ({
        function: {
          description: tool.description,
          name: tool.name,
          parameters: tool.inputSchema,
          strict: tool.strict ?? false,
        },
        type: "function",
      }));
      if (request.toolChoice !== undefined) mapped.tool_choice = mapToolChoice(request.toolChoice);
    }
    if (request.responseFormat !== undefined && request.responseFormat.type !== "text") {
      mapped.response_format =
        request.responseFormat.type === "json_object"
          ? { type: "json_object" }
          : {
              json_schema: {
                description: request.responseFormat.description ?? "",
                name: request.responseFormat.name,
                schema: request.responseFormat.schema,
                strict: request.responseFormat.strict ?? true,
              },
              type: "json_schema",
            };
    }
    return mapped;
  }

  protected async parseResponse(response: Response, request: ModelRequest): Promise<ModelResponse> {
    const body = await readJsonResponse(this.id, response, this.maxResponseBytes);
    return normalizeChatResponse(this.id, body, request, requestIdFrom(response.headers));
  }

  protected async *parseStream(
    response: Response,
    request: ModelRequest,
  ): AsyncIterable<ModelStreamEvent> {
    const body = await ensureStreamingResponse(this.id, response);
    const requestId = requestIdFrom(response.headers);
    const toolParts = new Map<number, { id: string; name: string; argumentsText: string }>();
    let id: string | undefined;
    let model: string | undefined;
    let text = "";
    let finishReason: unknown;
    let usage = emptyUsage();
    let started = false;
    let terminal = false;

    for await (const event of parseServerSentEvents(body, { provider: this.id })) {
      if (event.data === "[DONE]") {
        if (!started || id === undefined || model === undefined) {
          malformed(this.id, "The stream ended before response metadata arrived.");
        }
        const wireToolCalls = [...toolParts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, tool]) => ({
            function: { arguments: tool.argumentsText || "{}", name: tool.name },
            id: tool.id,
            type: "function",
          }));
        const normalized = normalizeChatResponse(
          this.id,
          {
            choices: [
              {
                finish_reason: finishReason,
                index: 0,
                message: {
                  content: text,
                  role: "assistant",
                  ...(wireToolCalls.length === 0 ? {} : { tool_calls: wireToolCalls }),
                },
              },
            ],
            id,
            model,
            usage: toWireUsage(usage),
          },
          request,
          requestId,
        );
        yield { response: normalized, type: "completed" };
        terminal = true;
        continue;
      }

      const payload = parseEventJson(this.id, event.data);
      if (asObject(payload.error) !== undefined) throwStreamError(this.id, payload.error);
      id ??= asString(payload.id);
      model ??= asString(payload.model);
      if (!started && id !== undefined && model !== undefined) {
        yield { id, model, provider: this.id, type: "response_start" };
        started = true;
      }

      for (const rawChoice of asArray(payload.choices) ?? []) {
        const choice = expectObject(this.id, rawChoice, "streaming choice");
        if (nonNegativeInteger(choice.index) !== 0) continue;
        const delta = asObject(choice.delta) ?? {};
        const content = asString(delta.content);
        if (content !== undefined && content !== "") {
          text += content;
          yield { delta: content, type: "text_delta" };
        }

        for (const rawTool of asArray(delta.tool_calls) ?? []) {
          const wireTool = expectObject(this.id, rawTool, "streaming tool call");
          const index = nonNegativeInteger(wireTool.index);
          const fn = asObject(wireTool.function) ?? {};
          let tool = toolParts.get(index);
          const wireId = asString(wireTool.id);
          const wireName = asString(fn.name);
          if (tool === undefined) {
            if (wireId === undefined || wireName === undefined) {
              malformed(this.id, "A tool-call stream began without an id and name.");
            }
            tool = { argumentsText: "", id: wireId, name: wireName };
            toolParts.set(index, tool);
            yield { id: tool.id, index, name: tool.name, type: "tool_call_start" };
          }
          const argumentsDelta = asString(fn.arguments);
          if (argumentsDelta !== undefined && argumentsDelta !== "") {
            tool.argumentsText += argumentsDelta;
            yield { delta: argumentsDelta, index, type: "tool_call_delta" };
          }
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          finishReason = choice.finish_reason;
        }
      }

      if (payload.usage !== undefined) {
        usage = normalizeUsage(payload.usage);
        yield { type: "usage", usage };
      }
    }

    if (!terminal) malformed(this.id, "The chat-completions stream ended without [DONE].");
  }
}

function mapMessage(message: ModelRequest["messages"][number]): JsonObject {
  if (message.role === "tool") {
    return { content: message.content, role: "tool", tool_call_id: message.toolCallId };
  }

  const textOnly = message.content.every((part) => part.type === "text");
  const mapped: Record<string, JsonValue> = {
    content: textOnly
      ? message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
      : message.content.map((part) =>
          part.type === "text"
            ? { text: part.text, type: "text" }
            : { image_url: { url: part.url }, type: "image_url" },
        ),
    role: message.role,
  };
  if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
    mapped.tool_calls = message.toolCalls.map((call) => ({
      function: { arguments: JSON.stringify(call.arguments), name: call.name },
      id: call.id,
      type: "function",
    }));
  }
  return mapped;
}

function mapReasoning(
  provider: string,
  mapped: Record<string, JsonValue>,
  effort: ReasoningEffort,
  parameter: CompatibleReasoningParameter | undefined,
): void {
  if (parameter === "reasoning") mapped.reasoning = { effort };
  else if (parameter === "reasoning_effort") mapped.reasoning_effort = effort;
  else {
    throw new ProviderError({
      category: "unsupported",
      message: "This compatible endpoint has no configured reasoning-parameter mapping.",
      provider,
      retryable: false,
    });
  }
}

function mapToolChoice(choice: ToolChoice): JsonValue {
  if (typeof choice === "string") return choice;
  return { function: { name: choice.name }, type: "function" };
}

function normalizeChatResponse(
  provider: string,
  value: unknown,
  request: ModelRequest,
  requestId: string | undefined,
): ModelResponse {
  const body = expectObject(provider, value, "response");
  const choices = expectArray(provider, body.choices, "response choices");
  if (choices.length === 0) malformed(provider, "The response did not contain a choice.");
  const choice = expectObject(provider, choices[0], "first response choice");
  const wireMessage = expectObject(provider, choice.message, "assistant message");
  const text = responseText(provider, wireMessage.content);
  const toolCalls = (asArray(wireMessage.tool_calls) ?? []).map((rawTool) => {
    const tool = expectObject(provider, rawTool, "tool call");
    const fn = expectObject(provider, tool.function, "tool call function");
    return {
      arguments: parseJsonObject(
        provider,
        expectString(provider, fn.arguments, "tool call arguments"),
        "Tool call arguments",
      ),
      id: expectString(provider, tool.id, "tool call id"),
      name: expectString(provider, fn.name, "tool call name"),
    };
  });
  const message: ConversationMessage & { readonly role: "assistant" } = {
    content: text === "" ? [] : [{ text, type: "text" }],
    role: "assistant",
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };
  const usage = normalizeUsage(body.usage);
  const structuredOutput = parseStructuredOutput(provider, text, request, toolCalls.length > 0);
  return {
    finishReason: chatFinishReason(choice.finish_reason),
    id: expectString(provider, body.id, "response id"),
    message,
    model: expectString(provider, body.model, "response model"),
    provider,
    usage,
    ...(requestId === undefined ? {} : { requestId }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
  };
}

function responseText(provider: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return expectArray(provider, value, "assistant content")
    .map((rawPart) => {
      const part = expectObject(provider, rawPart, "assistant content part");
      return part.type === "text" ? expectString(provider, part.text, "assistant text") : "";
    })
    .join("");
}

function normalizeUsage(value: unknown): TokenUsage {
  const usage = asObject(value) ?? {};
  const promptDetails = asObject(usage.prompt_tokens_details) ?? {};
  const completionDetails = asObject(usage.completion_tokens_details) ?? {};
  const inputTokens = nonNegativeInteger(usage.prompt_tokens);
  const outputTokens = nonNegativeInteger(usage.completion_tokens);
  return {
    cachedInputTokens: nonNegativeInteger(promptDetails.cached_tokens),
    inputTokens,
    outputTokens,
    reasoningOutputTokens: nonNegativeInteger(completionDetails.reasoning_tokens),
    totalTokens: nonNegativeInteger(usage.total_tokens) || inputTokens + outputTokens,
  };
}

function emptyUsage(): TokenUsage {
  return {
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function toWireUsage(usage: TokenUsage): JsonObject {
  return {
    completion_tokens: usage.outputTokens,
    completion_tokens_details: { reasoning_tokens: usage.reasoningOutputTokens ?? 0 },
    prompt_tokens: usage.inputTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens ?? 0 },
    total_tokens: usage.totalTokens,
  };
}

function chatFinishReason(value: unknown): FinishReason {
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  if (value === "tool_calls" || value === "function_call") return "tool_call";
  if (value === "content_filter") return "safety";
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
  return parseJsonValue(provider, unwrapExactJsonFence(text), "Structured output");
}

function unwrapExactJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed);
  return match?.[1]?.trim() ?? text;
}

function validateExtraHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const protectedHeaders = new Set(["authorization", "content-type", "host", "x-api-key"]);
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || protectedHeaders.has(normalized)) {
      throw new TypeError(`Unsafe or protected extra header: ${name}.`);
    }
    if (/[\r\n]/.test(value)) throw new TypeError(`Unsafe value for extra header: ${name}.`);
    result[normalized] = value;
  }
  return Object.freeze(result);
}

function throwStreamError(provider: string, value: unknown): never {
  const error = asObject(value) ?? {};
  throw new ProviderError({
    category: "unavailable",
    code: asString(error.code) ?? asString(error.type),
    message: asString(error.message) ?? "The provider reported a streaming error.",
    provider,
    retryable: true,
  });
}
