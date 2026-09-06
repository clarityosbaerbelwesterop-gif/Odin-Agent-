import { createHash } from "node:crypto";
import {
  assertFrontierBudgetFitsProfile,
  type FrontierEvaluationProfile,
  validateFrontierEvaluationProfile,
} from "./profile.js";
import { evaluateFrontierSuite, modelFacingFrontierCase } from "./suite.js";
import type {
  FrontierArmResult,
  FrontierCase,
  FrontierEvaluationReport,
  FrontierEvidenceStatus,
  FrontierModelFacingCase,
  FrontierTaskClass,
} from "./types.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type BenchmarkV2Domain =
  | "coding"
  | "math"
  | "reasoning"
  | "tool_use"
  | "research"
  | "long_context"
  | "recovery"
  | "long_mission";

export const BENCHMARK_V2_BLUEPRINT_VERSION = "benchmark-v2-100-v1";
export const BENCHMARK_V2_DOMAINS = Object.freeze<readonly BenchmarkV2Domain[]>([
  "coding",
  "math",
  "reasoning",
  "tool_use",
  "research",
  "long_context",
  "recovery",
  "long_mission",
]);

export const BENCHMARK_V2_DOMAIN_COUNTS: Readonly<Record<BenchmarkV2Domain, number>> =
  Object.freeze({
    coding: 25,
    long_context: 5,
    long_mission: 5,
    math: 20,
    reasoning: 20,
    recovery: 5,
    research: 10,
    tool_use: 10,
  });

const FRONTIER_CLASS_BY_DOMAIN: Readonly<Record<BenchmarkV2Domain, FrontierTaskClass>> =
  Object.freeze({
    coding: "coding",
    long_context: "reasoning",
    long_mission: "long_mission",
    math: "reasoning",
    reasoning: "reasoning",
    recovery: "recovery",
    research: "tool_use",
    tool_use: "tool_use",
  });

export interface BenchmarkV2CaseInput {
  readonly domain: BenchmarkV2Domain;
  readonly frontierCase: FrontierCase;
}

export interface BenchmarkV2Case extends BenchmarkV2CaseInput {
  readonly benchmarkCaseHash: string;
}

export interface BenchmarkV2ModelFacingCase {
  readonly domain: BenchmarkV2Domain;
  readonly frontierCase: FrontierModelFacingCase;
  readonly benchmarkCaseHash: string;
}

export interface BenchmarkV2SuiteInput {
  readonly suiteVersion: string;
  readonly profile: FrontierEvaluationProfile;
  readonly cases: readonly BenchmarkV2Case[];
}

export interface BenchmarkV2Suite extends BenchmarkV2SuiteInput {
  readonly blueprintVersion: typeof BENCHMARK_V2_BLUEPRINT_VERSION;
  readonly benchmarkHash: string;
}

export interface BenchmarkV2DomainSummary {
  readonly domain: BenchmarkV2Domain;
  readonly caseCount: number;
  readonly completePairs: number;
  readonly incompletePairs: number;
  readonly infrastructurePairs: number;
  readonly status: FrontierEvidenceStatus;
  readonly baselineQualityBps: number | null;
  readonly odinQualityBps: number | null;
  readonly qualityLiftBps: number | null;
}

export interface BenchmarkV2Report {
  readonly blueprintVersion: typeof BENCHMARK_V2_BLUEPRINT_VERSION;
  readonly benchmarkHash: string;
  readonly frontierReport: FrontierEvaluationReport;
  readonly domains: readonly BenchmarkV2DomainSummary[];
  readonly reportHash: string;
}

export class BenchmarkV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkV2Error";
  }
}

export function frontierTaskClassForBenchmarkV2Domain(
  domain: BenchmarkV2Domain,
): FrontierTaskClass {
  assertDomain(domain);
  return FRONTIER_CLASS_BY_DOMAIN[domain];
}

export function createBenchmarkV2Case(value: BenchmarkV2CaseInput): BenchmarkV2Case {
  exactKeys(value, ["domain", "frontierCase"]);
  assertDomain(value.domain);
  const facing = modelFacingFrontierCase(value.frontierCase);
  const expectedClass = frontierTaskClassForBenchmarkV2Domain(value.domain);
  if (facing.taskClass !== expectedClass) {
    throw new BenchmarkV2Error("Benchmark v2 domain does not match its M22 frontier task class.");
  }
  const body = {
    domain: value.domain,
    frontierCase: value.frontierCase,
  } as const;
  const benchmarkCaseHash = hashJson({
    caseHash: value.frontierCase.caseHash,
    domain: value.domain,
  });
  return Object.freeze({ ...body, benchmarkCaseHash });
}

