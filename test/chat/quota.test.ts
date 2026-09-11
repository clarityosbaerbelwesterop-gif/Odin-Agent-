import assert from "node:assert/strict";
import test from "node:test";
import { computeUnitsForUsage, planQuota } from "../../src/chat/quota.js";

test("M10 defaults give each subscription tier a bounded server-side quota", () => {
  assert.deepEqual(planQuota("free", {}), {
    monthlyOcu: 1_000,
    dailyOcu: 100,
    maxConcurrentMissions: 1,
  });
  assert.deepEqual(planQuota("pro", {}), {
    monthlyOcu: 15_000,
    dailyOcu: 1_500,
    maxConcurrentMissions: 3,
  });
  assert.deepEqual(planQuota("developer", {}), {
    monthlyOcu: 45_000,
    dailyOcu: 4_500,
    maxConcurrentMissions: 5,
  });
  assert.deepEqual(planQuota("ultra", {}), {
    monthlyOcu: 150_000,
    dailyOcu: 15_000,
    maxConcurrentMissions: 10,
  });
});

test("M10 quota overrides are server-side and malformed values fall back", () => {
  const env = {
    ODIN_QUOTA_PRO_MONTHLY_OCU: "20000",
    ODIN_QUOTA_PRO_DAILY_OCU: "2000",
    ODIN_QUOTA_PRO_MAX_CONCURRENT_MISSIONS: "4",
  };
  assert.deepEqual(planQuota("pro", env), {
    monthlyOcu: 20_000,
    dailyOcu: 2_000,
    maxConcurrentMissions: 4,
  });
  assert.deepEqual(
    planQuota("free", {
      ODIN_QUOTA_FREE_MONTHLY_OCU: "-1",
      ODIN_QUOTA_FREE_DAILY_OCU: "not-a-number",
      ODIN_QUOTA_FREE_MAX_CONCURRENT_MISSIONS: "1.5",
    }),
    { monthlyOcu: 1_000, dailyOcu: 100, maxConcurrentMissions: 1 },
  );
});

test("M10 OCU weights charge stronger shared models more than the same token use", () => {
  const usage = { inputTokens: 1_000, outputTokens: 500 };
  assert.equal(computeUnitsForUsage("gpt-oss-20b", usage), 2);
  assert.equal(computeUnitsForUsage("gpt-oss-120b", usage), 5);
  assert.equal(computeUnitsForUsage("deepseek-v4-flash", usage), 4);
  assert.equal(computeUnitsForUsage("kimi", usage), 6);
  assert.equal(computeUnitsForUsage("mistral-medium-3-5", usage), 8);
  assert.equal(computeUnitsForUsage("deepseek-v4-pro", usage), 10);
});

test("frontier OpenRouter models receive explicit shared-compute weights", () => {
  const usage = { inputTokens: 1_000, outputTokens: 500 };
  assert.equal(computeUnitsForUsage("openrouter-gpt-5-6-luna", usage), 6);
  assert.equal(computeUnitsForUsage("openrouter-claude-fable-5-1", usage), 16);
  assert.equal(computeUnitsForUsage("openrouter-claude-opus-5", usage), 20);
});

test("M10 OCU accounting has a minimum charge and a conservative unknown-model fallback", () => {
  assert.equal(computeUnitsForUsage("gpt-oss-20b", { inputTokens: 0, outputTokens: 0 }), 1);
  assert.equal(computeUnitsForUsage("future-model", { inputTokens: 2_000, outputTokens: 500 }), 3);
});
