import { createHash } from "node:crypto";
import type {
  ClientCommandRequest,
  ClientCommandResponse,
  ClientStateRequest,
  ClientStateResponse,
} from "../client/types.js";
import type {
  DurableJobStatus,
  JobClaimInput,
  JobHandler,
  JobHandlerResult,
  JobLease,
} from "../durable/types.js";
import { containsObviousSecret } from "../security/secret-text.js";

const MAX_IDENTIFIER = 160;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024 * 1024;
const MAX_CONTENT_TYPE = 160;
const MAX_LEASE_MS = 5 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/u;

export type HostedServiceErrorCode =
  | "AUTH_DENIED"
  | "SCOPE_DENIED"
  | "MALFORMED"
  | "RESYNC_REQUIRED"
  | "ARTIFACT_INVALID"
  | "RECOVERY_MISMATCH"
  | "WORKER_LEASE_INVALID"
  | "WORKER_FAILED";

export class HostedServiceError extends Error {
  readonly code: HostedServiceErrorCode;

  constructor(code: HostedServiceErrorCode, message: string) {
    super(message);
    this.name = "HostedServiceError";
    this.code = code;
  }
}

export interface HostedMissionScope {
  readonly projectId: string;
  readonly missionId: string;
}

export interface HostedIdentity {
  readonly subjectId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly missionScopes: readonly HostedMissionScope[];
  readonly expiresAt: string;
}

export interface HostedAuthenticationResolver {
  resolve(bearerToken: string, evaluatedAt: string): Promise<HostedIdentity | null>;
}

export interface HostedRequestContext {
  readonly bearerToken: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly sessionId: string;
  readonly requestedAt: string;
}

export interface HostedClientGateway {
  state(value: unknown): Promise<ClientStateResponse>;
  command(value: unknown): Promise<ClientCommandResponse>;
}

export interface HostedArtifactMetadata {
  readonly artifactId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly createdAt: string;
}

export interface HostedArtifactAdapter {
  metadata(artifactId: string): Promise<HostedArtifactMetadata | null>;
}

export interface HostedRealtimeContinuityRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly afterCursor: number;
}

export interface HostedRealtimeContinuity {
  readonly status: "CONTIGUOUS" | "RESYNC_REQUIRED";
  readonly observedCursor: number;
}

export interface HostedRealtimeAdapter {
  continuity(request: HostedRealtimeContinuityRequest): Promise<HostedRealtimeContinuity>;
}

export interface HostedBackupScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly missionId: string;
}

export interface HostedBackupSnapshot extends HostedBackupScope {
  readonly backupId: string;
  readonly createdAt: string;
  readonly sourceStateHash: string;
  readonly backupHash: string;
}

export interface HostedRestoreResult {
  readonly backupId: string;
  readonly restoredAt: string;
  readonly restoredStateHash: string;
  readonly backupHash: string;
}

export interface HostedBackupAdapter {
  create(scope: HostedBackupScope, createdAt: string): Promise<HostedBackupSnapshot>;
  restore(
    scope: HostedBackupScope,
    backupId: string,
    restoredAt: string,
  ): Promise<HostedRestoreResult>;
}

export interface HostedWorkerScope extends HostedBackupScope {
  readonly workerId: string;
  readonly now: string;
  readonly leaseMs: number;
}

export interface HostedQueueClaimInput extends HostedBackupScope, JobClaimInput {}

export interface HostedWorkerSettlement {
  readonly jobId: string;
  readonly missionId: string;
  readonly generation: number;
  readonly status: DurableJobStatus;
}

export interface HostedQueueAdapter {
  claim(input: HostedQueueClaimInput): Promise<JobLease | null>;
  settle(
    lease: JobLease,
    result: JobHandlerResult,
    settledAt: string,
  ): Promise<HostedWorkerSettlement>;
  abandon(lease: JobLease, reasonCode: string, abandonedAt: string): Promise<void>;
}

