import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "../providers/types.js";
import type { CapabilityPolicy } from "./policy.js";
import type { ToolRegistry } from "./registry.js";
import { validateToolInput } from "./schema.js";
import {
  type PolicyAuthorization,
  type ToolAuditRecord,
  type ToolAuditResultClass,
  type ToolAuditSink,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolFailureCategory,
  type ToolRegistration,
  ToolRuntimeError,
} from "./types.js";

interface ReplayRecord {
  readonly inputHash: string;
  readonly output: JsonValue;
  readonly attempts: number;
}

export class ToolRuntime {
  readonly #registry: ToolRegistry;
  readonly #policy: CapabilityPolicy;
  readonly #audit: ToolAuditSink;
  readonly #clock: () => string;
  readonly #replays = new Map<string, ReplayRecord>();
  readonly #locks = new Map<string, Promise<void>>();

  constructor(
    registry: ToolRegistry,
    policy: CapabilityPolicy,
    audit: ToolAuditSink,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.#registry = registry;
    this.#policy = policy;
    this.#audit = audit;
    this.#clock = clock;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    validateExecutionRequest(request);
    const registration = this.#registry.resolveRegistration(request.tool, request.version);
    validateToolInput(registration.manifest.inputSchema, request.input);
    const resource = resolveResource(registration, request.input);
    const inputHash = stableHash(request.input);

    if (!registration.manifest.sideEffecting) {
      return this.#executeFresh(request, registration, resource, inputHash);
    }

    const idempotencyKey = request.idempotencyKey;
    if (idempotencyKey === undefined || idempotencyKey.trim() === "") {
      throw new ToolRuntimeError(
        "invalid_input",
        "Side-effecting tools require a non-empty idempotency key.",
        false,
      );
    }
    const replayScope = [
      request.missionId,
      request.taskId,
      request.tool,
      request.version,
      idempotencyKey,
    ].join("\u0000");

    return this.#withLock(replayScope, async () => {
      const replay = this.#replays.get(replayScope);
      if (replay !== undefined) {
        if (replay.inputHash !== inputHash) {
          await this.#appendAudit({
            attempt: 0,
            errorCategory: "conflict",
            inputHash,
            policyDecision: "REPLAY",
            registration,
            request,
            resource,
            resultClass: "conflict",
            startedAt: this.#clock(),
          });
          throw new ToolRuntimeError(
            "conflict",
            "Idempotency key was reused with different tool input.",
            false,
          );
        }
        await this.#appendAudit({
          attempt: 0,
          inputHash,
          policyDecision: "REPLAY",
          registration,
          request,
          resource,
          resultClass: "replay",
          startedAt: this.#clock(),
        });
        return {
          attempts: replay.attempts,
          output: structuredClone(replay.output),
          replayed: true,
        };
      }

      const result = await this.#executeFresh(request, registration, resource, inputHash);
      this.#replays.set(replayScope, {
        attempts: result.attempts,
        inputHash,
        output: structuredClone(result.output),
      });
      return result;
    });
  }

  async #executeFresh(
    request: ToolExecutionRequest,
    registration: ToolRegistration,
    resource: string,
    inputHash: string,
  ): Promise<ToolExecutionResult> {
    const { manifest } = registration;

    for (let attempt = 1; attempt <= manifest.retryPolicy.maxAttempts; attempt += 1) {
      const startedAt = this.#clock();
      if (request.signal?.aborted === true) {
        await this.#appendAudit({
          attempt,
          errorCategory: "cancelled",
          inputHash,
          policyDecision: "DENY",
          registration,
          request,
          resource,
          resultClass: "cancelled",
          startedAt,
        });
        throw new ToolRuntimeError("cancelled", "Tool execution was cancelled.", false);
      }

      const authorization = this.#policy.authorizeAndConsume({
        missionId: request.missionId,
        operation: manifest.operation,
        resource,
        riskClass: manifest.riskClass,
        taskId: request.taskId,
        tool: request.tool,
        now: startedAt,
        ...(request.approval === undefined ? {} : { approval: request.approval }),
      });
      if (authorization.decision !== "ALLOW") {
        const category =
          authorization.decision === "REQUIRE_APPROVAL" ? "require_approval" : "denied";
        await this.#appendAudit({
          attempt,
          authorization,
          errorCategory: category,
          inputHash,
          policyDecision: authorization.decision,
          registration,
          request,
          resource,
          resultClass: "denied",
          startedAt,
        });
        throw new ToolRuntimeError(category, authorization.reason, false);
      }

      try {
        const output = await runHandlerWithTimeout(
          registration,
          request.input,
          request,
          attempt,
          manifest.retryPolicy.timeoutMs,
        );
        await this.#appendAudit({
          attempt,
          authorization,
          inputHash,
          policyDecision: authorization.decision,
          registration,
          request,
          resource,
          resultClass: "success",
          startedAt,
        });
        return { attempts: attempt, output: structuredClone(output), replayed: false };
      } catch (error) {
        const normalized = normalizeHandlerError(error);
        const canRetry =
          attempt < manifest.retryPolicy.maxAttempts &&
          normalized.retryable &&
          manifest.retryPolicy.retryableCategories.includes(normalized.category);
        await this.#appendAudit({
          attempt,
          authorization,
          errorCategory: normalized.category,
          inputHash,
          policyDecision: authorization.decision,
          registration,
          request,
          resource,
          resultClass: resultClassFor(normalized.category),
          startedAt,
        });
        if (!canRetry) throw normalized;
      }
    }

    throw new ToolRuntimeError("handler_error", "Tool retry loop ended unexpectedly.", false);
  }

  async #appendAudit(input: {
    readonly attempt: number;
    readonly authorization?: PolicyAuthorization;
    readonly errorCategory?: ToolFailureCategory;
    readonly inputHash: string;
    readonly policyDecision: ToolAuditRecord["policyDecision"];
    readonly registration: ToolRegistration;
    readonly request: ToolExecutionRequest;
    readonly resource: string;
    readonly resultClass: ToolAuditResultClass;
    readonly startedAt: string;
  }): Promise<void> {
    const record: ToolAuditRecord = {
      attempt: input.attempt,
      finishedAt: this.#clock(),
      inputHash: input.inputHash,
      missionId: input.request.missionId,
      operation: input.registration.manifest.operation,
      policyDecision: input.policyDecision,
      resource: input.resource,
      resultClass: input.resultClass,
      sideEffecting: input.registration.manifest.sideEffecting,
      startedAt: input.startedAt,
      taskId: input.request.taskId,
      tool: input.request.tool,
      version: input.request.version,
      ...(input.authorization?.grantId === undefined
        ? {}
        : { grantId: input.authorization.grantId }),
      ...(input.errorCategory === undefined ? {} : { errorCategory: input.errorCategory }),
    };
    await this.#audit.append(record);
  }

  async #withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#locks.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }
}

