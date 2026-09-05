import type { JsonObject } from "../providers/types.js";
import type { ToolRegistry } from "./registry.js";
import type { ToolRuntime } from "./runtime.js";
import type {
  ApprovalEvidence,
  ToolExecutionResult,
  ToolManifest,
  ToolOperation,
  ToolRiskClass,
  ToolTrustClass,
} from "./types.js";

export type ToolEcosystemCategory =
  | "api"
  | "browser"
  | "cicd"
  | "cloud"
  | "data"
  | "database"
  | "documents"
  | "repository"
  | "research";

export type ToolEcosystemCostClass = "metered" | "none";
export type ToolEcosystemCredentialMode = "brokered" | "none";
export type ToolEcosystemConfirmation = "m3-policy" | "none";

export interface ToolEcosystemDescriptor {
  readonly adapterId: string;
  readonly category: ToolEcosystemCategory;
  readonly confirmation: ToolEcosystemConfirmation;
  readonly costClass: ToolEcosystemCostClass;
  readonly credentialMode: ToolEcosystemCredentialMode;
  readonly maxAttempts: number;
  readonly networkAccess: boolean;
  readonly operation: ToolOperation;
  readonly riskClass: ToolRiskClass;
  readonly sideEffecting: boolean;
  readonly timeoutMs: number;
  readonly tool: string;
  readonly trustClass: ToolTrustClass;
  readonly version: string;
}

export interface ToolEcosystemSummary {
  readonly adapterId: string;
  readonly category: ToolEcosystemCategory;
  readonly confirmation: ToolEcosystemConfirmation;
  readonly costClass: ToolEcosystemCostClass;
  readonly credentialMode: ToolEcosystemCredentialMode;
  readonly networkAccess: boolean;
  readonly operation: ToolOperation;
  readonly riskClass: ToolRiskClass;
  readonly sideEffecting: boolean;
  readonly tool: string;
  readonly version: string;
}

export interface ToolEcosystemExecutionRequest {
  readonly approval?: ApprovalEvidence;
  readonly idempotencyKey?: string;
  readonly input: JsonObject;
  readonly missionId: string;
  readonly signal?: AbortSignal;
  readonly taskId: string;
}

export class ToolEcosystemError extends Error {
  constructor(
    readonly code: "CONFLICT" | "DENIED" | "INVALID_INPUT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ToolEcosystemError";
  }
}

const CATEGORIES = new Set<ToolEcosystemCategory>([
  "api",
  "browser",
  "cicd",
  "cloud",
  "data",
  "database",
  "documents",
  "repository",
  "research",
]);

export class ToolEcosystem {
  readonly #registry: ToolRegistry;
  readonly #runtime: ToolRuntime;
  readonly #descriptors = new Map<string, ToolEcosystemDescriptor>();

  constructor(registry: ToolRegistry, runtime: ToolRuntime) {
    this.#registry = registry;
    this.#runtime = runtime;
  }

  register(value: unknown): ToolEcosystemSummary {
    const descriptor = normalizeDescriptor(value);
    let manifest: ToolManifest;
    try {
      manifest = this.#registry.resolveManifest(descriptor.tool, descriptor.version);
    } catch {
      throw new ToolEcosystemError(
        "NOT_FOUND",
        "Ecosystem descriptors must reference an already-registered exact M3 tool.",
      );
    }
    assertDescriptorMatchesManifest(descriptor, manifest);
    const existing = this.#descriptors.get(descriptor.adapterId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(descriptor)) return summary(existing);
      throw new ToolEcosystemError("CONFLICT", "Adapter id is already registered differently.");
    }
    this.#descriptors.set(descriptor.adapterId, descriptor);
    return summary(descriptor);
  }

  discover(category?: ToolEcosystemCategory): readonly ToolEcosystemSummary[] {
    if (category !== undefined && !CATEGORIES.has(category)) {
      throw new ToolEcosystemError("INVALID_INPUT", "Unknown tool ecosystem category.");
    }
    return Object.freeze(
      [...this.#descriptors.values()]
        .filter((descriptor) => category === undefined || descriptor.category === category)
        .map(summary)
        .sort((left, right) => left.adapterId.localeCompare(right.adapterId)),
    );
  }

  resolveManifest(adapterId: string): ToolManifest {
    const descriptor = this.#requireDescriptor(adapterId);
    const manifest = this.#registry.resolveManifest(descriptor.tool, descriptor.version);
    assertDescriptorMatchesManifest(descriptor, manifest);
    return structuredClone(manifest);
  }

  async execute(
    adapterId: string,
    request: ToolEcosystemExecutionRequest,
  ): Promise<ToolExecutionResult> {
    const descriptor = this.#requireDescriptor(adapterId);
    validateExecutionRequest(request, descriptor);
    const currentManifest = this.#registry.resolveManifest(descriptor.tool, descriptor.version);
    assertDescriptorMatchesManifest(descriptor, currentManifest);
    return this.#runtime.execute({
      input: structuredClone(request.input),
      missionId: request.missionId,
      taskId: request.taskId,
      tool: descriptor.tool,
      version: descriptor.version,
      ...(request.approval === undefined ? {} : { approval: structuredClone(request.approval) }),
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  }

  #requireDescriptor(adapterId: string): ToolEcosystemDescriptor {
    validateIdentifier(adapterId, "adapterId");
    const descriptor = this.#descriptors.get(adapterId);
    if (descriptor === undefined) {
      throw new ToolEcosystemError("NOT_FOUND", "Tool ecosystem adapter is not registered.");
    }
    return descriptor;
  }
}