export type HostedAuditAction =
  | "auth.denied"
  | "mission.bootstrap"
  | "mission.reconnect"
  | "mission.command"
  | "artifact.read"
  | "worker.claim"
  | "worker.settle"
  | "backup.create"
  | "backup.restore";

export interface HostedAuditEvent {
  readonly auditId: string;
  readonly action: HostedAuditAction;
  readonly tenantId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly sessionId: string;
  readonly subjectHash: string;
  readonly occurredAt: string;
  readonly outcome: "ACCEPTED" | "DENIED";
  readonly reasonCode: string | null;
  readonly detailHash: string;
}

export interface HostedAuditAdapter {
  append(event: HostedAuditEvent): Promise<void>;
}

export interface HostedMissionBackendDependencies {
  readonly authentication: HostedAuthenticationResolver;
  readonly gateway: HostedClientGateway;
  readonly artifacts: HostedArtifactAdapter;
  readonly realtime: HostedRealtimeAdapter;
  readonly backups: HostedBackupAdapter;
  readonly queue: HostedQueueAdapter;
  readonly audit: HostedAuditAdapter;
}

export class HostedMissionBackend {
  readonly #authentication: HostedAuthenticationResolver;
  readonly #gateway: HostedClientGateway;
  readonly #artifacts: HostedArtifactAdapter;
  readonly #realtime: HostedRealtimeAdapter;
  readonly #backups: HostedBackupAdapter;
  readonly #queue: HostedQueueAdapter;
  readonly #audit: HostedAuditAdapter;

  constructor(dependencies: HostedMissionBackendDependencies) {
    requireFunction(dependencies.authentication?.resolve, "authentication.resolve");
    requireFunction(dependencies.gateway?.state, "gateway.state");
    requireFunction(dependencies.gateway?.command, "gateway.command");
    requireFunction(dependencies.artifacts?.metadata, "artifacts.metadata");
    requireFunction(dependencies.realtime?.continuity, "realtime.continuity");
    requireFunction(dependencies.backups?.create, "backups.create");
    requireFunction(dependencies.backups?.restore, "backups.restore");
    requireFunction(dependencies.queue?.claim, "queue.claim");
    requireFunction(dependencies.queue?.settle, "queue.settle");
    requireFunction(dependencies.queue?.abandon, "queue.abandon");
    requireFunction(dependencies.audit?.append, "audit.append");
    this.#authentication = dependencies.authentication;
    this.#gateway = dependencies.gateway;
    this.#artifacts = dependencies.artifacts;
    this.#realtime = dependencies.realtime;
    this.#backups = dependencies.backups;
    this.#queue = dependencies.queue;
    this.#audit = dependencies.audit;
  }

