import { createHash } from "node:crypto";
import { SandboxError } from "./types.js";

const MAX_IDENTIFIER_LENGTH = 160;
const MAX_LABEL_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 256;
const MAX_CREDENTIAL_REFERENCE_LENGTH = 256;
const MAX_TIMEOUT_MS = 60 * 60_000;

export type SandboxBackendKind = "local_process" | "remote_api";
export type SandboxIsolationClass = "host_process" | "provider_managed";
export type SandboxReleaseReason = "cancelled" | "completed" | "failed" | "expired";
export type SandboxReleaseOutcome = "RELEASED" | "REPLAYED";

export interface SandboxBackendDescriptor {
  readonly id: string;
  readonly label: string;
  readonly kind: SandboxBackendKind;
  readonly isolation: SandboxIsolationClass;
  readonly requiresCredential: boolean;
}

export interface SandboxBackendBinding {
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
  readonly backendId: string;
  readonly credentialRef?: string;
}

export interface SandboxModelIdentity {
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
}

export interface SandboxAllocationRequest extends SandboxModelIdentity {
  readonly missionId: string;
  readonly taskId: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface SandboxBackendCreateRequest extends SandboxModelIdentity {
  readonly idempotencyKey: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly credential?: string;
}

export interface SandboxBackendCreateResult {
  readonly sessionId: string;
  readonly expiresAt?: string;
}

export interface SandboxBackendDestroyRequest extends SandboxModelIdentity {
  readonly idempotencyKey: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly reason: SandboxReleaseReason;
  readonly signal: AbortSignal;
  readonly credential?: string;
}

export interface SandboxBackendAdapter {
  create(request: SandboxBackendCreateRequest): Promise<SandboxBackendCreateResult>;
  destroy?(request: SandboxBackendDestroyRequest): Promise<void>;
}

export interface SandboxBackendRegistration {
  readonly descriptor: SandboxBackendDescriptor;
  readonly adapter: SandboxBackendAdapter;
}

export type SandboxCredentialResolver = (credentialRef: string) => Promise<string> | string;

export interface SandboxSession extends SandboxModelIdentity {
  readonly allocationKey: string;
  readonly sessionId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly backendId: string;
  readonly backendKind: SandboxBackendKind;
  readonly isolation: SandboxIsolationClass;
  readonly expiresAt?: string;
  readonly selectionHash: string;
}

export interface SandboxReleaseRequest {
  readonly session: SandboxSession;
  readonly reason: SandboxReleaseReason;
  readonly signal: AbortSignal;
}

export interface SandboxBindingSummary extends SandboxModelIdentity {
  readonly backendId: string;
  readonly requiresCredential: boolean;
}

interface NormalizedBinding extends SandboxBackendBinding {
  readonly key: string;
}

interface RegisteredBackend {
  readonly descriptor: SandboxBackendDescriptor;
  readonly adapter: SandboxBackendAdapter;
}

interface AllocationRecord {
  readonly fingerprint: string;
  readonly session: SandboxSession;
}

interface InflightAllocation {
  readonly fingerprint: string;
  readonly promise: Promise<SandboxSession>;
}

export class SandboxBackendRegistry {
  readonly #backends = new Map<string, RegisteredBackend>();
  readonly #bindings = new Map<string, NormalizedBinding>();
  readonly #credentialResolver: SandboxCredentialResolver;
  readonly #allocations = new Map<string, AllocationRecord>();
  readonly #inflight = new Map<string, InflightAllocation>();
  readonly #released = new Set<string>();

  constructor(
    registrations: readonly SandboxBackendRegistration[],
    bindings: readonly SandboxBackendBinding[],
    credentialResolver: SandboxCredentialResolver,
  ) {
    if (!Array.isArray(registrations) || registrations.length === 0) {
      throw new SandboxError("BACKEND_INVALID", "At least one sandbox backend is required.");
    }
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new SandboxError("BACKEND_INVALID", "At least one sandbox model binding is required.");
    }
    if (typeof credentialResolver !== "function") {
      throw new SandboxError("BACKEND_INVALID", "Sandbox credential resolver is required.");
    }
    this.#credentialResolver = credentialResolver;

