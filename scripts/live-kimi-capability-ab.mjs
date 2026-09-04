import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  CandidateEvaluationProvider,
  createLiveProviderCallCounter,
  M15_DISTILLED_CAPABILITY_DRAFTS,
  M15_KIMI_CODING_AB_PROFILE,
} from "../dist/src/capability-packs/index.js";
import {
  classifyLiveFailure,
  isTerminalLiveMeasurementFailure,
  summarizeLiveComparisons,
} from "../dist/src/capability-packs/live-evidence.js";
import { InMemoryEventStore } from "../dist/src/events/store.js";
import { MissionRuntime } from "../dist/src/mission/runtime.js";
import { CapabilityRegistry, makeCapabilities } from "../dist/src/providers/capabilities.js";
import { NvidiaProvider } from "../dist/src/providers/nvidia.js";
import { CodingOrchestrator } from "../dist/src/runtime/coding.js";
import { normalizePackage } from "../dist/src/skills/registry.js";
import { InMemoryToolAuditSink } from "../dist/src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../dist/src/tools/policy.js";
import { ToolRegistry } from "../dist/src/tools/registry.js";
import { createRepositoryToolRegistrations } from "../dist/src/tools/repository.js";
import { ToolRuntime } from "../dist/src/tools/runtime.js";
import { IndependentVerificationEngine } from "../dist/src/verification/engine.js";
import { FixtureWorkspace } from "../dist/test/runtime/coding-fixtures.js";

const PROFILE = M15_KIMI_CODING_AB_PROFILE;
const MODEL = PROFILE.model;
const RESULT_PATH = process.env.ODIN_M15_AB_RESULT_PATH ?? "m15-kimi-coding-ab.json";
const MAX_PROVIDER_CALLS = PROFILE.maxProviderCalls;
const MAX_CALLS_PER_ARM_CASE = PROFILE.maxCallsPerArmCase;

function executionProfileEvidence() {
  return {
    acceptanceLatencyMs: PROFILE.acceptanceLatencyMs,
    maxCallsPerArmCase: PROFILE.maxCallsPerArmCase,
    maxProviderCalls: PROFILE.maxProviderCalls,
    profileVersion: PROFILE.profileVersion,
    providerTimeoutMs: PROFILE.providerTimeoutMs,
    reasoningEffort: PROFILE.reasoningEffort,
    temperature: PROFILE.temperature,
  };
}

const CASES = Object.freeze([
  Object.freeze({
    id: "canonical-user-id",
    objective:
      "Canonicalize selectUserId consistently with canonicalizeId while preserving the existing exports.",
    targetPath: "src/user.ts",
    files: Object.freeze({
      "README.md": "Identity values must be canonicalized consistently across the repository.",
      "package.json": JSON.stringify({ name: "m15-kimi-case-identity", private: true }),
      "src/identity.ts":
        "export function canonicalizeId(value: string): string {\n  return value.trim().toLowerCase();\n}\n",
      "src/user.ts":
        'import { canonicalizeId } from "./identity.js";\n\nexport function selectUserId(value: string): string {\n  return value;\n}\n',
    }),
    expected:
      'import { canonicalizeId } from "./identity.js";\n\nexport function selectUserId(value: string): string {\n  return canonicalizeId(value);\n}\n',
    accepts: (content) =>
      content.includes('import { canonicalizeId } from "./identity.js";') &&
      content.includes("return canonicalizeId(value);") &&
      content.includes("export function selectUserId(value: string): string"),
  }),
  Object.freeze({
    id: "retry-429-surgical",
    objective:
      "Repair shouldRetry so HTTP 429 is retryable without changing retryDelayMs or the API.",
    targetPath: "src/retry.ts",
    files: Object.freeze({
      "README.md": "Retry policy treats throttling and transient server failures as retryable.",
      "package.json": JSON.stringify({ name: "m15-kimi-case-retry", private: true }),
      "src/retry.ts":
        "export function shouldRetry(status: number): boolean {\n  if (status === 429) return false;\n  if (status >= 500) return true;\n  return false;\n}\n\nexport function retryDelayMs(attempt: number): number {\n  return Math.min(1000 * 2 ** attempt, 8000);\n}\n",
    }),
    expected:
      "export function shouldRetry(status: number): boolean {\n  if (status === 429) return true;\n  if (status >= 500) return true;\n  return false;\n}\n\nexport function retryDelayMs(attempt: number): number {\n  return Math.min(1000 * 2 ** attempt, 8000);\n}\n",
    accepts: (content) =>
      content.includes("if (status === 429) return true;") &&
      content.includes(
        "export function retryDelayMs(attempt: number): number {\n  return Math.min(1000 * 2 ** attempt, 8000);\n}",
      ),
  }),
  Object.freeze({
    id: "safe-trim-existing-api",
    objective:
      "safeTrim parseLabel input using the existing repository helper while preserving internal whitespace and the exported API.",
    targetPath: "src/label.ts",
    files: Object.freeze({
      "README.md": "Labels preserve internal whitespace and remove only surrounding whitespace.",
      "package.json": JSON.stringify({ name: "m15-kimi-case-label", private: true }),
      "src/label.ts":
        'import { safeTrim } from "./text.js";\n\nexport function parseLabel(value: string): string {\n  return value;\n}\n',
      "src/text.ts":
        'export function safeTrim(value: string): string {\n  return value.trim();\n}\n\nexport function collapseWhitespace(value: string): string {\n  return value.replace(/\\s+/g, " " ).trim();\n}\n',
    }),
    expected:
      'import { safeTrim } from "./text.js";\n\nexport function parseLabel(value: string): string {\n  return safeTrim(value);\n}\n',
    accepts: (content) =>
      content.includes('import { safeTrim } from "./text.js";') &&
      content.includes("return safeTrim(value);") &&
      content.includes("export function parseLabel(value: string): string"),
  }),
]);

