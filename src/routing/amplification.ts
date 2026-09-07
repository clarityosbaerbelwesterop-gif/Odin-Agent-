import type {
  BenchmarkV2Domain,
  WeaknessClass,
  WeaknessHeatmapEntry,
  WeaknessMiningReport,
} from "../frontier-evals/index.js";
import {
  assertSha256,
  exactKeys,
  identifier,
  objectValue,
  safeInteger,
  sha256Json,
} from "./internal.js";
import type { ReasoningPlan, RoutingRisk } from "./types.js";
import { RoutingError } from "./types.js";

export const AMPLIFICATION_POLICY_VERSION = "intelligence-d-v1" as const;

export type AmplificationStrategy =
  | "backward_reason"
  | "constraint_solve"
  | "counterexample_search"
  | "decompose"
  | "direct"
  | "independent_critique"
  | "numeric_consistency"
  | "retrieve_context"
  | "strict_output"
  | "targeted_repair"
  | "tool_ground";

export interface ReasoningAmplificationRequest {
  readonly expectedBenchmarkHash: string;
  readonly expectedProfileHash: string;
  readonly domain: BenchmarkV2Domain;
  readonly risk: RoutingRisk;
  readonly complexityBps: number;
  readonly maxContextTokens: number;
  readonly baseReasoning: ReasoningPlan;
  readonly weaknessReport: WeaknessMiningReport;
}

export interface ReasoningAmplificationPlan {
  readonly policyVersion: typeof AMPLIFICATION_POLICY_VERSION;
  readonly benchmarkHash: string;
  readonly profileHash: string;
  readonly weaknessReportHash: string;
  readonly domain: BenchmarkV2Domain;
  readonly strategies: readonly AmplificationStrategy[];
  readonly branchCount: number;
  readonly critiquePasses: number;
  readonly repairAttempts: number;
  readonly maxModelCalls: number;
  readonly maxEstimatedTokens: number;
  readonly contextTokenCeiling: number;
  readonly requiresIndependentVerification: boolean;
  readonly reasonCodes: readonly string[];
  readonly planHash: string;
}

const DOMAINS = new Set<BenchmarkV2Domain>([
  "coding",
  "math",
  "reasoning",
  "tool_use",
  "research",
  "long_context",
  "recovery",
  "long_mission",
]);
const RISKS = new Set<RoutingRisk>(["low", "medium", "high", "critical"]);
const WEAKNESS_CLASSES = new Set<WeaknessClass>([
  "reasoning",
  "coding",
  "tool",
  "context",
  "model",
  "verification",
  "budget",
  "infrastructure",
  "unknown",
]);
const STRATEGY_ORDER: readonly AmplificationStrategy[] = [
  "direct",
  "decompose",
  "constraint_solve",
  "backward_reason",
  "retrieve_context",
  "tool_ground",
  "strict_output",
  "counterexample_search",
  "numeric_consistency",
  "independent_critique",
  "targeted_repair",
];

