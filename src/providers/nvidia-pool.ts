import type { CapabilityRegistry } from "./capabilities.js";
import { isProviderError } from "./errors.js";
import { NvidiaProvider } from "./nvidia.js";
import type { CompatibleReasoningParameter } from "./openai-compatible.js";
import type {
  CapabilityProfile,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ProviderCallOptions,
} from "./types.js";

export interface NvidiaPoolCredential {
  readonly slot: string;
  readonly value: string;
}

interface PoolState {
  failures: number;
  cooldownUntil: number;
  inFlight: number;
}

export interface PooledNvidiaProviderOptions {
  readonly capabilities: CapabilityRegistry;
  readonly credentials: readonly NvidiaPoolCredential[];
  readonly reasoningParameter?: CompatibleReasoningParameter;
  readonly defaultTimeoutMs?: number;
}

function cooldownFor(error: unknown): number {
  if (!isProviderError(error)) return 5_000;
  if (error.retryAfterMs !== undefined) return Math.max(1_000, Math.min(error.retryAfterMs, 15 * 60_000));
  if (error.category === "authentication" || error.category === "permission") return 60 * 60_000;
  if (error.category === "rate_limit" || error.category === "quota") return 60_000;
  if (error.category === "network" || error.category === "timeout" || error.category === "unavailable")
    return 5_000;
  return 0;
}

function mayFailOver(error: unknown): boolean {
  if (!isProviderError(error)) return true;
  return [
    "authentication",
    "permission",
    "quota",
    "rate_limit",
    "network",
    "timeout",
    "unavailable",
  ].includes(error.category);
}

export class PooledNvidiaProvider implements ModelProvider {
  readonly id = "nvidia";
  readonly #capabilities: CapabilityRegistry;
  readonly #providers: ReadonlyMap<string, NvidiaProvider>;
  readonly #states = new Map<string, PoolState>();

  constructor(options: PooledNvidiaProviderOptions) {
    this.#capabilities = options.capabilities;
    const providers = new Map<string, NvidiaProvider>();
    for (const credential of options.credentials) {
      if (!credential.value || providers.has(credential.slot)) continue;
      providers.set(
        credential.slot,
        new NvidiaProvider({
          capabilities: options.capabilities,
          credential: () => credential.value,
          ...(options.reasoningParameter === undefined
            ? {}
            : { reasoningParameter: options.reasoningParameter }),
          ...(options.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: options.defaultTimeoutMs }),
        }),
      );
      this.#states.set(credential.slot, { failures: 0, cooldownUntil: 0, inFlight: 0 });
    }
    if (providers.size === 0) throw new TypeError("NVIDIA credential pool must not be empty.");
    this.#providers = providers;
  }

  capabilities(model: string): CapabilityProfile {
    return this.#capabilities.resolve(this.id, model);
  }

  async generate(request: ModelRequest, options: ProviderCallOptions = {}): Promise<ModelResponse> {
    let lastError: unknown;
    for (const slot of this.#orderedSlots()) {
      const state = this.#states.get(slot);
      const provider = this.#providers.get(slot);
      if (!state || !provider) continue;
      state.inFlight += 1;
      try {
        const response = await provider.generate(request, options);
        this.#healthy(state);
        return response;
      } catch (error) {
        lastError = error;
        this.#failed(state, error);
        if (!mayFailOver(error)) throw error;
      } finally {
        state.inFlight = Math.max(0, state.inFlight - 1);
      }
    }
    throw lastError ?? new Error("No NVIDIA credential is currently available.");
  }

  async *stream(
    request: ModelRequest,
    options: ProviderCallOptions = {},
  ): AsyncIterable<ModelStreamEvent> {
    let lastError: unknown;
    for (const slot of this.#orderedSlots()) {
      const state = this.#states.get(slot);
      const provider = this.#providers.get(slot);
      if (!state || !provider) continue;
      let emitted = false;
      state.inFlight += 1;
      try {
        for await (const event of provider.stream(request, options)) {
          emitted = true;
          yield event;
        }
        this.#healthy(state);
        return;
      } catch (error) {
        lastError = error;
        this.#failed(state, error);
        if (emitted || !mayFailOver(error)) throw error;
      } finally {
        state.inFlight = Math.max(0, state.inFlight - 1);
      }
    }
    throw lastError ?? new Error("No NVIDIA credential is currently available.");
  }

  poolStatus(): readonly { slot: string; failures: number; inFlight: number; coolingDown: boolean }[] {
    const now = Date.now();
    return [...this.#states.entries()].map(([slot, state]) => ({
      slot,
      failures: state.failures,
      inFlight: state.inFlight,
      coolingDown: state.cooldownUntil > now,
    }));
  }

  #orderedSlots(): string[] {
    const now = Date.now();
    const entries = [...this.#states.entries()];
    const healthy = entries.filter(([, state]) => state.cooldownUntil <= now);
    const candidates = healthy.length > 0 ? healthy : entries.sort(([, a], [, b]) => a.cooldownUntil - b.cooldownUntil).slice(0, 1);
    return candidates
      .sort(([, left], [, right]) => left.inFlight - right.inFlight || left.failures - right.failures)
      .map(([slot]) => slot);
  }

  #healthy(state: PoolState): void {
    state.failures = 0;
    state.cooldownUntil = 0;
  }

  #failed(state: PoolState, error: unknown): void {
    state.failures += 1;
    const cooldown = cooldownFor(error);
    if (cooldown > 0) state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + cooldown);
  }
}
