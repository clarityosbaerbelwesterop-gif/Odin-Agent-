import {
  BENCHMARK_V2_DOMAINS,
  type BenchmarkV2Domain,
  type BenchmarkV2Report,
  type BenchmarkV2Suite,
  createBenchmarkV2Suite,
  evaluateBenchmarkV2,
  type FrontierArmResult,
  type FrontierEvidenceStatus,
  type FrontierFailureCategory,
} from "../frontier-evals/index.js";
import {
  AMPLIFICATION_POLICY_VERSION,
  type AmplificationStrategy,
  type ReasoningAmplificationPlan,
} from "./amplification.js";
import {
  assertSha256,
  exactKeys,
  identifier,
  objectValue,
  safeInteger,
  sha256Json,
} from "./internal.js";
import {
  type OutputDiscipline,
  type ScaffoldingMode,
  type ToolGroundingMode,
  WEAK_MODEL_SCAFFOLDING_VERSION,
  type WeakModelScaffoldingPlan,
} from "./scaffolding.js";
import { RoutingError } from "./types.js";

export const FRONTIER_AMPLIFICATION_VERSION = "intelligence-f-v1" as const;

export interface FrontierAmplificationComponent {
  readonly domain: BenchmarkV2Domain;
  readonly amplification: ReasoningAmplificationPlan;
  readonly scaffolding: WeakModelScaffoldingPlan;
}

export interface FrontierAmplificationCandidateInput {
  readonly benchmark: BenchmarkV2Suite;
  readonly components: readonly FrontierAmplificationComponent[];
}

export interface FrontierAmplificationCandidate {
  readonly version: typeof FRONTIER_AMPLIFICATION_VERSION;
  readonly authority: "evaluation_only";
  readonly routingEligible: false;
  readonly promotionEligible: false;
  readonly benchmarkHash: string;
  readonly profileHash: string;
  readonly components: readonly FrontierAmplificationComponent[];
  readonly candidateHash: string;
}

export interface FrontierWeaknessDelta {
  readonly failureCategory: FrontierFailureCategory;
  readonly baselineAffected: number;
  readonly odinAffected: number;
  readonly affectedDelta: number;
}

export interface FrontierAmplificationDomainReport {
  readonly domain: BenchmarkV2Domain;
  readonly caseCount: number;
  readonly completePairs: number;
  readonly incompletePairs: number;
  readonly infrastructurePairs: number;
  readonly status: FrontierEvidenceStatus;
  readonly qualityLiftBps: number | null;
  readonly tokenDeltaBps: number | null;
  readonly latencyDeltaBps: number | null;
  readonly verificationPassDeltaBps: number | null;
  readonly recoveryDelta: number | null;
  readonly repairDelta: number | null;
  readonly weaknessDeltas: readonly FrontierWeaknessDelta[];
}

export interface FrontierAmplificationReport {
  readonly version: typeof FRONTIER_AMPLIFICATION_VERSION;
  readonly authority: "analytics_only";
  readonly routingEligible: false;
  readonly promotionEligible: false;
  readonly candidateHash: string;
  readonly benchmarkHash: string;
  readonly benchmarkReportHash: string;
  readonly status: FrontierEvidenceStatus;
  readonly domains: readonly FrontierAmplificationDomainReport[];
  readonly reportHash: string;
}

const FAILURE_CATEGORIES: readonly FrontierFailureCategory[] = [
  "quality",
  "verification",
  "budget",
  "contract",
  "unknown",
];

const AMPLIFICATION_STRATEGIES = new Set<AmplificationStrategy>([
  "backward_reason",
  "constraint_solve",
  "counterexample_search",
  "decompose",
  "direct",
  "independent_critique",
  "numeric_consistency",
  "retrieve_context",
  "strict_output",
  "targeted_repair",
  "tool_ground",
]);
const SCAFFOLDING_MODES = new Set<ScaffoldingMode>(["AMPLIFIED", "STANDARD"]);
const OUTPUT_DISCIPLINES = new Set<OutputDiscipline>([
  "strict_structured",
  "structured_validated",
  "text_contract",
]);
const TOOL_GROUNDING_MODES = new Set<ToolGroundingMode>([
  "required_if_available",
  "unsupported",
  "not_required",
]);
const DEFICIENCIES = new Set([
  "context_window_below_floor",
  "output_limit_below_floor",
  "pass_rate_below_floor",
  "quality_below_floor",
  "sample_support_below_floor",
]);
const DIRECTIVES = new Set([
  "bounded_context_chunks",
  "decompose_before_execution",
  "ground_claims_before_mutation",
  "independent_verification_required",
  "output_contract_guard",
  "reject_no_change_repair",
  "reserve_repair_headroom",
  "surgical_repair_only",
  "tool_grounding",
  "tool_grounding_unavailable",
]);

