import { AnthropicProvider } from "../providers/anthropic.js";
import { CapabilityRegistry, makeCapabilities } from "../providers/capabilities.js";
import { GoogleProvider } from "../providers/google.js";
import { NvidiaProvider } from "../providers/nvidia.js";
import { OpenAIProvider } from "../providers/openai.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import type { CapabilityProfile } from "../providers/types.js";
import { planAllowsPlan } from "./entitlements.js";
import type { ProductStore, ProviderId } from "./product-store.js";
import { ChatError, type ChatModel, type ProductPlan } from "./types.js";

const OBSERVED_AT = "2026-09-09T00:00:00.000Z";

interface ModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly provider: ProviderId;
  readonly summary: string;
  readonly recommendedFor: readonly string[];
  readonly profile: CapabilityProfile["capabilities"];
}

const OPENAI_CAPABILITIES = makeCapabilities({
  textInput: true,
  imageInput: true,
  toolUse: true,
  streaming: true,
  structuredOutput: true,
  strictStructuredOutput: true,
  strictToolSchema: true,
  reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  contextWindowTokens: 1_050_000,
  maxOutputTokens: 128_000,
});
const CLAUDE_CAPABILITIES = makeCapabilities({
  textInput: true,
  imageInput: true,
  toolUse: true,
  streaming: true,
  structuredOutput: true,
  reasoningEfforts: ["low", "medium", "high", "max"],
  contextWindowTokens: 200_000,
  maxOutputTokens: 8_192,
});
const GEMINI_CAPABILITIES = makeCapabilities({
  textInput: true,
  imageInput: true,
  toolUse: true,
  streaming: true,
  structuredOutput: true,
  temperature: true,
  reasoningEfforts: ["low", "medium", "high"],
  contextWindowTokens: 1_048_576,
  maxOutputTokens: 65_536,
});
const OPENROUTER_FREE_CAPABILITIES = makeCapabilities({
  textInput: true,
  streaming: true,
  contextWindowTokens: 32_768,
  maxOutputTokens: 4_096,
});
const KIMI_CAPABILITIES = makeCapabilities({
  textInput: true,
  toolUse: true,
  streaming: true,
  reasoningEfforts: ["low", "high", "max"],
  contextWindowTokens: 1_048_576,
  maxOutputTokens: 65_536,
});
const MUSE_CAPABILITIES = makeCapabilities({
  textInput: true,
  imageInput: true,
  toolUse: true,
  streaming: true,
  temperature: true,
  reasoningEfforts: ["minimal", "low", "medium", "high", "max"],
  contextWindowTokens: 131_072,
  maxOutputTokens: 8_192,
});

const DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: "byok-openai-sol",
    label: "GPT-5.6 Sol · eigener Key",
    model: "gpt-5.6-sol",
    provider: "openai",
    summary: "OpenAI-Flaggschiff für komplexes Reasoning und Coding mit deinem eigenen API-Konto.",
    recommendedFor: ["Coding", "Thinking", "Long context"],
    profile: OPENAI_CAPABILITIES,
  },
  {
    id: "byok-openai-terra",
    label: "GPT-5.6 Terra · eigener Key",
    model: "gpt-5.6-terra",
    provider: "openai",
    summary: "Balance aus Qualität und Kosten über deinen eigenen OpenAI-Key.",
    recommendedFor: ["Chat", "Coding", "Research"],
    profile: OPENAI_CAPABILITIES,
  },
  {
    id: "byok-openai-luna",
    label: "GPT-5.6 Luna · eigener Key",
    model: "gpt-5.6-luna",
    provider: "openai",
    summary: "Schnelle, kostensensitive OpenAI-Route über deinen eigenen Key.",
    recommendedFor: ["Chat", "Fast tasks"],
    profile: OPENAI_CAPABILITIES,
  },
  {
    id: "byok-anthropic-sonnet5",
    label: "Claude Sonnet 5 · eigener Key",
    model: "claude-sonnet-5",
    provider: "anthropic",
    summary: "Anthropic Sonnet für Coding, Tool-Nutzung und anspruchsvolle Alltagsaufgaben.",
    recommendedFor: ["Coding", "Agents", "Thinking"],
    profile: CLAUDE_CAPABILITIES,
  },
  {
    id: "byok-anthropic-opus5",
    label: "Claude Opus 5 · eigener Key",
    model: "claude-opus-5",
    provider: "anthropic",
    summary: "Anthropic Frontier-Route für besonders schwierige Aufgaben mit deinem eigenen Key.",
    recommendedFor: ["Frontier", "Coding", "Reasoning"],
    profile: CLAUDE_CAPABILITIES,
  },
  {
    id: "byok-anthropic-haiku45",
    label: "Claude Haiku 4.5 · eigener Key",
    model: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    summary: "Schnelle Anthropic-Route für kompakte Aufgaben.",
    recommendedFor: ["Chat", "Fast tasks"],
    profile: CLAUDE_CAPABILITIES,
  },
  {
    id: "byok-gemini-pro",
    label: "Gemini 3.1 Pro · eigener Key",
    model: "gemini-3.1-pro-preview",
    provider: "gemini",
    summary: "Google Pro-Modell für komplexes multimodales Reasoning.",
    recommendedFor: ["Thinking", "Coding", "Vision"],
    profile: GEMINI_CAPABILITIES,
  },
  {
    id: "byok-gemini-flash",
    label: "Gemini 3.8 Flash · eigener Key",
    model: "gemini-3.8-flash",
    provider: "gemini",
    summary: "Aktuelle schnelle Gemini-Route mit großem Kontext.",
    recommendedFor: ["Fast tasks", "Research", "Vision"],
    profile: GEMINI_CAPABILITIES,
  },
  {
    id: "byok-gemini-flash-lite",
    label: "Gemini 3.5 Flash-Lite · eigener Key",
    model: "gemini-3.5-flash-lite",
    provider: "gemini",
    summary: "Kosteneffiziente Gemini-Route für hohe Volumina.",
    recommendedFor: ["Chat", "High volume"],
    profile: GEMINI_CAPABILITIES,
  },
  {
    id: "byok-openrouter-free",
    label: "OpenRouter Free Router · eigener Key",
    model: "openrouter/free",
    provider: "openrouter",
    summary: "OpenRouter wählt eine aktuell kostenlose Route. Modellidentität und Fähigkeiten können variieren.",
    recommendedFor: ["Chat", "Free route"],
    profile: OPENROUTER_FREE_CAPABILITIES,
  },
  {
    id: "byok-nvidia-kimi",
    label: "Kimi K3 via NVIDIA · eigener Key",
    model: "moonshotai/kimi-k3",
    provider: "nvidia",
    summary: "Kimi K3 über dein eigenes NVIDIA-Konto.",
    recommendedFor: ["Coding", "Thinking", "Long context"],
    profile: KIMI_CAPABILITIES,
  },
  {
    id: "byok-nvidia-muse",
    label: "Muse Glimmer 30B via NVIDIA · eigener Key",
    model: "meta/muse-glimmer-30b",
    provider: "nvidia",
    summary: "Multimodales NVIDIA-Modell über dein eigenes Konto.",
    recommendedFor: ["Coding", "Agents", "Vision"],
    profile: MUSE_CAPABILITIES,
  },
];

function registry(provider: string, definitions: readonly ModelDefinition[]): CapabilityRegistry {
  return new CapabilityRegistry(
    definitions.map((definition) => ({
      provider,
      model: definition.model,
      version: `odin-byok-2026-09-09-${definition.model}`,
      provenance: {
        kind: "provider",
        observedAt: OBSERVED_AT,
        reference: "Odin curated BYOK catalog; provider availability is verified separately",
      },
      capabilities: definition.profile,
    })),
  );
}

