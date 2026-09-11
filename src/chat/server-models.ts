import { CapabilityRegistry, makeCapabilities } from "../providers/capabilities.js";
import { type NvidiaPoolCredential, PooledNvidiaProvider } from "../providers/nvidia-pool.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import type { ModelCapabilities, ReasoningEffort } from "../providers/types.js";
import type { ChatModel, ProductPlan } from "./types.js";

type Environment = Readonly<Record<string, string | undefined>>;

interface SharedModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly plan: ProductPlan;
  readonly summary: string;
  readonly recommendedFor: readonly string[];
  readonly version: string;
  readonly reference: string;
  readonly capabilities: Partial<ModelCapabilities> & {
    readonly reasoningEfforts: readonly ReasoningEffort[];
  };
  readonly timeoutMs: number;
}

/** Shared NVIDIA capacity catalog. All models use the same bounded credential pool. */
export const NVIDIA_SHARED_MODEL_DEFINITIONS: readonly SharedModelDefinition[] = Object.freeze([
  {
    id: "gpt-oss-20b",
    label: "GPT-OSS 20B",
    model: "openai/gpt-oss-20b",
    plan: "free",
    summary: "Schnelles Reasoning- und Tool-Modell für normale Chat- und Agent-Aufgaben.",
    recommendedFor: ["Chat", "Fast reasoning", "Tool use"],
    version: "nvidia-api-2026-09-10",
    reference: "https://docs.api.nvidia.com/nim/reference/openai-gpt-oss-20b-infer",
    capabilities: {
      textInput: true,
      toolUse: true,
      streaming: true,
      structuredOutput: true,
      reasoningEfforts: ["low", "medium", "high"],
      contextWindowTokens: 128000,
      maxOutputTokens: 4096,
    },
    timeoutMs: 120000,
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    model: "openai/gpt-oss-120b",
    plan: "pro",
    summary: "Größeres Reasoning-Modell für anspruchsvollere Pro-Aufgaben und Tool-Nutzung.",
    recommendedFor: ["Thinking", "Research", "Tool use"],
    version: "nvidia-api-2026-09-10",
    reference: "https://docs.api.nvidia.com/nim/reference/openai-gpt-oss-120b-infer",
    capabilities: {
      textInput: true,
      toolUse: true,
      streaming: true,
      structuredOutput: true,
      reasoningEfforts: ["low", "medium", "high"],
      contextWindowTokens: 128000,
      maxOutputTokens: 4096,
    },
    timeoutMs: 150000,
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash 0731",
    model: "deepseek-ai/deepseek-v4-flash-0731",
    plan: "developer",
    summary: "Schnelles 1M-Kontext-Modell für Coding, Reasoning und agentische Workflows.",
    recommendedFor: ["Coding", "Long context", "Agents"],
    version: "nvidia-api-2026-09-10",
    reference: "https://docs.api.nvidia.com/nim/re/reference/deepseek-ai-deepseek-v4-flash-0731",
    capabilities: {
      textInput: true,
      toolUse: true,
      streaming: true,
      reasoningEfforts: ["high", "max"],
      contextWindowTokens: 1000000,
      maxOutputTokens: 16384,
    },
    timeoutMs: 180000,
  },
  {
    id: "kimi",
    label: "Kimi K3",
    model: "moonshotai/kimi-k3",
    plan: "developer",
    summary:
      "Natives multimodales 1M-Kontext-Modell für langes Coding, Reasoning und Tool-Nutzung.",
    recommendedFor: ["Coding", "Long horizon", "Vision", "Tool use"],
    version: "nvidia-api-2026-09-10",
    reference: "https://docs.api.nvidia.com/nim/re/reference/moonshotai-kimi-k3-infer",
    capabilities: {
      textInput: true,
      imageInput: true,
      toolUse: true,
      streaming: true,
      structuredOutput: true,
      temperature: true,
      reasoningEfforts: ["low", "high", "max"],
      contextWindowTokens: 1048576,
      maxOutputTokens: 65536,
    },
    timeoutMs: 180000,
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro 0813",
    model: "deepseek-ai/deepseek-v4-pro-0813",
    plan: "ultra",
    summary:
      "Frontier-starkes 1M-Kontext-Modell für schwieriges Coding, Reasoning und agentische Aufgaben.",
    recommendedFor: ["Ultra", "Hard coding", "Reasoning", "Agents"],
    version: "nvidia-api-2026-09-10",
    reference: "https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-pro-0813",
    capabilities: {
      textInput: true,
      toolUse: true,
      streaming: true,
      reasoningEfforts: ["high", "max"],
      contextWindowTokens: 1000000,
      maxOutputTokens: 16384,
    },
    timeoutMs: 180000,
  },
  {
    id: "mistral-medium-3-5",
    label: "Mistral Medium 3.5 128B",
    model: "mistralai/mistral-medium-3.5-128b",
    plan: "ultra",
    summary: "Flagship-Modell für Coding, Reasoning, Vision und native Function Calls.",
    recommendedFor: ["Ultra", "Coding", "Vision", "Structured work"],
    version: "nvidia-api-2026-09-10",
    reference:
      "https://docs.api.nvidia.com/nim/reference/mistralai-mistral-medium-3-5-128b-infer",
    capabilities: {
      textInput: true,
      imageInput: true,
      toolUse: true,
      streaming: true,
      structuredOutput: true,
      reasoningEfforts: ["high"],
      contextWindowTokens: 262144,
      maxOutputTokens: 32768,
    },
    timeoutMs: 180000,
  },
]);

