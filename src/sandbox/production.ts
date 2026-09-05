import { createHash } from "node:crypto";
import { normalizeRelativePath } from "./workspace.js";
import { SandboxError } from "./types.js";

const MAX_IDENTIFIER = 160;
const MAX_SESSION_ID = 256;
const MAX_POLICY_ITEMS = 64;
const MAX_EVIDENCE_REFS = 32;
const MAX_AUDIT_RECORDS = 10_000;
const MAX_WALL_TIME_MS = 24 * 60 * 60_000;
const MAX_CPU_MILLIS = 24 * 60 * 60_000;
const MAX_MEMORY_BYTES = 512 * 1024 * 1024 * 1024;
const MAX_IO_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_PROCESSES = 4096;
const MAX_NETWORK_REQUESTS = 100_000;

export type ProductionIsolationClass = "container" | "microvm" | "vm";
export type ProductionSandboxCleanupReason =
  | "cancelled"
  | "completed"
  | "failed"
  | "expired"
  | "quota_exceeded";
export type ProductionSandboxExecutionOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";
export type ProductionSandboxAuditAction = "allocate" | "execute" | "cleanup";

export interface ProductionSandboxQuota {
  readonly cpuMillis: number;
  readonly memoryBytes: number;
  readonly maxProcesses: number;
  readonly wallTimeMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxFilesystemWriteBytes: number;
  readonly maxNetworkRequests: number;
}

export interface ProductionSandboxUsage {
  readonly cpuMillis: number;
  readonly memoryBytes: number;
  readonly processCount: number;
  readonly wallTimeMs: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly filesystemWriteBytes: number;
  readonly networkRequests: number;
}

export interface ProductionSandboxPolicy {
  readonly policyVersion: string;
  readonly isolation: ProductionIsolationClass;
  readonly expiresAt: string;
  readonly quota: ProductionSandboxQuota;
  readonly workspaceRoots: readonly string[];
  readonly networkResolutionHashes: readonly string[];
  readonly secretRefs: readonly string[];
}

export interface ProductionSandboxBackendDescriptor {
  readonly id: string;
  readonly isolation: ProductionIsolationClass;
  readonly policyVersion: string;
}

export interface ProductionIsolationAttestation {
  readonly backendId: string;
  readonly isolation: ProductionIsolationClass;
  readonly policyVersion: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly evidenceRefs: readonly string[];
  readonly attestationHash: string;
}

export interface ProductionIsolationVerifier {
  verify(input: Readonly<{
    backendId: string;
    isolation: ProductionIsolationClass;
    policyVersion: string;
    evaluatedAt: string;
  }>): Promise<ProductionIsolationAttestation> | ProductionIsolationAttestation;
}

export interface ProductionSecretBrokerRequest {
  readonly secretRef: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly expiresAt: string;
}

export interface ProductionSecretBroker {
  resolve(request: ProductionSecretBrokerRequest): Promise<string> | string;
}

export interface ProductionSandboxAdapterAllocateRequest {
  readonly idempotencyKey: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly isolation: ProductionIsolationClass;
  readonly policyVersion: string;
  readonly quota: ProductionSandboxQuota;
  readonly workspaceRoots: readonly string[];
  readonly networkResolutionHashes: readonly string[];
  readonly expiresAt: string;
  readonly signal: AbortSignal;
}

export interface ProductionSandboxAdapterAllocateResult {
  readonly sessionId: string;
  readonly expiresAt: string;
}

export interface ProductionSandboxAdapterExecuteRequest {
  readonly idempotencyKey: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly quota: ProductionSandboxQuota;
  readonly workspaceRoots: readonly string[];
  readonly networkResolutionHashes: readonly string[];
  readonly secrets: readonly Readonly<{ ref: string; value: string }>[];
  readonly signal: AbortSignal;
}

export interface ProductionSandboxAdapterExecuteResult {
  readonly outcome: ProductionSandboxExecutionOutcome;
  readonly usage: ProductionSandboxUsage;
  readonly resultRef?: string;
}

export interface ProductionSandboxAdapterCleanupRequest {
  readonly idempotencyKey: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly reason: ProductionSandboxCleanupReason;
  readonly signal: AbortSignal;
}

export interface ProductionSandboxAdapter {
  allocate(
    request: ProductionSandboxAdapterAllocateRequest,
  ): Promise<ProductionSandboxAdapterAllocateResult>;
  execute(
    request: ProductionSandboxAdapterExecuteRequest,
  ): Promise<ProductionSandboxAdapterExecuteResult>;
  cleanup(request: ProductionSandboxAdapterCleanupRequest): Promise<void>;
}