async function credentialMap(store: ProductStore): Promise<Map<ProviderId, string>> {
  const entries = await Promise.all(
    (["openai", "anthropic", "openrouter", "nvidia", "gemini"] as const).map(async (provider) => [
      provider,
      await store.providerCredential(provider),
    ] as const),
  );
  return new Map(entries.filter((entry): entry is readonly [ProviderId, string] => !!entry[1]));
}

export async function buildUserModels(store: ProductStore): Promise<readonly ChatModel[]> {
  const credentials = await credentialMap(store);
  const result: ChatModel[] = [];
  for (const providerId of credentials.keys()) {
    const definitions = DEFINITIONS.filter((definition) => definition.provider === providerId);
    if (!definitions.length) continue;
    const capabilities = registry(
      providerId === "gemini" ? "google" : providerId,
      definitions,
    );
    const resolveCredential = () => credentials.get(providerId) ?? "";
    const provider =
      providerId === "openai"
        ? new OpenAIProvider({ capabilities, credential: resolveCredential, defaultTimeoutMs: 180_000 })
        : providerId === "anthropic"
          ? new AnthropicProvider({ capabilities, credential: resolveCredential, defaultTimeoutMs: 180_000 })
          : providerId === "openrouter"
            ? new OpenRouterProvider({
                capabilities,
                credential: resolveCredential,
                defaultTimeoutMs: 180_000,
                appTitle: "Odin Agent",
              })
            : providerId === "nvidia"
              ? new NvidiaProvider({
                  capabilities,
                  credential: resolveCredential,
                  reasoningParameter: "reasoning_effort",
                  defaultTimeoutMs: 180_000,
                })
              : new GoogleProvider({ capabilities, credential: resolveCredential, defaultTimeoutMs: 180_000 });
    for (const definition of definitions) {
      result.push({
        id: definition.id,
        label: definition.label,
        model: definition.model,
        plan: "free",
        summary: definition.summary,
        recommendedFor: definition.recommendedFor,
        provider,
      });
    }
  }
  return result;
}

export function modelsForPlan(
  serverModels: readonly ChatModel[],
  userModels: readonly ChatModel[],
  plan: ProductPlan,
): readonly ChatModel[] {
  const seen = new Set<string>();
  const result: ChatModel[] = [];
  for (const model of [...serverModels, ...userModels]) {
    const required = model.plan ?? "free";
    if (!planAllowsPlan(plan, required) || seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
  }
  return result;
}

export async function verifyProviderCredential(
  provider: ProviderId,
  secret: string,
): Promise<Record<string, unknown>> {
  if (typeof secret !== "string" || secret.trim().length < 8 || /[\r\n]/u.test(secret))
    throw new ChatError("INVALID_CREDENTIAL", "Enter a valid provider credential.");
  const key = secret.trim();
  const request = (() => {
    switch (provider) {
      case "openai":
        return { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } };
      case "anthropic":
        return {
          url: "https://api.anthropic.com/v1/models?limit=1",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        };
      case "openrouter":
        return { url: "https://openrouter.ai/api/v1/auth/key", headers: { Authorization: `Bearer ${key}` } };
      case "nvidia":
        return { url: "https://integrate.api.nvidia.com/v1/models", headers: { Authorization: `Bearer ${key}` } };
      case "gemini":
        return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": key } };
      default:
        throw new ChatError("INVALID_PROVIDER", "Unknown model provider.");
    }
  })();
  let response: Response;
  try {
    response = await fetch(request.url, {
      headers: { Accept: "application/json", ...request.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ChatError("PROVIDER_VERIFY", "Provider credential could not be verified right now.", 502);
  }
  await response.body?.cancel().catch(() => {});
  if (response.status === 401 || response.status === 403)
    throw new ChatError("PROVIDER_AUTH", "Provider rejected this credential.", 400);
  if (!response.ok)
    throw new ChatError("PROVIDER_VERIFY", "Provider credential could not be verified right now.", 502);
  return { verification: "provider-account-read", verifiedAt: new Date().toISOString() };
}
