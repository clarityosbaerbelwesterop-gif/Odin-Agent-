import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertFrontierBudgetFitsProfile,
  createFrontierBudgetProfile,
  createFrontierEvaluationProfile,
  FrontierProfileError,
  validateFrontierEvaluationProfile,
} from "../../src/frontier-evals/index.js";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function kimiProfileInput(reasoningEfforts: readonly string[] = ["low", "high", "max"]) {
  return {
    contextWindowTokens: 1_048_576,
    imageInput: true,
    maxOutputTokens: 65_536,
    model: "moonshotai/kimi-k3",
    profileVersion: "nvidia-build-2026-09-04",
    provider: "nvidia",
    provenance: {
      evidenceHash: sha("nvidia-kimi-k3-provider-capability-profile"),
      kind: "provider" as const,
      observedAt: "2026-09-04T00:00:00.000Z",
      reference: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer",
    },
    reasoningEffort: "max",
    reasoningEfforts,
    streaming: true,
    strictStructuredOutput: true,
    structuredOutput: true,
    textInput: true,
    toolUse: true,
  };
}

function kimiProfile(reasoningEfforts: readonly string[] = ["low", "high", "max"]) {
  return createFrontierEvaluationProfile(kimiProfileInput(reasoningEfforts));
}

test("evaluation profile binds Kimi capability envelope without model-name inference", () => {
  const profile = kimiProfile();
  assert.equal(profile.provider, "nvidia");
  assert.equal(profile.model, "moonshotai/kimi-k3");
  assert.equal(profile.reasoningEffort, "max");
  assert.deepEqual(profile.reasoningEfforts, ["high", "low", "max"]);
  assert.match(profile.profileHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(validateFrontierEvaluationProfile(profile), profile);

  const reordered = kimiProfile(["max", "low", "high"]);
  assert.equal(reordered.profileHash, profile.profileHash);

  const arbitraryName = createFrontierEvaluationProfile({
    ...kimiProfileInput(),
    model: "model-fixture",
  });
  assert.equal(arbitraryName.contextWindowTokens, profile.contextWindowTokens);
  assert.notEqual(arbitraryName.profileHash, profile.profileHash);
});

test("unsupported reasoning effort and contradictory structured-output declarations fail closed", () => {
  assert.throws(
    () => createFrontierEvaluationProfile({ ...kimiProfileInput(), reasoningEffort: "ultra" }),
    /reasoning effort is not supported/u,
  );
  assert.throws(
    () =>
      createFrontierEvaluationProfile({
        ...kimiProfileInput(),
        strictStructuredOutput: true,
        structuredOutput: false,
      }),
    /Strict structured output/u,
  );
});

test("benchmark budgets cannot exceed exact profile output or context limits", () => {
  const profile = kimiProfile();
  const valid = createFrontierBudgetProfile({
    id: "kimi-eval-budget",
    maxInputTokens: 20_000,
    maxLatencyMs: 240_000,
    maxModelCalls: 4,
    maxOutputTokens: 10_000,
    maxRecoveries: 1,
    maxRepairs: 2,
    maxToolCalls: 20,
  });
  assert.doesNotThrow(() => assertFrontierBudgetFitsProfile(profile, valid));

  const tooMuchOutput = createFrontierBudgetProfile({
    ...valid,
    id: "too-much-output",
    maxOutputTokens: 70_000,
  });
  assert.throws(
    () => assertFrontierBudgetFitsProfile(profile, tooMuchOutput),
    /output budget exceeds/u,
  );

  const smallContext = createFrontierEvaluationProfile({
    ...kimiProfileInput(),
    contextWindowTokens: 25_000,
    maxOutputTokens: 10_000,
  });
  assert.throws(() => assertFrontierBudgetFitsProfile(smallContext, valid), /context window/u);
});

test("tampered profile hashes, duplicate efforts, and malformed provenance are rejected", () => {
  const profile = kimiProfile();
  assert.throws(
    () =>
      assertFrontierBudgetFitsProfile(
        { ...profile, profileHash: sha("tampered") },
        createFrontierBudgetProfile({
          id: "tiny",
          maxInputTokens: 100,
          maxLatencyMs: 1_000,
          maxModelCalls: 1,
          maxOutputTokens: 100,
          maxRecoveries: 0,
          maxRepairs: 0,
          maxToolCalls: 0,
        }),
      ),
    /hash does not match/u,
  );
  assert.throws(() => kimiProfile(["high", "high"]), /duplicates/u);
  assert.throws(
    () =>
      createFrontierEvaluationProfile({
        ...kimiProfileInput(),
        provenance: { ...kimiProfileInput().provenance, evidenceHash: "not-a-hash" },
      }),
    /evidence hash/u,
  );
  assert.throws(
    () => validateFrontierEvaluationProfile({ ...profile, profileHash: "not-a-hash" }),
    FrontierProfileError,
  );
});