export interface ProductionSandboxBackendRegistration {
  readonly descriptor: ProductionSandboxBackendDescriptor;
  readonly adapter: ProductionSandboxAdapter;
}

export interface ProductionSandboxOpenRequest {
  readonly backendId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly policy: ProductionSandboxPolicy;
  readonly requestedAt: string;
  readonly signal: AbortSignal;
}

export interface ProductionSandboxSession {
  readonly allocationKey: string;
  readonly sessionId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly backendId: string;
  readonly isolation: ProductionIsolationClass;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly attestationHash: string;
  readonly quota: ProductionSandboxQuota;
  readonly workspaceRoots: readonly string[];
  readonly networkResolutionHashes: readonly string[];
  readonly secretRefHashes: readonly string[];
  readonly openedAt: string;
  readonly expiresAt: string;
  readonly sessionHash: string;
}

export interface ProductionSandboxExecuteRequest {
  readonly session: ProductionSandboxSession;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly signal: AbortSignal;
}

export interface ProductionSandboxCleanupRequest {
  readonly session: ProductionSandboxSession;
  readonly reason: ProductionSandboxCleanupReason;
  readonly requestedAt: string;
  readonly signal: AbortSignal;
}

export interface ProductionSandboxAuditRecord {
  readonly auditId: string;
  readonly action: ProductionSandboxAuditAction;
  readonly missionId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly backendId: string;
  readonly policyVersion: string;
  readonly isolation: ProductionIsolationClass;
  readonly occurredAt: string;
  readonly outcome: "ACCEPTED" | "REPLAYED";
  readonly reasonCode: string | null;
  readonly usageHash: string | null;
  readonly secretRefHashes: readonly string[];
}

interface RegisteredProductionBackend {
  readonly descriptor: ProductionSandboxBackendDescriptor;
  readonly adapter: ProductionSandboxAdapter;
}

interface AllocationRecord {
  readonly fingerprint: string;
  readonly session: ProductionSandboxSession;
}

interface InflightAllocation {
  readonly fingerprint: string;
  readonly promise: Promise<ProductionSandboxSession>;
}

interface InflightCleanup {
  readonly reason: ProductionSandboxCleanupReason;
  readonly promise: Promise<void>;
}

export class ProductionSandboxRuntime {
  readonly #backends = new Map<string, RegisteredProductionBackend>();
  readonly #verifier: ProductionIsolationVerifier;
  readonly #secretBroker: ProductionSecretBroker;
  readonly #allocations = new Map<string, AllocationRecord>();
  readonly #inflightAllocations = new Map<string, InflightAllocation>();
  readonly #released = new Map<string, ProductionSandboxCleanupReason>();
  readonly #inflightCleanup = new Map<string, InflightCleanup>();
  readonly #audit: ProductionSandboxAuditRecord[] = [];

  constructor(
    registrations: readonly ProductionSandboxBackendRegistration[],
    verifier: ProductionIsolationVerifier,
    secretBroker: ProductionSecretBroker,
  ) {
    if (!Array.isArray(registrations) || registrations.length === 0) {
      throw new SandboxError("BACKEND_INVALID", "At least one production sandbox backend is required.");
    }
    if (typeof verifier?.verify !== "function") {
      throw new SandboxError("BACKEND_INVALID", "Production isolation verifier is required.");
    }
    if (typeof secretBroker?.resolve !== "function") {
      throw new SandboxError("BACKEND_INVALID", "Production secret broker is required.");
    }
    this.#verifier = verifier;
    this.#secretBroker = secretBroker;

    for (const registration of registrations) {
      const descriptor = normalizeDescriptor(registration.descriptor);
      if (
        typeof registration.adapter?.allocate !== "function" ||
        typeof registration.adapter?.execute !== "function" ||
        typeof registration.adapter?.cleanup !== "function"
      ) {
        throw new SandboxError(
          "BACKEND_INVALID",
          "Production sandbox adapter must implement allocate, execute, and cleanup.",
        );
      }
      if (this.#backends.has(descriptor.id)) {
        throw new SandboxError("BACKEND_INVALID", `Duplicate production backend: ${descriptor.id}.`);
      }
      this.#backends.set(descriptor.id, Object.freeze({ descriptor, adapter: registration.adapter }));
    }
  }

