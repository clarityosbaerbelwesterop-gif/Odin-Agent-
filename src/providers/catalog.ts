import { CapabilityRegistry } from "./capabilities.js";
import type { CapabilityProfile, ReasoningEffort } from "./types.js";

const OBSERVED_AT = "2026-09-07T00:00:00Z";
const CATALOG_VERSION = "2026-09-07";

const FULL_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
const STANDARD_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const FAST_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium"];

const OPENAI_MODELS: readonly CapabilityProfile[] = [
  {
    capabilities: {
      contextWindowTokens: 400_000,
      imageInput: true,
      maxOutputTokens: 128_000,
      reasoningEfforts: FULL_EFFORTS,
      streaming: true,
      strictStructuredOutput: true,
      strictToolSchema: true,
      structuredOutput: true,
      temperature: false,
      textInput: true,
      toolUse: true,
    },
    model: "gpt-5.6-sol",
    pricing: {
      cachedInputPerMillionTokens: 0.15,
      currency: "USD",
      inputPerMillionTokens: 1.5,
      outputPerMillionTokens: 12,
    },
    provenance: { kind: "provider", observedAt: OBSERVED_AT, reference: "builtin-model-catalog" },
    provider: "openai",
    routing: { codingScore: 0.97, costClass: "high", latencyClass: "medium", reasoningScore: 0.98 },
    version: CATALOG_VERSION,
  },
  {
    capabilities: {
      contextWindowTokens: 400_000,
      imageInput: true,
      maxOutputTokens: 128_000,
      reasoningEfforts: STANDARD_EFFORTS,
      streaming: true,
      strictStructuredOutput: true,
      strictToolSchema: true,
      structuredOutput: true,
      temperature: false,
      textInput: true,
      toolUse: true,
    },
    model: "gpt-5.6-terra",
    pricing: {
      cachedInputPerMillionTokens: 0.05,
      currency: "USD",
      inputPerMillionTokens: 0.5,
      outputPerMillionTokens: 4,
    },
    provenance: { kind: "provider", observedAt: OBSERVED_AT, reference: "builtin-model-catalog" },
    provider: "openai",
    routing: { codingScore: 0.9, costClass: "medium", latencyClass: "medium", reasoningScore: 0.9 },
    version: CATALOG_VERSION,
  },
  {
    capabilities: {
      contextWindowTokens: 400_000,
      imageInput: true,
      maxOutputTokens: 64_000,
      reasoningEfforts: FAST_EFFORTS,
      streaming: true,
      strictStructuredOutput: true,
      strictToolSchema: true,
      structuredOutput: true,
      temperature: false,
      textInput: true,
      toolUse: true,
    },
    model: "gpt-5.6-luna",
    pricing: {
      cachedInputPerMillionTokens: 0.01,
      currency: "USD",
      inputPerMillionTokens: 0.1,
      outputPerMillionTokens: 0.8,
    },
    provenance: { kind: "provider", observedAt: OBSERVED_AT, reference: "builtin-model-catalog" },
    provider: "openai",
    routing: { codingScore: 0.75, costClass: "low", latencyClass: "low", reasoningScore: 0.72 },
    version: CATALOG_VERSION,
  },
];

const GOOGLE_MODELS: readonly CapabilityProfile[] = [
  {
    capabilities: {
      contextWindowTokens: 1_048_576,
      imageInput: true,
      maxOutputTokens: 65_536,
      reasoningEfforts: STANDARD_EFFORTS,
      streaming: true,
      strictStructuredOutput: false,
      strictToolSchema: false,
      structuredOutput: true,
      temperature: true,
      textInput: true,
      toolUse: true,
    },
    model: "gemini-3.1-pro-preview",
    pricing: {
      cachedInputPerMillionTokens: 0.31,
      currency: "USD",
      inputPerMillionTokens: 1.25,
      outputPerMillionTokens: 10,
    },
    provenance: { kind: "provider", observedAt: OBSERVED_AT, reference: "builtin-model-catalog" },
    provider: "google",
    routing: { codingScore: 0.94, costClass: "high", latencyClass: "medium", reasoningScore: 0.95 },
    version: CATALOG_VERSION,
  },
  {
    capabilities: {
      contextWindowTokens: 1_048_576,
      imageInput: true,
      maxOutputTokens: 65_536,
      reasoningEfforts: STANDARD_EFFORTS,
      streaming: true,
      strictStructuredOutput: false,
      strictToolSchema: false,
      structuredOutput: true,
      temperature: true,
      textInput: true,
      toolUse: true,
    },
    model: "gemini-3.7-flash",
    pricing: {
      cachedInputPerMillionTokens: 0.075,
      currency: "USD",
      inputPerMillionTokens: 0.3,
      outputPerMillionTokens: 2.5,
    },
    provenance: { kind: "provider", observedAt: OBSERVED_AT, reference: "builtin-model-catalog" },
    provider: "google",
    routing: { codingScore: 0.86, costClass: "medium", latencyClass: "low", reasoningScore: 0.85 },
    version: CATALOG_VERSION,
  },
  {
    capabilities: {
      contextWindowTokens: 1_048_576,
      imageInput: true,
      maxOutputTokens: 65_536,
      reasoningEfforts: FAST_EFFORTS,
      streaming: true,
      strictStructuredOutput: false,
      strictToolSchema: false,
      structuredOutput: true,
      temperature: true,
      textInput: true,
      toolUse: true,
    },
    model: "gemini-3.1-flash-lite",
    pricing: {
      cachedInputPerMillionTokens: 0.025,
      currency: "USD",
      inputPerMillionTokens: 0.1,
      outputPerMillionTokens: 0.4,
    },
    provenance: { kind: "provider", observedAt: OBSERVED_AT, reference: "builtin-model-catalog" },
    provider: "google",
    routing: { codingScore: 0.68, costClass: "low", latencyClass: "low", reasoningScore: 0.65 },
    version: CATALOG_VERSION,
  },
];

export const BUILTIN_MODEL_CATALOG: readonly CapabilityProfile[] = Object.freeze([
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS,
]);

export function builtinCapabilityRegistry(
  extraProfiles: readonly CapabilityProfile[] = [],
): CapabilityRegistry {
  return new CapabilityRegistry([...BUILTIN_MODEL_CATALOG, ...extraProfiles]);
}