export function createFrontierAmplificationCandidate(
  value: FrontierAmplificationCandidateInput,
): FrontierAmplificationCandidate {
  const input = objectValue(value, "frontier amplification candidate input");
  exactKeys(input, ["benchmark", "components"], [], "frontier amplification candidate input");
  const benchmark = normalizeBenchmark(input.benchmark as BenchmarkV2Suite);
  if (!Array.isArray(input.components) || input.components.length !== BENCHMARK_V2_DOMAINS.length) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification candidate requires exactly one component for every Benchmark 2.0 domain.",
    );
  }

  const components = input.components
    .map((component) => normalizeComponent(component, benchmark))
    .sort((left, right) => left.domain.localeCompare(right.domain));
  const domains = new Set(components.map((component) => component.domain));
  if (domains.size !== BENCHMARK_V2_DOMAINS.length) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification candidate contains duplicate or missing domain components.",
    );
  }
  for (const domain of BENCHMARK_V2_DOMAINS) {
    if (!domains.has(domain)) {
      throw new RoutingError(
        "INVALID_INPUT",
        "Frontier amplification candidate is missing a Benchmark 2.0 domain.",
      );
    }
  }

  for (const current of benchmark.cases) {
    const component = components.find((entry) => entry.domain === current.domain);
    if (component === undefined) {
      throw new RoutingError(
        "INVALID_INPUT",
        "Frontier amplification domain component disappeared.",
      );
    }
    if (component.scaffolding.maxModelCalls > current.frontierCase.budget.maxModelCalls) {
      throw new RoutingError(
        "BUDGET_EXCEEDED",
        "Frontier amplification model-call ceiling exceeds a Benchmark 2.0 case budget.",
      );
    }
    const caseTokenBudget =
      current.frontierCase.budget.maxInputTokens + current.frontierCase.budget.maxOutputTokens;
    if (component.scaffolding.maxEstimatedTokens > caseTokenBudget) {
      throw new RoutingError(
        "BUDGET_EXCEEDED",
        "Frontier amplification token ceiling exceeds a Benchmark 2.0 case budget.",
      );
    }
  }

  const body = {
    authority: "evaluation_only" as const,
    benchmarkHash: benchmark.benchmarkHash,
    componentIdentities: components.map((component) => ({
      amplificationPlanHash: component.amplification.planHash,
      amplificationPolicyVersion: component.amplification.policyVersion,
      domain: component.domain,
      maxEstimatedTokens: component.scaffolding.maxEstimatedTokens,
      maxModelCalls: component.scaffolding.maxModelCalls,
      scaffoldingPlanHash: component.scaffolding.planHash,
      scaffoldingVersion: component.scaffolding.version,
    })),
    profileHash: benchmark.profile.profileHash,
    promotionEligible: false as const,
    routingEligible: false as const,
    version: FRONTIER_AMPLIFICATION_VERSION,
  };
  return Object.freeze({
    authority: body.authority,
    benchmarkHash: body.benchmarkHash,
    candidateHash: sha256Json(body),
    components: Object.freeze(components),
    profileHash: body.profileHash,
    promotionEligible: false,
    routingEligible: false,
    version: FRONTIER_AMPLIFICATION_VERSION,
  });
}

