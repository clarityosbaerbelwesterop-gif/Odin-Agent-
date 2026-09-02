import { ProviderError } from "./errors.js";
import type {
  CapabilityProfile,
  CapabilityProvenance,
  ModelCapabilities,
  ModelPricing,
  ModelRequest,
  ModelRoutingMetadata,
  ReasoningEffort,
} from "./types.js";

const keyFor = (provider: string, model: string): string => `${provider}\u0000${model}`;

export class CapabilityRegistry {
  readonly #profiles = new Map<string, CapabilityProfile>();

  constructor(profiles: readonly CapabilityProfile[] = []) {
    for (const profile of profiles) this.register(profile);
  }

  static fromConfig(value: unknown): CapabilityRegistry {
    if (!Array.isArray(value)) {
      throw new TypeError("Capability configuration must be an array of profiles.");
    }
    const registry = new CapabilityRegistry();
    for (const profile of value) registry.register(parseProfile(profile));
    return registry;
  }

  register(profile: CapabilityProfile): void {
    const validated = parseProfile(profile);
    this.#profiles.set(keyFor(validated.provider, validated.model), freezeProfile(validated));
  }

  override(
    provider: string,
    model: string,
    capabilities: Partial<ModelCapabilities>,
    provenance: CapabilityProvenance,
    version: string,
  ): CapabilityProfile {
    const current = this.resolve(provider, model);
    const profile: CapabilityProfile = {
      capabilities: {
        ...current.capabilities,
        ...capabilities,
        reasoningEfforts: capabilities.reasoningEfforts ?? current.capabilities.reasoningEfforts,
      },
      model,
      ...(current.pricing === undefined ? {} : { pricing: current.pricing }),
      provider,
      provenance,
      ...(current.routing === undefined ? {} : { routing: current.routing }),
      version,
    };
    this.register(profile);
    return this.resolve(provider, model);
  }

  resolve(provider: string, model: string): CapabilityProfile {
    const profile = this.#profiles.get(keyFor(provider, model));
    if (profile === undefined) {
      throw new ProviderError({
        category: "unsupported",
        message: `No capability profile is configured for ${provider}/${model}.`,
        provider,
        retryable: false,
      });
    }
    return profile;
  }

  list(provider?: string): readonly CapabilityProfile[] {
    return [...this.#profiles.values()]
      .filter((profile) => provider === undefined || profile.provider === provider)
      .sort((left, right) =>
        `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`),
      );
  }
}

export function validateRequestCapabilities(
  provider: string,
  profile: CapabilityProfile,
  request: ModelRequest,
  streaming: boolean,
): void {
  if (request.model !== profile.model || profile.provider !== provider) {
    unsupported(provider, "The resolved capability profile does not match the request.");
  }

  if (!profile.capabilities.textInput) unsupported(provider, "Text input is not supported.");
  if (streaming && !profile.capabilities.streaming) {
    unsupported(provider, "Streaming is not supported by the selected model.");
  }

  const usesImages = request.messages.some(
    (message) =>
      message.role !== "tool" && message.content.some((part) => part.type === "image_url"),
  );
  if (usesImages && !profile.capabilities.imageInput) {
    unsupported(provider, "Image input is not supported by the selected model.");
  }

  if ((request.tools?.length ?? 0) > 0 && !profile.capabilities.toolUse) {
    unsupported(provider, "Tool use is not supported by the selected model.");
  }

  if (
    request.tools?.some((tool) => tool.strict === true) &&
    !profile.capabilities.strictToolSchema
  ) {
    unsupported(provider, "Strict tool schemas are not supported by the selected model.");
  }

  if (
    request.responseFormat !== undefined &&
    request.responseFormat.type !== "text" &&
    !profile.capabilities.structuredOutput
  ) {
    unsupported(provider, "Structured output is not supported by the selected model.");
  }

  if (
    request.responseFormat?.type === "json_schema" &&
    request.responseFormat.strict !== false &&
    !profile.capabilities.strictStructuredOutput
  ) {
    unsupported(provider, "Strict structured output is not supported by the selected model.");
  }

  if (request.temperature !== undefined && !profile.capabilities.temperature) {
    unsupported(provider, "Temperature is not supported by the selected model.");
  }

  if (
    request.reasoningEffort !== undefined &&
    !profile.capabilities.reasoningEfforts.includes(request.reasoningEffort)
  ) {
    unsupported(
      provider,
      `Reasoning effort ${request.reasoningEffort} is not supported by the selected model.`,
    );
  }

  if (
    request.maxOutputTokens !== undefined &&
    profile.capabilities.maxOutputTokens !== undefined &&
    request.maxOutputTokens > profile.capabilities.maxOutputTokens
  ) {
    unsupported(provider, "Requested output tokens exceed the configured model limit.");
  }
}

export function makeCapabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    imageInput: false,
    reasoningEfforts: [],
    streaming: false,
    strictStructuredOutput: false,
    strictToolSchema: false,
    structuredOutput: false,
    temperature: false,
    textInput: true,
    toolUse: false,
    ...overrides,
  };
}