export function modelFacingBenchmarkV2Case(value: BenchmarkV2Case): BenchmarkV2ModelFacingCase {
  const normalized = normalizeBenchmarkCase(value);
  return Object.freeze({
    benchmarkCaseHash: normalized.benchmarkCaseHash,
    domain: normalized.domain,
    frontierCase: modelFacingFrontierCase(normalized.frontierCase),
  });
}

export function createBenchmarkV2Suite(value: BenchmarkV2SuiteInput): BenchmarkV2Suite {
  exactKeys(value, ["suiteVersion", "profile", "cases"]);
  const suiteVersion = identifier(value.suiteVersion, "suiteVersion");
  const profile = validateFrontierEvaluationProfile(value.profile);
  if (!Array.isArray(value.cases) || value.cases.length !== 100) {
    throw new BenchmarkV2Error("Benchmark v2 blueprint requires exactly 100 cases.");
  }

  const cases = value.cases
    .map(normalizeBenchmarkCase)
    .sort((left, right) => left.benchmarkCaseHash.localeCompare(right.benchmarkCaseHash));
  const ids = new Set<string>();
  const caseHashes = new Set<string>();
  const benchmarkCaseHashes = new Set<string>();
  const counts = emptyDomainCounts();

  for (const current of cases) {
    if (current.frontierCase.suiteVersion !== suiteVersion) {
      throw new BenchmarkV2Error("Benchmark v2 case belongs to a different suite version.");
    }
    if (
      ids.has(current.frontierCase.id) ||
      caseHashes.has(current.frontierCase.caseHash) ||
      benchmarkCaseHashes.has(current.benchmarkCaseHash)
    ) {
      throw new BenchmarkV2Error("Benchmark v2 contains duplicate case identity.");
    }
    ids.add(current.frontierCase.id);
    caseHashes.add(current.frontierCase.caseHash);
    benchmarkCaseHashes.add(current.benchmarkCaseHash);
    counts[current.domain] += 1;
    assertFrontierBudgetFitsProfile(profile, current.frontierCase.budget);
  }

  for (const domain of BENCHMARK_V2_DOMAINS) {
    if (counts[domain] !== BENCHMARK_V2_DOMAIN_COUNTS[domain]) {
      throw new BenchmarkV2Error(
        "Benchmark v2 domain mix does not match the locked 100-case blueprint.",
      );
    }
  }

  const body = {
    blueprintVersion: BENCHMARK_V2_BLUEPRINT_VERSION,
    caseHashes: cases.map((current) => current.benchmarkCaseHash),
    profileHash: profile.profileHash,
    suiteVersion,
  } as const;
  return Object.freeze({
    benchmarkHash: hashJson(body),
    blueprintVersion: BENCHMARK_V2_BLUEPRINT_VERSION,
    cases: Object.freeze(cases),
    profile,
    suiteVersion,
  });
}

export function evaluateBenchmarkV2(input: {
  readonly benchmark: BenchmarkV2Suite;
  readonly harnessVersion: string;
  readonly results: readonly FrontierArmResult[];
}): BenchmarkV2Report {
  exactKeys(input, ["benchmark", "harnessVersion", "results"]);
  const benchmark = normalizeBenchmark(input.benchmark);
  const harnessVersion = identifier(input.harnessVersion, "harnessVersion");
  const results: readonly FrontierArmResult[] = input.results;
  if (!Array.isArray(results)) {
    throw new BenchmarkV2Error("Benchmark v2 results must be an array.");
  }

  const frontierReport = evaluateFrontierSuite({
    cases: benchmark.cases.map((current) => current.frontierCase),
    harnessVersion,
    results,
    suiteVersion: benchmark.suiteVersion,
  });

  for (const result of results) {
    if (
      result.provider !== benchmark.profile.provider ||
      result.model !== benchmark.profile.model ||
      result.profileVersion !== benchmark.profile.profileVersion ||
      result.reasoningEffort !== benchmark.profile.reasoningEffort
    ) {
      throw new BenchmarkV2Error(
        "Benchmark v2 result does not match the exact evaluation profile envelope.",
      );
    }
  }

  const resultsByCase = new Map<
    string,
    Partial<Record<"model_alone" | "odin", FrontierArmResult>>
  >();
  for (const result of results) {
    const pair = resultsByCase.get(result.caseHash) ?? {};
    pair[result.arm] = result;
    resultsByCase.set(result.caseHash, pair);
  }

  const domains = Object.freeze(
    BENCHMARK_V2_DOMAINS.map((domain) =>
      summarizeDomain(
        domain,
        benchmark.cases.filter((current) => current.domain === domain),
        resultsByCase,
      ),
    ),
  );
  const body = {
    benchmarkHash: benchmark.benchmarkHash,
    blueprintVersion: BENCHMARK_V2_BLUEPRINT_VERSION,
    domainSummaries: domains,
    frontierReportHash: frontierReport.reportHash,
  } as const;
  return Object.freeze({
    benchmarkHash: benchmark.benchmarkHash,
    blueprintVersion: BENCHMARK_V2_BLUEPRINT_VERSION,
    domains,
    frontierReport,
    reportHash: hashJson(body),
  });
}

