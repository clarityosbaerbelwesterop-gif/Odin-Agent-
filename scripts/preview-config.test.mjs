import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFreeKey,
  previewVariable,
  scope,
  validateInvocation,
} from "./configure-vercel-preview.mjs";

test("deployment workflow rejects foreign repositories, production and missing credentials", () => {
  const env = {
    GITHUB_REPOSITORY: scope.repository,
    GITHUB_REF: `refs/heads/${scope.gitBranch}`,
    GITHUB_SHA: "a".repeat(40),
    VERCEL_TOKEN: "synthetic-vercel",
    NEON_API_KEY: "synthetic-neon",
    NV_API_KEY: "synthetic-model",
  };
  assert.doesNotThrow(() => validateInvocation(env));
  for (const changes of [
    { GITHUB_REPOSITORY: "foreign/repository" },
    { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REF: "refs/pull/38/merge" },
    { GITHUB_SHA: "" },
    { VERCEL_TOKEN: "" },
    { NV_API_KEY: "synthetic\nheader" },
  ])
    assert.throws(() => validateInvocation({ ...env, ...changes }));
});

test("secret writes are narrow, sensitive and preview-branch scoped", () => {
  for (const key of ["ODIN_DATABASE_URL", "NEON_AUTH_BASE_URL", "NV_API_KEY"]) {
    assert.deepEqual(previewVariable(key, "synthetic-value"), {
      key,
      value: "synthetic-value",
      type: "sensitive",
      target: ["preview"],
      gitBranch: scope.gitBranch,
    });
  }
  assert.throws(() => previewVariable("VERCEL_TOKEN", "synthetic"));
  assert.throws(() => previewVariable("FREE_API_KEY", "synthetic"));
});

test("FreeLLM key classification never mistakes catalog licensing for inference quota", () => {
  assert.equal(classifyFreeKey(undefined), "NOT_CONFIGURED");
  assert.equal(classifyFreeKey("fla_synthetic"), "CATALOG_LICENSE_NOT_INFERENCE");
  assert.equal(classifyFreeKey("freellmapi-synthetic"), "ROUTER_KEY_ENDPOINT_REQUIRED");
  assert.equal(classifyFreeKey("synthetic-other"), "UNRECOGNIZED_PROVIDER_ENDPOINT_REQUIRED");
});