  async bootstrap(
    context: HostedRequestContext,
    request: ClientStateRequest,
  ): Promise<ClientStateResponse> {
    const authorized = await this.#authorize(context);
    this.#bindClientRequest(context, request.sessionId, request.missionId);
    const response = await this.#gateway.state(request);
    this.#assertStateResponse(context, response);
    await this.#auditEvent(
      "mission.bootstrap",
      authorized,
      context,
      "ACCEPTED",
      null,
      `cursor:${response.nextCursor}:version:${response.projection.version}`,
    );
    return response;
  }

  async reconnect(
    context: HostedRequestContext,
    request: ClientStateRequest,
  ): Promise<ClientStateResponse> {
    const authorized = await this.#authorize(context);
    this.#bindClientRequest(context, request.sessionId, request.missionId);
    const continuity = await this.#realtime.continuity({
      afterCursor: request.afterCursor,
      missionId: context.missionId,
      projectId: context.projectId,
      tenantId: context.tenantId,
    });
    if (
      continuity.status !== "CONTIGUOUS" ||
      !Number.isSafeInteger(continuity.observedCursor) ||
      continuity.observedCursor < request.afterCursor
    ) {
      await this.#auditEvent(
        "mission.reconnect",
        authorized,
        context,
        "DENIED",
        "resync_required",
        `cursor:${request.afterCursor}`,
      );
      throw new HostedServiceError(
        "RESYNC_REQUIRED",
        "Hosted reconnect continuity is unavailable; a fresh bootstrap is required.",
      );
    }
    const response = await this.#gateway.state(request);
    this.#assertStateResponse(context, response);
    await this.#auditEvent(
      "mission.reconnect",
      authorized,
      context,
      "ACCEPTED",
      null,
      `cursor:${response.nextCursor}:version:${response.projection.version}`,
    );
    return response;
  }

  async command(
    context: HostedRequestContext,
    request: ClientCommandRequest,
  ): Promise<ClientCommandResponse> {
    const authorized = await this.#authorize(context);
    this.#bindClientRequest(context, request.sessionId, request.missionId);
    const response = await this.#gateway.command(request);
    if (
      response.sessionId !== context.sessionId ||
      response.missionId !== context.missionId ||
      response.projection.missionId !== context.missionId
    ) {
      throw new HostedServiceError("SCOPE_DENIED", "Hosted command response crossed mission scope.");
    }
    await this.#auditEvent(
      "mission.command",
      authorized,
      context,
      "ACCEPTED",
      null,
      `${request.command}:${request.expectedVersion}:${request.idempotencyKey}:${response.outcome}`,
    );
    return response;
  }

  async artifact(
    context: HostedRequestContext,
    artifactIdInput: string,
  ): Promise<HostedArtifactMetadata> {
    const authorized = await this.#authorize(context);
    const artifactId = identifier(artifactIdInput, "artifactId", 256);
    const metadata = await this.#artifacts.metadata(artifactId);
    if (metadata === null) {
      await this.#auditEvent(
        "artifact.read",
        authorized,
        context,
        "DENIED",
        "artifact_unavailable",
        artifactId,
      );
      throw new HostedServiceError("SCOPE_DENIED", "Artifact is unavailable in the requested scope.");
    }
    const normalized = normalizeArtifact(metadata);
    if (
      normalized.tenantId !== context.tenantId ||
      normalized.projectId !== context.projectId ||
      normalized.missionId !== context.missionId ||
      normalized.artifactId !== artifactId
    ) {
      await this.#auditEvent(
        "artifact.read",
        authorized,
        context,
        "DENIED",
        "artifact_scope_mismatch",
        artifactId,
      );
      throw new HostedServiceError("SCOPE_DENIED", "Artifact is unavailable in the requested scope.");
    }
    await this.#auditEvent(
      "artifact.read",
      authorized,
      context,
      "ACCEPTED",
      null,
      `${normalized.artifactId}:${normalized.sha256}:${normalized.sizeBytes}`,
    );
    return normalized;
  }

  async createBackup(context: HostedRequestContext): Promise<HostedBackupSnapshot> {
    const authorized = await this.#authorize(context);
    const scope = backupScope(context);
    const snapshot = normalizeBackupSnapshot(
      await this.#backups.create(scope, canonicalTimestamp(context.requestedAt, "requestedAt")),
    );
    assertBackupScope(snapshot, scope);
    if (snapshot.backupHash !== hostedBackupHash(snapshot)) {
      throw new HostedServiceError("RECOVERY_MISMATCH", "Backup integrity evidence is invalid.");
    }
    await this.#auditEvent(
      "backup.create",
      authorized,
      context,
      "ACCEPTED",
      null,
      `${snapshot.backupId}:${snapshot.backupHash}:${snapshot.sourceStateHash}`,
    );
    return snapshot;
  }

  async restoreBackup(
    context: HostedRequestContext,
    expectedSnapshot: HostedBackupSnapshot,
  ): Promise<HostedRestoreResult> {
    const authorized = await this.#authorize(context);
    const scope = backupScope(context);
    const snapshot = normalizeBackupSnapshot(expectedSnapshot);
    assertBackupScope(snapshot, scope);
    if (snapshot.backupHash !== hostedBackupHash(snapshot)) {
      throw new HostedServiceError("RECOVERY_MISMATCH", "Expected backup integrity is invalid.");
    }
    const result = normalizeRestoreResult(
      await this.#backups.restore(
        scope,
        snapshot.backupId,
        canonicalTimestamp(context.requestedAt, "requestedAt"),
      ),
    );
    if (
      result.backupId !== snapshot.backupId ||
      result.backupHash !== snapshot.backupHash ||
      result.restoredStateHash !== snapshot.sourceStateHash
    ) {
      await this.#auditEvent(
        "backup.restore",
        authorized,
        context,
        "DENIED",
        "restore_mismatch",
        `${snapshot.backupId}:${result.backupHash}:${result.restoredStateHash}`,
      );
      throw new HostedServiceError(
        "RECOVERY_MISMATCH",
        "Restored state does not match exact backup evidence.",
      );
    }
    await this.#auditEvent(
      "backup.restore",
      authorized,
      context,
      "ACCEPTED",
      null,
      `${result.backupId}:${result.backupHash}:${result.restoredStateHash}`,
    );
    return result;
  }

  async runWorkerOnce(
    scopeInput: HostedWorkerScope,
    handler: JobHandler,
    signal: AbortSignal,
  ): Promise<HostedWorkerSettlement | null> {
    assertNotAborted(signal, "Hosted worker execution was cancelled.");
    const scope = normalizeWorkerScope(scopeInput);
    requireFunction(handler?.execute, "handler.execute");
    const lease = await this.#queue.claim({
      leaseMs: scope.leaseMs,
      missionId: scope.missionId,
      now: scope.now,
      projectId: scope.projectId,
      tenantId: scope.tenantId,
      workerId: scope.workerId,
    });
    if (lease === null) return null;
    try {
      validateLease(lease, scope);
    } catch (error) {
      await this.#queue.abandon(lease, "lease_invalid", scope.now);
      await this.#auditWorker(
        "worker.claim",
        scope,
        lease,
        "DENIED",
        "lease_invalid",
        `${lease.jobId}:${lease.generation}`,
      );
      throw error;
    }
    await this.#auditWorker(
      "worker.claim",
      scope,
      lease,
      "ACCEPTED",
      null,
      `${lease.jobId}:${lease.attempt}:${lease.generation}`,
    );

    let result: JobHandlerResult;
    try {
      result = await handler.execute(lease, signal);
      assertNotAborted(signal, "Hosted worker execution was cancelled.");
    } catch {
      await this.#queue.abandon(lease, "worker_crash", scope.now);
      await this.#auditWorker(
        "worker.settle",
        scope,
        lease,
        "DENIED",
        "worker_crash",
        `${lease.jobId}:${lease.generation}`,
      );
      throw new HostedServiceError("WORKER_FAILED", "Hosted worker failed before settlement.");
    }

    const settlement = await this.#queue.settle(lease, result, scope.now);
    if (
      settlement.jobId !== lease.jobId ||
      settlement.missionId !== lease.missionId ||
      settlement.generation !== lease.generation
    ) {
      await this.#auditWorker(
        "worker.settle",
        scope,
        lease,
        "DENIED",
        "stale_settlement",
        `${settlement.jobId}:${settlement.generation}`,
      );
      throw new HostedServiceError(
        "WORKER_LEASE_INVALID",
        "Hosted queue settlement is stale or crossed job scope.",
      );
    }
    await this.#auditWorker(
      "worker.settle",
      scope,
      lease,
      "ACCEPTED",
      null,
      `${settlement.jobId}:${settlement.generation}:${settlement.status}`,
    );
    return Object.freeze({ ...settlement });
  }

  async #authorize(contextInput: HostedRequestContext): Promise<HostedIdentity> {
    const context = normalizeContext(contextInput);
    let identity: HostedIdentity | null;
    try {
      identity = await this.#authentication.resolve(context.bearerToken, context.requestedAt);
    } catch {
      await this.#audit.append(
        auditRecord(
          "auth.denied",
          context,
          sha256("unresolved-subject"),
          "DENIED",
          "auth_dependency_failed",
          "resolver_failure",
        ),
      );
      throw new HostedServiceError("AUTH_DENIED", "Hosted authentication is unavailable.");
    }
    if (identity === null) {
      await this.#audit.append(
        auditRecord(
          "auth.denied",
          context,
          sha256("unknown-subject"),
          "DENIED",
          "auth_missing",
          "resolver_null",
        ),
      );
      throw new HostedServiceError("AUTH_DENIED", "Hosted authentication failed.");
    }
    const normalized = normalizeIdentity(identity);
    const scoped = normalized.missionScopes.some(
      (value) => value.projectId === context.projectId && value.missionId === context.missionId,
    );
    if (
      normalized.sessionId !== context.sessionId ||
      normalized.tenantId !== context.tenantId ||
      Date.parse(normalized.expiresAt) <= Date.parse(context.requestedAt) ||
      !scoped
    ) {
      await this.#audit.append(
        auditRecord(
          "auth.denied",
          context,
          sha256(normalized.subjectId),
          "DENIED",
          "scope_denied",
          `${normalized.sessionId}:${normalized.tenantId}`,
        ),
      );
      throw new HostedServiceError(
        "SCOPE_DENIED",
        "Hosted identity is expired, foreign, or outside mission scope.",
      );
    }
    return normalized;
  }

  #bindClientRequest(context: HostedRequestContext, sessionId: string, missionId: string): void {
    if (sessionId !== context.sessionId || missionId !== context.missionId) {
      throw new HostedServiceError("SCOPE_DENIED", "Client request crossed hosted session scope.");
    }
  }

  #assertStateResponse(context: HostedRequestContext, response: ClientStateResponse): void {
    if (
      response.sessionId !== context.sessionId ||
      response.missionId !== context.missionId ||
      response.projection.missionId !== context.missionId ||
      response.events.some((event) => event.missionId !== context.missionId)
    ) {
      throw new HostedServiceError("SCOPE_DENIED", "Hosted state response crossed mission scope.");
    }
  }

  async #auditEvent(
    action: HostedAuditAction,
    identity: HostedIdentity,
    context: HostedRequestContext,
    outcome: "ACCEPTED" | "DENIED",
    reasonCode: string | null,
    detail: string,
  ): Promise<void> {
    await this.#audit.append(
      auditRecord(action, context, sha256(identity.subjectId), outcome, reasonCode, detail),
    );
  }

  async #auditWorker(
    action: "worker.claim" | "worker.settle",
    scope: HostedWorkerScope,
    lease: JobLease,
    outcome: "ACCEPTED" | "DENIED",
    reasonCode: string | null,
    detail: string,
  ): Promise<void> {
    const context: HostedRequestContext = {
      bearerToken: "internal-worker-token-not-persisted",
      missionId: scope.missionId,
      projectId: scope.projectId,
      requestedAt: scope.now,
      sessionId: `worker:${scope.workerId}`,
      tenantId: scope.tenantId,
    };
    await this.#audit.append(
      auditRecord(action, context, sha256(scope.workerId), outcome, reasonCode, `${lease.jobId}:${detail}`),
    );
  }
}