  descriptors(): readonly ProductionSandboxBackendDescriptor[] {
    return Object.freeze(
      [...this.#backends.values()]
        .map(({ descriptor }) => descriptor)
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  auditRecords(): readonly ProductionSandboxAuditRecord[] {
    return Object.freeze(this.#audit.map((record) => Object.freeze({ ...record })));
  }

  async open(request: ProductionSandboxOpenRequest): Promise<ProductionSandboxSession> {
    assertNotAborted(request.signal, "Production sandbox allocation was cancelled.");
    const requestedAt = canonicalTimestamp(request.requestedAt, "requestedAt");
    const missionId = identifier(request.missionId, "missionId");
    const taskId = identifier(request.taskId, "taskId");
    const backendId = identifier(request.backendId, "backendId");
    const backend = this.#backends.get(backendId);
    if (backend === undefined) {
      throw new SandboxError("BACKEND_NOT_FOUND", "Production sandbox backend is unavailable.");
    }
    const policy = normalizePolicy(request.policy, requestedAt);
    if (
      policy.isolation !== backend.descriptor.isolation ||
      policy.policyVersion !== backend.descriptor.policyVersion
    ) {
      throw new SandboxError(
        "POLICY_INVALID",
        "Production policy cannot relabel backend isolation or policy version.",
      );
    }

    const policyHash = productionSandboxPolicyHash(policy);
    const allocationKey = sha256(
      canonicalPairs({ backendId, missionId, policyVersion: policy.policyVersion, taskId }),
    );
    const fingerprint = sha256(canonicalPairs({ allocationKey, policyHash }));
    const settled = this.#allocations.get(allocationKey);
    if (settled !== undefined) {
      assertReplayFingerprint(settled.fingerprint, fingerprint);
      if (this.#released.has(allocationKey)) {
        throw new SandboxError("SESSION_INVALID", "Released production sandbox cannot be reused.");
      }
      this.#auditEvent("allocate", settled.session, requestedAt, "REPLAYED", null, null);
      return settled.session;
    }
    const inflight = this.#inflightAllocations.get(allocationKey);
    if (inflight !== undefined) {
      assertReplayFingerprint(inflight.fingerprint, fingerprint);
      const replayed = await inflight.promise;
      assertNotAborted(request.signal, "Production sandbox allocation replay was cancelled.");
      this.#auditEvent("allocate", replayed, requestedAt, "REPLAYED", null, null);
      return replayed;
    }

    const promise = this.#createSession({
      allocationKey,
      backend,
      fingerprint,
      missionId,
      policy,
      policyHash,
      requestedAt,
      signal: request.signal,
      taskId,
    });
    this.#inflightAllocations.set(allocationKey, Object.freeze({ fingerprint, promise }));
    try {
      return await promise;
    } finally {
      this.#inflightAllocations.delete(allocationKey);
    }
  }

  async execute(request: ProductionSandboxExecuteRequest): Promise<ProductionSandboxAdapterExecuteResult> {
    assertNotAborted(request.signal, "Production sandbox execution was cancelled.");
    const requestedAt = canonicalTimestamp(request.requestedAt, "requestedAt");
    const commandId = identifier(request.commandId, "commandId");
    const idempotencyKey = identifier(request.idempotencyKey, "idempotencyKey", 256);
    const session = this.#requireSession(request.session, requestedAt);
    const backend = this.#backends.get(session.backendId);
    if (backend === undefined) {
      throw new SandboxError("BACKEND_NOT_FOUND", "Production sandbox backend is unavailable.");
    }

    const secrets: Array<Readonly<{ ref: string; value: string }>> = [];
    for (const secretRefHash of session.secretRefHashes) {
      const originalRef = this.#secretReferenceForHash(session, secretRefHash);
      let value: string;
      try {
        value = await this.#secretBroker.resolve(
          Object.freeze({
            expiresAt: session.expiresAt,
            missionId: session.missionId,
            secretRef: originalRef,
            sessionId: session.sessionId,
            taskId: session.taskId,
          }),
        );
      } catch {
        throw new SandboxError("SECRET_DENIED", "Production secret broker denied a scoped reference.");
      }
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.includes("\r") ||
        value.includes("\n")
      ) {
        throw new SandboxError("SECRET_DENIED", "Production secret broker returned invalid material.");
      }
      secrets.push(Object.freeze({ ref: originalRef, value }));
    }

    const result = await backend.adapter.execute(
      Object.freeze({
        commandId,
        idempotencyKey,
        missionId: session.missionId,
        networkResolutionHashes: session.networkResolutionHashes,
        quota: session.quota,
        secrets: Object.freeze(secrets),
        sessionId: session.sessionId,
        signal: request.signal,
        taskId: session.taskId,
        workspaceRoots: session.workspaceRoots,
      }),
    );
    assertNotAborted(request.signal, "Production sandbox execution was cancelled.");
    const normalized = normalizeExecutionResult(result);
    try {
      assertUsageWithinQuota(normalized.usage, session.quota);
    } catch (error) {
      await this.#cleanupAfterQuota(session);
      throw error;
    }
    this.#auditEvent(
      "execute",
      session,
      requestedAt,
      "ACCEPTED",
      normalized.outcome === "SUCCEEDED" ? null : normalized.outcome.toLowerCase(),
      normalized.usage,
    );
    return normalized;
  }

  async cleanup(request: ProductionSandboxCleanupRequest): Promise<"RELEASED" | "REPLAYED"> {
    assertNotAborted(request.signal, "Production sandbox cleanup was cancelled.");
    const requestedAt = canonicalTimestamp(request.requestedAt, "requestedAt");
    const reason = normalizeCleanupReason(request.reason);
    const session = this.#requireKnownSession(request.session);
    const existing = this.#released.get(session.allocationKey);
    if (existing !== undefined) {
      assertCleanupReason(existing, reason);
      this.#auditEvent("cleanup", session, requestedAt, "REPLAYED", reason, null);
      return "REPLAYED";
    }
    const inflight = this.#inflightCleanup.get(session.allocationKey);
    if (inflight !== undefined) {
      assertCleanupReason(inflight.reason, reason);
      await inflight.promise;
      assertNotAborted(request.signal, "Production sandbox cleanup replay was cancelled.");
      this.#auditEvent("cleanup", session, requestedAt, "REPLAYED", reason, null);
      return "REPLAYED";
    }
    const backend = this.#backends.get(session.backendId);
    if (backend === undefined) {
      throw new SandboxError("BACKEND_NOT_FOUND", "Production sandbox backend is unavailable.");
    }
    const promise = backend.adapter.cleanup(
      Object.freeze({
        idempotencyKey: `cleanup:${session.allocationKey}`,
        missionId: session.missionId,
        reason,
        sessionId: session.sessionId,
        signal: request.signal,
        taskId: session.taskId,
      }),
    );
    this.#inflightCleanup.set(session.allocationKey, Object.freeze({ promise, reason }));
    try {
      await promise;
      this.#released.set(session.allocationKey, reason);
      this.#auditEvent("cleanup", session, requestedAt, "ACCEPTED", reason, null);
      return "RELEASED";
    } finally {
      this.#inflightCleanup.delete(session.allocationKey);
    }
  }

  async #createSession(input: Readonly<{
    allocationKey: string;
    backend: RegisteredProductionBackend;
    fingerprint: string;
    missionId: string;
    taskId: string;
    policy: ProductionSandboxPolicy;
    policyHash: string;
    requestedAt: string;
    signal: AbortSignal;
  }>): Promise<ProductionSandboxSession> {
    const attestation = normalizeAttestation(
      await this.#verifier.verify(
        Object.freeze({
          backendId: input.backend.descriptor.id,
          evaluatedAt: input.requestedAt,
          isolation: input.backend.descriptor.isolation,
          policyVersion: input.backend.descriptor.policyVersion,
        }),
      ),
      input.backend.descriptor,
      input.requestedAt,
    );
    assertNotAborted(input.signal, "Production sandbox allocation was cancelled.");
    const adapterResult = normalizeAllocationResult(
      await input.backend.adapter.allocate(
        Object.freeze({
          expiresAt: input.policy.expiresAt,
          idempotencyKey: input.allocationKey,
          isolation: input.policy.isolation,
          missionId: input.missionId,
          networkResolutionHashes: input.policy.networkResolutionHashes,
          policyVersion: input.policy.policyVersion,
          quota: input.policy.quota,
          signal: input.signal,
          taskId: input.taskId,
          workspaceRoots: input.policy.workspaceRoots,
        }),
      ),
    );
    assertNotAborted(input.signal, "Production sandbox allocation was cancelled.");
    const expiresAt = earliestTimestamp(
      input.policy.expiresAt,
      attestation.expiresAt,
      adapterResult.expiresAt,
    );
    if (Date.parse(expiresAt) <= Date.parse(input.requestedAt)) {
      throw new SandboxError("SESSION_INVALID", "Production sandbox session is already expired.");
    }
    const secretRefHashes = Object.freeze(
      input.policy.secretRefs.map((reference) => sha256(reference)).sort(),
    );
    const sessionBase = {
      allocationKey: input.allocationKey,
      attestationHash: attestation.attestationHash,
      backendId: input.backend.descriptor.id,
      expiresAt,
      isolation: input.policy.isolation,
      missionId: input.missionId,
      networkResolutionHashes: input.policy.networkResolutionHashes,
      openedAt: input.requestedAt,
      policyHash: input.policyHash,
      policyVersion: input.policy.policyVersion,
      quota: input.policy.quota,
      secretRefHashes,
      sessionId: adapterResult.sessionId,
      taskId: input.taskId,
      workspaceRoots: input.policy.workspaceRoots,
    } as const;
    const session = Object.freeze({
      ...sessionBase,
      sessionHash: productionSandboxSessionHash(sessionBase),
    });
    this.#allocations.set(
      input.allocationKey,
      Object.freeze({ fingerprint: input.fingerprint, session }),
    );
    this.#rememberSecretReferences(session, input.policy.secretRefs);
    this.#auditEvent("allocate", session, input.requestedAt, "ACCEPTED", null, null);
    return session;
  }

  readonly #secretRefsBySession = new Map<string, ReadonlyMap<string, string>>();

  #rememberSecretReferences(session: ProductionSandboxSession, refs: readonly string[]): void {
    this.#secretRefsBySession.set(
      session.sessionHash,
      new Map(refs.map((reference) => [sha256(reference), reference])),
    );
  }

  #secretReferenceForHash(session: ProductionSandboxSession, hash: string): string {
    const reference = this.#secretRefsBySession.get(session.sessionHash)?.get(hash);
    if (reference === undefined) {
      throw new SandboxError("SECRET_DENIED", "Production secret reference binding is unavailable.");
    }
    return reference;
  }

  #requireKnownSession(value: ProductionSandboxSession): ProductionSandboxSession {
    const normalized = normalizeSession(value);
    const stored = this.#allocations.get(normalized.allocationKey)?.session;
    if (stored === undefined || stored.sessionHash !== normalized.sessionHash) {
      throw new SandboxError("SESSION_INVALID", "Production sandbox session is unknown or tampered.");
    }
    return stored;
  }

  #requireSession(value: ProductionSandboxSession, requestedAt: string): ProductionSandboxSession {
    const session = this.#requireKnownSession(value);
    if (this.#released.has(session.allocationKey)) {
      throw new SandboxError("SESSION_INVALID", "Released production sandbox cannot execute.");
    }
    if (Date.parse(session.expiresAt) <= Date.parse(requestedAt)) {
      throw new SandboxError("SESSION_INVALID", "Production sandbox session is expired.");
    }
    return session;
  }

  async #cleanupAfterQuota(session: ProductionSandboxSession): Promise<void> {
    if (this.#released.has(session.allocationKey)) return;
    const backend = this.#backends.get(session.backendId);
    if (backend === undefined) return;
    const controller = new AbortController();
    await backend.adapter.cleanup(
      Object.freeze({
        idempotencyKey: `cleanup:${session.allocationKey}`,
        missionId: session.missionId,
        reason: "quota_exceeded",
        sessionId: session.sessionId,
        signal: controller.signal,
        taskId: session.taskId,
      }),
    );
    this.#released.set(session.allocationKey, "quota_exceeded");
    this.#auditEvent("cleanup", session, new Date().toISOString(), "ACCEPTED", "quota_exceeded", null);
  }

  #auditEvent(
    action: ProductionSandboxAuditAction,
    session: ProductionSandboxSession,
    occurredAt: string,
    outcome: "ACCEPTED" | "REPLAYED",
    reasonCode: string | null,
    usage: ProductionSandboxUsage | null,
  ): void {
    if (this.#audit.length >= MAX_AUDIT_RECORDS) {
      throw new SandboxError("AUDIT_INVALID", "Production sandbox audit capacity is exhausted.");
    }
    const usageHash = usage === null ? null : sha256(JSON.stringify(usage));
    const recordBase = {
      action,
      backendId: session.backendId,
      isolation: session.isolation,
      missionId: session.missionId,
      occurredAt,
      outcome,
      policyVersion: session.policyVersion,
      reasonCode,
      secretRefHashes: session.secretRefHashes,
      sessionId: session.sessionId,
      taskId: session.taskId,
      usageHash,
    } as const;
    this.#audit.push(
      Object.freeze({
        ...recordBase,
        auditId: sha256(JSON.stringify(recordBase)),
      }),
    );
  }
}