export function evaluateFrontierAmplification(inputValue: {
  readonly benchmark: BenchmarkV2Suite;
  readonly candidate: FrontierAmplificationCandidate;
  readonly harnessVersion: string;
  readonly results: readonly FrontierArmResult[];
}): FrontierAmplificationReport {
  const input = objectValue(inputValue, "frontier amplification evaluation");
  exactKeys(
    input,
    ["benchmark", "candidate", "harnessVersion", "results"],
    [],
    "frontier amplification evaluation",
  );
  const benchmark = normalizeBenchmark(input.benchmark as BenchmarkV2Suite);
  const candidate = validateCandidate(input.candidate as FrontierAmplificationCandidate, benchmark);
  if (!Array.isArray(input.results)) {
    throw new RoutingError("INVALID_INPUT", "Frontier amplification results must be an array.");
  }

  const benchmarkReport = evaluateBenchmarkV2({
    benchmark,
    harnessVersion: input.harnessVersion as string,
    results: input.results as readonly FrontierArmResult[],
  });
  const pairsByCase = pairResults(input.results as readonly FrontierArmResult[]);
  const domains = Object.freeze(
    BENCHMARK_V2_DOMAINS.map((domain) =>
      buildDomainReport(domain, benchmark, benchmarkReport, pairsByCase),
    ),
  );
  const body = {
    authority: "analytics_only" as const,
    benchmarkHash: benchmark.benchmarkHash,
    benchmarkReportHash: benchmarkReport.reportHash,
    candidateHash: candidate.candidateHash,
    domains,
    promotionEligible: false as const,
    routingEligible: false as const,
    status: benchmarkReport.frontierReport.status,
    version: FRONTIER_AMPLIFICATION_VERSION,
  };
  return Object.freeze({ ...body, reportHash: sha256Json(body) });
}

function normalizeBenchmark(value: BenchmarkV2Suite): BenchmarkV2Suite {
  const rebuilt = createBenchmarkV2Suite({
    cases: value.cases,
    profile: value.profile,
    suiteVersion: value.suiteVersion,
  });
  if (
    value.benchmarkHash !== rebuilt.benchmarkHash ||
    value.blueprintVersion !== rebuilt.blueprintVersion
  ) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification benchmark identity is invalid.",
    );
  }
  return rebuilt;
}

function normalizeComponent(
  value: unknown,
  benchmark: BenchmarkV2Suite,
): FrontierAmplificationComponent {
  const component = objectValue(value, "frontier amplification component");
  exactKeys(
    component,
    ["domain", "amplification", "scaffolding"],
    [],
    "frontier amplification component",
  );
  if (
    typeof component.domain !== "string" ||
    !BENCHMARK_V2_DOMAINS.includes(component.domain as BenchmarkV2Domain)
  ) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification component domain is unsupported.",
    );
  }
  const domain = component.domain as BenchmarkV2Domain;
  const amplification = normalizeAmplification(
    component.amplification as ReasoningAmplificationPlan,
  );
  const scaffolding = normalizeScaffolding(component.scaffolding as WeakModelScaffoldingPlan);
  if (
    amplification.domain !== domain ||
    scaffolding.domain !== domain ||
    amplification.profileHash !== benchmark.profile.profileHash ||
    scaffolding.profileHash !== benchmark.profile.profileHash ||
    amplification.benchmarkHash !== benchmark.benchmarkHash
  ) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification component does not match the exact benchmark/profile/domain binding.",
    );
  }
  if (scaffolding.amplificationPlanHash !== amplification.planHash) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification scaffolding does not bind the exact Phase D plan.",
    );
  }
  if (
    scaffolding.maxModelCalls !== amplification.maxModelCalls ||
    scaffolding.maxEstimatedTokens !== amplification.maxEstimatedTokens
  ) {
    throw new RoutingError(
      "BUDGET_EXCEEDED",
      "Phase E scaffolding must preserve the exact Phase D runtime-owned ceilings.",
    );
  }
  if (amplification.contextTokenCeiling > benchmark.profile.contextWindowTokens) {
    throw new RoutingError(
      "BUDGET_EXCEEDED",
      "Phase D context ceiling exceeds the bound evaluation profile.",
    );
  }
  const expectedOutputDiscipline: OutputDiscipline = benchmark.profile.strictStructuredOutput
    ? "strict_structured"
    : benchmark.profile.structuredOutput
      ? "structured_validated"
      : "text_contract";
  if (scaffolding.outputDiscipline !== expectedOutputDiscipline) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Phase E output discipline does not match the bound capability profile.",
    );
  }
  const expectedToolGrounding: ToolGroundingMode =
    domain === "tool_use" || domain === "research"
      ? benchmark.profile.toolUse
        ? "required_if_available"
        : "unsupported"
      : "not_required";
  if (scaffolding.toolGrounding !== expectedToolGrounding) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Phase E tool grounding does not match the bound capability profile.",
    );
  }
  const targetedRepair = amplification.strategies.includes("targeted_repair");
  if (
    scaffolding.surgicalRepairOnly !== targetedRepair ||
    scaffolding.rejectNoChangeRepair !== targetedRepair
  ) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Phase E repair policy does not match the exact Phase D strategy set.",
    );
  }
  if (
    scaffolding.requiresIndependentVerification !==
    (scaffolding.mode === "AMPLIFIED" || amplification.requiresIndependentVerification)
  ) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Phase E verification policy does not match its D/E inputs.",
    );
  }
  return Object.freeze({ amplification, domain, scaffolding });
}

