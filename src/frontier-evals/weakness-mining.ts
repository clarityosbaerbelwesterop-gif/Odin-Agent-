import { createHash } from "node:crypto";
import type { BenchmarkV2Domain, BenchmarkV2Suite } from "./benchmark-v2.js";
import { evaluateBenchmarkV2 } from "./benchmark-v2.js";
import type { FrontierArm, FrontierArmResult, FrontierFailureCategory } from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type WeaknessClass =
  | "reasoning"
  | "coding"
  | "tool"
  | "context"
  | "model"
  | "verification"
  | "budget"
  | "infrastructure"
  | "unknown";

export type WeaknessDiagnosticCode =
  | "reasoning_inconsistent"
  | "reasoning_incomplete"
  | "repair_no_change"
  | "quality_failed_after_repair"
  | "tool_call_invalid"
  | "tool_result_unusable"
  | "long_context_missed_evidence"
  | "context_overflow"
  | "structured_output_missing"
  | "output_truncated"
  | "verification_failed"
  | "budget_exhausted"
  | "timeout"
  | "network"
  | "authentication"
  | "rate_limit"
  | "unavailable"
  | "malformed_response"
  | "unknown";

export type WeaknessFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "other";

export type WeaknessSignalCode =
  | WeaknessDiagnosticCode
  | "result_quality_failure"
  | "result_verification_failure"
  | "result_budget_failure"
  | "result_contract_failure"
  | "result_timeout"
  | "result_network"
  | "result_authentication"
  | "result_rate_limit"
  | "result_unavailable"
  | "result_malformed_response"
  | "result_unknown_failure";

export interface WeaknessDiagnosticInput {
  readonly resultHash: string;
  readonly code: WeaknessDiagnosticCode;
  readonly finishReason: WeaknessFinishReason | null;
  readonly evidenceHash: string;
}

export interface WeaknessDiagnostic extends WeaknessDiagnosticInput {
  readonly diagnosticHash: string;
}

export interface WeaknessHeatmapEntry {
  readonly arm: FrontierArm;
  readonly weaknessClass: WeaknessClass;
  readonly code: WeaknessSignalCode;
  readonly affectedResults: number;
  readonly severityPoints: number;
  readonly maxSeverity: number;
}

export interface WeaknessDeltaEntry {
  readonly weaknessClass: WeaknessClass;
  readonly code: WeaknessSignalCode;
  readonly baselineAffected: number;
  readonly odinAffected: number;
  readonly affectedDelta: number;
  readonly baselineSeverityPoints: number;
  readonly odinSeverityPoints: number;
  readonly severityDelta: number;
}

export interface WeaknessMiningReport {
  readonly benchmarkHash: string;
  readonly profileHash: string;
  readonly suiteVersion: string;
  readonly harnessVersion: string;
  readonly comparablePairCount: number;
  readonly incompletePairCount: number;
  readonly attributableHeatmap: readonly WeaknessHeatmapEntry[];
  readonly infrastructureHeatmap: readonly WeaknessHeatmapEntry[];
  readonly pairedDeltas: readonly WeaknessDeltaEntry[];
  readonly diagnosticHashes: readonly string[];
  readonly reportHash: string;
}

interface WeaknessSignal {
  readonly arm: FrontierArm;
  readonly caseHash: string;
  readonly resultHash: string;
  readonly weaknessClass: WeaknessClass;
  readonly code: WeaknessSignalCode;
  readonly severity: number;
  readonly infrastructureAmbiguous: boolean;
}

const DIAGNOSTIC_CODES = new Set<WeaknessDiagnosticCode>([
  "reasoning_inconsistent",
  "reasoning_incomplete",
  "repair_no_change",
  "quality_failed_after_repair",
  "tool_call_invalid",
  "tool_result_unusable",
  "long_context_missed_evidence",
  "context_overflow",
  "structured_output_missing",
  "output_truncated",
  "verification_failed",
  "budget_exhausted",
  "timeout",
  "network",
  "authentication",
  "rate_limit",
  "unavailable",
  "malformed_response",
  "unknown",
]);