async function runHandlerWithTimeout(
  registration: ToolRegistration,
  input: JsonObject,
  request: ToolExecutionRequest,
  attempt: number,
  timeoutMs: number,
): Promise<JsonValue> {
  const controller = new AbortController();
  return new Promise<JsonValue>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = () => {
      controller.abort();
      finish(() =>
        reject(new ToolRuntimeError("cancelled", "Tool execution was cancelled.", false)),
      );
    };
    const timeout = setTimeout(() => {
      controller.abort();
      finish(() => reject(new ToolRuntimeError("timeout", "Tool execution timed out.", true)));
    }, timeoutMs);

    if (request.signal?.aborted === true) {
      onAbort();
      return;
    }
    request.signal?.addEventListener("abort", onAbort, { once: true });

    Promise.resolve()
      .then(() =>
        registration.handler(input, {
          attempt,
          missionId: request.missionId,
          signal: controller.signal,
          taskId: request.taskId,
        }),
      )
      .then(
        (output) => finish(() => resolve(output)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function resolveResource(registration: ToolRegistration, input: JsonObject): string {
  let resource: string;
  try {
    resource = registration.resourceFromInput(input);
  } catch (error) {
    if (error instanceof ToolRuntimeError) throw error;
    throw new ToolRuntimeError("invalid_input", "Tool resource could not be resolved.", false);
  }
  if (typeof resource !== "string" || resource.trim() === "") {
    throw new ToolRuntimeError("invalid_input", "Tool resource must be non-empty.", false);
  }
  return resource;
}

function normalizeHandlerError(error: unknown): ToolRuntimeError {
  if (error instanceof ToolRuntimeError) return error;
  return new ToolRuntimeError("handler_error", "Tool handler failed.", false);
}

function resultClassFor(category: ToolFailureCategory): ToolAuditResultClass {
  if (category === "timeout") return "timeout";
  if (category === "cancelled") return "cancelled";
  if (category === "conflict") return "conflict";
  if (category === "denied" || category === "require_approval") return "denied";
  return "failure";
}

function stableHash(value: JsonValue): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value !== "object" || value === null) return value;
  const object = value as JsonObject;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalize(object[key] as JsonValue)]),
  ) as JsonObject;
}

function validateExecutionRequest(request: ToolExecutionRequest): void {
  for (const [name, value] of [
    ["missionId", request.missionId],
    ["taskId", request.taskId],
    ["tool", request.tool],
    ["version", request.version],
  ] as const) {
    if (value.trim() === "")
      throw new ToolRuntimeError("invalid_input", `${name} is required.`, false);
  }
}
