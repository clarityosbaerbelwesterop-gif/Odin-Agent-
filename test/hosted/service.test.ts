import assert from "node:assert/strict";
import test from "node:test";
import type {
  ClientCommandRequest,
  ClientCommandResponse,
  ClientMissionProjection,
  ClientStateRequest,
  ClientStateResponse,
} from "../../src/client/index.js";
import type { JobHandlerResult, JobLease } from "../../src/durable/index.js";
import {
  type HostedArtifactMetadata,
  type HostedAuditEvent,
  type HostedBackupSnapshot,
  type HostedIdentity,
  HostedMissionBackend,
  type HostedMissionBackendDependencies,
  HostedServiceError,
  hostedBackupHash,
} from "../../src/hosted/index.js";

const NOW = "2026-09-06T08:00:00.000Z";
const FUTURE = "2026-09-06T09:00:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function projection(): ClientMissionProjection {
  return {
    budgetLimits: {
      attempts: 10,
      costMicros: 1_000,
      inputTokens: 10_000,
      outputTokens: 5_000,
      toolCalls: 20,
    },
    budgetUsage: {
      attempts: 1,
      costMicros: 100,
      inputTokens: 500,
      outputTokens: 100,
      toolCalls: 2,
    },
    checkpointVersion: 2,
    focus: "complex",
    jobs: {
      BLOCKED: 0,
      CANCELLED: 0,
      CANCELLING: 0,
      PENDING: 1,
      RETRY_WAIT: 0,
      RUNNING: 1,
      SUCCEEDED: 2,
    },
    missionId: "mission-1",
    objective: "Ship hosted mission backend",
    resumeState: null,
    state: "EXECUTING",
    tasks: [
      { dependsOn: [], id: "task-1", priority: 1, status: "RUNNING", title: "Hosted backend" },
    ],
    verification: { evidenceRefs: [], status: "PENDING" },
    version: 3,
  };
}

function stateRequest(afterCursor = 0): ClientStateRequest {
  return {
    afterCursor,
    capabilityId: "cap-1",
    limit: 20,
    missionId: "mission-1",
    protocol: { major: 1, minor: 0 },
    requestId: `state-${afterCursor}`,
    requestedAt: NOW,
    sessionId: "session-1",
  };
}

function stateResponse(afterCursor = 0): ClientStateResponse {
  return {
    emittedAt: NOW,
    events: [],
    fromCursor: afterCursor,
    hasMore: false,
    missionId: "mission-1",
    nextCursor: afterCursor,
    projection: projection(),
    protocol: { major: 1, minor: 0 },
    requestId: `state-${afterCursor}`,
    sessionId: "session-1",
  };
}

function commandRequest(): ClientCommandRequest {
  return {
    capabilityId: "cap-1",
    command: "mission.pause",
    expectedVersion: 3,
    idempotencyKey: "pause-1",
    issuedAt: NOW,
    missionId: "mission-1",
    protocol: { major: 1, minor: 0 },
    requestId: "command-1",
    sessionId: "session-1",
  };
}

function commandResponse(): ClientCommandResponse {
  return {
    command: "mission.pause",
    emittedAt: NOW,
    missionId: "mission-1",
    outcome: "APPLIED",
    projection: { ...projection(), state: "PAUSED", version: 5 },
    protocol: { major: 1, minor: 0 },
    requestId: "command-1",
    sessionId: "session-1",
  };
}

function identity(overrides: Partial<HostedIdentity> = {}): HostedIdentity {
  return {
    expiresAt: FUTURE,
    missionScopes: [{ missionId: "mission-1", projectId: "project-1" }],
    sessionId: "session-1",
    subjectId: "user-1",
    tenantId: "tenant-1",
    ...overrides,
  };
}

function context(overrides: Partial<ReturnType<typeof contextBase>> = {}) {
  return { ...contextBase(), ...overrides };
}

function contextBase() {
  return {
    bearerToken: "opaque-session-token",
    missionId: "mission-1",
    projectId: "project-1",
    requestedAt: NOW,
    sessionId: "session-1",
    tenantId: "tenant-1",
  };
}

class FixtureGateway {
  states = 0;
  commands: unknown[] = [];

  async state(value: unknown) {
    this.states += 1;
    const request = value as ClientStateRequest;
    return stateResponse(request.afterCursor);
  }

