import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BENCHMARK_V2_DOMAIN_COUNTS,
  BENCHMARK_V2_DOMAINS,
  type BenchmarkV2Case,
  type BenchmarkV2Domain,
  createBenchmarkV2Case,
  createBenchmarkV2Suite,
  createFrontierArmResult,
  createFrontierBudgetProfile,
  createFrontierCase,
  createFrontierEvaluationProfile,
  createWeaknessDiagnostic,
  frontierTaskClassForBenchmarkV2Domain,
  mineBenchmarkWeaknesses,
  WeaknessMiningError,
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
    evidenceHash: sha("weakness-mining-profile-evidence"),
    kind: "evaluation",
    observedAt: "2026-09-04T00:00:00.000Z",
    reference: "weakness-mining-fixture",
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
  id: "weakness-mining-budget",
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
        hiddenAcceptanceHash: sha(`weakness-hidden:${index}`),
        id: `weakness-case-${String(index).padStart(3, "0")}`,
        publicInputHash: sha(`weakness-public:${index}`),
        suiteVersion: "weakness-suite-v1",
        taskClass: frontierTaskClassForBenchmarkV2Domain(domain),
      }),
    }),
  );
}

function result(
  current: BenchmarkV2Case,
  arm: "model_alone" | "odin",
  options: Partial<{
    outcomeClass: "SUCCESS" | "TASK_TERMINAL" | "INFRASTRUCTURE_AMBIGUOUS";
    failureCategory:
      | "none"
      | "quality"
      | "verification"
      | "budget"
      | "contract"
      | "timeout"
      | "network"
      | "authentication"
      | "rate_limit"
      | "unavailable"
      | "malformed_response"
      | "unknown";
    verification: "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE";
    qualityBps: number | null;
  }> = {},
) {
  const infrastructure = options.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS";
  const terminal = options.outcomeClass === "TASK_TERMINAL";
  return createFrontierArmResult({
    arm,
    attributable: !infrastructure,
    budgetHash: current.frontierCase.budget.budgetHash,
    caseHash: current.frontierCase.caseHash,
    completed: !infrastructure,
    failureCategory:
      options.failureCategory ?? (infrastructure ? "timeout" : terminal ? "quality" : "none"),
    harnessVersion: "weakness-harness-v1",
    inputTokens: arm === "odin" ? 900 : 1_000,
    latencyMs: arm === "odin" ? 900 : 1_000,
    model: profile.model,
    modelCalls: 1,
    outcomeClass: options.outcomeClass ?? "SUCCESS",
    outputTokens: arm === "odin" ? 450 : 500,
    profileVersion: profile.profileVersion,
    provider: profile.provider,
    qualityBps: options.qualityBps ?? (infrastructure ? null : arm === "odin" ? 8_000 : 7_000),
    reasoningEffort: profile.reasoningEffort,
    recoveries: 0,
    repairs: 0,
    toolCalls: 1,
    verification:
      options.verification ?? (infrastructure ? "INCOMPLETE" : terminal ? "FAIL" : "PASS"),
  });
}

function completeResults(cases: readonly BenchmarkV2Case[]) {
  return cases.flatMap((current) => [result(current, "model_alone"), result(current, "odin")]);
}

function benchmark(cases = benchmarkCases()) {
  return createBenchmarkV2Suite({
    cases,
    profile,
    suiteVersion: "weakness-suite-v1",
  });
}

test("known M16 run-5 patterns stay sanitized and map into stable weakness classes", () => {
  const cases = benchmarkCases();
  const currentBenchmark = benchmark(cases);
  const results = completeResults(cases);
  const codingCase = cases.find((current) => current.domain === "coding");
  assert.ok(codingCase !== undefined);
  const odinResult = results.find(
    (entry) => entry.caseHash === codingCase.frontierCase.caseHash && entry.arm === "odin",
  );
  assert.ok(odinResult !== undefined);

  const diagnostics = [
    createWeaknessDiagnostic({
      code: "repair_no_change",
      evidenceHash: sha("m16-run5-repair-no-change"),
      finishReason: null,
      resultHash: odinResult.resultHash,
    }),
    createWeaknessDiagnostic({
      code: "quality_failed_after_repair",
      evidenceHash: sha("m16-run5-quality-failed-after-repair"),
      finishReason: null,
      resultHash: odinResult.resultHash,
    }),
    createWeaknessDiagnostic({
      code: "structured_output_missing",
      evidenceHash: sha("m16-run5-structured-output-missing-length"),
      finishReason: "length",
      resultHash: odinResult.resultHash,
    }),
  ];

  const report = mineBenchmarkWeaknesses({
    benchmark: currentBenchmark,
    diagnostics,
    harnessVersion: "weakness-harness-v1",
    results,
  });
  assert.equal(report.comparablePairCount, 100);
  assert.equal(report.incompletePairCount, 0);
  assert.equal(report.infrastructureHeatmap.length, 0);
  assert.ok(
    report.attributableHeatmap.some(
      (entry) => entry.code === "repair_no_change" && entry.weaknessClass === "coding",
    ),
  );
  assert.ok(
    report.attributableHeatmap.some(
      (entry) =>
        entry.code === "quality_failed_after_repair" && entry.weaknessClass === "verification",
    ),
  );
  assert.ok(
    report.attributableHeatmap.some(
      (entry) => entry.code === "structured_output_missing" && entry.weaknessClass === "model",
    ),
  );
  assert.ok(!JSON.stringify(report).includes("finishReason"));
  assert.ok(!JSON.stringify(report).includes("m16-run5"));
});

