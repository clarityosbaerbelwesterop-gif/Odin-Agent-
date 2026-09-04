import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { InMemoryEventStore } from "../dist/src/events/store.js";
import { MissionRuntime } from "../dist/src/mission/runtime.js";
import { CapabilityRegistry, makeCapabilities } from "../dist/src/providers/capabilities.js";
import { isProviderError } from "../dist/src/providers/errors.js";
import { NvidiaProvider } from "../dist/src/providers/nvidia.js";
import { CodingOrchestrator } from "../dist/src/runtime/coding.js";
import { InMemoryToolAuditSink } from "../dist/src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../dist/src/tools/policy.js";
import { ToolRegistry } from "../dist/src/tools/registry.js";
import { createRepositoryToolRegistrations } from "../dist/src/tools/repository.js";
import { ToolRuntime } from "../dist/src/tools/runtime.js";
import { IndependentVerificationEngine } from "../dist/src/verification/engine.js";
import {
  FixtureQualityRunner,
  FixtureWorkspace,
  fixtureFiles,
  TARGET_PATH,
} from "../dist/test/runtime/coding-fixtures.js";

const MODEL = "moonshotai/kimi-k3";
const RESULT_PATH = process.env.ODIN_LIVE_RESULT_PATH ?? "live-smoke-result.json";
const OBJECTIVE = "Fix add function so it returns the sum of both arguments";
const MAX_PROVIDER_CALLS = 2;
const EXPECTED_FINAL_LINE = "return a + b;";

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
        reference: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer",
      },
      version: "nvidia-build-2026-09-04",
    },
  ]);
}

function safeFailure(error, providerCalls, latencyMs) {
  if (isProviderError(error)) {
    return {
      completed: false,
      error: {
        category: error.category,
        code: error.code ?? null,
        name: error.name,
        provider: error.provider,
        retryable: error.retryable,
        status: error.status ?? null,
      },
      latencyMs,
      model: MODEL,
      provider: "nvidia",
      providerCalls,
      score: 0,
    };
  }
  return {
    completed: false,
    error: {
      category: "runtime",
      name: error instanceof Error ? error.name : "UnknownError",
    },
    latencyMs,
    model: MODEL,
    provider: "nvidia",
    providerCalls,
    score: 0,
  };
}

function score(report, finalContent) {
  let value = 0;
  if (report.state === "COMPLETED") value += 30;
  if (report.quality.finalExitCode === 0) value += 25;
  if (report.verification.outcome === "PASS") value += 25;
  if (finalContent.includes(EXPECTED_FINAL_LINE)) value += 10;
  value += report.quality.firstFailureSignature === null ? 10 : 5;
  return value;
}

async function main() {
  const observedAt = new Date().toISOString();
  const dryRun = process.argv.includes("--dry-run");
  const registry = capabilityRegistry(observedAt);
  registry.resolve("nvidia", MODEL);

  if (dryRun) {
    const result = {
      configured: true,
      maxProviderCalls: MAX_PROVIDER_CALLS,
      model: MODEL,
      objective: OBJECTIVE,
      provider: "nvidia",
      secretPresent: false,
    };
    await writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
    return;
  }

  const key = process.env.NV_API_KEY;
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("NV_API_KEY is unavailable to the live smoke control plane.");
  }

  let providerCalls = 0;
  const rawProvider = new NvidiaProvider({
    capabilities: registry,
    credential: ({ model, provider }) => {
      if (provider !== "nvidia" || model !== MODEL) {
        throw new Error("Credential request did not match the authorized NVIDIA Kimi K3 identity.");
      }
      return key;
    },
    defaultTimeoutMs: 180_000,
    reasoningParameter: "reasoning_effort",
  });

  const provider = {
    id: rawProvider.id,
    capabilities: (model) => rawProvider.capabilities(model),
    generate: async (request, options) => {
      providerCalls += 1;
      if (providerCalls > MAX_PROVIDER_CALLS) {
        throw new Error("Live smoke provider-call ceiling exceeded.");
      }
      return rawProvider.generate(
        {
          ...request,
          reasoningEffort: "max",
          temperature: 1,
        },
        options,
      );
    },
    stream: (request, options) =>
      rawProvider.stream(
        {
          ...request,
          reasoningEffort: "max",
          temperature: 1,
        },
        options,
      ),
  };

  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const policy = new InMemoryCapabilityPolicy();
  const tools = new ToolRuntime(
    new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace })),
    policy,
    audit,
    () => observedAt,
  );
  const mission = new MissionRuntime(new InMemoryEventStore(), () => observedAt);
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
  try {
    const result = await coding.start({
      budgetLimits: {
        attempts: 30,
        costMicros: 0,
        inputTokens: 20_000,
        outputTokens: 10_000,
        toolCalls: 30,
      },
      missionId: `m12d-kimi-${Date.now()}`,
      objective: OBJECTIVE,
    });
    const latencyMs = Math.round(performance.now() - started);
    if (result.status !== "completed") {
      throw new Error("Live smoke unexpectedly returned an interrupted mission.");
    }
    const finalContent = workspace.content(TARGET_PATH);
    const sanitized = {
      attempts: result.report.attempts,
      completed: result.report.state === "COMPLETED",
      finalContent,
      firstPass: result.report.quality.firstFailureSignature === null,
      latencyMs,
      model: MODEL,
      modelUsage: result.report.modelUsage,
      provider: "nvidia",
      providerCalls,
      quality: {
        commandId: result.report.quality.commandId,
        exitCode: result.report.quality.finalExitCode,
      },
      repaired: result.report.quality.firstFailureSignature !== null,
      score: score(result.report, finalContent),
      toolCalls: result.report.toolCalls,
      verification: {
        outcome: result.report.verification.outcome,
        resultHash: result.report.verification.resultHash,
      },
    };
    await writeFile(RESULT_PATH, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(sanitized));
    if (!sanitized.completed || sanitized.score < 95) process.exitCode = 1;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const sanitized = safeFailure(error, providerCalls, latencyMs);
    await writeFile(RESULT_PATH, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(sanitized));
    process.exitCode = 1;
  }
}

await main();