export function productionIsolationAttestationHash(
  value: Omit<ProductionIsolationAttestation, "attestationHash">,
): string {
  return sha256(
    JSON.stringify({
      backendId: value.backendId,
      evidenceRefs: [...value.evidenceRefs],
      expiresAt: value.expiresAt,
      isolation: value.isolation,
      issuedAt: value.issuedAt,
      policyVersion: value.policyVersion,
    }),
  );
}

export function productionSandboxPolicyHash(value: ProductionSandboxPolicy): string {
  return sha256(
    JSON.stringify({
      expiresAt: value.expiresAt,
      isolation: value.isolation,
      networkResolutionHashes: [...value.networkResolutionHashes],
      policyVersion: value.policyVersion,
      quota: value.quota,
      secretRefs: [...value.secretRefs].map((reference) => sha256(reference)),
      workspaceRoots: [...value.workspaceRoots],
    }),
  );
}

export function productionSandboxSessionHash(
  value: Omit<ProductionSandboxSession, "sessionHash">,
): string {
  return sha256(JSON.stringify(value));
}

function normalizeDescriptor(
  value: ProductionSandboxBackendDescriptor,
): ProductionSandboxBackendDescriptor {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("BACKEND_INVALID", "Production backend descriptor is invalid.");
  }
  return Object.freeze({
    id: identifier(value.id, "backend id"),
    isolation: normalizeIsolation(value.isolation),
    policyVersion: identifier(value.policyVersion, "policyVersion"),
  });
}

