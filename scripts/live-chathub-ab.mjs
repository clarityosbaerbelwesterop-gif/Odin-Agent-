import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createLiveProviderPacer } from "../dist/src/capability-packs/live-pacer.js";
import { ChatEngine } from "../dist/src/chat/engine.js";
import { DEFAULT_CHAT_LIMITS } from "../dist/src/chat/modes.js";
import { ChatStore } from "../dist/src/chat/store.js";
import { SqliteDurableStore } from "../dist/src/durable/store.js";
import { CapabilityRegistry, makeCapabilities } from "../dist/src/providers/capabilities.js";
import { NvidiaProvider } from "../dist/src/providers/nvidia.js";

const cases = [
  {
    id: "integer-arithmetic",
    question: "Calculate ((98765 * 4321) - (12345 * 6789)) / 5 exactly.",
    answer: String((98765 * 4321 - 12345 * 6789) / 5),
  },
  {
    id: "dependency-schedule",
    question:
      "Tasks can run in parallel with unlimited workers. A takes 3 hours. B takes 5 hours and depends on A. C takes 2 hours and depends on A. D takes 4 hours and depends on both B and C. Starting at hour 0, what is the earliest finish hour of D?",
    answer: "12",
  },
  {
    id: "javascript-trace",
    question:
      'What string does JavaScript return? [3,1,3,2].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b).map(n=>n*n).join(",")',
    answer: "1,4,9",
  },
];
const resultPath = process.env.ODIN_CHAT_AB_RESULT_PATH ?? "chathub-ab-result.json";
const model = "moonshotai/kimi-k3";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const report = {
  status: "INCOMPLETE",
  evaluatedAt: new Date().toISOString(),
  head: process.env.GITHUB_SHA ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  model,
  authority: "measurement_only",
  scope:
    "Three exact-answer arithmetic, scheduling and code-tracing cases; not SWE-bench or general intelligence evidence.",
  protocol: {
    acquisitions: 1,
    hiddenRetries: 0,
    reasoningEffort: "high",
    outputLimitPerCall: 4096,
    baselineCallsPerCase: 1,
    odinCallsPerCase: 4,
    odinMode: "thinking",
    equalCompute: false,
    ordering: "AB then BA alternating",
    grading: "exact FINAL answer; expected answers withheld from both model contexts",
  },
  cases: [],
};
const persist = async () => writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--dry-run")) {
  report.status = "DRY_RUN";
  report.cases = cases.map(({ id, question }) => ({ id, promptHash: hash(question) }));
  await persist();
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else if (!(process.env.NV_API_KEY ?? process.env.NVIDIA_API_KEY)) {
  report.status = "BLOCKED";
  report.reason = "NV_API_KEY is unavailable";
  await persist();
  process.exitCode = 1;
} else {
  const capabilities = new CapabilityRegistry([
    {
      model,
      provider: "nvidia",
      version: "nvidia-build-2026-09-04",
      provenance: {
        kind: "provider",
        observedAt: "2026-09-04T00:00:00.000Z",
        reference: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer",
      },
      capabilities: makeCapabilities({
        textInput: true,
        toolUse: true,
        streaming: true,
        reasoningEfforts: ["low", "high", "max"],
        contextWindowTokens: 1048576,
        maxOutputTokens: 65536,
      }),
    },
  ]);
  const raw = new NvidiaProvider({
    capabilities,
    credential: () => process.env.NV_API_KEY ?? process.env.NVIDIA_API_KEY,
    reasoningParameter: "reasoning_effort",
    defaultTimeoutMs: 180000,
  });
  const pacer = createLiveProviderPacer({ minStartIntervalMs: 65000 });
  const signal = AbortSignal.timeout(25 * 60000);
  let calls = 0;
  const provider = {
    id: raw.id,
    capabilities: (name) => raw.capabilities(name),
    generate: async (request, options) => {
      await pacer.beforeAttempt(signal);
      calls++;
      return raw.generate(request, { ...options, signal });
    },
    stream: async function* (request, options) {
      await pacer.beforeAttempt(signal);
      calls++;
      yield* raw.stream(request, {
        ...options,
        signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])]),
      });
    },
  };
  const score = (text, expected) => /^FINAL:\s*(.*?)\s*$/mu.exec(text)?.[1]?.trim() === expected;
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    const prompt = `${item.question}\nReturn the answer on a line using exactly FINAL: <answer>, without quotes, units, or a trailing full stop. For comma-separated output use no spaces.`;
    const record = { id: item.id, promptHash: hash(prompt) };
    report.cases.push(record);
    for (const arm of index % 2 ? ["odin", "baseline"] : ["baseline", "odin"]) {
      const start = performance.now();
      const callsBefore = calls;
      const waitBefore = pacer.snapshot().waitedMs;
      let text = "";
      let usage = null;
      let complete = false;
      let state = "FAILED";
      try {
        signal.throwIfAborted();
        if (arm === "baseline") {
          const response = await provider.generate(
            {
              model,
              messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
              reasoningEffort: "high",
              maxOutputTokens: 4096,
            },
            { signal },
          );
          text = response.message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          usage = response.usage;
          complete = response.finishReason === "stop";
          state = response.finishReason;
        } else {
          const directory = await mkdtemp(join(tmpdir(), "odin-live-ab-"));
          const store = new ChatStore(join(directory, "chat.sqlite"));
          const events = new SqliteDurableStore(join(directory, "mission.sqlite"));
          const engine = new ChatEngine({
            store,
            events,
            models: [{ id: "kimi", label: "Kimi K3", model, provider }],
            signal,
            limits: {
              ...DEFAULT_CHAT_LIMITS,
              maxCalls: 4,
              maxOutputTokens: 16384,
              maxTurnMs: 10 * 60000,
            },
          });
          try {
            const conversation = store.createConversation(item.id);
            const turn = await engine.submit({
              conversationId: conversation.id,
              text: prompt,
              mode: "thinking",
              modelId: "kimi",
              requestId: randomUUID(),
            });
            await engine.idle();
            const checkpoint = store.checkpoint(turn.id);
            const view = await engine.view(turn.id);
            state = view.state;
            text = String(
              store.events(conversation.id).findLast((event) => event.type === "answer")?.data
                .text ?? "",
            );
            usage = checkpoint?.usageUnknown ? null : (checkpoint?.usage ?? null);
            complete = view.state === "COMPLETED" && usage !== null;
          } finally {
            await engine.close();
            store.close();
            events.close();
            await rm(directory, { recursive: true, force: true });
          }
        }
      } catch (error) {
        state = typeof error?.category === "string" ? error.category : "unavailable_or_interrupted";
      }
      const pacingMs = pacer.snapshot().waitedMs - waitBefore;
      const wallMs = Math.round(performance.now() - start);
      record[arm] = {
        complete,
        passed: complete && score(text, item.answer),
        state,
        calls: calls - callsBefore,
        usage,
        wallMs,
        pacingMs,
        elapsedExcludingPacingMs: Math.max(0, wallMs - pacingMs),
        responseHash: hash(text),
      };
      await persist();
      process.stdout.write(`${JSON.stringify({ case: item.id, arm, ...record[arm] })}\n`);
    }
  }
  report.status = report.cases.every((item) => item.baseline.complete && item.odin.complete)
    ? "COMPLETE"
    : "INCOMPLETE";
  report.summary = {
    totalCases: cases.length,
    completePairs: report.cases.filter((item) => item.baseline.complete && item.odin.complete)
      .length,
    baselinePassed: report.cases.filter((item) => item.baseline.passed).length,
    odinPassed: report.cases.filter((item) => item.odin.passed).length,
    providerCalls: calls,
    pacing: pacer.snapshot(),
  };
  await persist();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "COMPLETE") process.exitCode = 1;
}