export function hostedBackupHash(snapshot: Omit<HostedBackupSnapshot, "backupHash"> | HostedBackupSnapshot): string {
  return sha256(
    canonicalPairs({
      backupId: snapshot.backupId,
      createdAt: snapshot.createdAt,
      missionId: snapshot.missionId,
      projectId: snapshot.projectId,
      sourceStateHash: snapshot.sourceStateHash,
      tenantId: snapshot.tenantId,
    }),
  );
}

function backupScope(context: HostedRequestContext): HostedBackupScope {
  return Object.freeze({
    missionId: context.missionId,
    projectId: context.projectId,
    tenantId: context.tenantId,
  });
}

function normalizeContext(input: HostedRequestContext): HostedRequestContext {
  if (typeof input.bearerToken !== "string" || input.bearerToken.length < 1 || input.bearerToken.length > MAX_TOKEN_LENGTH) {
    throw new HostedServiceError("AUTH_DENIED", "Hosted bearer token is missing or malformed.");
  }
  return Object.freeze({
    bearerToken: input.bearerToken,
    missionId: identifier(input.missionId, "missionId"),
    projectId: identifier(input.projectId, "projectId"),
    requestedAt: canonicalTimestamp(input.requestedAt, "requestedAt"),
    sessionId: identifier(input.sessionId, "sessionId", 256),
    tenantId: identifier(input.tenantId, "tenantId"),
  });
}

