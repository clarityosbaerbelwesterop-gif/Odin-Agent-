import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDurableStore } from "../durable/store.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { CapabilityRegistry } from "../providers/capabilities.js";
import { NvidiaProvider } from "../providers/nvidia.js";
import { OpenAIProvider } from "../providers/openai.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import type { ModelProvider } from "../providers/types.js";
import { NodeProcessAdapter, SandboxProcessRunner } from "../sandbox/process.js";
import type { SandboxCommandDefinition } from "../sandbox/types.js";
import { CanonicalWorkspaceBoundary } from "../sandbox/workspace.js";
import type { QualityCommandRunner } from "../tools/repository.js";
import { readBenchmarks } from "./benchmarks.js";
import { ChatEngine } from "./engine.js";
import { startChatServer } from "./http.js";
import { WikipediaResearchAdapter } from "./research.js";
import { identifier, object, safeText } from "./safety.js";
import { ChatStore } from "./store.js";
import { ChatError, type ChatModel } from "./types.js";

async function main(): Promise<void> {
  const configPath = resolve(process.env.ODIN_CONFIG_PATH ?? "odin.config.json");
  const config = object(JSON.parse(await readFile(configPath, "utf8")), [
    "models",
    "workspace",
    "allowWorkspaceWrites",
    "allowHostExecution",
    "qualityCommands",
    "research",
    "port",
    "host",
    "publicOrigin",
    "stateDirectory",
  ]);
  if (!Array.isArray(config.models))
    throw new ChatError("CONFIG_MODELS", "Configure a models array.");
  const models: ChatModel[] = [];
  for (const raw of config.models) {
    const item = object(raw, ["id", "label", "profile", "credentialEnv", "baseUrl"]);
    if (
      typeof item.credentialEnv !== "string" ||
      !/^[A-Z][A-Z0-9_]{1,80}$/u.test(item.credentialEnv)
    )
      throw new ChatError("CONFIG_CREDENTIAL", "Configure a credential environment variable name.");
    const credentialEnv = item.credentialEnv;
    if (!process.env[credentialEnv]) continue;
    const capabilities = CapabilityRegistry.fromConfig([item.profile]);
    const profile = capabilities.list()[0];
    if (!profile) throw new ChatError("CONFIG_PROFILE", "Model profile is missing.");
    const opts = {
      capabilities,
      credential: () => process.env[credentialEnv] ?? "",
      defaultTimeoutMs: 180_000,
      ...(typeof item.baseUrl === "string" ? { baseUrl: item.baseUrl } : {}),
    };
    let provider: ModelProvider;
    if (profile.provider === "nvidia")
      provider = new NvidiaProvider({ ...opts, reasoningParameter: "reasoning_effort" });
    else if (profile.provider === "openai") provider = new OpenAIProvider(opts);
    else if (profile.provider === "anthropic") provider = new AnthropicProvider(opts);
    else if (profile.provider === "openrouter") provider = new OpenRouterProvider(opts);
    else throw new ChatError("CONFIG_PROVIDER", "Choose an existing supported provider adapter.");
    models.push({
      id: identifier(item.id),
      label: safeText(item.label, 200),
      model: profile.model,
      provider,
    });
  }
  const stateRoot = resolve(
    dirname(configPath),
    typeof config.stateDirectory === "string" ? config.stateDirectory : ".odin",
  );
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const workspaceRoot =
    typeof config.workspace === "string"
      ? resolve(dirname(configPath), config.workspace)
      : undefined;
  let quality: QualityCommandRunner | undefined;
  if (Array.isArray(config.qualityCommands) && config.qualityCommands.length) {
    if (config.allowHostExecution !== true || !workspaceRoot)
      throw new ChatError(
        "HOST_EXECUTION_DISABLED",
        "Quality commands require an explicitly trusted workspace and allowHostExecution=true.",
      );
    const runner = new SandboxProcessRunner(
      await CanonicalWorkspaceBoundary.create(workspaceRoot),
      new NodeProcessAdapter(),
      config.qualityCommands as SandboxCommandDefinition[],
      { maxConcurrent: 1, hostEnv: {} },
    );
    quality = {
      commands: () => runner.commands(),
      run: async (command, signal) => {
        const result = await runner.run(command, signal);
        return {
          exitCode: result.outcome === "EXITED" ? (result.exitCode ?? 1) : 1,
          output: `${result.stdout}\n${result.stderr}`,
        };
      },
    };
  }
  const store = new ChatStore(join(stateRoot, "chat.sqlite"));
  const events = new SqliteDurableStore(join(stateRoot, "missions.sqlite"));
  const engine = new ChatEngine({
    store,
    events,
    models,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    allowWorkspaceWrites: config.allowWorkspaceWrites === true,
    ...(quality ? { quality } : {}),
    ...(config.research === "wikipedia-en" || config.research === "wikipedia-de"
      ? { research: new WikipediaResearchAdapter(config.research === "wikipedia-de" ? "de" : "en") }
      : {}),
  });
  await engine.initialize();
  const benchmark = await readBenchmarks(
    fileURLToPath(new URL("../../../docs/evals/", import.meta.url)),
  );
  const host = config.host;
  if (host !== undefined && !["127.0.0.1", "::1", "0.0.0.0"].includes(String(host)))
    throw new ChatError("HOST_CONFIG", "Unsupported listen host.");
  const app = await startChatServer({
    engine,
    accessToken: process.env.ODIN_ACCESS_TOKEN ?? "",
    webRoot: fileURLToPath(new URL("../../web/", import.meta.url)),
    ...(host ? { host: host as "127.0.0.1" | "::1" | "0.0.0.0" } : {}),
    ...(typeof config.port === "number" ? { port: config.port } : {}),
    ...(typeof config.publicOrigin === "string" ? { publicOrigin: config.publicOrigin } : {}),
    benchmark,
  });
  process.stdout.write(
    `Odin Chathub: ${app.origin}\nConfigured models available: ${models.length}\n`,
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    store.close();
    events.close();
  };
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      error instanceof ChatError
        ? `${error.code}: ${error.message}\n`
        : "Odin configuration or startup failed. Check the local configuration and state permissions.\n",
    );
    process.exitCode = 1;
  });
}
