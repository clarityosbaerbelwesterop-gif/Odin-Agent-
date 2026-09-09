import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFreeKey,
  previewVariable,
  scope,
  validateInvocation,
} from "./configure-vercel-preview.mjs";
import { temporaryDeploymentShare } from "./preview-access.mjs";

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

test("hosted smoke reuses only a short-lived share belonging to the pinned deployment", () => {
  const now = 1800000000000;
  const entries = {
    "synthetic-short-share": { scope: "shareable-link", expires: now + 3600000 },
    "synthetic-longer-share": { scope: "shareable-link", expires: now + 82800000 },
  };
  assert.deepEqual(temporaryDeploymentShare(entries, now), {
    secret: "synthetic-short-share",
    expires: now + 3600000,
  });
  for (const entry of [
    { scope: "automation-bypass", expires: now + 3600000 },
    { scope: "user", access: "granted", expires: now + 3600000 },
    { scope: "alias-protection-override", expires: now + 3600000 },
    { scope: "shareable-link" },
    { scope: "shareable-link", expires: now - 1 },
    { scope: "shareable-link", expires: now + 300000 },
    { scope: "shareable-link", expires: now + 86400001 },
    { scope: "shareable-link", expires: "tomorrow" },
  ])
    assert.equal(temporaryDeploymentShare({ "synthetic-share": entry }, now), undefined);
  assert.equal(temporaryDeploymentShare(undefined, now), undefined);
  assert.equal(temporaryDeploymentShare(entries, Number.NaN), undefined);
  assert.equal(
    temporaryDeploymentShare({ "synthetic\nheader": entries["synthetic-short-share"] }, now),
    undefined,
  );
});
