import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createFrontierArmResult,
  createFrontierBudgetProfile,
  createFrontierCase,
  evaluateFrontierSuite,
  type FrontierArmResult,
  type FrontierCase,
  FrontierEvaluationError,
  type FrontierTaskClass,
  modelFacingFrontierCase,
} from "../../src/frontier-evals/index.js";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const budget = createFrontierBudgetProfile({
  id: "frontier-budget-v1",
  maxInputTokens: 20_000,
  maxLatencyMs: 120_000,
  maxModelCalls: 4,
  maxOutputTokens: 8_000,
  maxRecoveries: 2,
  maxRepairs: 2,
  maxToolCalls: 8,
});

const classes: readonly FrontierTaskClass[] = [
  "coding",
  "reasoning",
  "tool_use",
  "recovery",
  "long_mission",
];

function cases(count = 60): readonly FrontierCase[] {
  return Array.from({ length: count }, (_, index) =>
    createFrontierCase({
      budget,
      hiddenAcceptanceHash: sha(`hidden-acceptance:${index}`),
      id: `frontier-case-${String(index).padStart(3, "0")}`,
      publicInputHash: sha(`public-input:${index}`),
      suiteVersion: "frontier-suite-v1",
      taskClass: classes[index % classes.length] ?? "coding",
    }),
  );
}

function result(
  currentCase: FrontierCase,
  arm: "model_alone" | "odin",
  options: Partial<{
    completed: boolean;
    attributable: boolean;
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
    provider: string;
    model: string;
    profileVersion: string;
    budgetHash: string;
  }> = {},
): FrontierArmResult {
  const infrastructure = options.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS";
  return createFrontierArmResult({
    arm,
    attributable: options.attributable ?? !infrastructure,
    budgetHash: options.budgetHash ?? budget.budgetHash,
    caseHash: currentCase.caseHash,
    completed: options.completed ?? !infrastructure,
    failureCategory: options.failureCategory ?? (infrastructure ? "timeout" : "none"),
    harnessVersion: "frontier-harness-v1",
    inputTokens: arm === "odin" ? 900 : 1_000,
    latencyMs: arm === "odin" ? 900 : 1_000,
    model: options.model ?? "model-fixture",
    modelCalls: 1,
    outcomeClass: options.outcomeClass ?? "SUCCESS",
    outputTokens: arm === "odin" ? 450 : 500,
    profileVersion: options.profileVersion ?? "profile-v1",
    provider: options.provider ?? "provider-fixture",
    qualityBps: options.qualityBps ?? (infrastructure ? null : arm === "odin" ? 8_000 : 7_000),
    reasoningEffort: "high",
    recoveries: 0,
    repairs: 0,
    toolCalls: 1,
    verification: options.verification ?? (infrastructure ? "INCOMPLETE" : "PASS"),
  });
}

function completeResults(allCases: readonly FrontierCase[]): readonly FrontierArmResult[] {
  return allCases.flatMap((currentCase) => [
    result(currentCase, "model_alone"),
    result(currentCase, "odin"),
  ]);
}

test("60-case held-out fixture aggregates complete matched evidence deterministically", () => {
  const allCases = cases();
  const results = completeResults(allCases);
  const report = evaluateFrontierSuite({
    cases: allCases,
    harnessVersion: "frontier-harness-v1",
    results,
    suiteVersion: "frontier-suite-v1",
  });
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.caseCount, 60);
  assert.equal(report.matchedPairCount, 60);
  assert.equal(report.incompletePairCount, 0);
  assert.equal(report.metrics.baselineQualityBps, 7_000);
  assert.equal(report.metrics.odinQualityBps, 8_000);
  assert.equal(report.metrics.qualityLiftBps, 1_000);
  assert.ok((report.metrics.tokenDeltaBps ?? 0) < 0);
  assert.ok((report.metrics.latencyDeltaBps ?? 0) < 0);

  const reversed = evaluateFrontierSuite({
    cases: [...allCases].reverse(),
    harnessVersion: "frontier-harness-v1",
    results: [...results].reverse(),
    suiteVersion: "frontier-suite-v1",
  });
  assert.deepEqual(reversed, report);
});

test("model-facing case projection cannot expose hidden acceptance metadata", () => {
  const currentCase = cases(50)[0];
  assert.ok(currentCase !== undefined);
  const facing = modelFacingFrontierCase(currentCase);
  const serialized = JSON.stringify(facing);
  assert.ok(!serialized.includes("hiddenAcceptance"));
  assert.ok(!serialized.includes(currentCase.hiddenAcceptanceHash));
  assert.equal(facing.publicInputHash, currentCase.publicInputHash);
  assert.equal(facing.caseHash, currentCase.caseHash);
});

test("one infrastructure-ambiguous pair yields PARTIAL without numeric survivorship bias", () => {
  const allCases = cases(50);
  const results = completeResults(allCases).map((entry) => {
    const target = allCases[0];
    if (target !== undefined && entry.caseHash === target.caseHash && entry.arm === "odin") {
      return result(target, "odin", {
        attributable: false,
        completed: false,
        failureCategory: "timeout",
        outcomeClass: "INFRASTRUCTURE_AMBIGUOUS",
        qualityBps: null,
        verification: "INCOMPLETE",
      });
    }
    return entry;
  });
  const report = evaluateFrontierSuite({
    cases: allCases,
    harnessVersion: "frontier-harness-v1",
    results,
    suiteVersion: "frontier-suite-v1",
  });
  assert.equal(report.status, "PARTIAL");
  assert.equal(report.matchedPairCount, 49);
  assert.equal(report.incompletePairCount, 1);
  assert.equal(report.metrics.completePairs, 49);
});