function normalizeAmplification(value: ReasoningAmplificationPlan): ReasoningAmplificationPlan {
  const plan = objectValue(value, "Phase D amplification plan");
  exactKeys(
    plan,
    [
      "policyVersion",
      "benchmarkHash",
      "profileHash",
      "weaknessReportHash",
      "domain",
      "strategies",
      "branchCount",
      "critiquePasses",
      "repairAttempts",
      "maxModelCalls",
      "maxEstimatedTokens",
      "contextTokenCeiling",
      "requiresIndependentVerification",
      "reasonCodes",
      "planHash",
    ],
    [],
    "Phase D amplification plan",
  );
  if (plan.policyVersion !== AMPLIFICATION_POLICY_VERSION) {
    throw new RoutingError("INVALID_INPUT", "Phase D amplification version is unsupported.");
  }
  if (!Array.isArray(plan.strategies) || !Array.isArray(plan.reasonCodes)) {
    throw new RoutingError("INVALID_INPUT", "Phase D amplification collections are malformed.");
  }
  const strategies = plan.strategies.map((strategy, index) => {
    if (
      typeof strategy !== "string" ||
      !AMPLIFICATION_STRATEGIES.has(strategy as AmplificationStrategy)
    ) {
      throw new RoutingError("INVALID_INPUT", `Phase D strategy at index ${index} is unsupported.`);
    }
    return strategy as AmplificationStrategy;
  });
  if (new Set(strategies).size !== strategies.length) {
    throw new RoutingError("INVALID_INPUT", "Phase D strategies contain duplicates.");
  }
  const reasonCodes = plan.reasonCodes.map((reason, index) =>
    identifier(reason, `Phase D reasonCodes[${index}]`),
  );
  if (new Set(reasonCodes).size !== reasonCodes.length) {
    throw new RoutingError("INVALID_INPUT", "Phase D reason codes contain duplicates.");
  }
  if (
    typeof plan.domain !== "string" ||
    !BENCHMARK_V2_DOMAINS.includes(plan.domain as BenchmarkV2Domain)
  ) {
    throw new RoutingError("INVALID_INPUT", "Phase D domain is unsupported.");
  }
  const domain = plan.domain as BenchmarkV2Domain;
  const body = {
    benchmarkHash: assertSha256(plan.benchmarkHash, "Phase D benchmarkHash"),
    branchCount: safeInteger(plan.branchCount, "Phase D branchCount", 1, 100),
    contextTokenCeiling: safeInteger(
      plan.contextTokenCeiling,
      "Phase D contextTokenCeiling",
      1,
      100_000_000,
    ),
    critiquePasses: safeInteger(plan.critiquePasses, "Phase D critiquePasses", 0, 100),
    domain,
    maxEstimatedTokens: safeInteger(
      plan.maxEstimatedTokens,
      "Phase D maxEstimatedTokens",
      0,
      100_000_000,
    ),
    maxModelCalls: safeInteger(plan.maxModelCalls, "Phase D maxModelCalls", 1, 100),
    policyVersion: plan.policyVersion,
    profileHash: assertSha256(plan.profileHash, "Phase D profileHash"),
    reasonCodes: Object.freeze(reasonCodes),
    repairAttempts: safeInteger(plan.repairAttempts, "Phase D repairAttempts", 0, 100),
    requiresIndependentVerification: plan.requiresIndependentVerification,
    strategies: Object.freeze(strategies),
    weaknessReportHash: assertSha256(plan.weaknessReportHash, "Phase D weaknessReportHash"),
  } as const;
  if (typeof body.requiresIndependentVerification !== "boolean") {
    throw new RoutingError("INVALID_INPUT", "Phase D verification requirement must be boolean.");
  }
  const planHash = assertSha256(plan.planHash, "Phase D planHash");
  if (sha256Json(body) !== planHash) {
    throw new RoutingError("INVALID_INPUT", "Phase D plan hash does not match its contents.");
  }
  return Object.freeze({ ...body, planHash }) as ReasoningAmplificationPlan;
}