function normalizeIdentity(input: HostedIdentity): HostedIdentity {
  const missionScopes = input.missionScopes.map((scope) =>
    Object.freeze({
      missionId: identifier(scope.missionId, "missionScope.missionId"),
      projectId: identifier(scope.projectId, "missionScope.projectId"),
    }),
  );
  if (missionScopes.length === 0 || missionScopes.length > 512) {
    throw new HostedServiceError("MALFORMED", "Hosted identity mission scope count is invalid.");
  }
  const seen = new Set<string>();
  for (const scope of missionScopes) {
    const key = `${scope.projectId}\u0000${scope.missionId}`;
    if (seen.has(key)) throw new HostedServiceError("MALFORMED", "Hosted identity contains duplicate mission scope.");
    seen.add(key);
  }
  return Object.freeze({
    expiresAt: canonicalTimestamp(input.expiresAt, "identity.expiresAt"),
    missionScopes: Object.freeze(missionScopes),
    sessionId: identifier(input.sessionId, "identity.sessionId", 256),
    subjectId: identifier(input.subjectId, "identity.subjectId", 256),
    tenantId: identifier(input.tenantId, "identity.tenantId"),
  });
}

function normalizeArtifact(input: HostedArtifactMetadata): HostedArtifactMetadata {
  const contentType = boundedString(input.contentType, "contentType", MAX_CONTENT_TYPE);
  if (containsObviousSecret(contentType)) {
    throw new HostedServiceError("ARTIFACT_INVALID", "Artifact content type contains forbidden material.");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0 || input.sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new HostedServiceError("ARTIFACT_INVALID", "Artifact size is outside hosted bounds.");
  }
  if (!SHA256.test(input.sha256)) {
    throw new HostedServiceError("ARTIFACT_INVALID", "Artifact hash must be lowercase SHA-256.");
  }
  return Object.freeze({
    artifactId: identifier(input.artifactId, "artifactId", 256),
    contentType,
    createdAt: canonicalTimestamp(input.createdAt, "artifact.createdAt"),
    missionId: identifier(input.missionId, "artifact.missionId"),
    projectId: identifier(input.projectId, "artifact.projectId"),
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    tenantId: identifier(input.tenantId, "artifact.tenantId"),
  });
}

