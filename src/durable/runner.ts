import { assertArtifactReference, assertReasonCode, assertSafeInteger } from "./internal.js";
import type { SqliteDurableStore } from "./store.js";
import type {
  DurableJobRecord,
  JobHandler,
  JobHandlerResult,
  JobLease,
  JobRunnerOptions,
  JobRunResult,
} from "./types.js";

export class DurableJobRunner {
  readonly #store: SqliteDurableStore;
  readonly #handler: JobHandler;
  readonly #options: JobRunnerOptions;
  readonly #clock: () => string;

  constructor(
    store: SqliteDurableStore,
    handler: JobHandler,
    options: JobRunnerOptions,
    clock: () => string = () => new Date().toISOString(),
  ) {
    validateOptions(options);
    this.#store = store;
    this.#handler = handler;
    this.#options = Object.freeze({ ...options });
    this.#clock = clock;
  }

  async runNext(): Promise<JobRunResult | null> {
    const lease = await this.#store.claimJob({
      leaseMs: this.#options.leaseMs,
      now: this.#clock(),
      workerId: this.#options.workerId,
    });
    if (lease === null) return null;
    return this.#executeLease(lease);
  }

  async drain(maxRuns: number): Promise<readonly JobRunResult[]> {
    assertSafeInteger(maxRuns, "maxRuns", 1, 10_000);
    const results: JobRunResult[] = [];
    while (results.length < maxRuns) {
      const result = await this.runNext();
      if (result === null) break;
      results.push(result);
    }
    return Object.freeze(results.map((result) => Object.freeze({ ...result })));
  }

  async #executeLease(lease: JobLease): Promise<JobRunResult> {
    const controller = new AbortController();
    let timeoutTriggered = false;
    let cancellationObserved = false;
    let heartbeatFailure: unknown;
    let heartbeatActive = false;

    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, this.#options.timeoutMs);

    const heartbeat = setInterval(() => {
      if (heartbeatActive || controller.signal.aborted) return;
      heartbeatActive = true;
      void this.#store
        .heartbeatJob(lease, this.#clock(), this.#options.leaseMs)
        .then((result) => {
          if (result.state === "CANCELLING") {
            cancellationObserved = true;
            controller.abort();
          }
        })
        .catch((error: unknown) => {
          heartbeatFailure = error;
          controller.abort();
        })
        .finally(() => {
          heartbeatActive = false;
        });
    }, this.#options.heartbeatMs);

    let outcome: JobHandlerResult;
    try {
      try {
        outcome = validateHandlerResult(
          await this.#handler.execute(Object.freeze(structuredClone(lease)), controller.signal),
        );
      } catch {
        outcome = {
          outcome: "RETRY",
          reasonCode: timeoutTriggered ? "handler_timeout" : "handler_error",
          retryAfterMs: 0,
        };
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    }

    if (heartbeatFailure !== undefined) throw heartbeatFailure;
    if (cancellationObserved || (controller.signal.aborted && !timeoutTriggered)) {
      outcome = { outcome: "CANCELLED" };
    } else if (timeoutTriggered) {
      outcome = { outcome: "RETRY", reasonCode: "handler_timeout", retryAfterMs: 0 };
    }

    const settled = await settle(this.#store, lease, outcome, this.#clock());
    return Object.freeze({
      finalStatus: settled.status,
      generation: lease.generation,
      jobId: lease.jobId,
    });
  }
}

async function settle(
  store: SqliteDurableStore,
  lease: JobLease,
  outcome: JobHandlerResult,
  now: string,
): Promise<DurableJobRecord> {
  if (outcome.outcome === "SUCCEEDED") {
    return store.settleJobSuccess(lease, outcome.result, now);
  }
  if (outcome.outcome === "RETRY") {
    return store.settleJobRetry(lease, outcome.reasonCode, outcome.retryAfterMs, now);
  }
  if (outcome.outcome === "BLOCKED") {
    return store.settleJobBlocked(lease, outcome.reasonCode, now);
  }
  return store.settleJobCancelled(lease, now);
}

function validateHandlerResult(value: JobHandlerResult): JobHandlerResult {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Job handler result must be a structured object.");
  }
  if (value.outcome === "SUCCEEDED") {
    assertArtifactReference(value.result, "handler result");
    return Object.freeze({ outcome: "SUCCEEDED", result: Object.freeze({ ...value.result }) });
  }
  if (value.outcome === "RETRY") {
    assertReasonCode(value.reasonCode);
    assertSafeInteger(value.retryAfterMs, "handler retryAfterMs", 0, 3_600_000);
    return Object.freeze({
      outcome: "RETRY",
      reasonCode: value.reasonCode,
      retryAfterMs: value.retryAfterMs,
    });
  }
  if (value.outcome === "BLOCKED") {
    assertReasonCode(value.reasonCode);
    return Object.freeze({ outcome: "BLOCKED", reasonCode: value.reasonCode });
  }
  if (value.outcome === "CANCELLED") return Object.freeze({ outcome: "CANCELLED" });
  throw new TypeError("Job handler outcome is unsupported.");
}

function validateOptions(options: JobRunnerOptions): void {
  if (options.workerId.trim() === "" || options.workerId.length > 200) {
    throw new TypeError("Runner workerId must be a bounded non-empty identifier.");
  }
  assertSafeInteger(options.leaseMs, "runner leaseMs", 1, 300_000);
  assertSafeInteger(options.heartbeatMs, "runner heartbeatMs", 1, 300_000);
  assertSafeInteger(options.timeoutMs, "runner timeoutMs", 1, 3_600_000);
  if (options.heartbeatMs >= options.leaseMs) {
    throw new TypeError("Runner heartbeat cadence must be shorter than its lease duration.");
  }
}
