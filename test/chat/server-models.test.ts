import assert from "node:assert/strict";
import test from "node:test";
import {
  createSharedNvidiaModels,
  NVIDIA_SHARED_MODEL_DEFINITIONS,
  sharedNvidiaCredential,
} from "../../src/chat/server-models.js";

test("shared NVIDIA catalog is ordered across the four Odin plans", () => {
  assert.deepEqual(
    NVIDIA_SHARED_MODEL_DEFINITIONS.map(({ id, plan }) => [id, plan]),
    [
      ["gpt-oss-20b", "free"],
      ["gpt-oss-120b", "pro"],
      ["deepseek-v4-flash", "developer"],
      ["kimi", "developer"],
      ["deepseek-v4-pro", "ultra"],
      ["mistral-medium-3-5", "ultra"],
    ],
  );
  assert.equal(new Set(NVIDIA_SHARED_MODEL_DEFINITIONS.map((model) => model.id)).size, 6);
  assert.equal(new Set(NVIDIA_SHARED_MODEL_DEFINITIONS.map((model) => model.model)).size, 6);
});

test("production never consumes legacy NVIDIA Developer Program/API Catalog keys", () => {
  const legacyOnly = {
    VERCEL_ENV: "production",
    NV_API_KEY: "legacy-primary",
    NV_API_KEY_2: "legacy-secondary",
    ODIN_NVIDIA_PRODUCTION_AUTHORIZED: "true",
  };
  assert.equal(sharedNvidiaCredential(legacyOnly, "primary"), "");
  assert.equal(sharedNvidiaCredential(legacyOnly, "secondary"), "");
  assert.deepEqual(createSharedNvidiaModels(legacyOnly), []);
});

test("production shared models require explicit authorization and production credential names", () => {
  const key = "prod-primary";
  assert.deepEqual(
    createSharedNvidiaModels({
      VERCEL_ENV: "production",
      NVIDIA_PRODUCTION_API_KEY: key,
    }),
    [],
  );

  const models = createSharedNvidiaModels({
    VERCEL_ENV: "production",
    ODIN_NVIDIA_PRODUCTION_AUTHORIZED: "true",
    NVIDIA_PRODUCTION_API_KEY: key,
    NVIDIA_PRODUCTION_API_KEY_2: "prod-secondary",
  });
  assert.equal(models.length, NVIDIA_SHARED_MODEL_DEFINITIONS.length);
  assert.deepEqual(
    models.map(({ id, plan }) => [id, plan]),
    NVIDIA_SHARED_MODEL_DEFINITIONS.map(({ id, plan }) => [id, plan]),
  );
});

test("non-production preview may use existing bounded evaluation credentials", () => {
  const models = createSharedNvidiaModels({
    VERCEL_ENV: "preview",
    NV_API_KEY: "preview-primary",
    NV_API_KEY_2: "preview-secondary",
  });
  assert.equal(models.length, 6);
  assert.equal(models.find((model) => model.id === "kimi")?.plan, "developer");
  assert.equal(models.find((model) => model.id === "deepseek-v4-pro")?.plan, "ultra");
});

test("documented model capability ceilings stay conservative", () => {
  const models = createSharedNvidiaModels({
    VERCEL_ENV: "preview",
    NV_API_KEY: "preview-primary",
  });
  const byId = new Map(models.map((model) => [model.id, model]));
  assert.equal(
    byId.get("gpt-oss-20b")?.provider.capabilities("openai/gpt-oss-20b").capabilities
      .maxOutputTokens,
    4096,
  );
  assert.equal(
    byId.get("kimi")?.provider.capabilities("moonshotai/kimi-k3").capabilities.contextWindowTokens,
    1048576,
  );
  assert.equal(
    byId.get("deepseek-v4-pro")?.provider.capabilities("deepseek-ai/deepseek-v4-pro-0813")
      .capabilities.maxOutputTokens,
    16384,
  );
  assert.deepEqual(
    byId.get("mistral-medium-3-5")?.provider.capabilities("mistralai/mistral-medium-3.5-128b")
      .capabilities.reasoningEfforts,
    ["high"],
  );
});
