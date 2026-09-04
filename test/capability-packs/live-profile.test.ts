import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveAbExecutionProfile,
  createLiveProviderCallCounter,
  M15_KIMI_CODING_AB_PROFILE,
} from "../../src/capability-packs/live-profile.js";

test("Kimi live A/B profile preserves measurable latency headroom", () => {
  assert.equal(M15_KIMI_CODING_AB_PROFILE.provider, "nvidia");
  assert.equal(M15_KIMI_CODING_AB_PROFILE.model, "moonshotai/kimi-k3");
  assert.equal(M15_KIMI_CODING_AB_PROFILE.profileVersion, "m15-kimi-coding-ab-v2");
  assert.equal(M15_KIMI_CODING_AB_PROFILE.reasoningEffort, "high");
  assert.equal(M15_KIMI_CODING_AB_PROFILE.acceptanceLatencyMs, 180_000);
  assert.equal(M15_KIMI_CODING_AB_PROFILE.providerTimeoutMs, 240_000);
  assert.ok(
    M15_KIMI_CODING_AB_PROFILE.providerTimeoutMs > M15_KIMI_CODING_AB_PROFILE.acceptanceLatencyMs,
  );
  assert.equal(Object.isFrozen(M15_KIMI_CODING_AB_PROFILE), true);
});

test("live profile rejects timeout equal to or too close to acceptance latency", () => {
  const base = {
    acceptanceLatencyMs: 180_000,
    maxCallsPerArmCase: 2,
    maxProviderCalls: 12,
    model: "moonshotai/kimi-k3",
    profileVersion: "test-profile",
    provider: "nvidia",
    reasoningEffort: "high" as const,
    temperature: 1,
  };

  assert.throws(
    () => createLiveAbExecutionProfile({ ...base, providerTimeoutMs: 180_000 }),
    TypeError,
  );
  assert.throws(
    () => createLiveAbExecutionProfile({ ...base, providerTimeoutMs: 209_999 }),
    TypeError,
  );
  assert.doesNotThrow(() => createLiveAbExecutionProfile({ ...base, providerTimeoutMs: 210_000 }));
});

test("live profile rejects unsafe ceilings and malformed identity", () => {
  const valid = {
    acceptanceLatencyMs: 180_000,
    maxCallsPerArmCase: 2,
    maxProviderCalls: 12,
    model: "moonshotai/kimi-k3",
    profileVersion: "test-profile",
    provider: "nvidia",
    providerTimeoutMs: 240_000,
    reasoningEffort: "high" as const,
    temperature: 1,
  };

  assert.throws(() => createLiveAbExecutionProfile({ ...valid, maxProviderCalls: 1 }), TypeError);
  assert.throws(
    () => createLiveAbExecutionProfile({ ...valid, providerTimeoutMs: 600_001 }),
    TypeError,
  );
  assert.throws(
    () => createLiveAbExecutionProfile({ ...valid, profileVersion: "bad profile" }),
    TypeError,
  );
  assert.throws(
    () => createLiveAbExecutionProfile({ ...valid, temperature: Number.NaN }),
    TypeError,
  );
});

test("live provider call counter charges every attempted call and blocks the next one", () => {
  const counter = createLiveProviderCallCounter(2);

  assert.equal(counter.limit, 2);
  assert.equal(counter.value, 0);
  assert.equal(counter.consume(), 1);
  assert.equal(counter.value, 1);
  assert.equal(counter.consume(), 2);
  assert.equal(counter.value, 2);
  assert.throws(() => counter.consume(), RangeError);
  assert.equal(counter.value, 2);
  assert.equal(Object.isFrozen(counter), true);
});

test("live provider call counter rejects malformed ceilings", () => {
  assert.throws(() => createLiveProviderCallCounter(0), TypeError);
  assert.throws(() => createLiveProviderCallCounter(-1), TypeError);
  assert.throws(() => createLiveProviderCallCounter(1.5), TypeError);
  assert.throws(() => createLiveProviderCallCounter(Number.MAX_SAFE_INTEGER + 1), TypeError);
});