export function createReasoningAmplificationPlan(
  value: ReasoningAmplificationRequest,
): ReasoningAmplificationPlan {
  const input = normalizeRequest(value);
  const report = normalizeWeaknessReport(input.weaknessReport);
  if (report.benchmarkHash !== input.expectedBenchmarkHash) {
    throw new RoutingError("INVALID_INPUT", "Weakness report benchmark binding does not match.");
  }
  if (report.profileHash !== input.expectedProfileHash) {
    throw new RoutingError("INVALID_INPUT", "Weakness report profile binding does not match.");
  }

  const odinWeaknesses = report.attributableHeatmap.filter((entry) => entry.arm === "odin");
  const attributable = odinWeaknesses.filter(
    (entry) => entry.weaknessClass !== "unknown" && entry.weaknessClass !== "infrastructure",
  );
  const signals = aggregateWeaknesses(attributable);
  const strategies = new Set<AmplificationStrategy>(["direct"]);
  const reasonCodes = new Set<string>();

  if (report.comparablePairCount === 0 || attributable.length === 0) {
    reasonCodes.add("conservative_default");
  } else {
    addWeaknessStrategies(strategies, reasonCodes, signals, input.domain);
  }
  addDomainStrategies(strategies, reasonCodes, input.domain, input.complexityBps, input.risk);

  const orderedStrategies = Object.freeze(
    STRATEGY_ORDER.filter((strategy) => strategies.has(strategy)),
  );
  const desiredBranches = Math.max(
    1,
    Math.min(
      4,
      1 +
        Number(strategies.has("decompose")) +
        Number(strategies.has("constraint_solve") || strategies.has("backward_reason")) +
        Number(strategies.has("counterexample_search")),
    ),
  );
  const desiredCritiques =
    strategies.has("independent_critique") || input.risk === "high" || input.risk === "critical"
      ? 1
      : 0;
  const desiredRepairs = strategies.has("targeted_repair") ? 1 : 0;

  const branchCount = Math.min(input.baseReasoning.branchCount, desiredBranches);
  const critiquePasses = Math.min(input.baseReasoning.critiquePasses, desiredCritiques);
  const repairAttempts = Math.min(input.baseReasoning.repairAttempts, desiredRepairs);
  const requiredCalls = Math.max(1, branchCount + critiquePasses + repairAttempts);
  const maxModelCalls = Math.min(input.baseReasoning.maxModelCalls, requiredCalls);
  const contextTokenCeiling = Math.min(
    input.maxContextTokens,
    deriveContextCeiling(input.maxContextTokens, signals.get("context") ?? 0, input.domain),
  );
  const requiresIndependentVerification =
    input.risk !== "low" ||
    input.complexityBps >= 5_000 ||
    signals.has("reasoning") ||
    signals.has("verification") ||
    signals.has("model");

  const body = {
    benchmarkHash: report.benchmarkHash,
    branchCount,
    contextTokenCeiling,
    critiquePasses,
    domain: input.domain,
    maxEstimatedTokens: input.baseReasoning.maxEstimatedTokens,
    maxModelCalls,
    policyVersion: AMPLIFICATION_POLICY_VERSION,
    profileHash: report.profileHash,
    reasonCodes: Object.freeze([...reasonCodes].sort()),
    repairAttempts,
    requiresIndependentVerification,
    strategies: orderedStrategies,
    weaknessReportHash: report.reportHash,
  } as const;
  return Object.freeze({ ...body, planHash: sha256Json(body) });
}

function normalizeRequest(value: ReasoningAmplificationRequest): ReasoningAmplificationRequest {
  const input = objectValue(value, "reasoning amplification request");
  exactKeys(
    input,
    [
      "expectedBenchmarkHash",
      "expectedProfileHash",
      "domain",
      "risk",
      "complexityBps",
      "maxContextTokens",
      "baseReasoning",
      "weaknessReport",
    ],
    [],
    "reasoning amplification request",
  );
  const domain = input.domain as BenchmarkV2Domain;
  const risk = input.risk as RoutingRisk;
  if (!DOMAINS.has(domain)) throw new RoutingError("INVALID_INPUT", "Amplification domain is invalid.");
  if (!RISKS.has(risk)) throw new RoutingError("INVALID_INPUT", "Amplification risk is invalid.");
  const expectedBenchmarkHash = assertSha256(input.expectedBenchmarkHash, "expectedBenchmarkHash");
  const expectedProfileHash = assertSha256(input.expectedProfileHash, "expectedProfileHash");
  const complexityBps = safeInteger(input.complexityBps, "complexityBps", 0, 10_000);
  const maxContextTokens = safeInteger(input.maxContextTokens, "maxContextTokens", 1, 10_000_000);
  const baseReasoning = normalizeReasoningPlan(input.baseReasoning as ReasoningPlan);
  return Object.freeze({
    baseReasoning,
    complexityBps,
    domain,
    expectedBenchmarkHash,
    expectedProfileHash,
    maxContextTokens,
    risk,
    weaknessReport: input.weaknessReport as WeaknessMiningReport,
  });
}

