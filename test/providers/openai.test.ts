import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityRegistry,
  type ModelRequest,
  OpenAIProvider,
} from "../../src/providers/index.js";
import {
  basicRequest,
  capabilityProfile,
  collectStream,
  jsonResponse,
  MockTransport,
  sseResponse,
} from "./helpers.js";

function openAIResponse(text = '{"answer":42}') {
  return {
    id: "resp_1",
    model: "test-model",
    output: [
      {
        content: [{ annotations: [], text, type: "output_text" }],
        id: "msg_1",
        role: "assistant",
        type: "message",
      },
    ],
    status: "completed",
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 15,
    },
  };
}

test("OpenAI Responses request and response are normalized", async () => {
  const transport = new MockTransport(() =>
    jsonResponse(openAIResponse(), { headers: { "x-request-id": "req-openai" } }),
  );
  const provider = new OpenAIProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("openai")]),
    credential: () => "openai-key",
    transport,
  });
  const request: ModelRequest = {
    maxOutputTokens: 500,
    messages: [
      { content: [{ text: "Stay concise", type: "text" }], role: "system" },
      { content: [{ text: "Calculate", type: "text" }], role: "user" },
    ],
    model: "test-model",
    reasoningEffort: "medium",
    responseFormat: {
      name: "answer",
      schema: {
        additionalProperties: false,
        properties: { answer: { type: "number" } },
        required: ["answer"],
        type: "object",
      },
      strict: true,
      type: "json_schema",
    },
    toolChoice: "auto",
    tools: [
      {
        description: "Read a value",
        inputSchema: {
          additionalProperties: false,
          properties: { key: { type: "string" } },
          required: ["key"],
          type: "object",
        },
        name: "read_value",
        strict: true,
      },
    ],
  };

  const response = await provider.generate(request);
  assert.equal(transport.requests.length, 1);
  const wire = JSON.parse(transport.requests[0]?.body ?? "") as Record<string, unknown>;
  assert.equal(transport.requests[0]?.url, "https://api.openai.com/v1/responses");
  assert.equal(transport.requests[0]?.headers.authorization, "Bearer openai-key");
  assert.equal(wire.stream, false);
  assert.deepEqual(wire.reasoning, { effort: "medium" });
  assert.equal((wire.tools as Array<Record<string, unknown>>)[0]?.type, "function");
  assert.equal((wire.text as { format: { type: string } }).format.type, "json_schema");

  assert.equal(response.provider, "openai");
  assert.equal(response.finishReason, "stop");
  assert.equal(response.message.content[0]?.type, "text");
  assert.deepEqual(response.structuredOutput, { answer: 42 });
  assert.deepEqual(response.usage, {
    cachedInputTokens: 4,
    inputTokens: 10,
    outputTokens: 5,
    reasoningOutputTokens: 2,
    totalTokens: 15,
  });
  assert.equal(response.requestId, "req-openai");
});

test("OpenAI function calls are normalized", async () => {
  const transport = new MockTransport(() =>
    jsonResponse({
      id: "resp_tool",
      model: "test-model",
      output: [
        {
          arguments: '{"path":"README.md"}',
          call_id: "call_1",
          name: "read_file",
          type: "function_call",
        },
      ],
      status: "completed",
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    }),
  );
  const provider = new OpenAIProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("openai")]),
    credential: () => "key",
    transport,
  });
  const response = await provider.generate(basicRequest());
  assert.equal(response.finishReason, "tool_call");
  assert.deepEqual(response.message.toolCalls, [
    { arguments: { path: "README.md" }, id: "call_1", name: "read_file" },
  ]);
});

test("OpenAI rejects malformed tool-call arguments instead of executing them", async () => {
  const transport = new MockTransport(() =>
    jsonResponse({
      id: "resp_bad_tool",
      model: "test-model",
      output: [
        {
          arguments: "{not-json",
          call_id: "call_bad",
          name: "read_file",
          type: "function_call",
        },
      ],
      status: "completed",
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    }),
  );
  const provider = new OpenAIProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("openai")]),
    credential: () => "key",
    transport,
  });
  await assert.rejects(
    provider.generate(basicRequest()),
    /Tool call arguments contained invalid JSON/,
  );
});

test("OpenAI streaming emits deltas, usage, and one normalized completion", async () => {
  const complete = openAIResponse("Hello");
  const chunks = [
    `data: ${JSON.stringify({ response: { id: "resp_1", model: "test-model" }, type: "response.created" })}\n\n`,
    `data: ${JSON.stringify({ delta: "Hel", type: "response.output_text.delta" })}\n`,
    "\n",
    `data: ${JSON.stringify({ delta: "lo", type: "response.output_text.delta" })}\n\n`,
    `data: ${JSON.stringify({ response: complete, type: "response.completed" })}\n\n`,
  ];
  const transport = new MockTransport(() => sseResponse(chunks));
  const provider = new OpenAIProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("openai")]),
    credential: () => "key",
    transport,
  });

  const events = await collectStream(provider.stream(basicRequest()));
  assert.deepEqual(
    events.map((event) => event.type),
    ["response_start", "text_delta", "text_delta", "usage", "completed"],
  );
  assert.equal(events[1]?.type === "text_delta" ? events[1].delta : undefined, "Hel");
  const completed = events.at(-1);
  assert.equal(
    completed?.type === "completed" && completed.response.message.content[0]?.type === "text"
      ? completed.response.message.content[0].text
      : undefined,
    "Hello",
  );
  assert.equal(JSON.parse(transport.requests[0]?.body ?? "{}").stream, true);
});