const FINISH_REASONS = new Set<WeaknessFinishReason>([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "other",
]);

const INFRASTRUCTURE_DIAGNOSTICS = new Set<WeaknessDiagnosticCode>([
  "timeout",
  "network",
  "authentication",
  "rate_limit",
  "unavailable",
  "malformed_response",
]);

const DIAGNOSTIC_CLASS: Readonly<Record<WeaknessDiagnosticCode, WeaknessClass>> = Object.freeze({
  authentication: "infrastructure",
  budget_exhausted: "budget",
  context_overflow: "context",
  long_context_missed_evidence: "context",
  malformed_response: "infrastructure",
  network: "infrastructure",
  output_truncated: "model",
  quality_failed_after_repair: "verification",
  rate_limit: "infrastructure",
  reasoning_incomplete: "reasoning",
  reasoning_inconsistent: "reasoning",
  repair_no_change: "coding",
  structured_output_missing: "model",
  timeout: "infrastructure",
  tool_call_invalid: "tool",
  tool_result_unusable: "tool",
  unavailable: "infrastructure",
  unknown: "unknown",
  verification_failed: "verification",
});

const DIAGNOSTIC_SEVERITY: Readonly<Record<WeaknessDiagnosticCode, number>> = Object.freeze({
  authentication: 2,
  budget_exhausted: 3,
  context_overflow: 4,
  long_context_missed_evidence: 4,
  malformed_response: 2,
  network: 2,
  output_truncated: 4,
  quality_failed_after_repair: 5,
  rate_limit: 2,
  reasoning_incomplete: 4,
  reasoning_inconsistent: 4,
  repair_no_change: 3,
  structured_output_missing: 4,
  timeout: 2,
  tool_call_invalid: 4,
  tool_result_unusable: 3,
  unavailable: 2,
  unknown: 1,
  verification_failed: 5,
});

export class WeaknessMiningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeaknessMiningError";
  }
}

export function createWeaknessDiagnostic(value: WeaknessDiagnosticInput): WeaknessDiagnostic {
  exactKeys(value, ["resultHash", "code", "finishReason", "evidenceHash"]);
  const resultHash = sha256(value.resultHash, "resultHash");
  const evidenceHash = sha256(value.evidenceHash, "evidenceHash");
  if (!DIAGNOSTIC_CODES.has(value.code)) {
    throw new WeaknessMiningError("Weakness diagnostic code is unsupported.");
  }
  if (value.finishReason !== null && !FINISH_REASONS.has(value.finishReason)) {
    throw new WeaknessMiningError("Weakness finish reason is unsupported.");
  }
  if (value.code === "output_truncated" && value.finishReason !== "length") {
    throw new WeaknessMiningError("Output truncation requires finishReason=length.");
  }
  const body = {
    code: value.code,
    evidenceHash,
    finishReason: value.finishReason,
    resultHash,
  } as const;
  return Object.freeze({ ...body, diagnosticHash: hashJson(body) });
}

