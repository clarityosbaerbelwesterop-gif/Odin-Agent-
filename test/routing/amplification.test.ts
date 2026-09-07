import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { WeaknessHeatmapEntry, WeaknessMiningReport } from "../../src/frontier-evals/index.js";
import {
  createReasoningAmplificationPlan,
  type ReasoningAmplificationRequest,
} from "../../src/routing/index.js";
import type { ReasoningPlan } from "../../src/routing/types.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reasoningPlan(overrides: Partial<Omit<ReasoningPlan, "planHash">> = {}): ReasoningPlan {
  const body = {
    branchCount: 4,
    branches: [
      { id: "branch-1", kind: "direct" as const },
      { id: "branch-2", kind: "alternative" as const },
      { id: "branch-3", kind: "adversarial" as const },
      { id: "branch-4", kind: "decomposition" as const },
    ],
    critiquePasses: 2,
    estimatedTokensPerCall: 1_000,
    maxEstimatedTokens: 8_000,
    maxModelCalls: 8,
    parallelism: 4,
    repairAttempts: 2,
    ...overrides,
  };
  return Object.freeze({ ...body, planHash: hashJson(body) });
}

function weakness(
  weaknessClass: WeaknessHeatmapEntry["weaknessClass"],
  code: string,
  severityPoints = 5,
): WeaknessHeatmapEntry {
  return Object.freeze({
    affectedResults: 1,
    arm: "odin" as const,
    code,
    maxSeverity: 5,
    severityPoints,
    weaknessClass,
  }) as WeaknessHeatmapEntry;
}

function report(
  options: {
    attributable?: readonly WeaknessHeatmapEntry[];
    infrastructure?: readonly WeaknessHeatmapEntry[];
    comparablePairCount?: number;
    profileHash?: string;
  } = {},
): WeaknessMiningReport {
  const body = {
    attributableHeatmap: Object.freeze([...(options.attributable ?? [])]),
    benchmarkHash: sha("benchmark-d"),
    comparablePairCount: options.comparablePairCount ?? 3,
    diagnosticHashes: Object.freeze([] as string[]),
    harnessVersion: "benchmark-v2-harness-v1",
    incompletePairCount: 0,
    infrastructureHeatmap: Object.freeze([...(options.infrastructure ?? [])]),
    pairedDeltas: Object.freeze([]),
    profileHash: options.profileHash ?? sha("profile-d"),
    suiteVersion: "benchmark-v2-suite-v1",
  } as const;
  return Object.freeze({ ...body, reportHash: hashJson(body) }) as WeaknessMiningReport;
}

function request(
  weaknessReport: WeaknessMiningReport,
  overrides: Partial<ReasoningAmplificationRequest> = {},
): ReasoningAmplificationRequest {
  return {
    baseReasoning: reasoningPlan(),
    complexityBps: 8_000,
    domain: "math",
    expectedBenchmarkHash: weaknessReport.benchmarkHash,
    expectedProfileHash: weaknessReport.profileHash,
    maxContextTokens: 20_000,
    risk: "high",
    weaknessReport,
    ...overrides,
  };
}

test("Phase D maps attributable weaknesses into deterministic bounded strategies", () => {
  const weaknessReport = report({
    attributable: [
      weakness("reasoning", "reasoning_incomplete", 8),
      weakness("coding", "repair_no_change", 5),
      weakness("verification", "quality_failed_after_repair", 9),
    ],
  });
  const first = createReasoningAmplificationPlan(request(weaknessReport));
  const second = createReasoningAmplificationPlan(request(weaknessReport));

  assert.deepEqual(first, second);
  assert.deepEqual(first.strategies, [
    "direct",
    "decompose",
    "constraint_solve",
    "counterexample_search",
    "numeric_consistency",
    "independent_critique",
    "targeted_repair",
  ]);
  assert.ok(first.branchCount <= 4);
  assert.ok(first.critiquePasses <= 2);
  assert.ok(first.repairAttempts <= 2);
  assert.ok(first.maxModelCalls <= 8);
  assert.equal(first.maxEstimatedTokens, 8_000);
  assert.equal(first.requiresIndependentVerification, true);
});

test("unknown and infrastructure evidence never masquerade as attributable amplification", () => {
  const weaknessReport = report({
    attributable: [weakness("unknown", "unknown", 1)],
    comparablePairCount: 0,
    infrastructure: [weakness("infrastructure", "timeout", 2)],
  });
  const plan = createReasoningAmplificationPlan(
    request(weaknessReport, {
      complexityBps: 1_000,
      domain: "coding",
      risk: "low",
    }),
  );

  assert.deepEqual(plan.strategies, ["direct"]);
  assert.deepEqual(plan.reasonCodes, ["conservative_default"]);
  assert.equal(plan.requiresIndependentVerification, false);
  assert.equal(plan.maxModelCalls, 1);
});

test("profile binding and report integrity fail closed", () => {
  const foreign = report({ profileHash: sha("foreign-profile") });
  assert.throws(
    () =>
      createReasoningAmplificationPlan(
        request(foreign, {
          expectedProfileHash: sha("profile-d"),
        }),
      ),
    /profile binding/u,
  );

  const valid = report({ attributable: [weakness("model", "output_truncated", 4)] });
  const tampered = { ...valid, comparablePairCount: valid.comparablePairCount + 1 };
  assert.throws(
    () => createReasoningAmplificationPlan(request(tampered as WeaknessMiningReport)),
    /report hash/u,
  );
});

test("base reasoning budget tampering cannot enlarge amplification ceilings", () => {
  const weaknessReport = report({
    attributable: [
      weakness("model", "structured_output_missing", 6),
      weakness("verification", "verification_failed", 8),
    ],
  });
  const constrained = reasoningPlan({
    branchCount: 1,
    branches: [{ id: "branch-1", kind: "direct" }],
    critiquePasses: 0,
    maxModelCalls: 1,
    parallelism: 1,
    repairAttempts: 0,
  });
  const plan = createReasoningAmplificationPlan(
    request(weaknessReport, { baseReasoning: constrained, domain: "coding", risk: "critical" }),
  );
  assert.equal(plan.branchCount, 1);
  assert.equal(plan.critiquePasses, 0);
  assert.equal(plan.repairAttempts, 0);
  assert.equal(plan.maxModelCalls, 1);
  assert.ok(plan.strategies.includes("strict_output"));
  assert.ok(plan.strategies.includes("targeted_repair"));

  const altered = { ...constrained, maxModelCalls: 5 } as ReasoningPlan;
  assert.throws(
    () => createReasoningAmplificationPlan(request(weaknessReport, { baseReasoning: altered })),
    /plan hash/u,
  );
});

test("context weakness reduces slice ceiling while math adds numeric consistency", () => {
  const weaknessReport = report({
    attributable: [weakness("context", "long_context_missed_evidence", 7)],
  });
  const plan = createReasoningAmplificationPlan(
    request(weaknessReport, { domain: "long_context", maxContextTokens: 10_000, risk: "medium" }),
  );
  assert.equal(plan.contextTokenCeiling, 6_000);
  assert.ok(plan.strategies.includes("retrieve_context"));

  const mathPlan = createReasoningAmplificationPlan(
    request(report(), { domain: "math", complexityBps: 2_000, risk: "low" }),
  );
  assert.ok(mathPlan.strategies.includes("numeric_consistency"));
  assert.ok(mathPlan.strategies.includes("constraint_solve"));
});