function normalizeScaffolding(value: WeakModelScaffoldingPlan): WeakModelScaffoldingPlan {
  const plan = objectValue(value, "Phase E scaffolding plan");
  exactKeys(
    plan,
    [
      "version",
      "mode",
      "profileHash",
      "evaluationHash",
      "amplificationPlanHash",
      "domain",
      "deficiencies",
      "directives",
      "decompositionDepth",
      "contextChunkBps",
      "outputDiscipline",
      "toolGrounding",
      "requiresIndependentVerification",
      "surgicalRepairOnly",
      "rejectNoChangeRepair",
      "maxModelCalls",
      "maxEstimatedTokens",
      "planHash",
    ],
    [],
    "Phase E scaffolding plan",
  );
  if (plan.version !== WEAK_MODEL_SCAFFOLDING_VERSION) {
    throw new RoutingError("INVALID_INPUT", "Phase E scaffolding version is unsupported.");
  }
  if (!Array.isArray(plan.deficiencies) || !Array.isArray(plan.directives)) {
    throw new RoutingError("INVALID_INPUT", "Phase E scaffolding collections are malformed.");
  }
  if (
    typeof plan.domain !== "string" ||
    !BENCHMARK_V2_DOMAINS.includes(plan.domain as BenchmarkV2Domain)
  ) {
    throw new RoutingError("INVALID_INPUT", "Phase E domain is unsupported.");
  }
  const domain = plan.domain as BenchmarkV2Domain;
  if (typeof plan.mode !== "string" || !SCAFFOLDING_MODES.has(plan.mode as ScaffoldingMode)) {
    throw new RoutingError("INVALID_INPUT", "Phase E scaffolding mode is unsupported.");
  }
  const mode = plan.mode as ScaffoldingMode;
  if (
    typeof plan.outputDiscipline !== "string" ||
    !OUTPUT_DISCIPLINES.has(plan.outputDiscipline as OutputDiscipline)
  ) {
    throw new RoutingError("INVALID_INPUT", "Phase E output discipline is unsupported.");
  }
  const outputDiscipline = plan.outputDiscipline as OutputDiscipline;
  if (
    typeof plan.toolGrounding !== "string" ||
    !TOOL_GROUNDING_MODES.has(plan.toolGrounding as ToolGroundingMode)
  ) {
    throw new RoutingError("INVALID_INPUT", "Phase E tool grounding mode is unsupported.");
  }
  const toolGrounding = plan.toolGrounding as ToolGroundingMode;
  const deficiencies = plan.deficiencies.map((value, index) => {
    const normalized = identifier(value, `Phase E deficiencies[${index}]`);
    if (!DEFICIENCIES.has(normalized)) {
      throw new RoutingError("INVALID_INPUT", "Phase E deficiency is unsupported.");
    }
    return normalized;
  });
  const directives = plan.directives.map((value, index) => {
    const normalized = identifier(value, `Phase E directives[${index}]`);
    if (!DIRECTIVES.has(normalized)) {
      throw new RoutingError("INVALID_INPUT", "Phase E directive is unsupported.");
    }
    return normalized;
  });
  if (
    new Set(deficiencies).size !== deficiencies.length ||
    new Set(directives).size !== directives.length
  ) {
    throw new RoutingError("INVALID_INPUT", "Phase E collections contain duplicates.");
  }
  if (
    (mode === "STANDARD" && deficiencies.length !== 0) ||
    (mode === "AMPLIFIED" && deficiencies.length === 0)
  ) {
    throw new RoutingError("INVALID_INPUT", "Phase E mode contradicts its deficiency evidence.");
  }
  const contextChunkBps = safeInteger(plan.contextChunkBps, "Phase E contextChunkBps", 1, 10_000);
  if (contextChunkBps !== 5_000 && contextChunkBps !== 10_000) {
    throw new RoutingError("INVALID_INPUT", "Phase E context chunk policy is unsupported.");
  }
  const decompositionDepth = safeInteger(
    plan.decompositionDepth,
    "Phase E decompositionDepth",
    1,
    3,
  );
  const body = {
    amplificationPlanHash: assertSha256(
      plan.amplificationPlanHash,
      "Phase E amplificationPlanHash",
    ),
    contextChunkBps,
    decompositionDepth,
    deficiencies: Object.freeze(deficiencies),
    directives: Object.freeze(directives),
    domain,
    evaluationHash: assertSha256(plan.evaluationHash, "Phase E evaluationHash"),
    maxEstimatedTokens: safeInteger(
      plan.maxEstimatedTokens,
      "Phase E maxEstimatedTokens",
      0,
      100_000_000,
    ),
    maxModelCalls: safeInteger(plan.maxModelCalls, "Phase E maxModelCalls", 1, 100),
    mode,
    outputDiscipline,
    profileHash: assertSha256(plan.profileHash, "Phase E profileHash"),
    rejectNoChangeRepair: plan.rejectNoChangeRepair,
    requiresIndependentVerification: plan.requiresIndependentVerification,
    surgicalRepairOnly: plan.surgicalRepairOnly,
    toolGrounding,
    version: plan.version,
  } as const;
  if (
    typeof body.rejectNoChangeRepair !== "boolean" ||
    typeof body.requiresIndependentVerification !== "boolean" ||
    typeof body.surgicalRepairOnly !== "boolean"
  ) {
    throw new RoutingError("INVALID_INPUT", "Phase E boolean policy fields are malformed.");
  }
  const planHash = assertSha256(plan.planHash, "Phase E planHash");
  if (sha256Json(body) !== planHash) {
    throw new RoutingError("INVALID_INPUT", "Phase E plan hash does not match its contents.");
  }
  return Object.freeze({ ...body, planHash }) as WeakModelScaffoldingPlan;
}