  async command(value: unknown) {
    this.commands.push(value);
    return commandResponse();
  }
}

class FixtureQueue {
  lease: JobLease | null = {
    attempt: 1,
    expiresAt: FUTURE,
    generation: 2,
    jobId: "job-1",
    missionId: "mission-1",
    payload: { artifactId: "payload-1", sha256: SHA_A },
    taskId: "task-1",
    token: "lease-token",
    workerId: "worker-1",
  };
  settled: JobHandlerResult[] = [];
  abandoned: string[] = [];
  settlementGeneration = 2;

  async claim() {
    return this.lease;
  }

  async settle(_lease: JobLease, result: JobHandlerResult) {
    this.settled.push(result);
    return {
      generation: this.settlementGeneration,
      jobId: "job-1",
      missionId: "mission-1",
      status: "SUCCEEDED" as const,
    };
  }

  async abandon(_lease: JobLease, reasonCode: string) {
    this.abandoned.push(reasonCode);
  }
}

class FixtureBackups {
  sourceStateHash = SHA_A;
  restoreStateHash = SHA_A;

  async create() {
    const base = {
      backupId: "backup-1",
      createdAt: NOW,
      missionId: "mission-1",
      projectId: "project-1",
      sourceStateHash: this.sourceStateHash,
      tenantId: "tenant-1",
    };
    return { ...base, backupHash: hostedBackupHash(base) };
  }

  async restore(_scope: unknown, backupId: string) {
    const snapshot = await this.create();
    return {
      backupHash: snapshot.backupHash,
      backupId,
      restoredAt: NOW,
      restoredStateHash: this.restoreStateHash,
    };
  }
}

function fixture() {
  const audits: HostedAuditEvent[] = [];
  const gateway = new FixtureGateway();
  const queue = new FixtureQueue();
  const backups = new FixtureBackups();
  const artifact: HostedArtifactMetadata = {
    artifactId: "artifact-1",
    contentType: "application/json",
    createdAt: NOW,
    missionId: "mission-1",
    projectId: "project-1",
    sha256: SHA_A,
    sizeBytes: 512,
    tenantId: "tenant-1",
  };
  const dependencies: HostedMissionBackendDependencies = {
    artifacts: { metadata: async () => artifact },
    audit: { append: async (event) => void audits.push(event) },
    authentication: { resolve: async () => identity() },
    backups,
    gateway,
    queue,
    realtime: {
      continuity: async ({ afterCursor }) => ({
        observedCursor: afterCursor,
        status: "CONTIGUOUS",
      }),
    },
  };
  return {
    artifact,
    audits,
    backups,
    dependencies,
    gateway,
    queue,
    service: new HostedMissionBackend(dependencies),
  };
}

test("hosted bootstrap authenticates exact tenant/project/mission scope and keeps bearer token out of audit", async () => {
  const value = fixture();
  const response = await value.service.bootstrap(context(), stateRequest());
  assert.equal(response.projection.missionId, "mission-1");
  assert.equal(value.gateway.states, 1);
  assert.equal(value.audits.at(-1)?.action, "mission.bootstrap");
  assert.doesNotMatch(JSON.stringify(value.audits), /opaque-session-token/u);
});

test("hosted identity denies foreign project/mission combinations before client gateway access", async () => {
  const value = fixture();
  const service = new HostedMissionBackend({
    ...value.dependencies,
    authentication: {
      resolve: async () =>
        identity({ missionScopes: [{ missionId: "mission-2", projectId: "project-1" }] }),
    },
  });
  await assert.rejects(
    service.bootstrap(context(), stateRequest()),
    (error: unknown) => error instanceof HostedServiceError && error.code === "SCOPE_DENIED",
  );
  assert.equal(value.gateway.states, 0);
  assert.equal(value.audits.at(-1)?.action, "auth.denied");
});

test("hosted reconnect fails closed on lifecycle continuity gaps", async () => {
  const value = fixture();
  const service = new HostedMissionBackend({
    ...value.dependencies,
    realtime: {
      continuity: async () => ({ observedCursor: 4, status: "RESYNC_REQUIRED" }),
    },
  });
  await assert.rejects(
    service.reconnect(context(), stateRequest(5)),
    (error: unknown) => error instanceof HostedServiceError && error.code === "RESYNC_REQUIRED",
  );
  assert.equal(value.gateway.states, 0);
});