export function mineBenchmarkWeaknesses(input: {
  readonly benchmark: BenchmarkV2Suite;
  readonly harnessVersion: string;
  readonly results: readonly FrontierArmResult[];
  readonly diagnostics: readonly WeaknessDiagnostic[];
}): WeaknessMiningReport {
  exactKeys(input, ["benchmark", "harnessVersion", "results", "diagnostics"]);
  if (!Array.isArray(input.diagnostics) || input.diagnostics.length > 2_000) {
    throw new WeaknessMiningError("Weakness diagnostics exceed their bounded collection size.");
  }

  const benchmarkReport = evaluateBenchmarkV2({
    benchmark: input.benchmark,
    harnessVersion: input.harnessVersion,
    results: input.results,
  });
  const resultByHash = new Map(input.results.map((result) => [result.resultHash, result] as const));
  const domainByCaseHash = new Map(
    input.benchmark.cases.map(
      (current) => [current.frontierCase.caseHash, current.domain] as const,
    ),
  );

  const diagnostics = input.diagnostics
    .map(normalizeDiagnostic)
    .sort((left, right) => left.diagnosticHash.localeCompare(right.diagnosticHash));
  const diagnosticIdentities = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (!resultByHash.has(diagnostic.resultHash)) {
      throw new WeaknessMiningError("Weakness diagnostic references a foreign result.");
    }
    const identity = `${diagnostic.resultHash}:${diagnostic.code}:${diagnostic.finishReason ?? "none"}`;
    if (diagnosticIdentities.has(identity)) {
      throw new WeaknessMiningError(
        "Duplicate weakness diagnostic identity is not valid evidence.",
      );
    }
    diagnosticIdentities.add(identity);
  }

  const signals: WeaknessSignal[] = [];
  for (const result of input.results) {
    const domain = domainByCaseHash.get(result.caseHash);
    if (domain === undefined) {
      throw new WeaknessMiningError("Weakness result references a foreign benchmark case.");
    }
    const failureSignal = signalFromResultFailure(result, domain);
    if (failureSignal !== null) signals.push(failureSignal);
  }

  for (const diagnostic of diagnostics) {
    const result = resultByHash.get(diagnostic.resultHash);
    if (result === undefined) {
      throw new WeaknessMiningError("Weakness diagnostic result disappeared during analysis.");
    }
    const weaknessClass = DIAGNOSTIC_CLASS[diagnostic.code];
    if (
      !result.attributable &&
      result.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS" &&
      weaknessClass !== "infrastructure" &&
      weaknessClass !== "unknown"
    ) {
      throw new WeaknessMiningError(
        "Infrastructure-ambiguous evidence cannot be relabeled as an attributable weakness.",
      );
    }
    if (
      INFRASTRUCTURE_DIAGNOSTICS.has(diagnostic.code) &&
      result.outcomeClass !== "INFRASTRUCTURE_AMBIGUOUS"
    ) {
      throw new WeaknessMiningError(
        "Infrastructure diagnostic requires infrastructure-ambiguous result evidence.",
      );
    }
    signals.push({
      arm: result.arm,
      caseHash: result.caseHash,
      code: diagnostic.code,
      infrastructureAmbiguous: result.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS",
      resultHash: result.resultHash,
      severity: DIAGNOSTIC_SEVERITY[diagnostic.code],
      weaknessClass,
    });
  }

  const attributableSignals = signals.filter((signal) => !signal.infrastructureAmbiguous);
  const infrastructureSignals = signals.filter((signal) => signal.infrastructureAmbiguous);
  const comparableResultHashes = comparableResultHashSet(input.benchmark, input.results);
  const pairedSignals = attributableSignals.filter((signal) =>
    comparableResultHashes.has(signal.resultHash),
  );

  const attributableHeatmap = Object.freeze(buildHeatmap(attributableSignals));
  const infrastructureHeatmap = Object.freeze(buildHeatmap(infrastructureSignals));
  const pairedDeltas = Object.freeze(buildPairedDeltas(pairedSignals));
  const diagnosticHashes = Object.freeze(
    diagnostics.map((diagnostic) => diagnostic.diagnosticHash),
  );
  const body = {
    attributableHeatmap,
    benchmarkHash: input.benchmark.benchmarkHash,
    comparablePairCount: benchmarkReport.frontierReport.matchedPairCount,
    diagnosticHashes,
    harnessVersion: input.harnessVersion,
    incompletePairCount: benchmarkReport.frontierReport.incompletePairCount,
    infrastructureHeatmap,
    pairedDeltas,
    profileHash: input.benchmark.profile.profileHash,
    suiteVersion: input.benchmark.suiteVersion,
  } as const;
  return Object.freeze({ ...body, reportHash: hashJson(body) });
}

