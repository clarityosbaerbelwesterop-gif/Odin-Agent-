import { CapabilityRegistry, makeCapabilities } from "../providers/capabilities.js";
import { NvidiaProvider } from "../providers/nvidia.js";
import type { ModelCapabilities, ReasoningEffort } from "../providers/types.js";
import type { ChatModel, ProductPlan } from "./types.js";

type Environment = Readonly<Record<string, string | undefined>>;

interface NvidiaSharedModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly plan: ProductPlan;
  readonly summary: string;
  readonly recommendedFor: readonly string[];
  readonly credentialSlot: "primary" | "secondary";
  readonly version: string;
  readonly reference: string;
  readonly capabilities: Partial<ModelCapabilities> & {
    readonly reasoningEfforts: readonly ReasoningEffort[];
  };
  readonly timeoutMs: number;
}

/**
 * Shared Odin capacity is deliberately separate from NVIDIA Developer Program/API Catalog keys.
 * Build/API Catalog access is suitable for evaluation and preview work, while public production
 * capacity must be explicitly backed by a production-authorized credential.
 */
export const NVIDIA_SHARED_MODEL_DEFINITIONS: readonly NvidiaSharedModelDefinition[] = Object.freeze([
  {
    id: "gpt-oss-20b",
    label: "GPT-OSS 20B",
    model: "openai/gpt-oss-20b",
    plan: "free",
    summary: "Schnelles Reasoning- und Tool-Modell für normale Chat- und Agent-Aufgaben.",
    recommendedFor: ["Chat", "Fast reasoning", "Tool use"],
    credentialSlot: "primary",
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
    credentialSlot: "primary",
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
    credentialSlot: "secondary",
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
    summary: "Natives multimodales 1M-Kontext-Modell für langes Coding, Reasoning und Tool-Nutzung.",
    recommendedFor: ["Coding", "Long horizon", "Vision", "Tool use"],
    credentialSlot: "primary",
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
    summary: "Frontier-starkes 1M-Kontext-Modell für schwieriges Coding, Reasoning und agentische Aufgaben.",
    recommendedFor: ["Ultra", "Hard coding", "Reasoning", "Agents"],
    credentialSlot: "primary",
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
    credentialSlot: "secondary",
    version: "nvidia-api-2026-09-10",
    reference: "https://docs.api.nvidia.com/nim/reference/mistralai-mistral-medium-3-5-128b-infer",
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

export function sharedNvidiaCredential(
  env: Environment,
  slot: "primary" | "secondary",
): string {
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") {
    if (env.ODIN_NVIDIA_PRODUCTION_AUTHORIZED !== "true") return "";
    const primary = env.NVIDIA_PRODUCTION_API_KEY ?? "";
    if (slot === "secondary") return env.NVIDIA_PRODUCTION_API_KEY_2 ?? primary;
    return primary;
  }

  const primary = env.NV_API_KEY ?? env.NVIDIA_API_KEY ?? "";
  if (slot === "secondary") return env.NV_API_KEY_2 ?? env.NV_PRO_API_KEY ?? primary;
  return primary;
}

export function createSharedNvidiaModels(env: Environment = process.env): ChatModel[] {
  const models: ChatModel[] = [];
  for (const definition of NVIDIA_SHARED_MODEL_DEFINITIONS) {
    const credential = sharedNvidiaCredential(env, definition.credentialSlot);
    if (!credential) continue;
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
      provider: new NvidiaProvider({
        capabilities,
        credential: () => credential,
        reasoningParameter: "reasoning_effort",
        defaultTimeoutMs: definition.timeoutMs,
      }),
    });
  }
  return models;
}