function normalizeReasoningPlan(planValue: ReasoningPlan): ReasoningPlan {
  const plan = objectValue(planValue, "base reasoning plan");
  exactKeys(
    plan,
    [
      "branchCount",
      "branches",
      "critiquePasses",
      "repairAttempts",
      "estimatedTokensPerCall",
      "maxEstimatedTokens",
      "maxModelCalls",
      "parallelism",
      "planHash",
    ],
    [],
    "base reasoning plan",
  );
  const normalized = {
    branchCount: safeInteger(plan.branchCount, "base branchCount", 1, 100),
    branches: plan.branches,
    critiquePasses: safeInteger(plan.critiquePasses, "base critiquePasses", 0, 100),
    estimatedTokensPerCall: safeInteger(
      plan.estimatedTokensPerCall,
      "base estimatedTokensPerCall",
      0,
      10_000_000,
    ),
    maxEstimatedTokens: safeInteger(
      plan.maxEstimatedTokens,
      "base maxEstimatedTokens",
      0,
      100_000_000,
    ),
    maxModelCalls: safeInteger(plan.maxModelCalls, "base maxModelCalls", 1, 100),
    parallelism: safeInteger(plan.parallelism, "base parallelism", 1, 100),
    repairAttempts: safeInteger(plan.repairAttempts, "base repairAttempts", 0, 100),
  } as const;
  if (!Array.isArray(normalized.branches) || normalized.branches.length !== normalized.branchCount) {
    throw new RoutingError("INVALID_INPUT", "Base reasoning branch identity is malformed.");
  }
  const planHash = assertSha256(plan.planHash, "base reasoning planHash");
  if (sha256Json(normalized) !== planHash) {
    throw new RoutingError("INVALID_INPUT", "Base reasoning plan hash does not match its contents.");
  }
  return Object.freeze({ ...normalized, planHash }) as ReasoningPlan;
}

function normalizeWeaknessReport(value: WeaknessMiningReport): WeaknessMiningReport {
  const report = objectValue(value, "weakness report");
  exactKeys(
    report,
    [
      "benchmarkHash",
      "profileHash",
      "suiteVersion",
      "harnessVersion",
      "comparablePairCount",
      "incompletePairCount",
      "attributableHeatmap",
      "infrastructureHeatmap",
      "pairedDeltas",
      "diagnosticHashes",
      "reportHash",
    ],
    [],
    "weakness report",
  );
  const attributableHeatmap = normalizeHeatmap(report.attributableHeatmap, "attributableHeatmap", false);
  const infrastructureHeatmap = normalizeHeatmap(
    report.infrastructureHeatmap,
    "infrastructureHeatmap",
    true,
  );
  if (!Array.isArray(report.pairedDeltas) || report.pairedDeltas.length > 2_000) {
    throw new RoutingError("INVALID_INPUT", "Weakness paired deltas exceed their bound.");
  }
  if (!Array.isArray(report.diagnosticHashes) || report.diagnosticHashes.length > 2_000) {
    throw new RoutingError("INVALID_INPUT", "Weakness diagnostic hashes exceed their bound.");
  }
  const diagnosticHashes = report.diagnosticHashes.map((hash, index) =>
    assertSha256(hash, `diagnosticHashes[${index}]`),
  );
  const normalizedBody = {
    attributableHeatmap,
    benchmarkHash: assertSha256(report.benchmarkHash, "weakness benchmarkHash"),
    comparablePairCount: safeInteger(report.comparablePairCount, "comparablePairCount", 0, 10_000),
    diagnosticHashes: Object.freeze(diagnosticHashes),
    harnessVersion: identifier(report.harnessVersion, "weakness harnessVersion"),
    incompletePairCount: safeInteger(report.incompletePairCount, "incompletePairCount", 0, 10_000),
    infrastructureHeatmap,
    pairedDeltas: report.pairedDeltas,
    profileHash: assertSha256(report.profileHash, "weakness profileHash"),
    suiteVersion: identifier(report.suiteVersion, "weakness suiteVersion"),
  } as const;
  const reportHash = assertSha256(report.reportHash, "weakness reportHash");
  if (sha256Json(normalizedBody) !== reportHash) {
    throw new RoutingError("INVALID_INPUT", "Weakness report hash does not match its contents.");
  }
  return Object.freeze({ ...normalizedBody, reportHash }) as WeaknessMiningReport;
}