/**
 * OpenRouter is intentionally a small curated frontier lane instead of mirroring the whole catalog.
 * These models are shared hosted capacity and therefore pass through Odin's normal plan/quota gates.
 */
export const OPENROUTER_SHARED_MODEL_DEFINITIONS: readonly SharedModelDefinition[] = Object.freeze([
  {
    id: "openrouter-gpt-5-6-luna",
    label: "GPT-5.6 Luna · OpenRouter",
    model: "openai/gpt-5.6-luna",
    plan: "pro",
    summary: "Schnelles Frontier-Modell für Thinking, Research und agentische Aufgaben.",
    recommendedFor: ["Thinking", "Research", "Agents"],
    version: "openrouter-2026-09-11",
    reference: "https://openrouter.ai/openai/gpt-5.6-luna",
    capabilities: {
      textInput: true,
      imageInput: true,
      toolUse: true,
      streaming: true,
      structuredOutput: true,
      reasoningEfforts: ["low", "medium", "high"],
      contextWindowTokens: 1050000,
      maxOutputTokens: 32768,
    },
    timeoutMs: 180000,
  },
  {
    id: "openrouter-claude-fable-5-1",
    label: "Claude Fable 5.1 · OpenRouter",
    model: "anthropic/claude-fable-5.1",
    plan: "developer",
    summary: "Frontier Coding-Modell für lange Refactors, Agent-Loops und komplexe Repo-Arbeit.",
    recommendedFor: ["Coding", "Long-running agents", "Code review"],
    version: "openrouter-2026-09-11",
    reference: "https://openrouter.ai/anthropic/claude-fable-5.1",
    capabilities: {
      textInput: true,
      imageInput: true,
      toolUse: true,
      streaming: true,
      structuredOutput: true,
      reasoningEfforts: ["low", "medium", "high"],
      contextWindowTokens: 1000000,
      maxOutputTokens: 32768,
    },
    timeoutMs: 240000,
  },
  {
    id: "openrouter-claude-opus-5",
    label: "Claude Opus 5 · OpenRouter",
    model: "anthropic/claude-opus-5",
    plan: "ultra",
    summary: "Flagship-Modell für schwierigstes Coding, Reviews und lang laufende autonome Missionen.",
    recommendedFor: ["Ultra", "Hard coding", "Long horizon", "Review"],
    version: "openrouter-2026-09-11",
    reference: "https://openrouter.ai/anthropic/claude-opus-5",
    capabilities: {
      textInput: true,
      imageInput: true,
      toolUse: true,
      streaming: true,
      structuredOutput: true,
      reasoningEfforts: ["low", "medium", "high"],
      contextWindowTokens: 1000000,
      maxOutputTokens: 65536,
    },
    timeoutMs: 240000,
  },
]);