test("hosted command preserves M9 expected-version and idempotency request unchanged", async () => {
  const value = fixture();
  const request = commandRequest();
  const response = await value.service.command(context(), request);
  assert.equal(response.outcome, "APPLIED");
  assert.deepEqual(value.gateway.commands, [request]);
  assert.equal(value.audits.at(-1)?.action, "mission.command");
});

test("hosted artifact lookup denies cross-tenant metadata without disclosing it", async () => {
  const value = fixture();
  const service = new HostedMissionBackend({
    ...value.dependencies,
    artifacts: { metadata: async () => ({ ...value.artifact, tenantId: "tenant-2" }) },
  });
  await assert.rejects(
    service.artifact(context(), "artifact-1"),
    (error: unknown) => error instanceof HostedServiceError && error.code === "SCOPE_DENIED",
  );
  assert.equal(value.audits.at(-1)?.reasonCode, "artifact_scope_mismatch");
});

test("hosted worker consumes exact M8-style lease and rejects stale settlement generation", async () => {
  const value = fixture();
  const scope = {
    leaseMs: 30_000,
    missionId: "mission-1",
    now: NOW,
    projectId: "project-1",
    tenantId: "tenant-1",
    workerId: "worker-1",
  };
  const settled = await value.service.runWorkerOnce(
    scope,
    {
      execute: async () => ({
        outcome: "SUCCEEDED",
        result: { artifactId: "result-1", sha256: SHA_B },
      }),
    },
    new AbortController().signal,
  );
  assert.equal(settled?.generation, 2);
  assert.equal(value.queue.settled.length, 1);

  value.queue.settlementGeneration = 1;
  await assert.rejects(
    value.service.runWorkerOnce(
      scope,
      {
        execute: async () => ({
          outcome: "SUCCEEDED",
          result: { artifactId: "result-2", sha256: SHA_B },
        }),
      },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof HostedServiceError && error.code === "WORKER_LEASE_INVALID",
  );
});

test("hosted worker rejects expired leases and records crash abandonment", async () => {
  const value = fixture();
  const scope = {
    leaseMs: 30_000,
    missionId: "mission-1",
    now: NOW,
    projectId: "project-1",
    tenantId: "tenant-1",
    workerId: "worker-1",
  };
  value.queue.lease = value.queue.lease === null ? null : { ...value.queue.lease, expiresAt: NOW };
  await assert.rejects(
    value.service.runWorkerOnce(
      scope,
      { execute: async () => ({ outcome: "CANCELLED" }) },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof HostedServiceError && error.code === "WORKER_LEASE_INVALID",
  );
  assert.deepEqual(value.queue.abandoned, ["lease_invalid"]);

  const crash = fixture();
  await assert.rejects(
    crash.service.runWorkerOnce(
      scope,
      {
        execute: async () => {
          throw new Error("worker crashed");
        },
      },
      new AbortController().signal,
    ),
    (error: unknown) => error instanceof HostedServiceError && error.code === "WORKER_FAILED",
  );
  assert.deepEqual(crash.queue.abandoned, ["worker_crash"]);
});

test("hosted backup and restore bind exact tenant mission and state hash", async () => {
  const value = fixture();
  const snapshot: HostedBackupSnapshot = await value.service.createBackup(context());
  assert.equal(snapshot.backupHash, hostedBackupHash(snapshot));
  const restored = await value.service.restoreBackup(context(), snapshot);
  assert.equal(restored.restoredStateHash, snapshot.sourceStateHash);

  value.backups.restoreStateHash = SHA_B;
  await assert.rejects(
    value.service.restoreBackup(context(), snapshot),
    (error: unknown) => error instanceof HostedServiceError && error.code === "RECOVERY_MISMATCH",
  );
  assert.equal(value.audits.at(-1)?.reasonCode, "restore_mismatch");
});

test("hosted dependency failures never fabricate successful public-service evidence", async () => {
  const value = fixture();
  const service = new HostedMissionBackend({
    ...value.dependencies,
    artifacts: {
      metadata: async () => {
        throw new Error("database unavailable");
      },
    },
  });
  await assert.rejects(service.artifact(context(), "artifact-1"), /database unavailable/u);
  assert.equal(
    value.audits.some((event) => event.action === "artifact.read" && event.outcome === "ACCEPTED"),
    false,
  );
});