    for (const registration of registrations) {
      const descriptor = normalizeDescriptor(registration.descriptor);
      if (typeof registration.adapter?.create !== "function") {
        throw new SandboxError("BACKEND_INVALID", "Sandbox backend adapter is invalid.");
      }
      if (descriptor.kind === "remote_api" && typeof registration.adapter.destroy !== "function") {
        throw new SandboxError(
          "BACKEND_INVALID",
          "Remote sandbox backends must implement deterministic cleanup.",
        );
      }
      if (this.#backends.has(descriptor.id)) {
        throw new SandboxError(
          "BACKEND_INVALID",
          `Duplicate sandbox backend ID: ${descriptor.id}.`,
        );
      }
      this.#backends.set(
        descriptor.id,
        Object.freeze({ adapter: registration.adapter, descriptor }),
      );
    }

    for (const binding of bindings) {
      const normalized = normalizeBinding(binding);
      const backend = this.#backends.get(normalized.backendId);
      if (backend === undefined) {
        throw new SandboxError(
          "BACKEND_NOT_FOUND",
          `Sandbox binding references unknown backend: ${normalized.backendId}.`,
        );
      }
      if (backend.descriptor.requiresCredential && normalized.credentialRef === undefined) {
        throw new SandboxError(
          "BACKEND_INVALID",
          `Sandbox backend ${backend.descriptor.id} requires a credential reference.`,
        );
      }
      if (!backend.descriptor.requiresCredential && normalized.credentialRef !== undefined) {
        throw new SandboxError(
          "BACKEND_INVALID",
          `Sandbox backend ${backend.descriptor.id} must not receive a credential reference.`,
        );
      }
      if (this.#bindings.has(normalized.key)) {
        throw new SandboxError(
          "BACKEND_INVALID",
          `Duplicate sandbox model binding: ${normalized.key}.`,
        );
      }
      this.#bindings.set(normalized.key, normalized);
    }
  }

  backends(): readonly SandboxBackendDescriptor[] {
    return Object.freeze(
      [...this.#backends.values()]
        .map(({ descriptor }) => descriptor)
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  bindings(): readonly SandboxBindingSummary[] {
    return Object.freeze(
      [...this.#bindings.values()]
        .map((binding) => {
          const backend = this.#backends.get(binding.backendId);
          if (backend === undefined) {
            throw new SandboxError(
              "BACKEND_NOT_FOUND",
              "Sandbox backend disappeared from registry.",
            );
          }
          return Object.freeze({
            backendId: binding.backendId,
            model: binding.model,
            profileVersion: binding.profileVersion,
            provider: binding.provider,
            requiresCredential: backend.descriptor.requiresCredential,
          });
        })
        .sort((left, right) => modelKey(left).localeCompare(modelKey(right))),
    );
  }

  resolve(identity: SandboxModelIdentity): SandboxBackendDescriptor {
    const normalizedIdentity = normalizeIdentity(identity);
    const binding = this.#bindings.get(modelKey(normalizedIdentity));
    if (binding === undefined) {
      throw new SandboxError(
        "BINDING_NOT_FOUND",
        "No sandbox backend is bound to this exact model profile.",
      );
    }
    const backend = this.#backends.get(binding.backendId);
    if (backend === undefined) {
      throw new SandboxError("BACKEND_NOT_FOUND", "Sandbox backend is unavailable.");
    }
    return backend.descriptor;
  }

  async allocate(request: SandboxAllocationRequest): Promise<SandboxSession> {
    if (request.signal.aborted) {
      throw new SandboxError("CANCELLED", "Sandbox allocation was cancelled.");
    }
    const identity = normalizeIdentity(request);
    const missionId = identifier(request.missionId, "missionId");
    const taskId = identifier(request.taskId, "taskId");
    const timeoutMs = positiveInteger(request.timeoutMs, "timeoutMs", MAX_TIMEOUT_MS);
    const binding = this.#bindings.get(modelKey(identity));
    if (binding === undefined) {
      throw new SandboxError(
        "BINDING_NOT_FOUND",
        "No sandbox backend is bound to this exact model profile.",
      );
    }
    const backend = this.#backends.get(binding.backendId);
    if (backend === undefined) {
      throw new SandboxError("BACKEND_NOT_FOUND", "Sandbox backend is unavailable.");
    }

    const allocationKey = allocationKeyFor({
      backendId: backend.descriptor.id,
      missionId,
      model: identity.model,
      profileVersion: identity.profileVersion,
      provider: identity.provider,
      taskId,
    });
    const fingerprint = selectionHashFor({ allocationKey, timeoutMs: String(timeoutMs) });
    const settled = this.#allocations.get(allocationKey);
    if (settled !== undefined) {
      assertAllocationFingerprint(settled.fingerprint, fingerprint);
      if (this.#released.has(allocationKey)) {
        throw new SandboxError("SESSION_INVALID", "Released sandbox allocation cannot be reused.");
      }
      return settled.session;
    }
    const inflight = this.#inflight.get(allocationKey);
    if (inflight !== undefined) {
      assertAllocationFingerprint(inflight.fingerprint, fingerprint);
      return inflight.promise;
    }

    const promise = this.#createAllocation({
      allocationKey,
      backend,
      binding,
      fingerprint,
      identity,
      missionId,
      signal: request.signal,
      taskId,
      timeoutMs,
    });
    this.#inflight.set(allocationKey, Object.freeze({ fingerprint, promise }));
    try {
      return await promise;
    } finally {
      this.#inflight.delete(allocationKey);
    }
  }

  async release(request: SandboxReleaseRequest): Promise<SandboxReleaseOutcome> {
    if (request.signal.aborted) {
      throw new SandboxError("CANCELLED", "Sandbox release was cancelled.");
    }
    if (!isReleaseReason(request.reason)) {
      throw new SandboxError("SESSION_INVALID", "Sandbox release reason is invalid.");
    }
    const session = normalizeSession(request.session);
    const stored = this.#allocations.get(session.allocationKey);
    if (stored === undefined || !sameSession(stored.session, session)) {
      throw new SandboxError("SESSION_INVALID", "Sandbox session is unknown or does not match.");
    }
    if (this.#released.has(session.allocationKey)) return "REPLAYED";

    const binding = this.#bindings.get(modelKey(session));
    if (binding === undefined || binding.backendId !== session.backendId) {
      throw new SandboxError("SESSION_INVALID", "Sandbox session binding no longer matches.");
    }
    const backend = this.#backends.get(session.backendId);
    if (backend === undefined) {
      throw new SandboxError("BACKEND_NOT_FOUND", "Sandbox backend is unavailable.");
    }

    if (backend.adapter.destroy !== undefined) {
      const credential = backend.descriptor.requiresCredential
        ? await this.#resolveCredential(binding.credentialRef)
        : undefined;
      if (request.signal.aborted) {
        throw new SandboxError("CANCELLED", "Sandbox release was cancelled.");
      }
      await backend.adapter.destroy(
        Object.freeze({
          ...(credential === undefined ? {} : { credential }),
          idempotencyKey: `release:${session.allocationKey}`,
          missionId: session.missionId,
          model: session.model,
          profileVersion: session.profileVersion,
          provider: session.provider,
          reason: request.reason,
          sessionId: session.sessionId,
          signal: request.signal,
          taskId: session.taskId,
        }),
      );
    }

    this.#released.add(session.allocationKey);
    return "RELEASED";
  }

  async #createAllocation(input: {
    readonly allocationKey: string;
    readonly backend: RegisteredBackend;
    readonly binding: NormalizedBinding;
    readonly fingerprint: string;
    readonly identity: SandboxModelIdentity;
    readonly missionId: string;
    readonly taskId: string;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<SandboxSession> {
    const credential = input.backend.descriptor.requiresCredential
      ? await this.#resolveCredential(input.binding.credentialRef)
      : undefined;
    if (input.signal.aborted) {
      throw new SandboxError("CANCELLED", "Sandbox allocation was cancelled.");
    }
    const result = await input.backend.adapter.create(
      Object.freeze({
        ...(credential === undefined ? {} : { credential }),
        idempotencyKey: input.allocationKey,
        missionId: input.missionId,
        model: input.identity.model,
        profileVersion: input.identity.profileVersion,
        provider: input.identity.provider,
        signal: input.signal,
        taskId: input.taskId,
        timeoutMs: input.timeoutMs,
      }),
    );
    const sessionId = identifier(result?.sessionId, "sessionId", MAX_SESSION_ID_LENGTH);
    const expiresAt = normalizeOptionalTimestamp(result?.expiresAt);
    const selectionHash = selectionHashFor({
      allocationKey: input.allocationKey,
      backendId: input.backend.descriptor.id,
      missionId: input.missionId,
      model: input.identity.model,
      profileVersion: input.identity.profileVersion,
      provider: input.identity.provider,
      sessionId,
      taskId: input.taskId,
    });
    const session = Object.freeze({
      allocationKey: input.allocationKey,
      backendId: input.backend.descriptor.id,
      backendKind: input.backend.descriptor.kind,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      isolation: input.backend.descriptor.isolation,
      missionId: input.missionId,
      model: input.identity.model,
      profileVersion: input.identity.profileVersion,
      provider: input.identity.provider,
      selectionHash,
      sessionId,
      taskId: input.taskId,
    });
    this.#allocations.set(
      input.allocationKey,
      Object.freeze({ fingerprint: input.fingerprint, session }),
    );
    return session;
  }

  async #resolveCredential(reference: string | undefined): Promise<string> {
    if (reference === undefined) {
      throw new SandboxError("CREDENTIAL_INVALID", "Sandbox credential reference is missing.");
    }
    let credential: string;
    try {
      credential = await this.#credentialResolver(reference);
    } catch {
      throw new SandboxError("CREDENTIAL_INVALID", "Sandbox credential could not be resolved.");
    }
    if (
      typeof credential !== "string" ||
      credential.trim() === "" ||
      credential.includes("\r") ||
      credential.includes("\n")
    ) {
      throw new SandboxError("CREDENTIAL_INVALID", "Sandbox credential is missing or invalid.");
    }
    return credential;
  }
}