test("unknown diagnostics remain unknown instead of being guessed into a favorable class", () => {
  const cases = benchmarkCases();
  const results = completeResults(cases);
  const target = results[0];
  assert.ok(target !== undefined);
  const report = mineBenchmarkWeaknesses({
    benchmark: benchmark(cases),
    diagnostics: [
      createWeaknessDiagnostic({
        code: "unknown",
        evidenceHash: sha("opaque-unknown-diagnostic"),
        finishReason: null,
        resultHash: target.resultHash,
      }),
    ],
    harnessVersion: "weakness-harness-v1",
    results,
  });
  const unknown = report.attributableHeatmap.find((entry) => entry.code === "unknown");
  assert.ok(unknown !== undefined);
  assert.equal(unknown.weaknessClass, "unknown");
  assert.equal(unknown.maxSeverity, 1);
});

test("infrastructure ambiguity remains separate from attributable weakness heatmaps", () => {
  const cases = benchmarkCases();
  const target = cases.find((current) => current.domain === "long_context");
  assert.ok(target !== undefined);
  const results = completeResults(cases).map((entry) =>
    entry.caseHash === target.frontierCase.caseHash && entry.arm === "odin"
      ? result(target, "odin", {
          failureCategory: "timeout",
          outcomeClass: "INFRASTRUCTURE_AMBIGUOUS",
          qualityBps: null,
          verification: "INCOMPLETE",
        })
      : entry,
  );
  const infrastructureResult = results.find(
    (entry) => entry.caseHash === target.frontierCase.caseHash && entry.arm === "odin",
  );
  assert.ok(infrastructureResult !== undefined);
  const report = mineBenchmarkWeaknesses({
    benchmark: benchmark(cases),
    diagnostics: [
      createWeaknessDiagnostic({
        code: "timeout",
        evidenceHash: sha("infrastructure-timeout"),
        finishReason: null,
        resultHash: infrastructureResult.resultHash,
      }),
    ],
    harnessVersion: "weakness-harness-v1",
    results,
  });
  assert.equal(report.comparablePairCount, 99);
  assert.equal(report.incompletePairCount, 1);
  assert.ok(report.infrastructureHeatmap.some((entry) => entry.code === "result_timeout"));
  assert.ok(report.infrastructureHeatmap.some((entry) => entry.code === "timeout"));
  assert.ok(
    !report.attributableHeatmap.some((entry) => entry.arm === "odin" && entry.code === "timeout"),
  );
  assert.ok(!report.pairedDeltas.some((entry) => entry.code === "timeout"));
});

test("paired deltas use only complete comparable arms and preserve incomplete-pair evidence", () => {
  const cases = benchmarkCases();
  const target = cases.find((current) => current.domain === "coding");
  assert.ok(target !== undefined);
  const second = cases.filter((current) => current.domain === "coding")[1];
  assert.ok(second !== undefined);
  const results = completeResults(cases)
    .filter((entry) => !(entry.caseHash === target.frontierCase.caseHash && entry.arm === "odin"))
    .map((entry) =>
      entry.caseHash === second.frontierCase.caseHash && entry.arm === "odin"
        ? result(second, "odin", {
            failureCategory: "quality",
            outcomeClass: "TASK_TERMINAL",
            qualityBps: 2_500,
            verification: "FAIL",
          })
        : entry,
    );
  const incompleteBaseline = results.find(
    (entry) => entry.caseHash === target.frontierCase.caseHash && entry.arm === "model_alone",
  );
  const failedOdin = results.find(
    (entry) => entry.caseHash === second.frontierCase.caseHash && entry.arm === "odin",
  );
  assert.ok(incompleteBaseline !== undefined);
  assert.ok(failedOdin !== undefined);
  const report = mineBenchmarkWeaknesses({
    benchmark: benchmark(cases),
    diagnostics: [
      createWeaknessDiagnostic({
        code: "repair_no_change",
        evidenceHash: sha("incomplete-arm-diagnostic"),
        finishReason: null,
        resultHash: incompleteBaseline.resultHash,
      }),
      createWeaknessDiagnostic({
        code: "repair_no_change",
        evidenceHash: sha("complete-arm-diagnostic"),
        finishReason: null,
        resultHash: failedOdin.resultHash,
      }),
    ],
    harnessVersion: "weakness-harness-v1",
    results,
  });
  assert.equal(report.comparablePairCount, 99);
  assert.equal(report.incompletePairCount, 1);
  const delta = report.pairedDeltas.find((entry) => entry.code === "repair_no_change");
  assert.ok(delta !== undefined);
  assert.equal(delta.baselineAffected, 0);
  assert.equal(delta.odinAffected, 1);
  assert.equal(delta.affectedDelta, 1);
});