function normalizeBackupSnapshot(input: HostedBackupSnapshot): HostedBackupSnapshot {
  if (!SHA256.test(input.sourceStateHash) || !SHA256.test(input.backupHash)) {
    throw new HostedServiceError("RECOVERY_MISMATCH", "Backup evidence hashes are invalid.");
  }
  return Object.freeze({
    backupHash: input.backupHash,
    backupId: identifier(input.backupId, "backupId", 256),
    createdAt: canonicalTimestamp(input.createdAt, "backup.createdAt"),
    missionId: identifier(input.missionId, "backup.missionId"),
    projectId: identifier(input.projectId, "backup.projectId"),
    sourceStateHash: input.sourceStateHash,
    tenantId: identifier(input.tenantId, "backup.tenantId"),
  });
}

function normalizeRestoreResult(input: HostedRestoreResult): HostedRestoreResult {
  if (!SHA256.test(input.restoredStateHash) || !SHA256.test(input.backupHash)) {
    throw new HostedServiceError("RECOVERY_MISMATCH", "Restore evidence hashes are invalid.");
  }
  return Object.freeze({
    backupHash: input.backupHash,
    backupId: identifier(input.backupId, "restore.backupId", 256),
    restoredAt: canonicalTimestamp(input.restoredAt, "restore.restoredAt"),
    restoredStateHash: input.restoredStateHash,
  });
}

