import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BENCHMARK_V2_DOMAIN_COUNTS,
  BENCHMARK_V2_DOMAINS,
  type BenchmarkV2Case,
  type BenchmarkV2Domain,
  BenchmarkV2Error,
  createBenchmarkV2Case,
  createBenchmarkV2Suite,
  createFrontierArmResult,
  createFrontierBudgetProfile,
  createFrontierCase,
  createFrontierEvaluationProfile,
  evaluateBenchmarkV2,
  frontierTaskClassForBenchmarkV2Domain,
  modelFacingBenchmarkV2Case,
} from "../../src/frontier-evals/index.js";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const profile = createFrontierEvaluationProfile({
  contextWindowTokens: 1_048_576,
  imageInput: true,
  maxOutputTokens: 65_536,
  model: "moonshotai/kimi-k3",
  profileVersion: "nvidia-build-2026-09-04",
  provider: "nvidia",
  provenance: {
    evidenceHash: sha("benchmark-v2-kimi-capability-evidence"),
    kind: "evaluation",
    observedAt: "2026-09-04T00:00:00.000Z",
    reference: "benchmark-v2-fixture",
  },
  reasoningEffort: "max",
  reasoningEfforts: ["low", "high", "max"],
  streaming: true,
  strictStructuredOutput: true,
  structuredOutput: true,
  textInput: true,
  toolUse: true,
});

const budget = createFrontierBudgetProfile({
  id: "benchmark-v2-budget",
  maxInputTokens: 20_000,
  maxLatencyMs: 120_000,
  maxModelCalls: 4,
  maxOutputTokens: 8_000,
  maxRecoveries: 2,
  maxRepairs: 2,
  maxToolCalls: 12,
});

function domainSequence(): readonly BenchmarkV2Domain[] {
  return BENCHMARK_V2_DOMAINS.flatMap((domain) =>
    Array.from({ length: BENCHMARK_V2_DOMAIN_COUNTS[domain] }, () => domain),
  );
}

function benchmarkCases(): readonly BenchmarkV2Case[] {
  return domainSequence().map((domain, index) =>
    createBenchmarkV2Case({
      domain,
      frontierCase: createFrontierCase({
        budget,
        hiddenAcceptanceHash: sha(`benchmark-v2-hidden:${index}`),
        id: `benchmark-v2-case-${String(index).padStart(3, "0")}`,
        publicInputHash: sha(`benchmark-v2-public:${index}`),
        suiteVersion: "benchmark-v2-suite-v1",
        taskClass: frontierTaskClassForBenchmarkV2Domain(domain),
      }),
    }),
  );
}

function result(
  current: BenchmarkV2Case,
  arm: "model_alone" | "odin",
  infrastructure = false,
  model = profile.model,
) {
  return createFrontierArmResult({
    arm,
    attributable: !infrastructure,
    budgetHash: current.frontierCase.budget.budgetHash,
    caseHash: current.frontierCase.caseHash,
    completed: !infrastructure,
    failureCategory: infrastructure ? "timeout" : "none",
    harnessVersion: "benchmark-v2-harness-v1",
    inputTokens: arm === "odin" ? 900 : 1_000,
    latencyMs: arm === "odin" ? 900 : 1_000,
    model,
    modelCalls: 1,
    outcomeClass: infrastructure ? "INFRASTRUCTURE_AMBIGUOUS" : "SUCCESS",
    outputTokens: arm === "odin" ? 450 : 500,
    profileVersion: profile.profileVersion,
    provider: profile.provider,
    qualityBps: infrastructure ? null : arm === "odin" ? 8_000 : 7_000,
    reasoningEffort: profile.reasoningEffort,
    recoveries: 0,
    repairs: 0,
    toolCalls: 1,
    verification: infrastructure ? "INCOMPLETE" : "PASS",
  });
}

function completeResults(cases: readonly BenchmarkV2Case[]) {
  return cases.flatMap((current) => [result(current, "model_alone"), result(current, "odin")]);
}

test("locked 100-case blueprint spans all eight domains and reports each domain separately", () => {
  const cases = benchmarkCases();
  const benchmark = createBenchmarkV2Suite({
    cases,
    profile,
    suiteVersion: "benchmark-v2-suite-v1",
  });
  const report = evaluateBenchmarkV2({
    benchmark,
    harnessVersion: "benchmark-v2-harness-v1",
    results: completeResults(cases),
  });

  assert.equal(benchmark.cases.length, 100);
  assert.equal(report.frontierReport.status, "COMPLETE");
  assert.equal(report.frontierReport.matchedPairCount, 100);
  assert.equal(report.domains.length, 8);
  for (const summary of report.domains) {
    assert.equal(summary.caseCount, BENCHMARK_V2_DOMAIN_COUNTS[summary.domain]);
    assert.equal(summary.completePairs, summary.caseCount);
    assert.equal(summary.incompletePairs, 0);
    assert.equal(summary.infrastructurePairs, 0);
    assert.equal(summary.status, "COMPLETE");
    assert.equal(summary.baselineQualityBps, 7_000);
    assert.equal(summary.odinQualityBps, 8_000);
    assert.equal(summary.qualityLiftBps, 1_000);
  }

  const reversed = createBenchmarkV2Suite({
    cases: [...cases].reverse(),
    profile,
    suiteVersion: "benchmark-v2-suite-v1",
  });
  assert.equal(reversed.benchmarkHash, benchmark.benchmarkHash);
});