test("heatmaps are deterministic and sorted by measured frequency before severity", () => {
  const cases = benchmarkCases();
  const results = completeResults(cases);
  const odinResults = results.filter((entry) => entry.arm === "odin");
  const first = odinResults[0];
  const second = odinResults[1];
  const third = odinResults[2];
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  const diagnostics = [
    createWeaknessDiagnostic({
      code: "repair_no_change",
      evidenceHash: sha("repair-one"),
      finishReason: null,
      resultHash: first.resultHash,
    }),
    createWeaknessDiagnostic({
      code: "repair_no_change",
      evidenceHash: sha("repair-two"),
      finishReason: null,
      resultHash: second.resultHash,
    }),
    createWeaknessDiagnostic({
      code: "verification_failed",
      evidenceHash: sha("verification-one"),
      finishReason: null,
      resultHash: third.resultHash,
    }),
  ];
  const input = {
    benchmark: benchmark(cases),
    diagnostics,
    harnessVersion: "weakness-harness-v1",
    results,
  } as const;
  const report = mineBenchmarkWeaknesses(input);
  const reversed = mineBenchmarkWeaknesses({
    ...input,
    diagnostics: [...diagnostics].reverse(),
    results: [...results].reverse(),
  });
  assert.deepEqual(reversed, report);
  const repairIndex = report.attributableHeatmap.findIndex(
    (entry) => entry.code === "repair_no_change",
  );
  const verificationIndex = report.attributableHeatmap.findIndex(
    (entry) => entry.code === "verification_failed",
  );
  assert.ok(repairIndex >= 0 && verificationIndex >= 0);
  assert.ok(repairIndex < verificationIndex);
});

test("tampering, duplicate diagnostics, and infrastructure relabeling fail closed", () => {
  const cases = benchmarkCases();
  const target = cases.find((current) => current.domain === "long_context");
  assert.ok(target !== undefined);
  const results = completeResults(cases).map((entry) =>
    entry.caseHash === target.frontierCase.caseHash && entry.arm === "odin"
      ? result(target, "odin", {
          failureCategory: "network",
          outcomeClass: "INFRASTRUCTURE_AMBIGUOUS",
          qualityBps: null,
          verification: "INCOMPLETE",
        })
      : entry,
  );
  const infrastructureResult = results.find(
    (entry) => entry.caseHash === target.frontierCase.caseHash && entry.arm === "odin",
  );
  assert.ok(infrastructureResult !== undefined);
  const diagnostic = createWeaknessDiagnostic({
    code: "network",
    evidenceHash: sha("network-diagnostic"),
    finishReason: null,
    resultHash: infrastructureResult.resultHash,
  });
  assert.throws(
    () =>
      mineBenchmarkWeaknesses({
        benchmark: benchmark(cases),
        diagnostics: [diagnostic, diagnostic],
        harnessVersion: "weakness-harness-v1",
        results,
      }),
    /Duplicate weakness diagnostic/u,
  );
  assert.throws(
    () =>
      mineBenchmarkWeaknesses({
        benchmark: benchmark(cases),
        diagnostics: [
          createWeaknessDiagnostic({
            code: "repair_no_change",
            evidenceHash: sha("bad-relabel"),
            finishReason: null,
            resultHash: infrastructureResult.resultHash,
          }),
        ],
        harnessVersion: "weakness-harness-v1",
        results,
      }),
    /cannot be relabeled/u,
  );
  assert.throws(
    () =>
      mineBenchmarkWeaknesses({
        benchmark: benchmark(cases),
        diagnostics: [{ ...diagnostic, diagnosticHash: sha("tampered") }],
        harnessVersion: "weakness-harness-v1",
        results,
      }),
    WeaknessMiningError,
  );
});