function normalizeHeatmap(value: unknown, label: string, infrastructure: boolean): readonly WeaknessHeatmapEntry[] {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw new RoutingError("INVALID_INPUT", `${label} exceeds its bounded collection size.`);
  }
  return Object.freeze(
    value.map((entryValue, index) => {
      const entry = objectValue(entryValue, `${label}[${index}]`);
      exactKeys(
        entry,
        ["arm", "weaknessClass", "code", "affectedResults", "severityPoints", "maxSeverity"],
        [],
        `${label}[${index}]`,
      );
      if (entry.arm !== "model_alone" && entry.arm !== "odin") {
        throw new RoutingError("INVALID_INPUT", `${label}[${index}] arm is invalid.`);
      }
      const weaknessClass = entry.weaknessClass as WeaknessClass;
      if (!WEAKNESS_CLASSES.has(weaknessClass)) {
        throw new RoutingError("INVALID_INPUT", `${label}[${index}] weakness class is invalid.`);
      }
      if (infrastructure && weaknessClass !== "infrastructure" && weaknessClass !== "unknown") {
        throw new RoutingError("INVALID_INPUT", "Infrastructure heatmap contains attributable weakness.");
      }
      if (!infrastructure && weaknessClass === "infrastructure") {
        throw new RoutingError("INVALID_INPUT", "Attributable heatmap contains infrastructure weakness.");
      }
      return Object.freeze({
        affectedResults: safeInteger(entry.affectedResults, `${label}[${index}] affectedResults`, 1, 10_000),
        arm: entry.arm,
        code: identifier(entry.code, `${label}[${index}] code`),
        maxSeverity: safeInteger(entry.maxSeverity, `${label}[${index}] maxSeverity`, 1, 10),
        severityPoints: safeInteger(entry.severityPoints, `${label}[${index}] severityPoints`, 1, 100_000),
        weaknessClass,
      }) as WeaknessHeatmapEntry;
    }),
  );
}

function aggregateWeaknesses(entries: readonly WeaknessHeatmapEntry[]): ReadonlyMap<WeaknessClass, number> {
  const totals = new Map<WeaknessClass, number>();
  for (const entry of entries) {
    totals.set(entry.weaknessClass, (totals.get(entry.weaknessClass) ?? 0) + entry.severityPoints);
  }
  return totals;
}

function addWeaknessStrategies(
  strategies: Set<AmplificationStrategy>,
  reasons: Set<string>,
  signals: ReadonlyMap<WeaknessClass, number>,
  domain: BenchmarkV2Domain,
): void {
  for (const weaknessClass of [...signals.keys()].sort()) {
    reasons.add(`weakness_${weaknessClass}`);
    switch (weaknessClass) {
      case "reasoning":
        strategies.add("decompose");
        strategies.add("counterexample_search");
        if (domain === "math" || domain === "reasoning") strategies.add("constraint_solve");
        break;
      case "coding":
        strategies.add("decompose");
        strategies.add("targeted_repair");
        strategies.add("independent_critique");
        break;
      case "tool":
        strategies.add("tool_ground");
        strategies.add("independent_critique");
        break;
      case "context":
        strategies.add("retrieve_context");
        strategies.add("decompose");
        break;
      case "model":
        strategies.add("strict_output");
        strategies.add("targeted_repair");
        break;
      case "verification":
        strategies.add("independent_critique");
        strategies.add("targeted_repair");
        break;
      case "budget":
        reasons.add("preserve_budget_headroom");
        break;
      case "infrastructure":
      case "unknown":
        break;
    }
  }
}

function addDomainStrategies(
  strategies: Set<AmplificationStrategy>,
  reasons: Set<string>,
  domain: BenchmarkV2Domain,
  complexityBps: number,
  risk: RoutingRisk,
): void {
  if (domain === "math") {
    strategies.add("constraint_solve");
    strategies.add("numeric_consistency");
    reasons.add("domain_math");
  }
  if (domain === "reasoning" || domain === "long_mission") {
    strategies.add("backward_reason");
    reasons.add(`domain_${domain}`);
  }
  if (domain === "tool_use" || domain === "research") {
    strategies.add("tool_ground");
    reasons.add(`domain_${domain}`);
  }
  if (domain === "long_context") {
    strategies.add("retrieve_context");
    reasons.add("domain_long_context");
  }
  if (complexityBps >= 7_500) {
    strategies.add("decompose");
    reasons.add("high_complexity");
  }
  if (risk === "high" || risk === "critical") {
    strategies.add("counterexample_search");
    strategies.add("independent_critique");
    reasons.add(`risk_${risk}`);
  }
}

function deriveContextCeiling(maxContextTokens: number, contextSeverity: number, domain: BenchmarkV2Domain): number {
  if (contextSeverity > 0) return Math.max(1, Math.floor(maxContextTokens * 0.6));
  if (domain === "long_context") return Math.max(1, Math.floor(maxContextTokens * 0.8));
  return maxContextTokens;
}