function normalizePolicy(value: ProductionSandboxPolicy, evaluatedAt: string): ProductionSandboxPolicy {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("POLICY_INVALID", "Production sandbox policy is invalid.");
  }
  const expiresAt = canonicalTimestamp(value.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(evaluatedAt)) {
    throw new SandboxError("POLICY_INVALID", "Production sandbox policy is expired.");
  }
  const workspaceRoots = normalizeUniqueItems(
    value.workspaceRoots,
    "workspaceRoots",
    (item) => normalizeRelativePath(item),
  );
  const networkResolutionHashes = normalizeUniqueItems(
    value.networkResolutionHashes,
    "networkResolutionHashes",
    sha256Value,
  );
  const secretRefs = normalizeUniqueItems(value.secretRefs, "secretRefs", (item) =>
    identifier(item, "secretRef", 256),
  );
  return Object.freeze({
    expiresAt,
    isolation: normalizeIsolation(value.isolation),
    networkResolutionHashes,
    policyVersion: identifier(value.policyVersion, "policyVersion"),
    quota: normalizeQuota(value.quota),
    secretRefs,
    workspaceRoots,
  });
}

function normalizeQuota(value: ProductionSandboxQuota): ProductionSandboxQuota {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("POLICY_INVALID", "Production sandbox quota is invalid.");
  }
  return Object.freeze({
    cpuMillis: positiveInteger(value.cpuMillis, "cpuMillis", MAX_CPU_MILLIS),
    maxFilesystemWriteBytes: positiveInteger(
      value.maxFilesystemWriteBytes,
      "maxFilesystemWriteBytes",
      MAX_IO_BYTES,
    ),
    maxNetworkRequests: nonNegativeInteger(
      value.maxNetworkRequests,
      "maxNetworkRequests",
      MAX_NETWORK_REQUESTS,
    ),
    maxProcesses: positiveInteger(value.maxProcesses, "maxProcesses", MAX_PROCESSES),
    maxStderrBytes: positiveInteger(value.maxStderrBytes, "maxStderrBytes", MAX_IO_BYTES),
    maxStdoutBytes: positiveInteger(value.maxStdoutBytes, "maxStdoutBytes", MAX_IO_BYTES),
    memoryBytes: positiveInteger(value.memoryBytes, "memoryBytes", MAX_MEMORY_BYTES),
    wallTimeMs: positiveInteger(value.wallTimeMs, "wallTimeMs", MAX_WALL_TIME_MS),
  });
}