function isProduction(env: Environment): boolean {
  return env.VERCEL_ENV !== undefined
    ? env.VERCEL_ENV === "production"
    : env.NODE_ENV === "production";
}

export function sharedNvidiaCredentials(env: Environment): readonly NvidiaPoolCredential[] {
  if (isProduction(env)) {
    if (env.ODIN_NVIDIA_PRODUCTION_AUTHORIZED !== "true") return [];
    return [1, 2, 3, 4, 5]
      .map((index) => ({
        slot: `production-${index}`,
        value:
          index === 1
            ? (env.NVIDIA_PRODUCTION_API_KEY ?? "")
            : (env[`NVIDIA_PRODUCTION_API_KEY_${index}`] ?? ""),
      }))
      .filter((credential) => credential.value !== "");
  }

  const fallback = env.NVIDIA_API_KEY ?? "";
  return [1, 2, 3, 4, 5]
    .map((index) => ({
      slot: `preview-${index}`,
      value:
        index === 1
          ? (env.NV_API_KEY ?? fallback)
          : (env[`NV_API_KEY_${index}`] ?? (index === 2 ? (env.NV_PRO_API_KEY ?? "") : "")),
    }))
    .filter((credential) => credential.value !== "");
}

export function sharedOpenRouterCredential(env: Environment): string | undefined {
  const value = env.OPENROUTER_API_KEY ?? env.UNOROUTER_API_KEY;
  return value && value.trim() !== "" && !/[\r\n]/u.test(value) ? value : undefined;
}

export function createSharedNvidiaModels(env: Environment = process.env): ChatModel[] {
  const credentials = sharedNvidiaCredentials(env);
  if (credentials.length === 0) return [];
  const models: ChatModel[] = [];
  for (const definition of NVIDIA_SHARED_MODEL_DEFINITIONS) {
    const capabilities = new CapabilityRegistry([
      {
        model: definition.model,
        provider: "nvidia",
        version: definition.version,
        provenance: {
          kind: "provider",
          observedAt: "2026-09-10T00:00:00.000Z",
          reference: definition.reference,
        },
        capabilities: makeCapabilities(definition.capabilities),
      },
    ]);
    models.push({
      id: definition.id,
      label: definition.label,
      model: definition.model,
      plan: definition.plan,
      summary: definition.summary,
      recommendedFor: definition.recommendedFor,
      sharedCapacity: true,
      provider: new PooledNvidiaProvider({
        capabilities,
        credentials,
        reasoningParameter: "reasoning_effort",
        defaultTimeoutMs: definition.timeoutMs,
      }),
    });
  }
  return models;
}

export function createSharedOpenRouterModels(env: Environment = process.env): ChatModel[] {
  const credential = sharedOpenRouterCredential(env);
  if (!credential) return [];
  const httpReferer = env.ODIN_PUBLIC_ORIGIN?.startsWith("https://")
    ? env.ODIN_PUBLIC_ORIGIN
    : undefined;
  return OPENROUTER_SHARED_MODEL_DEFINITIONS.map((definition) => {
    const capabilities = new CapabilityRegistry([
      {
        model: definition.model,
        provider: "openrouter",
        version: definition.version,
        provenance: {
          kind: "provider",
          observedAt: "2026-09-11T00:00:00.000Z",
          reference: definition.reference,
        },
        capabilities: makeCapabilities(definition.capabilities),
      },
    ]);
    return {
      id: definition.id,
      label: definition.label,
      model: definition.model,
      plan: definition.plan,
      summary: definition.summary,
      recommendedFor: definition.recommendedFor,
      sharedCapacity: true,
      provider: new OpenRouterProvider({
        capabilities,
        credential: async () => credential,
        defaultTimeoutMs: definition.timeoutMs,
        appTitle: "Odin Agent",
        ...(httpReferer ? { httpReferer } : {}),
      }),
    } satisfies ChatModel;
  });
}

export function createSharedHostedModels(env: Environment = process.env): ChatModel[] {
  return [...createSharedNvidiaModels(env), ...createSharedOpenRouterModels(env)];
}