test("model-facing Benchmark v2 projection keeps hidden acceptance metadata unavailable", () => {
  const current = benchmarkCases()[0];
  assert.ok(current !== undefined);
  const facing = modelFacingBenchmarkV2Case(current);
  const serialized = JSON.stringify(facing);
  assert.equal(facing.domain, "coding");
  assert.ok(!serialized.includes("hiddenAcceptance"));
  assert.ok(!serialized.includes(current.frontierCase.hiddenAcceptanceHash));
  assert.equal(facing.frontierCase.caseHash, current.frontierCase.caseHash);
});

test("domain mix and profile budget envelope fail closed before benchmark evaluation", () => {
  const cases = [...benchmarkCases()];
  const mathIndex = cases.findIndex((current) => current.domain === "math");
  assert.notEqual(mathIndex, -1);
  cases[mathIndex] = createBenchmarkV2Case({
    domain: "coding",
    frontierCase: createFrontierCase({
      budget,
      hiddenAcceptanceHash: sha("wrong-mix-hidden"),
      id: "benchmark-v2-wrong-mix",
      publicInputHash: sha("wrong-mix-public"),
      suiteVersion: "benchmark-v2-suite-v1",
      taskClass: "coding",
    }),
  });
  assert.throws(
    () => createBenchmarkV2Suite({ cases, profile, suiteVersion: "benchmark-v2-suite-v1" }),
    /domain mix/u,
  );

  const overBudget = createFrontierBudgetProfile({
    id: "benchmark-v2-over-profile",
    maxInputTokens: 20_000,
    maxLatencyMs: 120_000,
    maxModelCalls: 4,
    maxOutputTokens: 70_000,
    maxRecoveries: 2,
    maxRepairs: 2,
    maxToolCalls: 12,
  });
  const bounded = [...benchmarkCases()];
  const first = bounded[0];
  assert.ok(first !== undefined);
  bounded[0] = createBenchmarkV2Case({
    domain: first.domain,
    frontierCase: createFrontierCase({
      budget: overBudget,
      hiddenAcceptanceHash: sha("over-budget-hidden"),
      id: "benchmark-v2-over-budget",
      publicInputHash: sha("over-budget-public"),
      suiteVersion: "benchmark-v2-suite-v1",
      taskClass: frontierTaskClassForBenchmarkV2Domain(first.domain),
    }),
  });
  assert.throws(
    () => createBenchmarkV2Suite({ cases: bounded, profile, suiteVersion: "benchmark-v2-suite-v1" }),
    /output budget exceeds/u,
  );
});

test("one long-context infrastructure ambiguity remains separate from numeric domain evidence", () => {
  const cases = benchmarkCases();
  const benchmark = createBenchmarkV2Suite({
    cases,
    profile,
    suiteVersion: "benchmark-v2-suite-v1",
  });
  const target = cases.find((current) => current.domain === "long_context");
  assert.ok(target !== undefined);
  const results = completeResults(cases).map((entry) =>
    entry.caseHash === target.frontierCase.caseHash && entry.arm === "odin"
      ? result(target, "odin", true)
      : entry,
  );
  const report = evaluateBenchmarkV2({
    benchmark,
    harnessVersion: "benchmark-v2-harness-v1",
    results,
  });
  assert.equal(report.frontierReport.status, "PARTIAL");
  assert.equal(report.frontierReport.matchedPairCount, 99);
  const longContext = report.domains.find((summary) => summary.domain === "long_context");
  assert.ok(longContext !== undefined);
  assert.equal(longContext.status, "PARTIAL");
  assert.equal(longContext.completePairs, 4);
  assert.equal(longContext.incompletePairs, 1);
  assert.equal(longContext.infrastructurePairs, 1);
  assert.equal(longContext.qualityLiftBps, 1_000);
  const math = report.domains.find((summary) => summary.domain === "math");
  assert.ok(math !== undefined);
  assert.equal(math.status, "COMPLETE");
});

test("matched arms cannot escape the exact Phase A evaluation profile", () => {
  const cases = benchmarkCases();
  const benchmark = createBenchmarkV2Suite({
    cases,
    profile,
    suiteVersion: "benchmark-v2-suite-v1",
  });
  const first = cases[0];
  assert.ok(first !== undefined);
  const results = completeResults(cases).map((entry) =>
    entry.caseHash === first.frontierCase.caseHash
      ? result(first, entry.arm, false, "different-model")
      : entry,
  );
  assert.throws(
    () =>
      evaluateBenchmarkV2({
        benchmark,
        harnessVersion: "benchmark-v2-harness-v1",
        results,
      }),
    BenchmarkV2Error,
  );
});