function validateCandidate(
  value: FrontierAmplificationCandidate,
  benchmark: BenchmarkV2Suite,
): FrontierAmplificationCandidate {
  const candidate = objectValue(value, "frontier amplification candidate");
  exactKeys(
    candidate,
    [
      "version",
      "authority",
      "routingEligible",
      "promotionEligible",
      "benchmarkHash",
      "profileHash",
      "components",
      "candidateHash",
    ],
    [],
    "frontier amplification candidate",
  );
  if (
    candidate.version !== FRONTIER_AMPLIFICATION_VERSION ||
    candidate.authority !== "evaluation_only" ||
    candidate.routingEligible !== false ||
    candidate.promotionEligible !== false
  ) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification candidate authority is invalid.",
    );
  }
  const rebuilt = createFrontierAmplificationCandidate({
    benchmark,
    components: candidate.components as readonly FrontierAmplificationComponent[],
  });
  if (
    candidate.candidateHash !== rebuilt.candidateHash ||
    candidate.benchmarkHash !== rebuilt.benchmarkHash ||
    candidate.profileHash !== rebuilt.profileHash
  ) {
    throw new RoutingError(
      "INVALID_INPUT",
      "Frontier amplification candidate hash/binding is invalid.",
    );
  }
  return rebuilt;
}

function pairResults(
  results: readonly FrontierArmResult[],
): ReadonlyMap<string, Partial<Record<"model_alone" | "odin", FrontierArmResult>>> {
  const pairs = new Map<string, Partial<Record<"model_alone" | "odin", FrontierArmResult>>>();
  for (const result of results) {
    const pair = pairs.get(result.caseHash) ?? {};
    pair[result.arm] = result;
    pairs.set(result.caseHash, pair);
  }
  return pairs;
}