function normalizeDescriptor(value: SandboxBackendDescriptor): SandboxBackendDescriptor {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("BACKEND_INVALID", "Sandbox backend descriptor is invalid.");
  }
  const id = identifier(value.id, "backend id");
  const label = boundedText(value.label, "backend label", MAX_LABEL_LENGTH);
  if (value.kind !== "local_process" && value.kind !== "remote_api") {
    throw new SandboxError("BACKEND_INVALID", "Sandbox backend kind is invalid.");
  }
  if (value.isolation !== "host_process" && value.isolation !== "provider_managed") {
    throw new SandboxError("BACKEND_INVALID", "Sandbox isolation class is invalid.");
  }
  if (typeof value.requiresCredential !== "boolean") {
    throw new SandboxError("BACKEND_INVALID", "Sandbox credential requirement is invalid.");
  }
  if (value.kind === "local_process" && value.isolation !== "host_process") {
    throw new SandboxError(
      "BACKEND_INVALID",
      "Local sandbox backend must use host-process isolation.",
    );
  }
  if (value.kind === "remote_api" && value.isolation !== "provider_managed") {
    throw new SandboxError(
      "BACKEND_INVALID",
      "Remote sandbox backend must use provider-managed isolation.",
    );
  }
  return Object.freeze({
    id,
    isolation: value.isolation,
    kind: value.kind,
    label,
    requiresCredential: value.requiresCredential,
  });
}

