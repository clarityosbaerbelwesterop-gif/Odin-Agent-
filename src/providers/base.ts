import { type CapabilityRegistry, validateRequestCapabilities } from "./capabilities.js";
import { ProviderError } from "./errors.js";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  endpointUrl,
  executeHttpRequest,
  FetchHttpTransport,
  type HttpTransport,
  validatedBaseUrl,
} from "./transport.js";
import type {
  CapabilityProfile,
  CredentialResolver,
  JsonObject,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ProviderCallOptions,
} from "./types.js";

export interface ProviderAdapterOptions {
  readonly capabilities: CapabilityRegistry;
  readonly credential: CredentialResolver;
  readonly transport?: HttpTransport;
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
  readonly defaultTimeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export abstract class BaseProvider implements ModelProvider {
  abstract readonly id: string;
  readonly #capabilityRegistry: CapabilityRegistry;
  readonly #credentialResolver: CredentialResolver;
  readonly #transport: HttpTransport;
  readonly #baseUrl: URL;
  readonly #endpoint: string;
  readonly #defaultTimeoutMs: number;
  protected readonly maxResponseBytes: number;

  protected constructor(options: ProviderAdapterOptions, defaultBaseUrl: string, endpoint: string) {
    this.#capabilityRegistry = options.capabilities;
    this.#credentialResolver = options.credential;
    this.#transport = options.transport ?? new FetchHttpTransport();
    this.#baseUrl = validatedBaseUrl(
      options.baseUrl ?? defaultBaseUrl,
      options.allowInsecureHttp ?? false,
      options.allowPrivateNetwork ?? false,
    );
    this.#endpoint = endpoint;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

    if (!Number.isInteger(this.#defaultTimeoutMs) || this.#defaultTimeoutMs <= 0) {
      throw new TypeError("defaultTimeoutMs must be a positive integer.");
    }
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new TypeError("maxResponseBytes must be a positive integer.");
    }
  }

  capabilities(model: string): CapabilityProfile {
    return this.#capabilityRegistry.resolve(this.id, model);
  }

  async generate(request: ModelRequest, options: ProviderCallOptions = {}): Promise<ModelResponse> {
    const response = await this.post(request, false, options);
    return this.parseResponse(response, request);
  }

  async *stream(
    request: ModelRequest,
    options: ProviderCallOptions = {},
  ): AsyncIterable<ModelStreamEvent> {
    const response = await this.post(request, true, options);
    yield* this.parseStream(response, request);
  }

  protected abstract buildHeaders(credential: string, streaming: boolean): Record<string, string>;
  protected abstract mapRequest(request: ModelRequest, streaming: boolean): JsonObject;
  protected abstract parseResponse(
    response: Response,
    request: ModelRequest,
  ): Promise<ModelResponse>;
  protected abstract parseStream(
    response: Response,
    request: ModelRequest,
  ): AsyncIterable<ModelStreamEvent>;

  private async post(
    request: ModelRequest,
    streaming: boolean,
    options: ProviderCallOptions,
  ): Promise<Response> {
    validateRequestShape(this.id, request);
    validateRequestCapabilities(this.id, this.capabilities(request.model), request, streaming);
    const mapped = this.mapRequest(request, streaming);
    let body: string;
    try {
      body = JSON.stringify(mapped);
    } catch (error) {
      throw new ProviderError({
        category: "invalid_request",
        cause: error,
        message: "The normalized request is not JSON serializable.",
        provider: this.id,
        retryable: false,
      });
    }

    const credential = await this.resolveCredential();
    const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new ProviderError({
        category: "invalid_request",
        message: "timeoutMs must be a positive integer.",
        provider: this.id,
        retryable: false,
      });
    }

    return executeHttpRequest(this.id, this.#transport, {
      body,
      headers: this.buildHeaders(credential, streaming),
      method: "POST",
      signal: options.signal,
      timeoutMs,
      url: endpointUrl(this.#baseUrl, this.#endpoint),
    });
  }

  private async resolveCredential(): Promise<string> {
    let credential: string;
    try {
      credential = await this.#credentialResolver();
    } catch (error) {
      throw new ProviderError({
        category: "authentication",
        cause: error,
        message: "The provider credential could not be resolved.",
        provider: this.id,
        retryable: false,
      });
    }
    if (typeof credential !== "string" || credential.trim() === "" || /[\r\n]/.test(credential)) {
      throw new ProviderError({
        category: "authentication",
        message: "The provider credential is missing or invalid.",
        provider: this.id,
        retryable: false,
      });
    }
    return credential;
  }
}

function validateRequestShape(provider: string, request: ModelRequest): void {
  if (request.model.trim() === "") invalid(provider, "model must be non-empty.");
  if (request.messages.length === 0) invalid(provider, "messages must not be empty.");
  if (
    request.maxOutputTokens !== undefined &&
    (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0)
  ) {
    invalid(provider, "maxOutputTokens must be a positive integer.");
  }
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 1)
  ) {
    invalid(provider, "temperature must be between 0 and 1 at the normalized boundary.");
  }

  const names = new Set<string>();
  for (const tool of request.tools ?? []) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)) {
      invalid(provider, "Tool names must use 1-64 letters, numbers, underscores, or hyphens.");
    }
    if (names.has(tool.name)) invalid(provider, `Duplicate tool name: ${tool.name}.`);
    names.add(tool.name);
    if (tool.strict === true) assertStrictObjectSchema(provider, tool.inputSchema, tool.name);
  }
  if (typeof request.toolChoice === "object" && !names.has(request.toolChoice.name)) {
    invalid(provider, "The selected toolChoice is not present in tools.");
  }
  if (request.responseFormat?.type === "json_schema") {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(request.responseFormat.name)) {
      invalid(
        provider,
        "Response schema names must use 1-64 letters, numbers, underscores, or hyphens.",
      );
    }
    if (request.responseFormat.strict !== false) {
      assertStrictObjectSchema(
        provider,
        request.responseFormat.schema,
        request.responseFormat.name,
      );
    }
  }

  for (const message of request.messages) {
    if (message.role === "tool") {
      if (message.toolCallId.trim() === "") invalid(provider, "Tool result IDs must be non-empty.");
      continue;
    }
    if (message.role !== "assistant" && (message.toolCalls?.length ?? 0) > 0) {
      invalid(provider, "Only assistant messages may contain tool calls.");
    }
    for (const part of message.content) {
      if (part.type === "image_url") validateImageUrl(provider, part.url);
    }
  }
}

function assertStrictObjectSchema(provider: string, schema: JsonObject, name: string): void {
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    invalid(
      provider,
      `Strict schema ${name} must be an object with additionalProperties set to false.`,
    );
  }
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    invalid(provider, `Strict schema ${name} must define an object-valued properties field.`);
  }
  const required = schema.required;
  if (!Array.isArray(required) || !required.every((value) => typeof value === "string")) {
    invalid(provider, `Strict schema ${name} must define a string-valued required array.`);
  }
  if (Object.keys(properties).some((property) => !required.includes(property))) {
    invalid(provider, `Strict schema ${name} must list every property as required.`);
  }
}

function validateImageUrl(provider: string, value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "data:") {
      invalid(provider, "Image URLs must use HTTPS or a data URL.");
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    invalid(provider, "Image URLs must be valid URLs.");
  }
}

function invalid(provider: string, message: string): never {
  throw new ProviderError({
    category: "invalid_request",
    message,
    provider,
    retryable: false,
  });
}
