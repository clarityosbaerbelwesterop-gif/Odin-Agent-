import assert from "node:assert/strict";
import test from "node:test";
import {
  createSharedNvidiaModels,
  createSharedUnoRouterModels,
  sharedUnoRouterCredential,
  UNOROUTER_SHARED_MODEL_DEFINITIONS,
} from "../../src/chat/server-models.js";

test("UnoRouter shared capacity accepts the canonical or repository alias secret", () => {
  assert.equal(sharedUnoRouterCredential({ UNOROUTER_API_KEY: "canonical" }), "canonical");
  assert.equal(sharedUnoRouterCredential({ UNOROUTER_API_KEY: "repo-alias" }), "repo-alias");
  assert.equal(sharedUnoRouterCredential({ UNOROUTER_API_KEY: "bad\nkey" }), undefined);
});

test("shared UnoRouter catalog exposes only the curated frontier lane", () => {
  assert.deepEqual(
    UNOROUTER_SHARED_MODEL_DEFINITIONS.map(({ id, model, plan }) => [id, model, plan]),
    [
      ["unorouter-gpt-5-6-luna", "gpt-5.6-luna", "pro"],
      ["unorouter-claude-fable-5-1", "claude-fable-5.1", "developer"],
      ["unorouter-claude-opus-5", "claude-opus-5", "ultra"],
    ],
  );
});

test("UNOROUTER repository secret creates quota-metered UnoRouter models", () => {
  const models = createSharedUnoRouterModels({
    UNOROUTER_API_KEY: "repo-secret",
    ODIN_PUBLIC_ORIGIN: "https://odin-agent-xi.vercel.app",
  });
  assert.equal(models.length, 3);
  assert(models.every((model) => model.provider.id === "unorouter"));
  assert(models.every((model) => model.sharedCapacity === true));
  assert.equal(models.find((model) => model.id === "unorouter-gpt-5-6-luna")?.plan, "pro");
  assert.equal(
    models.find((model) => model.id === "unorouter-claude-fable-5-1")?.plan,
    "developer",
  );
  assert.equal(models.find((model) => model.id === "unorouter-claude-opus-5")?.plan, "ultra");
});

test("hosted catalog keeps NVIDIA defaults first and appends UnoRouter when configured", () => {
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
    ["unorouter-gpt-5-6-luna", "unorouter-claude-fable-5-1", "unorouter-claude-opus-5"],
  );
});