function signalFromResultFailure(
  result: FrontierArmResult,
  domain: BenchmarkV2Domain,
): WeaknessSignal | null {
  if (result.outcomeClass === "SUCCESS") return null;
  const classification = classifyFailure(result.failureCategory, domain);
  return {
    arm: result.arm,
    caseHash: result.caseHash,
    code: classification.code,
    infrastructureAmbiguous: result.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS",
    resultHash: result.resultHash,
    severity: classification.severity,
    weaknessClass: classification.weaknessClass,
  };
}

function classifyFailure(
  category: FrontierFailureCategory,
  domain: BenchmarkV2Domain,
): {
  readonly weaknessClass: WeaknessClass;
  readonly code: WeaknessSignalCode;
  readonly severity: number;
} {
  switch (category) {
    case "quality":
      return {
        code: "result_quality_failure",
        severity: 4,
        weaknessClass: domainWeaknessClass(domain),
      };
    case "verification":
      return { code: "result_verification_failure", severity: 5, weaknessClass: "verification" };
    case "budget":
      return { code: "result_budget_failure", severity: 3, weaknessClass: "budget" };
    case "contract":
      return { code: "result_contract_failure", severity: 4, weaknessClass: "model" };
    case "timeout":
      return { code: "result_timeout", severity: 2, weaknessClass: "infrastructure" };
    case "network":
      return { code: "result_network", severity: 2, weaknessClass: "infrastructure" };
    case "authentication":
      return { code: "result_authentication", severity: 2, weaknessClass: "infrastructure" };
    case "rate_limit":
      return { code: "result_rate_limit", severity: 2, weaknessClass: "infrastructure" };
    case "unavailable":
      return { code: "result_unavailable", severity: 2, weaknessClass: "infrastructure" };
    case "malformed_response":
      return { code: "result_malformed_response", severity: 3, weaknessClass: "infrastructure" };
    case "unknown":
      return { code: "result_unknown_failure", severity: 1, weaknessClass: "unknown" };
    case "none":
      throw new WeaknessMiningError("Non-success result cannot have no failure category.");
  }
}

function domainWeaknessClass(domain: BenchmarkV2Domain): WeaknessClass {
  switch (domain) {
    case "coding":
      return "coding";
    case "math":
    case "reasoning":
    case "recovery":
    case "long_mission":
      return "reasoning";
    case "tool_use":
    case "research":
      return "tool";
    case "long_context":
      return "context";
  }
}

function comparableResultHashSet(
  benchmark: BenchmarkV2Suite,
  results: readonly FrontierArmResult[],
): ReadonlySet<string> {
  const byCase = new Map<string, Partial<Record<FrontierArm, FrontierArmResult>>>();
  for (const result of results) {
    const pair = byCase.get(result.caseHash) ?? {};
    pair[result.arm] = result;
    byCase.set(result.caseHash, pair);
  }
  const hashes = new Set<string>();
  for (const current of benchmark.cases) {
    const pair = byCase.get(current.frontierCase.caseHash);
    if (pair?.model_alone === undefined || pair.odin === undefined) continue;
    if (!isMeasurable(pair.model_alone) || !isMeasurable(pair.odin)) continue;
    hashes.add(pair.model_alone.resultHash);
    hashes.add(pair.odin.resultHash);
  }
  return hashes;
}

function isMeasurable(result: FrontierArmResult): boolean {
  return result.completed && result.attributable && result.qualityBps !== null;
}

