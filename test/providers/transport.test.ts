import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityRegistry,
  OpenAIProvider,
  ProviderError,
  validatedBaseUrl,
} from "../../src/providers/index.js";
import { basicRequest, capabilityProfile, MockTransport } from "./helpers.js";

function providerWith(transport: MockTransport, key = "super-secret-key") {
  return new OpenAIProvider({
    capabilities: new CapabilityRegistry([capabilityProfile("openai")]),
    credential: () => key,
    transport,
  });
}

test("HTTP rate limits preserve safe retry hints and redact credentials", async () => {
  const transport = new MockTransport(
    () =>
      new Response(
        JSON.stringify({ error: { code: "rate_limit", message: "Slow down", type: "rate_limit" } }),
        {
          headers: { "retry-after": "2", "x-request-id": "req-429" },
          status: 429,
        },
      ),
  );
  const provider = providerWith(transport);

  await assert.rejects(provider.generate(basicRequest()), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.category, "rate_limit");
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 2_000);
    assert.equal(error.requestId, "req-429");
    assert.equal(JSON.stringify(error).includes("super-secret-key"), false);
    return true;
  });
});

test("invalid JSON and oversized bodies are malformed responses", async (context) => {
  await context.test("invalid JSON", async () => {
    const provider = providerWith(
      new MockTransport(() => new Response("not-json", { status: 200 })),
    );
    await assert.rejects(provider.generate(basicRequest()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.category, "malformed_response");
      return true;
    });
  });

  await context.test("oversized body", async () => {
    const transport = new MockTransport(() => new Response("123456", { status: 200 }));
    const provider = new OpenAIProvider({
      capabilities: new CapabilityRegistry([capabilityProfile("openai")]),
      credential: () => "key",
      maxResponseBytes: 5,
      transport,
    });
    await assert.rejects(provider.generate(basicRequest()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /safety limit/);
      return true;
    });
  });
});

test("abort and network failures are distinct normalized errors", async (context) => {
  await context.test("caller abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = providerWith(
      new MockTransport(() => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await assert.rejects(
      provider.generate(basicRequest(), { signal: controller.signal }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.category, "aborted");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });

  await context.test("network", async () => {
    const provider = providerWith(
      new MockTransport(() => {
        throw new Error("socket closed with super-secret-key");
      }),
    );
    await assert.rejects(provider.generate(basicRequest()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.category, "network");
      assert.equal(error.message.includes("super-secret-key"), false);
      return true;
    });
  });

  await context.test("timeout", async () => {
    const provider = providerWith(
      new MockTransport(() => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    await assert.rejects(provider.generate(basicRequest()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.category, "timeout");
      assert.equal(error.retryable, true);
      return true;
    });
  });
});

test("context overflow responses receive a distinct non-retryable category", async () => {
  const provider = providerWith(
    new MockTransport(
      () =>
        new Response(
          JSON.stringify({ error: { code: "context_length_exceeded", message: "Too long" } }),
          { status: 400 },
        ),
    ),
  );
  await assert.rejects(provider.generate(basicRequest()), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.category, "context_overflow");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("base URL validation denies embedded credentials and insecure HTTP by default", () => {
  assert.throws(() => validatedBaseUrl("https://user:pass@example.com"), /credentials/);
  assert.throws(() => validatedBaseUrl("http://example.com"), /HTTPS/);
  assert.throws(() => validatedBaseUrl("https://127.0.0.1"), /private network/);
  assert.equal(validatedBaseUrl("http://localhost:9000", true, true).protocol, "http:");
});
