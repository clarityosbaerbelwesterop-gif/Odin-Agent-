import type { ProviderAdapterOptions } from "./base.js";
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./openai-compatible.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterProviderOptions extends ProviderAdapterOptions {
  readonly appTitle?: string;
  readonly httpReferer?: string;
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OpenRouterProviderOptions) {
    const extraHeaders: Record<string, string> = {};
    if (options.appTitle !== undefined) extraHeaders["X-Title"] = options.appTitle;
    if (options.httpReferer !== undefined) extraHeaders["HTTP-Referer"] = options.httpReferer;
    const compatibleOptions: OpenAICompatibleProviderOptions = {
      ...options,
      baseUrl: options.baseUrl ?? OPENROUTER_BASE_URL,
      extraHeaders,
      providerId: "openrouter",
      reasoningParameter: "reasoning",
    };
    super(compatibleOptions);
  }
}
