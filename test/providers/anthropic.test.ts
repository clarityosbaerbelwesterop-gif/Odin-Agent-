import assert from "node:assert/strict";
import test from "node:test";
import {
  AnthropicProvider,
  CapabilityRegistry,
  type ModelRequest,
} from "../../src/providers/index.js";
import {
  basicRequest,
  capabilityProfile,
  collectStream,
  jsonResponse,
  MockTransport,
  sseResponse,
} from "./helpers.js";

test("Anthropic Messages request and tool response are normalized", async () => {
  const transport = new MockTransport(() =>
    jsonResponse(
      {
        content: [
          { text: "Checking", type: "text" },
          { id: "toolu_1", input: { path: "README.md" }, name: "read_file", type: "tool_use" },
        ],
        id: "msg_1",
        model: "test-model",
        role: "assistant",
        stop_reason: "tool_use",
        type: "message",
        usage: { cache_read_input_tokens: 3, input_tokens: 12, output_tokens: 6 },
      },
      { headers: { "request-id": "req-anthropic" } },
    ),
  );
  const provider = new AnthropicProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("anthropic")]),
    credential: () => "anthropic-key",
    transport,
  });
  const request: ModelRequest = {
    messages: [
      { content: [{ text: "Be precise", type: "text" }], role: "system" },
      { content: [{ text: "Inspect", type: "text" }], role: "user" },
    ],
    model: "test-model",
    reasoningEffort: "high",
    responseFormat: {
      name: "result",
      schema: {
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        type: "object",
      },
      type: "json_schema",
    },
    toolChoice: "required",
    tools: [
      {
        description: "Read a file",
        inputSchema: {
          additionalProperties: false,
          properties: { path: { type: "string" } },
          required: ["path"],
          type: "object",
        },
        name: "read_file",
        strict: true,
      },
    ],
  };

  const response = await provider.generate(request);
  const sent = transport.requests[0];
  const wire = JSON.parse(sent?.body ?? "{}") as Record<string, unknown>;
  assert.equal(sent?.url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent?.headers["x-api-key"], "anthropic-key");
  assert.equal(sent?.headers["anthropic-version"], "2023-06-01");
  assert.equal(wire.max_tokens, 1_024);
  assert.deepEqual(wire.tool_choice, { type: "any" });
  assert.deepEqual(wire.output_config, {
    effort: "high",
    format: {
      schema: {
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        type: "object",
      },
      type: "json_schema",
    },
  });
  assert.equal(response.finishReason, "tool_call");
  assert.deepEqual(response.message.toolCalls, [
    { arguments: { path: "README.md" }, id: "toolu_1", name: "read_file" },
  ]);
  assert.equal(response.usage.cachedInputTokens, 3);
  assert.equal(response.requestId, "req-anthropic");
});

test("Anthropic streaming rebuilds message state from event deltas", async () => {
  const wireEvents = [
    {
      message: {
        content: [],
        id: "msg_stream",
        model: "test-model",
        usage: { input_tokens: 7, output_tokens: 0 },
      },
      type: "message_start",
    },
    { content_block: { text: "", type: "text" }, index: 0, type: "content_block_start" },
    { delta: { text: "Hi", type: "text_delta" }, index: 0, type: "content_block_delta" },
    {
      content_block: { id: "toolu_2", input: {}, name: "read_file", type: "tool_use" },
      index: 1,
      type: "content_block_start",
    },
    {
      delta: { partial_json: '{"path":"a.ts"}', type: "input_json_delta" },
      index: 1,
      type: "content_block_delta",
    },
    {
      delta: { stop_reason: "tool_use" },
      type: "message_delta",
      usage: { output_tokens: 4 },
    },
    { type: "message_stop" },
  ];
  const payload = wireEvents.map(
    (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
  const transport = new MockTransport(() =>
    sseResponse([payload.join("").slice(0, 97), payload.join("").slice(97)]),
  );
  const provider = new AnthropicProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("anthropic")]),
    credential: () => "key",
    transport,
  });

  const events = await collectStream(provider.stream(basicRequest()));
  assert.deepEqual(
    events.map((event) => event.type),
    ["response_start", "text_delta", "tool_call_start", "tool_call_delta", "usage", "completed"],
  );
  const completed = events.at(-1);
  assert.equal(completed?.type, "completed");
  if (completed?.type !== "completed") return;
  const content = completed.response.message.content[0];
  assert.equal(content?.type === "text" ? content.text : undefined, "Hi");
  assert.deepEqual(completed.response.message.toolCalls, [
    { arguments: { path: "a.ts" }, id: "toolu_2", name: "read_file" },
  ]);
  assert.deepEqual(completed.response.usage, {
    cachedInputTokens: 0,
    inputTokens: 7,
    outputTokens: 4,
    totalTokens: 11,
  });
});