function normalizeBinding(value: SandboxBackendBinding): NormalizedBinding {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("BACKEND_INVALID", "Sandbox model binding is invalid.");
  }
  const identity = normalizeIdentity(value);
  const backendId = identifier(value.backendId, "backendId");
  const credentialRef =
    value.credentialRef === undefined
      ? undefined
      : identifier(value.credentialRef, "credentialRef", MAX_CREDENTIAL_REFERENCE_LENGTH);
  return Object.freeze({
    backendId,
    ...(credentialRef === undefined ? {} : { credentialRef }),
    key: modelKey(identity),
    ...identity,
  });
}

function normalizeIdentity(value: SandboxModelIdentity): SandboxModelIdentity {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("BACKEND_INVALID", "Sandbox model identity is invalid.");
  }
  return Object.freeze({
    model: identifier(value.model, "model"),
    profileVersion: identifier(value.profileVersion, "profileVersion"),
    provider: identifier(value.provider, "provider"),
  });
}

function normalizeSession(value: SandboxSession): SandboxSession {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("SESSION_INVALID", "Sandbox session is invalid.");
  }
  const identity = normalizeIdentity(value);
  const expiresAt =
    value.expiresAt === undefined ? undefined : normalizeOptionalTimestamp(value.expiresAt);
  return Object.freeze({
    allocationKey: identifier(value.allocationKey, "allocationKey", 64),
    backendId: identifier(value.backendId, "backendId"),
    backendKind: value.backendKind,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    isolation: value.isolation,
    missionId: identifier(value.missionId, "missionId"),
    ...identity,
    selectionHash: identifier(value.selectionHash, "selectionHash", 64),
    sessionId: identifier(value.sessionId, "sessionId", MAX_SESSION_ID_LENGTH),
    taskId: identifier(value.taskId, "taskId"),
  });
}

