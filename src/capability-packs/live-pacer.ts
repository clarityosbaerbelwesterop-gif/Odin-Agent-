import { setTimeout as sleepTimer } from "node:timers/promises";

export interface LiveProviderPacingSnapshot {
  readonly attempts: number;
  readonly minStartIntervalMs: number;
  readonly waitedMs: number;
}

export interface LiveProviderPacerOptions {
  readonly minStartIntervalMs: number;
  readonly clock?: (() => number) | undefined;
  readonly sleep?: ((milliseconds: number, signal?: AbortSignal) => Promise<void>) | undefined;
}

export interface LiveProviderPacer {
  beforeAttempt(signal?: AbortSignal): Promise<number>;
  snapshot(): LiveProviderPacingSnapshot;
}

const MAX_LIVE_PACING_INTERVAL_MS = 300_000;

export function createLiveProviderPacer(options: LiveProviderPacerOptions): LiveProviderPacer {
  assertPacingInterval(options.minStartIntervalMs);
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let attempts = 0;
  let nextStartAtMs: number | null = null;
  let waitedMs = 0;
  let queue = Promise.resolve();

  return Object.freeze({
    async beforeAttempt(signal?: AbortSignal): Promise<number> {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      try {
        assertNotAborted(signal);
        const observedAt = checkedClock(clock());
        const requiredWaitMs = nextStartAtMs === null ? 0 : Math.max(0, nextStartAtMs - observedAt);
        if (requiredWaitMs > 0) {
          await sleep(requiredWaitMs, signal);
          assertNotAborted(signal);
        }

        const startedAt = checkedClock(clock());
        if (startedAt < observedAt + requiredWaitMs) {
          throw new RangeError(
            "Live provider pacing clock did not advance through the required wait.",
          );
        }
        attempts += 1;
        waitedMs += requiredWaitMs;
        nextStartAtMs = startedAt + options.minStartIntervalMs;
        return requiredWaitMs;
      } finally {
        release();
      }
    },
    snapshot(): LiveProviderPacingSnapshot {
      return Object.freeze({
        attempts,
        minStartIntervalMs: options.minStartIntervalMs,
        waitedMs,
      });
    },
  });
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await sleepTimer(milliseconds, undefined, signal === undefined ? undefined : { signal });
}

function assertPacingInterval(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_LIVE_PACING_INTERVAL_MS) {
    throw new TypeError("minStartIntervalMs must be a positive bounded safe integer.");
  }
}

function checkedClock(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Live provider pacing clock must return a non-negative safe integer.");
  }
  return value;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Live provider pacing aborted.");
  }
}
