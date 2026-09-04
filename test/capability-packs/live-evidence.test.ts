import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLiveFailure,
  summarizeLiveComparisons,
} from "../../src/capability-packs/live-evidence.js";

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

test("live summary rejects malformed quality input", () => {
  assert.throws(
    () => summarizeLiveComparisons([{ baseline: arm(true, -1), candidate: arm(true, 5000) }]),
    TypeError,
  );
  assert.throws(() => summarizeLiveComparisons([]), TypeError);
});

test("failure diagnostics expose bounded categories without raw messages", () => {
  const provider = Object.assign(new Error("secret-bearing upstream text must not persist"), {
    category: "rate_limit",
    name: "ProviderError",
  });
  const mission = Object.assign(
    new Error("Model plan expectedSha does not match discovered repository state."),
    { name: "MissionDomainError" },
  );
  const unknownMission = Object.assign(new Error("opaque domain detail"), {
    name: "MissionDomainError",
  });

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

test("budget and malformed error classes normalize safely", () => {
  const budget = Object.assign(new Error("irrelevant"), {
    dimension: "inputTokens",
    name: "BudgetExceededError",
  });
  const malformed = Object.assign(new Error("irrelevant"), {
    name: "bad class with spaces and control\n",
  });

  assert.deepEqual(classifyLiveFailure(budget), {
    errorClass: "BudgetExceededError",
    errorCode: "budget_inputTokens",
  });
  assert.deepEqual(classifyLiveFailure(malformed), {
    errorClass: "Error",
    errorCode: "unclassified_error",
  });
});
