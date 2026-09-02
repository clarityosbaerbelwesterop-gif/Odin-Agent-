import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityRegistry,
  type ModelRequest,
  NvidiaProvider,
  OpenAICompatibleProvider,
  OpenRouterProvider,
  ProviderError,
} from "../../src/providers/index.js";
import {
  basicRequest,
  capabilityProfile,
  collectStream,
  jsonResponse,
  MockTransport,
  sseResponse,
} from "./helpers.js";

function chatResponse(providerModel = "test-model") {
  return {
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: { content: "Done", role: "assistant" },
      },
    ],
    id: "chat_1",
    model: providerModel,
    usage: {
      completion_tokens: 3,
      completion_tokens_details: { reasoning_tokens: 1 },
      prompt_tokens: 8,
      prompt_tokens_details: { cached_tokens: 2 },
      total_tokens: 11,
    },
  };
}

test("OpenRouter uses compatible chat mapping plus provider-specific headers and reasoning", async () => {
  const transport = new MockTransport(() =>
    jsonResponse(chatResponse(), { headers: { "x-generation-id": "gen-1" } }),
  );
  const provider = new OpenRouterProvider({
    appTitle: "Odin Agent",
    capabilities: new CapabilityRegistry([capabilityProfile("openrouter")]),
    credential: () => "router-key",
    httpReferer: "https://odin.invalid",
    transport,
  });
  const request: ModelRequest = {
    ...basicRequest(),
    reasoningEffort: "low",
    tools: [
      {
        description: "Read",
        inputSchema: { properties: {}, type: "object" },
        name: "read_file",
      },
    ],
  };

  const response = await provider.generate(request);
  const sent = transport.requests[0];
  const wire = JSON.parse(sent?.body ?? "{}") as Record<string, unknown>;
  assert.equal(sent?.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(sent?.headers["x-title"], "Odin Agent");
  assert.equal(sent?.headers["http-referer"], "https://odin.invalid");
  assert.deepEqual(wire.reasoning, { effort: "low" });
  assert.equal((wire.tools as Array<{ type: string }>)[0]?.type, "function");
  assert.equal(response.provider, "openrouter");
  assert.equal(response.requestId, "gen-1");
  assert.equal(response.usage.reasoningOutputTokens, 1);
});

test("OpenRouter ignores SSE comments and does not duplicate final usage chunks", async () => {
  const chunks = [
    ": OPENROUTER PROCESSING\n\n",
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Do" }, index: 0 }], id: "chat_s", model: "test-model" })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "ne" }, finish_reason: "stop", index: 0 }], id: "chat_s", model: "test-model" })}\n\n`,
    `data: ${JSON.stringify({ choices: [], id: "chat_s", model: "test-model", usage: { completion_tokens: 2, prompt_tokens: 4, total_tokens: 6 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const transport = new MockTransport(() => sseResponse(chunks));
  const provider = new OpenRouterProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("openrouter")]),
    credential: () => "key",
    transport,
  });

  const events = await collectStream(provider.stream(basicRequest()));
  assert.deepEqual(
    events.map((event) => event.type),
    ["response_start", "text_delta", "text_delta", "usage", "completed"],
  );
  const completed = events.at(-1);
  assert.equal(
    completed?.type === "completed" && completed.response.message.content[0]?.type === "text"
      ? completed.response.message.content[0].text
      : undefined,
    "Done",
  );
  assert.equal(
    completed?.type === "completed" ? completed.response.usage.totalTokens : undefined,
    6,
  );
});

test("NVIDIA NIM defaults to its compatible endpoint without inventing reasoning fields", async () => {
  const transport = new MockTransport(() => jsonResponse(chatResponse()));
  const provider = new NvidiaProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("nvidia")]),
    credential: () => "nvidia-key",
    transport,
  });
  const response = await provider.generate(basicRequest());
  assert.equal(transport.requests[0]?.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(response.provider, "nvidia");
  const content = response.message.content[0];
  assert.equal(content?.type === "text" ? content.text : undefined, "Done");
});

test("generic compatible reasoning requires an explicit wire mapping", async () => {
  const transport = new MockTransport(() => jsonResponse(chatResponse()));
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://models.example.com/v1",
    capabilities: new CapabilityRegistry([capabilityProfile("private-provider")]),
    credential: () => "key",
    providerId: "private-provider",
    transport,
  });
  await assert.rejects(
    provider.generate({ ...basicRequest(), reasoningEffort: "high" }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.category, "unsupported");
      return true;
    },
  );
  assert.equal(transport.requests.length, 0);
});