function normalizeAttestation(
  value: ProductionIsolationAttestation,
  descriptor: ProductionSandboxBackendDescriptor,
  evaluatedAt: string,
): ProductionIsolationAttestation {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("ATTESTATION_INVALID", "Production isolation attestation is invalid.");
  }
  const issuedAt = canonicalTimestamp(value.issuedAt, "issuedAt");
  const expiresAt = canonicalTimestamp(value.expiresAt, "expiresAt");
  if (Date.parse(issuedAt) > Date.parse(evaluatedAt) || Date.parse(expiresAt) <= Date.parse(evaluatedAt)) {
    throw new SandboxError("ATTESTATION_INVALID", "Production isolation attestation is stale or future.");
  }
  const evidenceRefs = normalizeUniqueItems(value.evidenceRefs, "evidenceRefs", (item) =>
    identifier(item, "evidenceRef", 256),
  );
  if (evidenceRefs.length === 0 || evidenceRefs.length > MAX_EVIDENCE_REFS) {
    throw new SandboxError("ATTESTATION_INVALID", "Production isolation evidence is incomplete.");
  }
  const normalized = {
    backendId: identifier(value.backendId, "backendId"),
    evidenceRefs,
    expiresAt,
    isolation: normalizeIsolation(value.isolation),
    issuedAt,
    policyVersion: identifier(value.policyVersion, "policyVersion"),
  } as const;
  if (
    normalized.backendId !== descriptor.id ||
    normalized.isolation !== descriptor.isolation ||
    normalized.policyVersion !== descriptor.policyVersion
  ) {
    throw new SandboxError("ATTESTATION_INVALID", "Isolation attestation does not match backend policy.");
  }
  if (value.attestationHash !== productionIsolationAttestationHash(normalized)) {
    throw new SandboxError("ATTESTATION_INVALID", "Isolation attestation hash is invalid.");
  }
  return Object.freeze({ ...normalized, attestationHash: value.attestationHash });
}