function modelKey(value: SandboxModelIdentity): string {
  return `${value.provider}\u0000${value.model}\u0000${value.profileVersion}`;
}

function allocationKeyFor(value: Readonly<Record<string, string>>): string {
  return selectionHashFor(value);
}

function selectionHashFor(value: Readonly<Record<string, string>>): string {
  const canonical = Object.keys(value)
    .sort()
    .map((key) => `${key}:${JSON.stringify(value[key])}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function sameSession(left: SandboxSession, right: SandboxSession): boolean {
  return (
    left.allocationKey === right.allocationKey &&
    left.backendId === right.backendId &&
    left.backendKind === right.backendKind &&
    left.expiresAt === right.expiresAt &&
    left.isolation === right.isolation &&
    left.missionId === right.missionId &&
    left.model === right.model &&
    left.profileVersion === right.profileVersion &&
    left.provider === right.provider &&
    left.selectionHash === right.selectionHash &&
    left.sessionId === right.sessionId &&
    left.taskId === right.taskId
  );
}

function assertAllocationFingerprint(existing: string, requested: string): void {
  if (existing !== requested) {
    throw new SandboxError(
      "SESSION_INVALID",
      "Sandbox allocation replay conflicts with its original immutable request.",
    );
  }
}

function isReleaseReason(value: string): value is SandboxReleaseReason {
  return (
    value === "cancelled" || value === "completed" || value === "failed" || value === "expired"
  );
}

function identifier(value: string, label: string, maximum = MAX_IDENTIFIER_LENGTH): string {
  const normalized = boundedText(value, label, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u.test(normalized)) {
    throw new SandboxError("BACKEND_INVALID", `${label} contains unsupported characters.`);
  }
  return normalized;
}

function boundedText(value: string, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maximum ||
    value.includes("\u0000")
  ) {
    throw new SandboxError("BACKEND_INVALID", `${label} is missing or outside its bound.`);
  }
  return value;
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new SandboxError("BACKEND_INVALID", `${label} must be a bounded positive integer.`);
  }
  return value;
}

function normalizeOptionalTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const timestamp = boundedText(value, "expiresAt", 64);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new SandboxError("SESSION_INVALID", "Sandbox session expiry is invalid.");
  }
  return timestamp;
}