function buildDomainReport(
  domain: BenchmarkV2Domain,
  benchmark: BenchmarkV2Suite,
  benchmarkReport: BenchmarkV2Report,
  pairsByCase: ReadonlyMap<string, Partial<Record<"model_alone" | "odin", FrontierArmResult>>>,
): FrontierAmplificationDomainReport {
  const summary = benchmarkReport.domains.find((current) => current.domain === domain);
  if (summary === undefined) {
    throw new RoutingError("INVALID_INPUT", "Benchmark 2.0 domain summary disappeared.");
  }
  let baselineTokens = 0;
  let odinTokens = 0;
  let baselineLatency = 0;
  let odinLatency = 0;
  let baselinePasses = 0;
  let odinPasses = 0;
  let recoveryDelta = 0;
  let repairDelta = 0;
  let measurablePairs = 0;
  const weaknessCounts = new Map<FrontierFailureCategory, { baseline: number; odin: number }>();

  for (const current of benchmark.cases.filter((entry) => entry.domain === domain)) {
    const pair = pairsByCase.get(current.frontierCase.caseHash);
    const baseline = pair?.model_alone;
    const odin = pair?.odin;
    if (
      baseline === undefined ||
      odin === undefined ||
      !isMeasurable(baseline) ||
      !isMeasurable(odin)
    ) {
      continue;
    }
    measurablePairs += 1;
    baselineTokens += baseline.inputTokens + baseline.outputTokens;
    odinTokens += odin.inputTokens + odin.outputTokens;
    baselineLatency += baseline.latencyMs;
    odinLatency += odin.latencyMs;
    baselinePasses += baseline.verification === "PASS" ? 1 : 0;
    odinPasses += odin.verification === "PASS" ? 1 : 0;
    recoveryDelta += odin.recoveries - baseline.recoveries;
    repairDelta += odin.repairs - baseline.repairs;
    recordWeakness(weaknessCounts, baseline.failureCategory, "baseline");
    recordWeakness(weaknessCounts, odin.failureCategory, "odin");
  }

  const weaknessDeltas = Object.freeze(
    FAILURE_CATEGORIES.map((failureCategory) => {
      const counts = weaknessCounts.get(failureCategory);
      return counts === undefined
        ? null
        : Object.freeze({
            affectedDelta: counts.odin - counts.baseline,
            baselineAffected: counts.baseline,
            failureCategory,
            odinAffected: counts.odin,
          });
    }).filter((value): value is FrontierWeaknessDelta => value !== null),
  );

  return Object.freeze({
    caseCount: summary.caseCount,
    completePairs: summary.completePairs,
    domain,
    incompletePairs: summary.incompletePairs,
    infrastructurePairs: summary.infrastructurePairs,
    latencyDeltaBps: measurablePairs === 0 ? null : relativeDeltaBps(baselineLatency, odinLatency),
    qualityLiftBps: summary.qualityLiftBps,
    recoveryDelta: measurablePairs === 0 ? null : recoveryDelta,
    repairDelta: measurablePairs === 0 ? null : repairDelta,
    status: summary.status,
    tokenDeltaBps: measurablePairs === 0 ? null : relativeDeltaBps(baselineTokens, odinTokens),
    verificationPassDeltaBps:
      measurablePairs === 0
        ? null
        : Math.round(((odinPasses - baselinePasses) * 10_000) / measurablePairs),
    weaknessDeltas,
  });
}

function recordWeakness(
  counts: Map<FrontierFailureCategory, { baseline: number; odin: number }>,
  category: FrontierFailureCategory,
  arm: "baseline" | "odin",
): void {
  if (category === "none" || !FAILURE_CATEGORIES.includes(category)) return;
  const current = counts.get(category) ?? { baseline: 0, odin: 0 };
  current[arm] += 1;
  counts.set(category, current);
}

function isMeasurable(value: FrontierArmResult): boolean {
  return value.completed && value.attributable && value.qualityBps !== null;
}

function relativeDeltaBps(baseline: number, candidate: number): number | null {
  if (baseline === 0) return candidate === 0 ? 0 : null;
  return Math.round(((candidate - baseline) * 10_000) / baseline);
}
