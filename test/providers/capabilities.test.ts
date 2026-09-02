import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry, OpenAIProvider, ProviderError } from "../../src/providers/index.js";
import { basicRequest, capabilityProfile, MockTransport } from "./helpers.js";

test("capability registry preserves provenance, ordering, and immutable snapshots", () => {
  const registry = new CapabilityRegistry([
    capabilityProfile("openai", "z-model"),
    capabilityProfile("anthropic", "a-model"),
  ]);

  const overridden = registry.override(
    "openai",
    "z-model",
    { streaming: false },
    {
      kind: "user_override",
      observedAt: "2026-09-02T01:00:00.000Z",
      reference: "mission setting",
    },
    "override-v1",
  );

  assert.equal(overridden.capabilities.streaming, false);
  assert.equal(overridden.provenance.kind, "user_override");
  assert.deepEqual(
    registry.list().map(({ provider, model }) => `${provider}/${model}`),
    ["anthropic/a-model", "openai/z-model"],
  );
  assert.equal(Object.isFrozen(overridden), true);
  assert.equal(Object.isFrozen(overridden.capabilities.reasoningEfforts), true);
});

test("unsupported capability fails before credential resolution or transport", async () => {
  const registry = new CapabilityRegistry([
    capabilityProfile("openai", "test-model", { imageInput: false }),
  ]);
  let credentialCalls = 0;
  const transport = new MockTransport(() => {
    throw new Error("transport must not run");
  });
  const provider = new OpenAIProvider({
    capabilities: registry,
    credential: () => {
      credentialCalls += 1;
      return "secret";
    },
    transport,
  });
  const request = {
    ...basicRequest(),
    messages: [
      {
        content: [{ type: "image_url" as const, url: "https://example.com/image.png" }],
        role: "user" as const,
      },
    ],
  };

  await assert.rejects(provider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.category, "unsupported");
    return true;
  });
  assert.equal(credentialCalls, 0);
  assert.equal(transport.requests.length, 0);
});

test("missing capability profile fails closed", () => {
  const registry = new CapabilityRegistry();
  assert.throws(() => registry.resolve("openai", "unknown"), ProviderError);
});

test("capability profiles can be loaded from validated external configuration", () => {
  const profile = capabilityProfile("openai", "configured-model", {
    contextWindowTokens: 100_000,
  });
  const configured = {
    ...profile,
    pricing: {
      cachedInputPerMillionTokens: 0.25,
      currency: "USD",
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 4,
    },
    routing: {
      codingScore: 0.8,
      costClass: "medium",
      latencyClass: "low",
      reasoningScore: 0.7,
    },
  };
  const registry = CapabilityRegistry.fromConfig(JSON.parse(JSON.stringify([configured])));
  assert.equal(
    registry.resolve("openai", "configured-model").capabilities.contextWindowTokens,
    100_000,
  );
  assert.equal(registry.resolve("openai", "configured-model").pricing?.currency, "USD");
  assert.equal(registry.resolve("openai", "configured-model").routing?.codingScore, 0.8);
  assert.throws(
    () =>
      CapabilityRegistry.fromConfig([
        {
          ...profile,
          capabilities: { ...profile.capabilities, streaming: "yes" },
        },
      ]),
    /streaming must be boolean/,
  );
});

test("strict structured output requires explicit model support and a strict root schema", async () => {
  const transport = new MockTransport(() => {
    throw new Error("transport must not run");
  });
  const provider = new OpenAIProvider({
    capabilities: new CapabilityRegistry([
      capabilityProfile("openai", "test-model", { strictStructuredOutput: false }),
    ]),
    credential: () => "key",
    transport,
  });
  const request = {
    ...basicRequest(),
    responseFormat: {
      name: "result",
      schema: {
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        type: "object",
      },
      type: "json_schema" as const,
    },
  };
  await assert.rejects(provider.generate(request), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.category, "unsupported");
    return true;
  });
  assert.equal(transport.requests.length, 0);
});

test("invalid strict schemas are rejected before credentials are read", async () => {
  let credentialCalls = 0;
  const transport = new MockTransport(() => {
    throw new Error("transport must not run");
  });
  const provider = new OpenAIProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("openai")]),
    credential: () => {
      credentialCalls += 1;
      return "key";
    },
    transport,
  });
  await assert.rejects(
    provider.generate({
      ...basicRequest(),
      tools: [
        {
          description: "Unsafe strict schema",
          inputSchema: { properties: { path: { type: "string" } }, type: "object" },
          name: "read_file",
          strict: true,
        },
      ],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.category, "invalid_request");
      return true;
    },
  );
  assert.equal(credentialCalls, 0);
  assert.equal(transport.requests.length, 0);
});
