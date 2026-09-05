import { createHash } from "node:crypto";
import {
  type FrontierAggregateMetrics,
  type FrontierArmResult,
  type FrontierArmResultInput,
  type FrontierBudgetProfile,
  type FrontierCase,
  type FrontierCaseInput,
  FrontierEvaluationError,
  type FrontierEvaluationReport,
  type FrontierFailureCategory,
  type FrontierModelFacingCase,
  type FrontierOutcomeClass,
  type FrontierTaskClass,
  type FrontierVerification,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const TASK_CLASSES = new Set<FrontierTaskClass>([
  "coding",
  "reasoning",
  "tool_use",
  "recovery",
  "long_mission",
]);
const OUTCOME_CLASSES = new Set<FrontierOutcomeClass>([
  "SUCCESS",
  "TASK_TERMINAL",
  "INFRASTRUCTURE_AMBIGUOUS",
]);
const VERIFICATIONS = new Set<FrontierVerification>(["PASS", "FAIL", "BLOCKED", "INCOMPLETE"]);
const FAILURE_CATEGORIES = new Set<FrontierFailureCategory>([
  "none",
  "quality",
  "verification",
  "budget",
  "contract",
  "timeout",
  "network",
  "authentication",
  "rate_limit",
  "unavailable",
  "malformed_response",
  "unknown",
]);
const INFRASTRUCTURE_FAILURES = new Set<FrontierFailureCategory>([
  "timeout",
  "network",
  "authentication",
  "rate_limit",
  "unavailable",
  "malformed_response",
  "unknown",
]);

export function createFrontierBudgetProfile(
  value: Omit<FrontierBudgetProfile, "budgetHash">,
): FrontierBudgetProfile {
  exactKeys(value, [
    "id",
    "maxModelCalls",
    "maxInputTokens",
    "maxOutputTokens",
    "maxLatencyMs",
    "maxToolCalls",
    "maxRepairs",
    "maxRecoveries",
  ]);
  const body = {
    id: identifier(value.id, "budget id"),
    maxInputTokens: boundedInteger(value.maxInputTokens, "maxInputTokens", 1, 10_000_000),
    maxLatencyMs: boundedInteger(value.maxLatencyMs, "maxLatencyMs", 1, 3_600_000),
    maxModelCalls: boundedInteger(value.maxModelCalls, "maxModelCalls", 1, 1_000),
    maxOutputTokens: boundedInteger(value.maxOutputTokens, "maxOutputTokens", 1, 10_000_000),
    maxRecoveries: boundedInteger(value.maxRecoveries, "maxRecoveries", 0, 1_000),
    maxRepairs: boundedInteger(value.maxRepairs, "maxRepairs", 0, 1_000),
    maxToolCalls: boundedInteger(value.maxToolCalls, "maxToolCalls", 0, 10_000),
  };
  return Object.freeze({ ...body, budgetHash: hashJson(body) });
}

export function createFrontierCase(value: FrontierCaseInput): FrontierCase {
  exactKeys(value, [
    "id",
    "suiteVersion",
    "taskClass",
    "publicInputHash",
    "hiddenAcceptanceHash",
    "budget",
  ]);
  const budget = normalizeBudget(value.budget);
  if (!TASK_CLASSES.has(value.taskClass)) {
    throw new FrontierEvaluationError("Frontier task class is unsupported.");
  }
  const body = {
    budget,
    hiddenAcceptanceHash: sha256(value.hiddenAcceptanceHash, "hiddenAcceptanceHash"),
    id: identifier(value.id, "case id"),
    publicInputHash: sha256(value.publicInputHash, "publicInputHash"),
    suiteVersion: identifier(value.suiteVersion, "suiteVersion"),
    taskClass: value.taskClass,
  };
  return Object.freeze({ ...body, caseHash: hashJson(caseIdentity(body)) });
}

export function modelFacingFrontierCase(value: FrontierCase): FrontierModelFacingCase {
  const normalized = normalizeCase(value);
  return Object.freeze({
    budget: normalized.budget,
    caseHash: normalized.caseHash,
    id: normalized.id,
    publicInputHash: normalized.publicInputHash,
    suiteVersion: normalized.suiteVersion,
    taskClass: normalized.taskClass,
  });
}

export function createFrontierArmResult(value: FrontierArmResultInput): FrontierArmResult {
  const normalized = normalizeResultInput(value);
  return Object.freeze({ ...normalized, resultHash: hashJson(normalized) });
}

export function evaluateFrontierSuite(input: {
  readonly suiteVersion: string;
  readonly harnessVersion: string;
  readonly cases: readonly FrontierCase[];
  readonly results: readonly FrontierArmResult[];
}): FrontierEvaluationReport {
  exactKeys(input, ["suiteVersion", "harnessVersion", "cases", "results"]);
  const suiteVersion = identifier(input.suiteVersion, "suiteVersion");
  const harnessVersion = identifier(input.harnessVersion, "harnessVersion");
  if (!Array.isArray(input.cases) || input.cases.length < 50 || input.cases.length > 200) {
    throw new FrontierEvaluationError("Frontier suite must contain between 50 and 200 cases.");
  }
  if (!Array.isArray(input.results) || input.results.length > 400) {
    throw new FrontierEvaluationError("Frontier result collection exceeds its bound.");
  }

  const cases = input.cases
    .map(normalizeCase)
    .sort((left, right) => left.caseHash.localeCompare(right.caseHash));
  const byCase = new Map<string, FrontierCase>();
  const caseIds = new Set<string>();
  for (const current of cases) {
    if (current.suiteVersion !== suiteVersion) {
      throw new FrontierEvaluationError("Frontier case belongs to a different suite version.");
    }
    if (byCase.has(current.caseHash) || caseIds.has(current.id)) {
      throw new FrontierEvaluationError("Frontier suite contains duplicate case identity.");
    }
    byCase.set(current.caseHash, current);
    caseIds.add(current.id);
  }

  const results = input.results
    .map(normalizeResult)
    .sort((left, right) => left.resultHash.localeCompare(right.resultHash));
  const pairMap = new Map<string, Partial<Record<"model_alone" | "odin", FrontierArmResult>>>();
  const seenResultHashes = new Set<string>();
  for (const result of results) {
    const currentCase = byCase.get(result.caseHash);
    if (currentCase === undefined) {
      throw new FrontierEvaluationError("Frontier result references a foreign case.");
    }
    if (result.harnessVersion !== harnessVersion) {
      throw new FrontierEvaluationError(
        "Frontier result harness version does not match suite execution.",
      );
    }
    if (result.budgetHash !== currentCase.budget.budgetHash) {
      throw new FrontierEvaluationError("Frontier result budget does not match its case budget.");
    }
    assertWithinBudget(result, currentCase.budget);
    if (seenResultHashes.has(result.resultHash)) {
      throw new FrontierEvaluationError(
        "Duplicate frontier result hash is not valid pair evidence.",
      );
    }
    seenResultHashes.add(result.resultHash);
    const pair = pairMap.get(result.caseHash) ?? {};
    if (pair[result.arm] !== undefined) {
      throw new FrontierEvaluationError("Frontier case has duplicate results for one arm.");
    }
    pair[result.arm] = result;
    pairMap.set(result.caseHash, pair);
  }

  const completePairs: Array<{ baseline: FrontierArmResult; odin: FrontierArmResult }> = [];
  let incompletePairCount = 0;
  for (const currentCase of cases) {
    const pair = pairMap.get(currentCase.caseHash);
    const baseline = pair?.model_alone;
    const odin = pair?.odin;
    if (baseline === undefined || odin === undefined) {
      incompletePairCount += 1;
      continue;
    }
    assertMatchedIdentity(baseline, odin);
    if (isMeasurable(baseline) && isMeasurable(odin)) {
      completePairs.push({ baseline, odin });
    } else {
      incompletePairCount += 1;
    }
  }

  const status =
    completePairs.length === 0
      ? ("INCONCLUSIVE" as const)
      : completePairs.length === cases.length
        ? ("COMPLETE" as const)
        : ("PARTIAL" as const);
  const metrics = aggregate(completePairs);
  const caseHashes = Object.freeze(cases.map((current) => current.caseHash));
  const resultHashes = Object.freeze(results.map((result) => result.resultHash));
  const body = {
    caseCount: cases.length,
    caseHashes,
    harnessVersion,
    incompletePairCount,
    matchedPairCount: completePairs.length,
    metrics,
    resultHashes,
    status,
    suiteVersion,
  };
  return Object.freeze({ ...body, reportHash: hashJson(body) });
}

function normalizeBudget(value: FrontierBudgetProfile): FrontierBudgetProfile {
  exactKeys(value, [
    "id",
    "maxModelCalls",
    "maxInputTokens",
    "maxOutputTokens",
    "maxLatencyMs",
    "maxToolCalls",
    "maxRepairs",
    "maxRecoveries",
    "budgetHash",
  ]);
  const rebuilt = createFrontierBudgetProfile({
    id: value.id,
    maxInputTokens: value.maxInputTokens,
    maxLatencyMs: value.maxLatencyMs,
    maxModelCalls: value.maxModelCalls,
    maxOutputTokens: value.maxOutputTokens,
    maxRecoveries: value.maxRecoveries,
    maxRepairs: value.maxRepairs,
    maxToolCalls: value.maxToolCalls,
  });
  if (value.budgetHash !== rebuilt.budgetHash) {
    throw new FrontierEvaluationError("Frontier budget hash does not match its limits.");
  }
  return rebuilt;
}

function normalizeCase(value: FrontierCase): FrontierCase {
  exactKeys(value, [
    "id",
    "suiteVersion",
    "taskClass",
    "publicInputHash",
    "hiddenAcceptanceHash",
    "budget",
    "caseHash",
  ]);
  const rebuilt = createFrontierCase({
    budget: value.budget,
    hiddenAcceptanceHash: value.hiddenAcceptanceHash,
    id: value.id,
    publicInputHash: value.publicInputHash,
    suiteVersion: value.suiteVersion,
    taskClass: value.taskClass,
  });
  if (value.caseHash !== rebuilt.caseHash) {
    throw new FrontierEvaluationError("Frontier case hash does not match its definition.");
  }
  return rebuilt;
}

function normalizeResult(value: FrontierArmResult): FrontierArmResult {
  exactKeys(value, [
    "caseHash",
    "arm",
    "provider",
    "model",
    "profileVersion",
    "reasoningEffort",
    "harnessVersion",
    "budgetHash",
    "completed",
    "attributable",
    "outcomeClass",
    "failureCategory",
    "verification",
    "qualityBps",
    "inputTokens",
    "outputTokens",
    "latencyMs",
    "modelCalls",
    "toolCalls",
    "repairs",
    "recoveries",
    "resultHash",
  ]);
  const rebuilt = createFrontierArmResult(value);
  if (value.resultHash !== rebuilt.resultHash) {
    throw new FrontierEvaluationError("Frontier result hash does not match its evidence.");
  }
  return rebuilt;
}

function normalizeResultInput(value: FrontierArmResultInput): FrontierArmResultInput {
  exactKeys(
    value,
    [
      "caseHash",
      "arm",
      "provider",
      "model",
      "profileVersion",
      "reasoningEffort",
      "harnessVersion",
      "budgetHash",
      "completed",
      "attributable",
      "outcomeClass",
      "failureCategory",
      "verification",
      "qualityBps",
      "inputTokens",
      "outputTokens",
      "latencyMs",
      "modelCalls",
      "toolCalls",
      "repairs",
      "recoveries",
    ],
    ["resultHash"],
  );
  if (value.arm !== "model_alone" && value.arm !== "odin") {
    throw new FrontierEvaluationError("Frontier arm is unsupported.");
  }
  if (!OUTCOME_CLASSES.has(value.outcomeClass) || !FAILURE_CATEGORIES.has(value.failureCategory)) {
    throw new FrontierEvaluationError("Frontier outcome classification is unsupported.");
  }
  if (!VERIFICATIONS.has(value.verification)) {
    throw new FrontierEvaluationError("Frontier verification status is unsupported.");
  }
  if (typeof value.completed !== "boolean" || typeof value.attributable !== "boolean") {
    throw new FrontierEvaluationError("Frontier completion and attribution flags must be boolean.");
  }
  validateOutcomeSemantics(value);
  return Object.freeze({
    arm: value.arm,
    attributable: value.attributable,
    budgetHash: sha256(value.budgetHash, "budgetHash"),
    caseHash: sha256(value.caseHash, "caseHash"),
    completed: value.completed,
    failureCategory: value.failureCategory,
    harnessVersion: identifier(value.harnessVersion, "harnessVersion"),
    inputTokens: boundedInteger(value.inputTokens, "inputTokens", 0, 10_000_000),
    latencyMs: boundedInteger(value.latencyMs, "latencyMs", 0, 3_600_000),
    model: identifier(value.model, "model"),
    modelCalls: boundedInteger(value.modelCalls, "modelCalls", 0, 1_000),
    outcomeClass: value.outcomeClass,
    outputTokens: boundedInteger(value.outputTokens, "outputTokens", 0, 10_000_000),
    profileVersion: identifier(value.profileVersion, "profileVersion"),
    provider: identifier(value.provider, "provider"),
    qualityBps:
      value.qualityBps === null ? null : boundedInteger(value.qualityBps, "qualityBps", 0, 10_000),
    reasoningEffort:
      value.reasoningEffort === null ? null : identifier(value.reasoningEffort, "reasoningEffort"),
    recoveries: boundedInteger(value.recoveries, "recoveries", 0, 1_000),
    repairs: boundedInteger(value.repairs, "repairs", 0, 1_000),
    toolCalls: boundedInteger(value.toolCalls, "toolCalls", 0, 10_000),
    verification: value.verification,
  });
}

function validateOutcomeSemantics(value: FrontierArmResultInput): void {
  if (value.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS") {
    if (
      value.completed ||
      value.attributable ||
      value.qualityBps !== null ||
      value.verification !== "INCOMPLETE" ||
      !INFRASTRUCTURE_FAILURES.has(value.failureCategory)
    ) {
      throw new FrontierEvaluationError(
        "Infrastructure-ambiguous evidence cannot become a measured task result.",
      );
    }
    return;
  }
  if (!value.completed || !value.attributable || value.qualityBps === null) {
    throw new FrontierEvaluationError(
      "Completed task outcomes require attributable numeric quality evidence.",
    );
  }
  if (value.outcomeClass === "SUCCESS") {
    if (value.failureCategory !== "none" || value.verification !== "PASS") {
      throw new FrontierEvaluationError(
        "Successful frontier outcomes require PASS and no failure category.",
      );
    }
  } else if (value.failureCategory === "none" || value.verification === "INCOMPLETE") {
    throw new FrontierEvaluationError(
      "Terminal task failures require a bounded failure category and final verification state.",
    );
  }
}

function assertMatchedIdentity(left: FrontierArmResult, right: FrontierArmResult): void {
  if (
    left.provider !== right.provider ||
    left.model !== right.model ||
    left.profileVersion !== right.profileVersion ||
    left.reasoningEffort !== right.reasoningEffort ||
    left.harnessVersion !== right.harnessVersion ||
    left.budgetHash !== right.budgetHash
  ) {
    throw new FrontierEvaluationError(
      "Matched frontier arms must use the same model profile, harness, and budget.",
    );
  }
}

function assertWithinBudget(result: FrontierArmResult, budget: FrontierBudgetProfile): void {
  if (
    result.modelCalls > budget.maxModelCalls ||
    result.inputTokens > budget.maxInputTokens ||
    result.outputTokens > budget.maxOutputTokens ||
    result.latencyMs > budget.maxLatencyMs ||
    result.toolCalls > budget.maxToolCalls ||
    result.repairs > budget.maxRepairs ||
    result.recoveries > budget.maxRecoveries
  ) {
    throw new FrontierEvaluationError(
      "Frontier result exceeds its declared equal-condition budget.",
    );
  }
}

function isMeasurable(value: FrontierArmResult): boolean {
  return value.completed && value.attributable && value.qualityBps !== null;
}

function aggregate(
  pairs: readonly { readonly baseline: FrontierArmResult; readonly odin: FrontierArmResult }[],
): FrontierAggregateMetrics {
  if (pairs.length === 0) {
    return Object.freeze({
      baselineLatencyMs: null,
      baselineModelCalls: null,
      baselineQualityBps: null,
      baselineTokens: null,
      completePairs: 0,
      latencyDeltaBps: null,
      odinLatencyMs: null,
      odinModelCalls: null,
      odinQualityBps: null,
      odinTokens: null,
      qualityLiftBps: null,
      tokenDeltaBps: null,
    });
  }
  let baselineQuality = 0;
  let odinQuality = 0;
  let baselineTokens = 0;
  let odinTokens = 0;
  let baselineLatency = 0;
  let odinLatency = 0;
  let baselineCalls = 0;
  let odinCalls = 0;
  for (const pair of pairs) {
    baselineQuality += pair.baseline.qualityBps ?? 0;
    odinQuality += pair.odin.qualityBps ?? 0;
    baselineTokens += pair.baseline.inputTokens + pair.baseline.outputTokens;
    odinTokens += pair.odin.inputTokens + pair.odin.outputTokens;
    baselineLatency += pair.baseline.latencyMs;
    odinLatency += pair.odin.latencyMs;
    baselineCalls += pair.baseline.modelCalls;
    odinCalls += pair.odin.modelCalls;
  }
  const baselineQualityBps = Math.round(baselineQuality / pairs.length);
  const odinQualityBps = Math.round(odinQuality / pairs.length);
  return Object.freeze({
    baselineLatencyMs: baselineLatency,
    baselineModelCalls: baselineCalls,
    baselineQualityBps,
    baselineTokens,
    completePairs: pairs.length,
    latencyDeltaBps: relativeDeltaBps(baselineLatency, odinLatency),
    odinLatencyMs: odinLatency,
    odinModelCalls: odinCalls,
    odinQualityBps,
    odinTokens,
    qualityLiftBps: odinQualityBps - baselineQualityBps,
    tokenDeltaBps: relativeDeltaBps(baselineTokens, odinTokens),
  });
}

function relativeDeltaBps(baseline: number, candidate: number): number | null {
  if (baseline === 0) return candidate === 0 ? 0 : null;
  return Math.round(((candidate - baseline) * 10_000) / baseline);
}

function caseIdentity(value: FrontierCaseInput): unknown {
  return {
    budgetHash: value.budget.budgetHash,
    hiddenAcceptanceHash: value.hiddenAcceptanceHash,
    id: value.id,
    publicInputHash: value.publicInputHash,
    suiteVersion: value.suiteVersion,
    taskClass: value.taskClass,
  };
}

function exactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FrontierEvaluationError("Frontier value must be an object.");
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !keys.includes(key))) {
    throw new FrontierEvaluationError("Frontier value has unknown or missing fields.");
  }
}

function identifier(value: string, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new FrontierEvaluationError(`${label} is malformed.`);
  }
  return value;
}

function sha256(value: string, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new FrontierEvaluationError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function boundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new FrontierEvaluationError(`${label} is outside its safe integer bound.`);
  }
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
