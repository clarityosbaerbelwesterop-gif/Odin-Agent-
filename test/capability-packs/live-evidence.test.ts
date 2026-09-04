import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLiveFailure,
  summarizeLiveComparisons,
} from "../../src/capability-packs/live-evidence.js";
import { BudgetExceededError, MissionDomainError } from "../../src/mission/runtime.js";
import { ProviderError } from "../../src/providers/errors.js";
import { CodingVerificationGateError } from "../../src/runtime/coding.js";

function arm(measurementComplete: boolean, qualityBps: number) {
  return { measurementComplete, qualityBps };
}

test("complete live pairs produce a measured summary", () => {
  const summary = summarizeLiveComparisons([
    { baseline: arm(true, 7000), candidate: arm(true, 9000) },
    { baseline: arm(true, 8000), candidate: arm(true, 8500) },
  ]);

  assert.deepEqual(summary, {
    averageLiftBps: 1250,
    baselineQualityBps: 7500,
    candidateQualityBps: 8750,
    cases: 2,
    completePairs: 2,
    incompletePairs: 0,
    status: "MEASURED",
    totalLiftBps: 2500,
  });
});

test("partial live evidence scores only complete matched pairs", () => {
  const summary = summarizeLiveComparisons([
    { baseline: arm(true, 8000), candidate: arm(true, 9000) },
    { baseline: arm(false, 0), candidate: arm(true, 9500) },
  ]);

  assert.deepEqual(summary, {
    averageLiftBps: 1000,
    baselineQualityBps: 8000,
    candidateQualityBps: 9000,
    cases: 2,
    completePairs: 1,
    incompletePairs: 1,
    status: "PARTIAL",
    totalLiftBps: 1000,
  });
});

test("zero complete pairs are inconclusive rather than a false zero-lift result", () => {
  const summary = summarizeLiveComparisons([
    { baseline: arm(false, 0), candidate: arm(false, 0) },
    { baseline: arm(false, 0), candidate: arm(false, 0) },
    { baseline: arm(false, 0), candidate: arm(false, 0) },
  ]);

  assert.deepEqual(summary, {
    averageLiftBps: null,
    baselineQualityBps: null,
    candidateQualityBps: null,
    cases: 3,
    completePairs: 0,
    incompletePairs: 3,
    status: "INCONCLUSIVE",
    totalLiftBps: null,
  });
});

test("live summary rejects empty malformed and out-of-range quality input", () => {
  assert.throws(
    () => summarizeLiveComparisons([{ baseline: arm(true, -1), candidate: arm(true, 5000) }]),
    TypeError,
  );
  assert.throws(
    () => summarizeLiveComparisons([{ baseline: arm(true, 5000), candidate: arm(true, 10_001) }]),
    TypeError,
  );
  assert.throws(
    () =>
      summarizeLiveComparisons([
        {
          baseline: { measurementComplete: "yes" as unknown as boolean, qualityBps: 5000 },
          candidate: arm(true, 5000),
        },
      ]),
    TypeError,
  );
  assert.throws(() => summarizeLiveComparisons([]), TypeError);
});

test("real provider and mission errors map to bounded diagnostics without raw messages", () => {
  const provider = new ProviderError({
    category: "rate_limit",
    message: "secret-bearing upstream text must not persist",
    provider: "fixture",
    retryable: true,
  });
  const mission = new MissionDomainError(
    "Model plan expectedSha does not match discovered repository state.",
  );
  const unknownMission = new MissionDomainError("opaque domain detail");

  assert.deepEqual(classifyLiveFailure(provider), {
    errorClass: "ProviderError",
    errorCode: "provider_rate_limit",
  });
  assert.deepEqual(classifyLiveFailure(mission), {
    errorClass: "MissionDomainError",
    errorCode: "plan_expected_sha_mismatch",
  });
  assert.deepEqual(classifyLiveFailure(unknownMission), {
    errorClass: "MissionDomainError",
    errorCode: "mission_domain_unknown",
  });
  assert.equal(JSON.stringify(classifyLiveFailure(provider)).includes("secret-bearing"), false);
});

test("budget verification and non-error failures have stable categories", () => {
  assert.deepEqual(classifyLiveFailure(new BudgetExceededError("inputTokens")), {
    errorClass: "BudgetExceededError",
    errorCode: "budget_inputTokens",
  });
  assert.deepEqual(classifyLiveFailure(new CodingVerificationGateError("private detail", null)), {
    errorClass: "CodingVerificationGateError",
    errorCode: "verification_gate_denied",
  });
  assert.deepEqual(classifyLiveFailure({ reason: "not an Error" }), {
    errorClass: "UnknownError",
    errorCode: "unknown_error",
  });
});

test("unknown categories and malformed error classes fail into bounded buckets", () => {
  const provider = new ProviderError({
    category: "unknown",
    message: "irrelevant",
    provider: "fixture",
    retryable: false,
  });
  Object.defineProperty(provider, "category", { value: "future_category" });
  const budget = new BudgetExceededError("attempts");
  Object.defineProperty(budget, "dimension", { value: "future_dimension" });
  const malformed = Object.assign(new Error("irrelevant"), {
    name: "bad class with spaces and control\n",
  });

  assert.deepEqual(classifyLiveFailure(provider), {
    errorClass: "ProviderError",
    errorCode: "provider_unknown",
  });
  assert.deepEqual(classifyLiveFailure(budget), {
    errorClass: "BudgetExceededError",
    errorCode: "budget_unknown",
  });
  assert.deepEqual(classifyLiveFailure(malformed), {
    errorClass: "Error",
    errorCode: "unclassified_error",
  });
});