function buildHeatmap(signals: readonly WeaknessSignal[]): WeaknessHeatmapEntry[] {
  const buckets = new Map<
    string,
    {
      arm: FrontierArm;
      weaknessClass: WeaknessClass;
      code: WeaknessSignalCode;
      results: Set<string>;
      severityPoints: number;
      maxSeverity: number;
    }
  >();
  for (const signal of signals) {
    const key = `${signal.arm}:${signal.weaknessClass}:${signal.code}`;
    const current = buckets.get(key) ?? {
      arm: signal.arm,
      code: signal.code,
      maxSeverity: 0,
      results: new Set<string>(),
      severityPoints: 0,
      weaknessClass: signal.weaknessClass,
    };
    if (!current.results.has(signal.resultHash)) {
      current.results.add(signal.resultHash);
      current.severityPoints += signal.severity;
      current.maxSeverity = Math.max(current.maxSeverity, signal.severity);
    }
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      affectedResults: bucket.results.size,
      arm: bucket.arm,
      code: bucket.code,
      maxSeverity: bucket.maxSeverity,
      severityPoints: bucket.severityPoints,
      weaknessClass: bucket.weaknessClass,
    }))
    .sort(
      (left, right) =>
        right.affectedResults - left.affectedResults ||
        right.severityPoints - left.severityPoints ||
        right.maxSeverity - left.maxSeverity ||
        left.arm.localeCompare(right.arm) ||
        left.weaknessClass.localeCompare(right.weaknessClass) ||
        left.code.localeCompare(right.code),
    );
}

function buildPairedDeltas(signals: readonly WeaknessSignal[]): WeaknessDeltaEntry[] {
  const buckets = new Map<
    string,
    {
      weaknessClass: WeaknessClass;
      code: WeaknessSignalCode;
      baselineResults: Set<string>;
      odinResults: Set<string>;
      baselineSeverityPoints: number;
      odinSeverityPoints: number;
    }
  >();
  for (const signal of signals) {
    const key = `${signal.weaknessClass}:${signal.code}`;
    const current = buckets.get(key) ?? {
      baselineResults: new Set<string>(),
      baselineSeverityPoints: 0,
      code: signal.code,
      odinResults: new Set<string>(),
      odinSeverityPoints: 0,
      weaknessClass: signal.weaknessClass,
    };
    if (signal.arm === "model_alone") {
      if (!current.baselineResults.has(signal.resultHash)) {
        current.baselineResults.add(signal.resultHash);
        current.baselineSeverityPoints += signal.severity;
      }
    } else if (!current.odinResults.has(signal.resultHash)) {
      current.odinResults.add(signal.resultHash);
      current.odinSeverityPoints += signal.severity;
    }
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      affectedDelta: bucket.odinResults.size - bucket.baselineResults.size,
      baselineAffected: bucket.baselineResults.size,
      baselineSeverityPoints: bucket.baselineSeverityPoints,
      code: bucket.code,
      odinAffected: bucket.odinResults.size,
      odinSeverityPoints: bucket.odinSeverityPoints,
      severityDelta: bucket.odinSeverityPoints - bucket.baselineSeverityPoints,
      weaknessClass: bucket.weaknessClass,
    }))
    .sort(
      (left, right) =>
        Math.abs(right.affectedDelta) - Math.abs(left.affectedDelta) ||
        Math.abs(right.severityDelta) - Math.abs(left.severityDelta) ||
        right.odinAffected + right.baselineAffected - (left.odinAffected + left.baselineAffected) ||
        left.weaknessClass.localeCompare(right.weaknessClass) ||
        left.code.localeCompare(right.code),
    );
}

function normalizeDiagnostic(value: WeaknessDiagnostic): WeaknessDiagnostic {
  exactKeys(value, ["resultHash", "code", "finishReason", "evidenceHash", "diagnosticHash"]);
  const rebuilt = createWeaknessDiagnostic({
    code: value.code,
    evidenceHash: value.evidenceHash,
    finishReason: value.finishReason,
    resultHash: value.resultHash,
  });
  if (rebuilt.diagnosticHash !== value.diagnosticHash) {
    throw new WeaknessMiningError("Weakness diagnostic hash does not match its evidence.");
  }
  return rebuilt;
}

function exactKeys(value: object, required: readonly string[]): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WeaknessMiningError("Weakness value must be an object.");
  }
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new WeaknessMiningError("Weakness value has unexpected or missing fields.");
  }
}

function sha256(value: string, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new WeaknessMiningError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