test("zero complete pairs are INCONCLUSIVE with null aggregate quality and lift", () => {
  const allCases = cases(50);
  const results = allCases.flatMap((currentCase) => [
    result(currentCase, "model_alone", {
      attributable: false,
      completed: false,
      failureCategory: "network",
      outcomeClass: "INFRASTRUCTURE_AMBIGUOUS",
      qualityBps: null,
      verification: "INCOMPLETE",
    }),
    result(currentCase, "odin", {
      attributable: false,
      completed: false,
      failureCategory: "timeout",
      outcomeClass: "INFRASTRUCTURE_AMBIGUOUS",
      qualityBps: null,
      verification: "INCOMPLETE",
    }),
  ]);
  const report = evaluateFrontierSuite({
    cases: allCases,
    harnessVersion: "frontier-harness-v1",
    results,
    suiteVersion: "frontier-suite-v1",
  });
  assert.equal(report.status, "INCONCLUSIVE");
  assert.equal(report.matchedPairCount, 0);
  assert.equal(report.metrics.baselineQualityBps, null);
  assert.equal(report.metrics.odinQualityBps, null);
  assert.equal(report.metrics.qualityLiftBps, null);
  assert.equal(report.metrics.tokenDeltaBps, null);
});

test("deterministic terminal task failures remain complete negative measurements", () => {
  const allCases = cases(50);
  const first = allCases[0];
  assert.ok(first !== undefined);
  const results = completeResults(allCases).map((entry) => {
    if (entry.caseHash !== first.caseHash) return entry;
    return result(first, entry.arm, {
      failureCategory: "verification",
      outcomeClass: "TASK_TERMINAL",
      qualityBps: 0,
      verification: "FAIL",
    });
  });
  const report = evaluateFrontierSuite({
    cases: allCases,
    harnessVersion: "frontier-harness-v1",
    results,
    suiteVersion: "frontier-suite-v1",
  });
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.matchedPairCount, 50);
});

test("budget or model-profile asymmetry blocks matched comparison", () => {
  const allCases = cases(50);
  const first = allCases[0];
  assert.ok(first !== undefined);
  const asymmetricModel = completeResults(allCases).map((entry) =>
    entry.caseHash === first.caseHash && entry.arm === "odin"
      ? result(first, "odin", { model: "different-model" })
      : entry,
  );
  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: allCases,
        harnessVersion: "frontier-harness-v1",
        results: asymmetricModel,
        suiteVersion: "frontier-suite-v1",
      }),
    /same model profile, harness, and budget/u,
  );

  const forgedBudget = { ...budget, budgetHash: sha("different-budget") };
  const wrongBudgetResult = createFrontierArmResult({
    ...result(first, "odin"),
    budgetHash: forgedBudget.budgetHash,
  });
  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: allCases,
        harnessVersion: "frontier-harness-v1",
        results: [
          result(first, "model_alone"),
          wrongBudgetResult,
          ...completeResults(allCases.slice(1)),
        ],
        suiteVersion: "frontier-suite-v1",
      }),
    /budget does not match/u,
  );
});

test("tampered result identity, duplicate arms, and foreign cases fail closed", () => {
  const allCases = cases(50);
  const first = allCases[0];
  assert.ok(first !== undefined);
  const valid = result(first, "model_alone");
  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: allCases,
        harnessVersion: "frontier-harness-v1",
        results: [{ ...valid, qualityBps: 9_999 }],
        suiteVersion: "frontier-suite-v1",
      }),
    /result hash/u,
  );

  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: allCases,
        harnessVersion: "frontier-harness-v1",
        results: [valid, valid],
        suiteVersion: "frontier-suite-v1",
      }),
    /Duplicate frontier result hash/u,
  );

  const foreignCase = createFrontierCase({
    budget,
    hiddenAcceptanceHash: sha("foreign-hidden"),
    id: "foreign-case",
    publicInputHash: sha("foreign-input"),
    suiteVersion: "frontier-suite-v1",
    taskClass: "coding",
  });
  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: allCases,
        harnessVersion: "frontier-harness-v1",
        results: [result(foreignCase, "model_alone")],
        suiteVersion: "frontier-suite-v1",
      }),
    /foreign case/u,
  );
});

test("suite and outcome bounds reject malformed benchmark evidence", () => {
  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: cases(49),
        harnessVersion: "frontier-harness-v1",
        results: [],
        suiteVersion: "frontier-suite-v1",
      }),
    /between 50 and 200/u,
  );
  const currentCase = cases(50)[0];
  assert.ok(currentCase !== undefined);
  assert.throws(
    () =>
      createFrontierArmResult({
        ...result(currentCase, "odin"),
        attributable: false,
        completed: false,
        failureCategory: "timeout",
        outcomeClass: "INFRASTRUCTURE_AMBIGUOUS",
        qualityBps: 1,
        verification: "INCOMPLETE",
      }),
    FrontierEvaluationError,
  );
});
