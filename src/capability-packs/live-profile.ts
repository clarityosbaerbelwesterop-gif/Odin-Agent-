export type LiveReasoningEffort = "low" | "high" | "max";

export interface LiveAbExecutionProfileInput {
  readonly acceptanceLatencyMs: number;
  readonly maxCallsPerArmCase: number;
  readonly maxProviderCalls: number;
  readonly model: string;
  readonly profileVersion: string;
  readonly provider: string;
  readonly providerTimeoutMs: number;
  readonly reasoningEffort: LiveReasoningEffort;
  readonly temperature: number;
}

export type LiveAbExecutionProfile = Readonly<LiveAbExecutionProfileInput>;

export interface LiveProviderCallCounter {
  readonly limit: number;
  readonly value: number;
  consume(): number;
}

const MAX_LIVE_TIMEOUT_MS = 600_000;
const MIN_MEASUREMENT_HEADROOM_MS = 30_000;

export function createLiveAbExecutionProfile(
  input: LiveAbExecutionProfileInput,
): LiveAbExecutionProfile {
  assertBoundedId(input.provider, "provider");
  assertBoundedId(input.model, "model");
  assertBoundedId(input.profileVersion, "profileVersion");
  assertPositiveSafeInteger(input.acceptanceLatencyMs, "acceptanceLatencyMs");
  assertPositiveSafeInteger(input.providerTimeoutMs, "providerTimeoutMs");
  assertPositiveSafeInteger(input.maxCallsPerArmCase, "maxCallsPerArmCase");
  assertPositiveSafeInteger(input.maxProviderCalls, "maxProviderCalls");

  if (input.providerTimeoutMs > MAX_LIVE_TIMEOUT_MS) {
    throw new TypeError("providerTimeoutMs exceeds the bounded live-measurement ceiling.");
  }
  if (input.providerTimeoutMs - input.acceptanceLatencyMs < MIN_MEASUREMENT_HEADROOM_MS) {
    throw new TypeError(
      "providerTimeoutMs must leave measurement headroom beyond the acceptance latency ceiling.",
    );
  }
  if (input.maxProviderCalls < input.maxCallsPerArmCase) {
    throw new TypeError("maxProviderCalls cannot be lower than maxCallsPerArmCase.");
  }
  if (!new Set<LiveReasoningEffort>(["low", "high", "max"]).has(input.reasoningEffort)) {
    throw new TypeError("reasoningEffort is unsupported.");
  }
  if (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) {
    throw new TypeError("temperature must be a finite number from 0 to 2.");
  }

  return Object.freeze({ ...input });
}

export function createLiveProviderCallCounter(limit: number): LiveProviderCallCounter {
  assertPositiveSafeInteger(limit, "providerCallLimit");
  let value = 0;
  return Object.freeze({
    limit,
    get value() {
      return value;
    },
    consume() {
      if (value >= limit) {
        throw new RangeError("Live provider call ceiling exceeded.");
      }
      value += 1;
      return value;
    },
  });
}

export const M15_KIMI_CODING_AB_PROFILE = createLiveAbExecutionProfile({
  acceptanceLatencyMs: 180_000,
  maxCallsPerArmCase: 2,
  maxProviderCalls: 12,
  model: "moonshotai/kimi-k3",
  profileVersion: "m15-kimi-coding-ab-v2",
  provider: "nvidia",
  providerTimeoutMs: 240_000,
  reasoningEffort: "high",
  temperature: 1,
});

function assertBoundedId(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value)) {
    throw new TypeError(`${field} must be a bounded stable identifier.`);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer.`);
  }
}