function summarizeDomain(
  domain: BenchmarkV2Domain,
  cases: readonly BenchmarkV2Case[],
  resultsByCase: ReadonlyMap<string, Partial<Record<"model_alone" | "odin", FrontierArmResult>>>,
): BenchmarkV2DomainSummary {
  let completePairs = 0;
  let incompletePairs = 0;
  let infrastructurePairs = 0;
  let baselineQuality = 0;
  let odinQuality = 0;

  for (const current of cases) {
    const pair = resultsByCase.get(current.frontierCase.caseHash);
    const baseline = pair?.model_alone;
    const odin = pair?.odin;
    if (
      baseline?.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS" ||
      odin?.outcomeClass === "INFRASTRUCTURE_AMBIGUOUS"
    ) {
      infrastructurePairs += 1;
    }
    if (
      baseline === undefined ||
      odin === undefined ||
      !isMeasurable(baseline) ||
      !isMeasurable(odin)
    ) {
      incompletePairs += 1;
      continue;
    }
    completePairs += 1;
    baselineQuality += baseline.qualityBps ?? 0;
    odinQuality += odin.qualityBps ?? 0;
  }

  const status: FrontierEvidenceStatus =
    completePairs === 0 ? "INCONCLUSIVE" : completePairs === cases.length ? "COMPLETE" : "PARTIAL";
  const baselineQualityBps =
    completePairs === 0 ? null : Math.round(baselineQuality / completePairs);
  const odinQualityBps = completePairs === 0 ? null : Math.round(odinQuality / completePairs);
  return Object.freeze({
    baselineQualityBps,
    caseCount: cases.length,
    completePairs,
    domain,
    incompletePairs,
    infrastructurePairs,
    odinQualityBps,
    qualityLiftBps:
      baselineQualityBps === null || odinQualityBps === null
        ? null
        : odinQualityBps - baselineQualityBps,
    status,
  });
}

function normalizeBenchmark(value: BenchmarkV2Suite): BenchmarkV2Suite {
  exactKeys(value, ["suiteVersion", "profile", "cases", "blueprintVersion", "benchmarkHash"]);
  if (value.blueprintVersion !== BENCHMARK_V2_BLUEPRINT_VERSION) {
    throw new BenchmarkV2Error("Benchmark v2 blueprint version is unsupported.");
  }
  if (!SHA256.test(value.benchmarkHash)) {
    throw new BenchmarkV2Error("Benchmark v2 hash must be SHA-256.");
  }
  const rebuilt = createBenchmarkV2Suite({
    cases: value.cases,
    profile: value.profile,
    suiteVersion: value.suiteVersion,
  });
  if (rebuilt.benchmarkHash !== value.benchmarkHash) {
    throw new BenchmarkV2Error("Benchmark v2 hash does not match its suite definition.");
  }
  return rebuilt;
}

function normalizeBenchmarkCase(value: BenchmarkV2Case): BenchmarkV2Case {
  exactKeys(value, ["domain", "frontierCase", "benchmarkCaseHash"]);
  if (!SHA256.test(value.benchmarkCaseHash)) {
    throw new BenchmarkV2Error("Benchmark v2 case hash must be SHA-256.");
  }
  const rebuilt = createBenchmarkV2Case({ domain: value.domain, frontierCase: value.frontierCase });
  if (rebuilt.benchmarkCaseHash !== value.benchmarkCaseHash) {
    throw new BenchmarkV2Error("Benchmark v2 case hash does not match its domain binding.");
  }
  return rebuilt;
}

function isMeasurable(value: FrontierArmResult): boolean {
  return value.completed && value.attributable && value.qualityBps !== null;
}

function assertDomain(value: string): asserts value is BenchmarkV2Domain {
  if (!BENCHMARK_V2_DOMAINS.includes(value as BenchmarkV2Domain)) {
    throw new BenchmarkV2Error("Benchmark v2 domain is unsupported.");
  }
}

function emptyDomainCounts(): Record<BenchmarkV2Domain, number> {
  return {
    coding: 0,
    long_context: 0,
    long_mission: 0,
    math: 0,
    reasoning: 0,
    recovery: 0,
    research: 0,
    tool_use: 0,
  };
}

function exactKeys(value: object, required: readonly string[]): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BenchmarkV2Error("Benchmark v2 value must be an object.");
  }
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new BenchmarkV2Error("Benchmark v2 value has unexpected or missing fields.");
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new BenchmarkV2Error(`Benchmark v2 ${label} is invalid.`);
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