function normalizeAllocationResult(
  value: ProductionSandboxAdapterAllocateResult,
): ProductionSandboxAdapterAllocateResult {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox allocation result is invalid.");
  }
  return Object.freeze({
    expiresAt: canonicalTimestamp(value.expiresAt, "adapter expiresAt"),
    sessionId: identifier(value.sessionId, "sessionId", MAX_SESSION_ID),
  });
}

function normalizeExecutionResult(
  value: ProductionSandboxAdapterExecuteResult,
): ProductionSandboxAdapterExecuteResult {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox execution result is invalid.");
  }
  if (
    value.outcome !== "SUCCEEDED" &&
    value.outcome !== "FAILED" &&
    value.outcome !== "CANCELLED" &&
    value.outcome !== "TIMED_OUT"
  ) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox execution outcome is invalid.");
  }
  const resultRef =
    value.resultRef === undefined ? undefined : identifier(value.resultRef, "resultRef", 256);
  return Object.freeze({
    outcome: value.outcome,
    ...(resultRef === undefined ? {} : { resultRef }),
    usage: normalizeUsage(value.usage),
  });
}

function normalizeUsage(value: ProductionSandboxUsage): ProductionSandboxUsage {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox usage is invalid.");
  }
  return Object.freeze({
    cpuMillis: nonNegativeInteger(value.cpuMillis, "cpuMillis", MAX_CPU_MILLIS),
    filesystemWriteBytes: nonNegativeInteger(
      value.filesystemWriteBytes,
      "filesystemWriteBytes",
      MAX_IO_BYTES,
    ),
    memoryBytes: nonNegativeInteger(value.memoryBytes, "memoryBytes", MAX_MEMORY_BYTES),
    networkRequests: nonNegativeInteger(
      value.networkRequests,
      "networkRequests",
      MAX_NETWORK_REQUESTS,
    ),
    processCount: nonNegativeInteger(value.processCount, "processCount", MAX_PROCESSES),
    stderrBytes: nonNegativeInteger(value.stderrBytes, "stderrBytes", MAX_IO_BYTES),
    stdoutBytes: nonNegativeInteger(value.stdoutBytes, "stdoutBytes", MAX_IO_BYTES),
    wallTimeMs: nonNegativeInteger(value.wallTimeMs, "wallTimeMs", MAX_WALL_TIME_MS),
  });
}

function assertUsageWithinQuota(usage: ProductionSandboxUsage, quota: ProductionSandboxQuota): void {
  const exceeded = [
    usage.cpuMillis > quota.cpuMillis ? "cpuMillis" : null,
    usage.memoryBytes > quota.memoryBytes ? "memoryBytes" : null,
    usage.processCount > quota.maxProcesses ? "processCount" : null,
    usage.wallTimeMs > quota.wallTimeMs ? "wallTimeMs" : null,
    usage.stdoutBytes > quota.maxStdoutBytes ? "stdoutBytes" : null,
    usage.stderrBytes > quota.maxStderrBytes ? "stderrBytes" : null,
    usage.filesystemWriteBytes > quota.maxFilesystemWriteBytes ? "filesystemWriteBytes" : null,
    usage.networkRequests > quota.maxNetworkRequests ? "networkRequests" : null,
  ].filter((value): value is string => value !== null);
  if (exceeded.length > 0) {
    throw new SandboxError(
      "QUOTA_EXCEEDED",
      "Production sandbox reported resource usage outside its runtime-owned quota.",
      exceeded,
    );
  }
}