function normalizeDescriptor(value: unknown): ToolEcosystemDescriptor {
  const object = exactObject(value, [
    "adapterId",
    "category",
    "confirmation",
    "costClass",
    "credentialMode",
    "maxAttempts",
    "networkAccess",
    "operation",
    "riskClass",
    "sideEffecting",
    "timeoutMs",
    "tool",
    "trustClass",
    "version",
  ]);
  if (
    typeof object.category !== "string" ||
    !CATEGORIES.has(object.category as ToolEcosystemCategory)
  ) {
    invalid("category is invalid.");
  }
  if (object.confirmation !== "none" && object.confirmation !== "m3-policy")
    invalid("confirmation is invalid.");
  if (object.costClass !== "none" && object.costClass !== "metered")
    invalid("costClass is invalid.");
  if (object.credentialMode !== "none" && object.credentialMode !== "brokered")
    invalid("credentialMode is invalid.");
  if (
    object.operation !== "execute" &&
    object.operation !== "read" &&
    object.operation !== "search" &&
    object.operation !== "write"
  )
    invalid("operation is invalid.");
  if (object.riskClass !== "low" && object.riskClass !== "medium" && object.riskClass !== "high")
    invalid("riskClass is invalid.");
  if (object.trustClass !== "builtin" && object.trustClass !== "project")
    invalid("trustClass is invalid.");
  if (typeof object.sideEffecting !== "boolean" || typeof object.networkAccess !== "boolean")
    invalid("boolean descriptor fields are invalid.");
  const maxAttempts = positiveInteger(object.maxAttempts, 16, "maxAttempts");
  const timeoutMs = positiveInteger(object.timeoutMs, 600_000, "timeoutMs");
  const descriptor: ToolEcosystemDescriptor = {
    adapterId: validateIdentifier(object.adapterId, "adapterId"),
    category: object.category as ToolEcosystemCategory,
    confirmation: object.confirmation,
    costClass: object.costClass,
    credentialMode: object.credentialMode,
    maxAttempts,
    networkAccess: object.networkAccess,
    operation: object.operation,
    riskClass: object.riskClass,
    sideEffecting: object.sideEffecting,
    timeoutMs,
    tool: validateIdentifier(object.tool, "tool"),
    trustClass: object.trustClass,
    version: validateIdentifier(object.version, "version"),
  };
  if (descriptor.riskClass === "high" && descriptor.confirmation !== "m3-policy") {
    throw new ToolEcosystemError(
      "DENIED",
      "High-risk adapters must declare M3 policy confirmation; metadata cannot weaken approval.",
    );
  }
  if (descriptor.credentialMode === "brokered" && !descriptor.networkAccess) {
    throw new ToolEcosystemError(
      "DENIED",
      "Brokered remote credentials require an explicitly network-capable adapter descriptor.",
    );
  }
  return Object.freeze(descriptor);
}

function assertDescriptorMatchesManifest(
  descriptor: ToolEcosystemDescriptor,
  manifest: ToolManifest,
): void {
  if (
    descriptor.tool !== manifest.name ||
    descriptor.version !== manifest.version ||
    descriptor.operation !== manifest.operation ||
    descriptor.riskClass !== manifest.riskClass ||
    descriptor.sideEffecting !== manifest.sideEffecting ||
    descriptor.maxAttempts !== manifest.retryPolicy.maxAttempts ||
    descriptor.timeoutMs !== manifest.retryPolicy.timeoutMs ||
    descriptor.trustClass !== manifest.trustClass
  ) {
    throw new ToolEcosystemError(
      "CONFLICT",
      "Tool ecosystem descriptor contradicts its exact M3 manifest.",
    );
  }
}

function validateExecutionRequest(
  request: ToolEcosystemExecutionRequest,
  descriptor: ToolEcosystemDescriptor,
): void {
  validateIdentifier(request.missionId, "missionId");
  validateIdentifier(request.taskId, "taskId");
  if (typeof request.input !== "object" || request.input === null || Array.isArray(request.input)) {
    invalid("input must be a JSON object.");
  }
  if (
    descriptor.sideEffecting &&
    (request.idempotencyKey === undefined || request.idempotencyKey.trim() === "")
  ) {
    throw new ToolEcosystemError(
      "DENIED",
      "Side-effecting ecosystem requests require an M3 idempotency key.",
    );
  }
  if (request.idempotencyKey !== undefined)
    validateIdentifier(request.idempotencyKey, "idempotencyKey");
}

function summary(descriptor: ToolEcosystemDescriptor): ToolEcosystemSummary {
  return Object.freeze({
    adapterId: descriptor.adapterId,
    category: descriptor.category,
    confirmation: descriptor.confirmation,
    costClass: descriptor.costClass,
    credentialMode: descriptor.credentialMode,
    networkAccess: descriptor.networkAccess,
    operation: descriptor.operation,
    riskClass: descriptor.riskClass,
    sideEffecting: descriptor.sideEffecting,
    tool: descriptor.tool,
    version: descriptor.version,
  });
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid("Expected an object.");
  const object = value as Record<string, unknown>;
  const expected = [...fields].sort();
  const actual = Object.keys(object).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid("Descriptor shape must be exact.");
  }
  return object;
}

function validateIdentifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 200 ||
    value.includes("\u0000")
  ) {
    invalid(`${name} is invalid.`);
  }
  return value;
}

function positiveInteger(value: unknown, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    invalid(`${name} is invalid.`);
  }
  return value as number;
}

function invalid(message: string): never {
  throw new ToolEcosystemError("INVALID_INPUT", message);
}
