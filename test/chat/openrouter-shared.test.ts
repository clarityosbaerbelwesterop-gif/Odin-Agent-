import assert from "node:assert/strict";
import test from "node:test";
import {
  createSharedNvidiaModels,
  createSharedOpenRouterModels,
  OPENROUTER_SHARED_MODEL_DEFINITIONS,
  sharedOpenRouterCredential,
} from "../../src/chat/server-models.js";

test("OpenRouter shared capacity accepts the canonical or repository alias secret", () => {
  assert.equal(sharedOpenRouterCredential({ OPENROUTER_API_KEY: "canonical" }), "canonical");
  assert.equal(sharedOpenRouterCredential({ UNOROUTER_API_KEY: "repo-alias" }), "repo-alias");
  assert.equal(
    sharedOpenRouterCredential({
      OPENROUTER_API_KEY: "canonical",
      UNOROUTER_API_KEY: "repo-alias",
    }),
    "canonical",
  );
  assert.equal(sharedOpenRouterCredential({ UNOROUTER_API_KEY: "bad\nkey" }), undefined);
});

test("shared OpenRouter catalog exposes only the curated frontier lane", () => {
  assert.deepEqual(
    OPENROUTER_SHARED_MODEL_DEFINITIONS.map(({ id, model, plan }) => [id, model, plan]),
    [
      ["openrouter-gpt-5-6-luna", "openai/gpt-5.6-luna", "pro"],
      ["openrouter-claude-fable-5-1", "anthropic/claude-fable-5.1", "developer"],
      ["openrouter-claude-opus-5", "anthropic/claude-opus-5", "ultra"],
    ],
  );
});

test("UNOROUTER repository secret creates quota-metered OpenRouter models", () => {
  const models = createSharedOpenRouterModels({
    UNOROUTER_API_KEY: "repo-secret",
    ODIN_PUBLIC_ORIGIN: "https://odin-agent-xi.vercel.app",
  });
  assert.equal(models.length, 3);
  assert(models.every((model) => model.provider.id === "openrouter"));
  assert(models.every((model) => model.sharedCapacity === true));
  assert.equal(models.find((model) => model.id === "openrouter-gpt-5-6-luna")?.plan, "pro");
  assert.equal(
    models.find((model) => model.id === "openrouter-claude-fable-5-1")?.plan,
    "developer",
  );
  assert.equal(models.find((model) => model.id === "openrouter-claude-opus-5")?.plan, "ultra");
});

test("hosted catalog keeps NVIDIA defaults first and appends OpenRouter when configured", () => {
  const models = createSharedNvidiaModels({
    VERCEL_ENV: "production",
    ODIN_NVIDIA_PRODUCTION_AUTHORIZED: "true",
    NVIDIA_PRODUCTION_API_KEY: "nvidia-prod",
    UNOROUTER_API_KEY: "openrouter-prod",
  });
  assert.equal(models.length, 9);
  assert.equal(models[0]?.id, "gpt-oss-20b");
  assert.deepEqual(
    models.slice(-3).map((model) => model.id),
    ["openrouter-gpt-5-6-luna", "openrouter-claude-fable-5-1", "openrouter-claude-opus-5"],
  );
});
