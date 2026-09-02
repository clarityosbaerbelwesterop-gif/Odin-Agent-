import type { ProviderAdapterOptions } from "./base.js";
import {
  type CompatibleReasoningParameter,
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./openai-compatible.js";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export interface NvidiaProviderOptions extends ProviderAdapterOptions {
  readonly reasoningParameter?: CompatibleReasoningParameter;
}

export class NvidiaProvider extends OpenAICompatibleProvider {
  constructor(options: NvidiaProviderOptions) {
    const compatibleOptions: OpenAICompatibleProviderOptions = {
      ...options,
      baseUrl: options.baseUrl ?? NVIDIA_BASE_URL,
      providerId: "nvidia",
      ...(options.reasoningParameter === undefined
        ? {}
        : { reasoningParameter: options.reasoningParameter }),
    };
    super(compatibleOptions);
  }
}