function assertBackupScope(snapshot: HostedBackupSnapshot, scope: HostedBackupScope): void {
  if (
    snapshot.tenantId !== scope.tenantId ||
    snapshot.projectId !== scope.projectId ||
    snapshot.missionId !== scope.missionId
  ) {
    throw new HostedServiceError("SCOPE_DENIED", "Backup evidence crossed hosted mission scope.");
  }
}

function normalizeWorkerScope(input: HostedWorkerScope): HostedWorkerScope {
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > MAX_LEASE_MS) {
    throw new HostedServiceError("MALFORMED", "Hosted worker lease duration is invalid.");
  }
  return Object.freeze({
    leaseMs: input.leaseMs,
    missionId: identifier(input.missionId, "worker.missionId"),
    now: canonicalTimestamp(input.now, "worker.now"),
    projectId: identifier(input.projectId, "worker.projectId"),
    tenantId: identifier(input.tenantId, "worker.tenantId"),
    workerId: identifier(input.workerId, "worker.workerId", 256),
  });
}

function validateLease(lease: JobLease, scope: HostedWorkerScope): void {
  if (
    lease.missionId !== scope.missionId ||
    lease.workerId !== scope.workerId ||
    !Number.isSafeInteger(lease.generation) ||
    lease.generation < 1 ||
    !Number.isSafeInteger(lease.attempt) ||
    lease.attempt < 1 ||
    Date.parse(canonicalTimestamp(lease.expiresAt, "lease.expiresAt")) <= Date.parse(scope.now)
  ) {
    throw new HostedServiceError("WORKER_LEASE_INVALID", "Hosted queue returned a stale or foreign lease.");
  }
}

function auditRecord(
  action: HostedAuditAction,
  context: HostedRequestContext,
  subjectHash: string,
  outcome: "ACCEPTED" | "DENIED",
  reasonCode: string | null,
  detail: string,
): HostedAuditEvent {
  if (!SHA256.test(subjectHash)) throw new HostedServiceError("MALFORMED", "Audit subject hash is invalid.");
  const occurredAt = canonicalTimestamp(context.requestedAt, "audit.occurredAt");
  const detailHash = sha256(detail);
  return Object.freeze({
    action,
    auditId: sha256(canonicalPairs({ action, detailHash, missionId: context.missionId, occurredAt, outcome, projectId: context.projectId, sessionId: context.sessionId, tenantId: context.tenantId })),
    detailHash,
    missionId: context.missionId,
    occurredAt,
    outcome,
    projectId: context.projectId,
    reasonCode,
    sessionId: context.sessionId,
    subjectHash,
    tenantId: context.tenantId,
  });
}

function identifier(value: string, label: string, max = MAX_IDENTIFIER): string {
  return boundedString(value, label, max);
}

function boundedString(value: string, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new HostedServiceError("MALFORMED", `${label} is invalid.`);
  }
  return value;
}

function canonicalTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new HostedServiceError("MALFORMED", `${label} must be canonical UTC.`);
  }
  return value;
}

function canonicalPairs(values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key.length}:${key}=${String(value).length}:${String(value)}`)
    .join("|");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireFunction(value: unknown, label: string): void {
  if (typeof value !== "function") throw new HostedServiceError("MALFORMED", `${label} is required.`);
}

function assertNotAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) throw new HostedServiceError("WORKER_FAILED", message);
}