function parseProfile(value: unknown): CapabilityProfile {
  const profile = record(value, "Capability profile");
  const provider = nonEmptyString(profile.provider, "provider");
  const model = nonEmptyString(profile.model, "model");
  const version = nonEmptyString(profile.version, "version");
  const rawProvenance = record(profile.provenance, "provenance");
  const kind = rawProvenance.kind;
  if (kind !== "provider" && kind !== "project_config" && kind !== "user_override") {
    throw new TypeError("Capability provenance kind is invalid.");
  }
  const observedAt = nonEmptyString(rawProvenance.observedAt, "provenance observedAt");
  if (!isIsoDate(observedAt)) {
    throw new TypeError("Capability provenance observedAt must be an ISO-8601 timestamp.");
  }
  const rawCapabilities = record(profile.capabilities, "capabilities");
  const reasoningEfforts = parseReasoningEfforts(rawCapabilities.reasoningEfforts);
  const contextWindowTokens = optionalPositiveInteger(
    rawCapabilities.contextWindowTokens,
    "contextWindowTokens",
  );
  const maxOutputTokens = optionalPositiveInteger(
    rawCapabilities.maxOutputTokens,
    "maxOutputTokens",
  );
  const pricing = profile.pricing === undefined ? undefined : parsePricing(profile.pricing);
  const routing = profile.routing === undefined ? undefined : parseRouting(profile.routing);

  return {
    capabilities: {
      imageInput: booleanValue(rawCapabilities.imageInput, "imageInput"),
      reasoningEfforts,
      streaming: booleanValue(rawCapabilities.streaming, "streaming"),
      strictStructuredOutput: booleanValue(
        rawCapabilities.strictStructuredOutput,
        "strictStructuredOutput",
      ),
      strictToolSchema: booleanValue(rawCapabilities.strictToolSchema, "strictToolSchema"),
      structuredOutput: booleanValue(rawCapabilities.structuredOutput, "structuredOutput"),
      temperature: booleanValue(rawCapabilities.temperature, "temperature"),
      textInput: booleanValue(rawCapabilities.textInput, "textInput"),
      toolUse: booleanValue(rawCapabilities.toolUse, "toolUse"),
      ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    },
    model,
    ...(pricing === undefined ? {} : { pricing }),
    provider,
    provenance: {
      kind,
      observedAt,
      reference: nonEmptyString(rawProvenance.reference, "provenance reference"),
    },
    ...(routing === undefined ? {} : { routing }),
    version,
  };
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer when provided.`);
  }
  return value;
}

function parseReasoningEfforts(value: unknown): readonly ReasoningEffort[] {
  if (!Array.isArray(value)) throw new TypeError("reasoningEfforts must be an array.");
  const allowed = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh", "max"]);
  if (!value.every((effort): effort is ReasoningEffort => allowed.has(effort as ReasoningEffort))) {
    throw new TypeError("reasoningEfforts contains an unsupported value.");
  }
  if (new Set(value).size !== value.length) {
    throw new TypeError("reasoningEfforts must not contain duplicates.");
  }
  return [...value];
}

function freezeProfile(profile: CapabilityProfile): CapabilityProfile {
  return Object.freeze({
    ...profile,
    capabilities: Object.freeze({
      ...profile.capabilities,
      reasoningEfforts: Object.freeze([...profile.capabilities.reasoningEfforts]),
    }),
    provenance: Object.freeze({ ...profile.provenance }),
    ...(profile.pricing === undefined ? {} : { pricing: Object.freeze({ ...profile.pricing }) }),
    ...(profile.routing === undefined ? {} : { routing: Object.freeze({ ...profile.routing }) }),
  });
}

function isIsoDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean.`);
  return value;
}

function parsePricing(value: unknown): ModelPricing {
  const pricing = record(value, "pricing");
  const cachedInputPerMillionTokens = optionalNonNegativeNumber(
    pricing.cachedInputPerMillionTokens,
    "cachedInputPerMillionTokens",
  );
  const cacheWritePerMillionTokens = optionalNonNegativeNumber(
    pricing.cacheWritePerMillionTokens,
    "cacheWritePerMillionTokens",
  );
  return {
    currency: nonEmptyString(pricing.currency, "pricing currency"),
    inputPerMillionTokens: nonNegativeNumber(
      pricing.inputPerMillionTokens,
      "inputPerMillionTokens",
    ),
    outputPerMillionTokens: nonNegativeNumber(
      pricing.outputPerMillionTokens,
      "outputPerMillionTokens",
    ),
    ...(cachedInputPerMillionTokens === undefined ? {} : { cachedInputPerMillionTokens }),
    ...(cacheWritePerMillionTokens === undefined ? {} : { cacheWritePerMillionTokens }),
  };
}

function parseRouting(value: unknown): ModelRoutingMetadata {
  const routing = record(value, "routing");
  const reasoningScore = optionalUnitScore(routing.reasoningScore, "reasoningScore");
  const codingScore = optionalUnitScore(routing.codingScore, "codingScore");
  return {
    costClass: relativeClass(routing.costClass, "costClass"),
    latencyClass: relativeClass(routing.latencyClass, "latencyClass"),
    ...(reasoningScore === undefined ? {} : { reasoningScore }),
    ...(codingScore === undefined ? {} : { codingScore }),
  };
}

function optionalNonNegativeNumber(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : nonNegativeNumber(value, name);
}

function nonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number.`);
  }
  return value;
}

function optionalUnitScore(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const score = nonNegativeNumber(value, name);
  if (score > 1) throw new TypeError(`${name} must not exceed 1.`);
  return score;
}

function relativeClass(value: unknown, name: string): ModelRoutingMetadata["costClass"] {
  if (value !== "low" && value !== "medium" && value !== "high" && value !== "unknown") {
    throw new TypeError(`${name} must be low, medium, high, or unknown.`);
  }
  return value;
}

function unsupported(provider: string, message: string): never {
  throw new ProviderError({
    category: "unsupported",
    message,
    provider,
    retryable: false,
  });
}