class CaseQualityRunner {
  #workspace;
  #caseSpec;

  constructor(workspace, caseSpec) {
    this.#workspace = workspace;
    this.#caseSpec = caseSpec;
  }

  commands() {
    return [{ id: "verify", label: `M15 ${this.#caseSpec.id} verification` }];
  }

  async run(commandId, signal) {
    if (signal.aborted) throw new Error("A/B fixture quality check aborted.");
    if (commandId !== "verify") throw new Error("Unknown A/B fixture quality command.");
    const content = this.#workspace.content(this.#caseSpec.targetPath);
    return this.#caseSpec.accepts(content)
      ? { exitCode: 0, output: `m15 ${this.#caseSpec.id} passed` }
      : { exitCode: 1, output: `m15 ${this.#caseSpec.id} failed deterministic acceptance` };
  }
}

function capabilityRegistry(observedAt) {
  return new CapabilityRegistry([
    {
      capabilities: makeCapabilities({
        contextWindowTokens: 1_048_576,
        imageInput: true,
        maxOutputTokens: 65_536,
        reasoningEfforts: ["low", "high", "max"],
        streaming: true,
        strictStructuredOutput: true,
        strictToolSchema: true,
        structuredOutput: true,
        temperature: true,
        textInput: true,
        toolUse: true,
      }),
      model: MODEL,
      provider: "nvidia",
      provenance: {
        kind: "provider",
        observedAt,
        reference: "https://docs.api.nvidia.com/nim/reference/moonshotai/kimi-k3-infer",
      },
      version: "nvidia-build-2026-09-04",
    },
  ]);
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function codingDraft() {
  const draft = M15_DISTILLED_CAPABILITY_DRAFTS.find((entry) => entry.domain === "coding");
  if (draft === undefined) throw new Error("M15 coding capability draft is unavailable.");
  return { draft, package: normalizePackage(draft.package) };
}

function scoreCase(caseSpec, run) {
  let score = 0;
  if (run.completed) score += 3_500;
  if (run.verification === "PASS") score += 2_000;
  if (caseSpec.accepts(run.finalContent)) score += 2_000;
  if (run.finalContent === caseSpec.expected) score += 1_500;
  if (run.firstPass) score += 500;
  if (run.changedFiles.length === 1 && run.changedFiles[0] === caseSpec.targetPath) score += 500;
  return Math.min(10_000, score);
}

async function runArm({ arm, baseProvider, caseSpec, candidate, observedAt }) {
  const workspace = new FixtureWorkspace(caseSpec.files);
  const initialContent = workspace.content(caseSpec.targetPath);
  const quality = new CaseQualityRunner(workspace, caseSpec);
  const audit = new InMemoryToolAuditSink();
  const policy = new InMemoryCapabilityPolicy();
  const tools = new ToolRuntime(
    new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace })),
    policy,
    audit,
    () => observedAt,
  );
  const mission = new MissionRuntime(new InMemoryEventStore(), () => observedAt);
  const provider =
    arm === "candidate"
      ? new CandidateEvaluationProvider(baseProvider, {
          candidateContentHash: candidate.contentHash,
          instructions: candidate.instructions,
          sourceReference: candidate.provenance.reference,
        })
      : baseProvider;
  const coding = new CodingOrchestrator({
    audit,
    clock: () => observedAt,
    grants: policy,
    mission,
    model: MODEL,
    provider,
    quality,
    tools,
    verification: new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 }),
  });
  const started = performance.now();
  const beforeCalls = baseProvider.callCounter.value;
  try {
    const result = await coding.start({
      budgetLimits: {
        attempts: 40,
        costMicros: 0,
        inputTokens: 40_000,
        outputTokens: 20_000,
        toolCalls: 40,
      },
      missionId: `m15-kimi-${arm}-${caseSpec.id}-${Date.now()}`,
      objective: caseSpec.objective,
    });
    const latencyMs = Math.round(performance.now() - started);
    if (result.status !== "completed") throw new Error("A/B fixture unexpectedly interrupted.");
    const calls = baseProvider.callCounter.value - beforeCalls;
    if (calls > MAX_CALLS_PER_ARM_CASE) throw new Error("Per-arm provider-call ceiling exceeded.");
    const finalContent = workspace.content(caseSpec.targetPath);
    const run = {
      changedFiles: result.report.changedFiles,
      completed: result.report.state === "COMPLETED",
      errorClass: null,
      errorCode: null,
      finalContent,
      firstPass: result.report.quality.firstFailureSignature === null,
      latencyMs,
      measurementComplete: true,
      modelUsage: result.report.modelUsage,
      mutationObserved: finalContent !== initialContent,
      providerCalls: calls,
      repaired: result.report.quality.firstFailureSignature !== null,
      verification: result.report.verification.outcome,
    };
    return { ...run, qualityBps: scoreCase(caseSpec, run) };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const calls = baseProvider.callCounter.value - beforeCalls;
    const finalContent = workspace.content(caseSpec.targetPath);
    const diagnostic = classifyLiveFailure(error);
    const run = {
      changedFiles: [],
      completed: false,
      errorClass: diagnostic.errorClass,
      errorCode: diagnostic.errorCode,
      finalContent,
      firstPass: false,
      latencyMs,
      measurementComplete: isTerminalLiveMeasurementFailure(diagnostic),
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      mutationObserved: finalContent !== initialContent,
      providerCalls: calls,
      repaired: false,
      verification: "FAIL",
    };
    return { ...run, qualityBps: 0 };
  }
}

