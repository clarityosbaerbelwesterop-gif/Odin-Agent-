import { BaseProvider, type ProviderAdapterOptions } from "./base.js";
import { ProviderError } from "./errors.js";
import {
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

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export class OpenAIProvider extends BaseProvider {
  readonly id = "openai";

  constructor(options: ProviderAdapterOptions) {
    super(options, OPENAI_BASE_URL, "responses");
  }

  protected buildHeaders(credential: string, streaming: boolean): Record<string, string> {
    return {
      accept: streaming ? "text/event-stream" : "application/json",
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
    };
  }

  protected mapRequest(request: ModelRequest, streaming: boolean): JsonObject {
    const mapped: Record<string, JsonValue> = {
      input: mapInput(request),
      model: request.model,
      stream: streaming,
    };
    if (request.maxOutputTokens !== undefined) {
      mapped.max_output_tokens = request.maxOutputTokens;
    }
    if (request.temperature !== undefined) mapped.temperature = request.temperature;
    if (request.reasoningEffort !== undefined) {
      mapped.reasoning = { effort: request.reasoningEffort };
    }
    if (request.tools !== undefined && request.tools.length > 0) {
      mapped.tools = request.tools.map((tool) => ({
        description: tool.description,
        name: tool.name,
        parameters: tool.inputSchema,
        strict: tool.strict ?? false,
        type: "function",
      }));
      if (request.toolChoice !== undefined) mapped.tool_choice = mapToolChoice(request.toolChoice);
    }
    if (request.responseFormat !== undefined && request.responseFormat.type !== "text") {
      mapped.text = {
        format:
          request.responseFormat.type === "json_object"
            ? { type: "json_object" }
            : {
                description: request.responseFormat.description ?? "",
                name: request.responseFormat.name,
                schema: request.responseFormat.schema,
                strict: request.responseFormat.strict ?? true,
                type: "json_schema",
              },
      };
    }
    return mapped;
  }

  protected async parseResponse(response: Response, request: ModelRequest): Promise<ModelResponse> {
    const body = await readJsonResponse(this.id, response, this.maxResponseBytes);
    return normalizeOpenAIResponse(body, request, requestIdFrom(response.headers));
  }

  protected async *parseStream(
    response: Response,
    request: ModelRequest,
  ): AsyncIterable<ModelStreamEvent> {
    const body = await ensureStreamingResponse(this.id, response);
    const requestId = requestIdFrom(response.headers);
    let terminal = false;

    for await (const event of parseServerSentEvents(body, { provider: this.id })) {
      if (event.data === "[DONE]") continue;
      const payload = parseEventJson(this.id, event.data);
      const type = asString(payload.type) ?? event.event;

      if (type === "response.created") {
        const created = expectObject(this.id, payload.response, "response.created response");
        yield {
          id: expectString(this.id, created.id, "response id"),
          model: expectString(this.id, created.model, "response model"),
          provider: this.id,
          type: "response_start",
        };
      } else if (type === "response.output_text.delta") {
        yield {
          delta: expectString(this.id, payload.delta, "text delta"),
          type: "text_delta",
        };
      } else if (type === "response.output_item.added") {
        const item = expectObject(this.id, payload.item, "output item");
        if (item.type === "function_call") {
          yield {
            id: expectString(this.id, item.call_id ?? item.id, "tool call id"),
            index: nonNegativeInteger(payload.output_index),
            name: expectString(this.id, item.name, "tool call name"),
            type: "tool_call_start",
          };
        }
      } else if (type === "response.function_call_arguments.delta") {
        yield {
          delta: expectString(this.id, payload.delta, "tool arguments delta"),
          index: nonNegativeInteger(payload.output_index),
          type: "tool_call_delta",
        };
      } else if (type === "response.completed" || type === "response.incomplete") {
        const normalized = normalizeOpenAIResponse(payload.response, request, requestId);
        yield { type: "usage", usage: normalized.usage };
        yield { response: normalized, type: "completed" };
        terminal = true;
      } else if (type === "response.failed" || type === "error") {
        throwStreamError(this.id, payload);
      }
    }

    if (!terminal) malformed(this.id, "The OpenAI stream ended without a terminal response event.");
  }
}

function mapInput(request: ModelRequest): JsonValue[] {
  const input: JsonValue[] = [];
  for (const message of request.messages) {
    if (message.role === "tool") {
      input.push({
        call_id: message.toolCallId,
        output: message.content,
        type: "function_call_output",
      });
      continue;
    }

    if (message.content.length > 0) {
      const textOnly = message.content.every((part) => part.type === "text");
      input.push({
        content: textOnly
          ? message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
          : message.content.map((part) =>
              part.type === "text"
                ? { text: part.text, type: "input_text" }
                : { detail: "auto", image_url: part.url, type: "input_image" },
            ),
        role: message.role,
        type: "message",
      });
    }

    for (const call of message.toolCalls ?? []) {
      input.push({
        arguments: JSON.stringify(call.arguments),
        call_id: call.id,
        name: call.name,
        type: "function_call",
      });
    }
  }
  return input;
}

function mapToolChoice(choice: ToolChoice): JsonValue {
  if (typeof choice === "string") return choice;
  return { name: choice.name, type: "function" };
}

function normalizeOpenAIResponse(
  value: unknown,
  request: ModelRequest,
  requestId: string | undefined,
): ModelResponse {
  const provider = "openai";
  const body = expectObject(provider, value, "response");
  if (body.status === "failed") throwStreamError(provider, body);
  const output = expectArray(provider, body.output, "response output");
  const textParts: string[] = [];
  const toolCalls: Array<{ id: string; name: string; arguments: JsonObject }> = [];
  let refused = false;

  for (const rawItem of output) {
    const item = expectObject(provider, rawItem, "output item");
    if (item.type === "message") {
      for (const rawContent of expectArray(provider, item.content, "message content")) {
        const content = expectObject(provider, rawContent, "message content item");
        if (content.type === "output_text") {
          textParts.push(expectString(provider, content.text, "output text"));
        } else if (content.type === "refusal") {
          refused = true;
          const refusal = asString(content.refusal);
          if (refusal !== undefined) textParts.push(refusal);
        }
      }
    } else if (item.type === "function_call") {
      toolCalls.push({
        arguments: parseJsonObject(
          provider,
          expectString(provider, item.arguments, "tool call arguments"),
          "Tool call arguments",
        ),
        id: expectString(provider, item.call_id ?? item.id, "tool call id"),
        name: expectString(provider, item.name, "tool call name"),
      });
    }
  }

  const text = textParts.join("");
  const message: ConversationMessage & { readonly role: "assistant" } = {
    content: text === "" ? [] : [{ text, type: "text" }],
    role: "assistant",
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };
  const usage = normalizeUsage(body.usage);
  const structuredOutput = parseStructuredOutput(provider, text, request, toolCalls.length > 0);
  return {
    finishReason: finishReason(body, toolCalls.length > 0, refused),
    id: expectString(provider, body.id, "response id"),
    message,
    model: expectString(provider, body.model, "response model"),
    provider,
    usage,
    ...(requestId === undefined ? {} : { requestId }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
  };
}

function normalizeUsage(value: unknown): TokenUsage {
  const usage = asObject(value) ?? {};
  const inputDetails = asObject(usage.input_tokens_details) ?? {};
  const outputDetails = asObject(usage.output_tokens_details) ?? {};
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  return {
    cachedInputTokens: nonNegativeInteger(inputDetails.cached_tokens),
    inputTokens,
    outputTokens,
    reasoningOutputTokens: nonNegativeInteger(outputDetails.reasoning_tokens),
    totalTokens: nonNegativeInteger(usage.total_tokens) || inputTokens + outputTokens,
  };
}

function finishReason(
  body: Record<string, unknown>,
  hasToolCalls: boolean,
  refused: boolean,
): FinishReason {
  if (refused) return "safety";
  if (hasToolCalls) return "tool_call";
  if (body.status === "incomplete") {
    const details = asObject(body.incomplete_details);
    return details?.reason === "content_filter" ? "safety" : "length";
  }
  if (body.status === "cancelled") return "cancelled";
  return body.status === "completed" ? "stop" : "unknown";
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

function throwStreamError(provider: string, payload: Record<string, unknown>): never {
  const response = asObject(payload.response) ?? payload;
  const error = asObject(response.error) ?? asObject(payload.error) ?? response;
  throw new ProviderError({
    category: "unavailable",
    code: asString(error.code) ?? asString(error.type),
    message: asString(error.message) ?? "The provider reported a failed response.",
    provider,
    retryable: true,
  });
}
