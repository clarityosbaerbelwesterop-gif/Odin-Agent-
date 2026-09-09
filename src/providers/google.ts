import type { ProviderAdapterOptions } from "./base.js";
import {
  type CompatibleReasoningParameter,
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./openai-compatible.js";

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export interface GoogleProviderOptions extends ProviderAdapterOptions {
  readonly reasoningParameter?: CompatibleReasoningParameter;
}

export class GoogleProvider extends OpenAICompatibleProvider {
  constructor(options: GoogleProviderOptions) {
    const compatibleOptions: OpenAICompatibleProviderOptions = {
      ...options,
      baseUrl: options.baseUrl ?? GOOGLE_BASE_URL,
      providerId: "google",
      reasoningParameter: options.reasoningParameter ?? "reasoning_effort",
    };
    super(compatibleOptions);
  }
}