function normalizeSession(value: ProductionSandboxSession): ProductionSandboxSession {
  if (typeof value !== "object" || value === null) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox session is invalid.");
  }
  const base = {
    allocationKey: sha256Value(value.allocationKey),
    attestationHash: sha256Value(value.attestationHash),
    backendId: identifier(value.backendId, "backendId"),
    expiresAt: canonicalTimestamp(value.expiresAt, "expiresAt"),
    isolation: normalizeIsolation(value.isolation),
    missionId: identifier(value.missionId, "missionId"),
    networkResolutionHashes: normalizeUniqueItems(
      value.networkResolutionHashes,
      "networkResolutionHashes",
      sha256Value,
    ),
    openedAt: canonicalTimestamp(value.openedAt, "openedAt"),
    policyHash: sha256Value(value.policyHash),
    policyVersion: identifier(value.policyVersion, "policyVersion"),
    quota: normalizeQuota(value.quota),
    secretRefHashes: normalizeUniqueItems(value.secretRefHashes, "secretRefHashes", sha256Value),
    sessionId: identifier(value.sessionId, "sessionId", MAX_SESSION_ID),
    taskId: identifier(value.taskId, "taskId"),
    workspaceRoots: normalizeUniqueItems(
      value.workspaceRoots,
      "workspaceRoots",
      (item) => normalizeRelativePath(item),
    ),
  } as const;
  const sessionHash = sha256Value(value.sessionHash);
  if (sessionHash !== productionSandboxSessionHash(base)) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox session hash is invalid.");
  }
  return Object.freeze({ ...base, sessionHash });
}

function normalizeIsolation(value: string): ProductionIsolationClass {
  if (value !== "container" && value !== "microvm" && value !== "vm") {
    throw new SandboxError("POLICY_INVALID", "Production sandbox requires container/microvm/vm isolation.");
  }
  return value;
}

function normalizeCleanupReason(value: string): ProductionSandboxCleanupReason {
  if (
    value !== "cancelled" &&
    value !== "completed" &&
    value !== "failed" &&
    value !== "expired" &&
    value !== "quota_exceeded"
  ) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox cleanup reason is invalid.");
  }
  return value;
}

function assertCleanupReason(
  existing: ProductionSandboxCleanupReason,
  requested: ProductionSandboxCleanupReason,
): void {
  if (existing !== requested) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox cleanup replay conflicts with prior reason.");
  }
}

function assertReplayFingerprint(existing: string, requested: string): void {
  if (existing !== requested) {
    throw new SandboxError("SESSION_INVALID", "Production sandbox replay changed immutable policy input.");
  }
}

function normalizeUniqueItems(
  values: readonly string[],
  label: string,
  normalize: (value: string) => string,
): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_POLICY_ITEMS) {
    throw new SandboxError("POLICY_INVALID", `${label} exceeds its bound.`);
  }
  const normalized = values.map(normalize);
  if (new Set(normalized).size !== normalized.length) {
    throw new SandboxError("POLICY_INVALID", `${label} contains duplicates.`);
  }
  return Object.freeze([...normalized].sort());
}

function canonicalTimestamp(value: string, label: string): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new SandboxError("POLICY_INVALID", `${label} is invalid.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new SandboxError("POLICY_INVALID", `${label} must be canonical UTC.`);
  }
  return value;
}

function earliestTimestamp(...values: readonly string[]): string {
  return [...values].sort((left, right) => Date.parse(left) - Date.parse(right))[0] as string;
}

function identifier(value: string, label: string, max = MAX_IDENTIFIER): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.includes("\u0000") ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u.test(value)
  ) {
    throw new SandboxError("POLICY_INVALID", `${label} is invalid.`);
  }
  return value;
}

function sha256Value(value: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new SandboxError("POLICY_INVALID", "Expected a SHA-256 value.");
  }
  return value;
}

function positiveInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new SandboxError("POLICY_INVALID", `${label} must be a bounded positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new SandboxError("POLICY_INVALID", `${label} must be a bounded non-negative integer.`);
  }
  return value;
}

function assertNotAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) throw new SandboxError("CANCELLED", message);
}

function canonicalPairs(value: Readonly<Record<string, string>>): string {
  return Object.keys(value)
    .sort()
    .map((key) => `${key}:${JSON.stringify(value[key])}`)
    .join("\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
