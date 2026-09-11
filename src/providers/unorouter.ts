import type { ProviderAdapterOptions } from "./base.js";
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./openai-compatible.js";

const UNOROUTER_BASE_URL = "https://api.unorouter.com/v1";

export interface UnoRouterProviderOptions extends ProviderAdapterOptions {}

export class UnoRouterProvider extends OpenAICompatibleProvider {
  constructor(options: UnoRouterProviderOptions) {
    const compatibleOptions: OpenAICompatibleProviderOptions = {
      ...options,
      baseUrl: options.baseUrl ?? UNOROUTER_BASE_URL,
      providerId: "unorouter",
      reasoningParameter: "reasoning_effort",
    };
    super(compatibleOptions);
  }
}