function measured(run) {
  return {
    authority: run.verification === "PASS" ? "PASS" : "FAIL",
    latencyMs: run.latencyMs,
    qualityBps: run.qualityBps,
    safety: run.completed && run.verification === "PASS" ? "PASS" : "FAIL",
    totalTokens:
      run.completed && run.measurementComplete
        ? run.modelUsage.inputTokens + run.modelUsage.outputTokens
        : 10_000_000,
  };
}

async function main() {
  const observedAt = new Date().toISOString();
  const dryRun = process.argv.includes("--dry-run");
  const { draft, package: candidate } = codingDraft();
  if (dryRun) {
    const result = {
      candidate: {
        contentHash: candidate.contentHash,
        name: candidate.name,
        version: candidate.version,
      },
      caseIds: CASES.map((entry) => entry.id),
      configured: true,
      executionProfile: executionProfileEvidence(),
      maxProviderCalls: MAX_PROVIDER_CALLS,
      model: MODEL,
      provider: "nvidia",
      secretPresent: false,
    };
    await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
    return;
  }

  const key = process.env.NV_API_KEY;
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("NV_API_KEY is unavailable to the M15 A/B control plane.");
  }
  const registry = capabilityRegistry(observedAt);
  registry.resolve("nvidia", MODEL);
  const callCounter = createLiveProviderCallCounter(MAX_PROVIDER_CALLS);
  const rawProvider = new NvidiaProvider({
    capabilities: registry,
    credential: ({ model, provider }) => {
      if (provider !== "nvidia" || model !== MODEL) {
        throw new Error("Credential request did not match the authorized NVIDIA Kimi K3 identity.");
      }
      return key;
    },
    defaultTimeoutMs: PROFILE.providerTimeoutMs,
    reasoningParameter: "reasoning_effort",
  });
  const baseProvider = {
    id: rawProvider.id,
    callCounter,
    capabilities: (model) => rawProvider.capabilities(model),
    generate: async (request, options) => {
      callCounter.consume();
      return rawProvider.generate(
        { ...request, reasoningEffort: PROFILE.reasoningEffort, temperature: PROFILE.temperature },
        options,
      );
    },
    stream: (request, options) => {
      callCounter.consume();
      return rawProvider.stream(
        { ...request, reasoningEffort: PROFILE.reasoningEffort, temperature: PROFILE.temperature },
        options,
      );
    },
  };

  const cases = [];
  for (const caseSpec of CASES) {
    const baseline = await runArm({
      arm: "baseline",
      baseProvider,
      candidate,
      caseSpec,
      observedAt,
    });
    const candidateRun = await runArm({
      arm: "candidate",
      baseProvider,
      candidate,
      caseSpec,
      observedAt,
    });
    const evidencePayload = {
      baseline: {
        completed: baseline.completed,
        firstPass: baseline.firstPass,
        finalContentHash: stableHash(baseline.finalContent),
        qualityBps: baseline.qualityBps,
        verification: baseline.verification,
      },
      candidate: {
        completed: candidateRun.completed,
        firstPass: candidateRun.firstPass,
        finalContentHash: stableHash(candidateRun.finalContent),
        qualityBps: candidateRun.qualityBps,
        verification: candidateRun.verification,
      },
      caseId: caseSpec.id,
      executionProfileVersion: PROFILE.profileVersion,
    };
    cases.push({
      baseline: measured(baseline),
      candidate: measured(candidateRun),
      evidenceRef: `m15:kimi:${caseSpec.id}:${stableHash(evidencePayload).slice(0, 32)}`,
      id: caseSpec.id,
      maxCandidateLatencyMs: PROFILE.acceptanceLatencyMs,
      maxCandidateTokens: 8_000,
      requiredQualityBps: 8_500,
      taskClass: "coding-change",
      sanitized: {
        baseline: {
          ...evidencePayload.baseline,
          errorClass: baseline.errorClass,
          errorCode: baseline.errorCode,
          latencyMs: baseline.latencyMs,
          measurementComplete: baseline.measurementComplete,
          mutationObserved: baseline.mutationObserved,
          providerCalls: baseline.providerCalls,
          totalTokens: measured(baseline).totalTokens,
        },
        candidate: {
          ...evidencePayload.candidate,
          errorClass: candidateRun.errorClass,
          errorCode: candidateRun.errorCode,
          latencyMs: candidateRun.latencyMs,
          measurementComplete: candidateRun.measurementComplete,
          mutationObserved: candidateRun.mutationObserved,
          providerCalls: candidateRun.providerCalls,
          totalTokens: measured(candidateRun).totalTokens,
        },
      },
    });
  }

  const attestationCases = cases.map(({ sanitized: _sanitized, ...entry }) => entry);
  const attestation = {
    candidate: {
      contentHash: candidate.contentHash,
      name: candidate.name,
      version: candidate.version,
    },
    cases: attestationCases,
    domain: "coding",
    evaluatedAt: observedAt,
    producerClass: "independent_test",
  };
  const summary = summarizeLiveComparisons(
    cases.map((entry) => ({
      baseline: {
        measurementComplete: entry.sanitized.baseline.measurementComplete,
        qualityBps: entry.baseline.qualityBps,
      },
      candidate: {
        measurementComplete: entry.sanitized.candidate.measurementComplete,
        qualityBps: entry.candidate.qualityBps,
      },
    })),
  );
  const sanitized = {
    attestation,
    candidateSources: draft.sourceRefs,
    executionProfile: executionProfileEvidence(),
    model: MODEL,
    provider: "nvidia",
    providerCalls: callCounter.value,
    results: cases.map((entry) => ({ id: entry.id, sanitized: entry.sanitized })),
    summary,
  };
  await writeFile(RESULT_PATH, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(sanitized.summary));
}

await main();
