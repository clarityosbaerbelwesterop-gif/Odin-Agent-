import { assertStrictToolSchema } from "./schema.js";
import {
  type ToolManifest,
  type ToolRegistration,
  ToolRuntimeError,
  type ToolSummary,
} from "./types.js";

export class ToolRegistry {
  readonly #registrations = new Map<string, ToolRegistration>();

  constructor(registrations: readonly ToolRegistration[] = []) {
    for (const registration of registrations) this.register(registration);
  }

  register(registration: ToolRegistration): void {
    validateManifest(registration.manifest);
    if (typeof registration.handler !== "function") {
      throw new TypeError("Tool handler must be a function.");
    }
    if (typeof registration.resourceFromInput !== "function") {
      throw new TypeError("Tool resource resolver must be a function.");
    }

    const key = toolKey(registration.manifest.name, registration.manifest.version);
    if (this.#registrations.has(key)) {
      throw new ToolRuntimeError("conflict", `Tool ${key} is already registered.`, false);
    }
    this.#registrations.set(key, freezeRegistration(registration));
  }

  listSummaries(): readonly ToolSummary[] {
    return [...this.#registrations.values()]
      .map(({ manifest }) => ({
        name: manifest.name,
        operation: manifest.operation,
        riskClass: manifest.riskClass,
        summary: manifest.summary,
        trustClass: manifest.trustClass,
        version: manifest.version,
      }))
      .sort((left, right) =>
        toolKey(left.name, left.version).localeCompare(toolKey(right.name, right.version)),
      );
  }

  resolveManifest(name: string, version: string): ToolManifest {
    return structuredClone(this.resolveRegistration(name, version).manifest);
  }

  resolveRegistration(name: string, version: string): ToolRegistration {
    const registration = this.#registrations.get(toolKey(name, version));
    if (registration === undefined) {
      throw new ToolRuntimeError("invalid_input", `Unknown tool ${name}@${version}.`, false);
    }
    return registration;
  }
}

function validateManifest(manifest: ToolManifest): void {
  assertIdentifier(manifest.name, "tool name", /^[a-z][a-z0-9_.-]{0,63}$/u);
  assertIdentifier(manifest.version, "tool version", /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/u);
  if (manifest.summary.trim() === "" || manifest.description.trim() === "") {
    throw new TypeError("Tool summary and description must be non-empty.");
  }
  if (
    !Number.isSafeInteger(manifest.retryPolicy.maxAttempts) ||
    manifest.retryPolicy.maxAttempts < 1
  ) {
    throw new TypeError("Tool retry maxAttempts must be a positive safe integer.");
  }
  if (
    !Number.isSafeInteger(manifest.retryPolicy.timeoutMs) ||
    manifest.retryPolicy.timeoutMs < 1
  ) {
    throw new TypeError("Tool timeoutMs must be a positive safe integer.");
  }
  if (
    new Set(manifest.retryPolicy.retryableCategories).size !==
    manifest.retryPolicy.retryableCategories.length
  ) {
    throw new TypeError("Tool retryableCategories must not contain duplicates.");
  }
  if (manifest.sideEffecting && manifest.retryPolicy.maxAttempts !== 1) {
    throw new TypeError(
      "Side-effecting tools are single-attempt in M3 until worker-level idempotency is available.",
    );
  }
  if (
    manifest.provenance.reference.trim() === "" ||
    Number.isNaN(Date.parse(manifest.provenance.observedAt))
  ) {
    throw new TypeError("Tool provenance must contain a reference and parseable timestamp.");
  }
  assertStrictToolSchema(manifest.inputSchema);
}

function freezeRegistration(registration: ToolRegistration): ToolRegistration {
  const manifest = structuredClone(registration.manifest);
  Object.freeze(manifest.retryPolicy.retryableCategories);
  Object.freeze(manifest.retryPolicy);
  Object.freeze(manifest.provenance);
  Object.freeze(manifest.inputSchema);
  Object.freeze(manifest);
  return Object.freeze({
    handler: registration.handler,
    manifest,
    resourceFromInput: registration.resourceFromInput,
  });
}

function toolKey(name: string, version: string): string {
  return `${name}@${version}`;
}

function assertIdentifier(value: string, name: string, pattern: RegExp): void {
  if (!pattern.test(value)) throw new TypeError(`${name} is invalid.`);
}
