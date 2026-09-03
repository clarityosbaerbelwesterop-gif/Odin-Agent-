import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { EventAppendItem, EventStore, StoredEvent } from "../events/store.js";
import { EventStoreConflictError } from "../events/store.js";
import {
  createMissionCheckpoint,
  type MissionCheckpoint,
  restoreMissionCheckpoint,
} from "../mission/checkpoint.js";
import { type MissionEventData, projectMission } from "../mission/runtime.js";
import {
  asRow,
  assertArtifactReference,
  assertCanonicalTimestamp,
  assertIdentifier,
  assertReasonCode,
  assertSafeInteger,
  assertSha256,
  canonicalJson,
  hashText,
  mergeLimits,
  parseJson,
  rowInteger,
  rowNullableString,
  rowString,
  withImmediateTransaction,
} from "./internal.js";
import { missionEventCodec } from "./mission-codec.js";
import {
  type ArtifactReference,
  DEFAULT_DURABLE_LIMITS,
  type DurableCheckpointStore,
  type DurableJobRecord,
  type DurableJobStatus,
  DurableStoreConflictError,
  DurableStoreCorruptionError,
  type DurableStoreLimits,
  type JobClaimInput,
  type JobEnqueueInput,
  type JobHeartbeatResult,
  type JobLease,
  type JobLifecycleEvent,
  type JobLifecycleType,
  LeaseRejectedError,
} from "./types.js";

const SCHEMA_VERSION = 1;
const JOB_STATUSES = new Set<DurableJobStatus>([
  "PENDING",
  "RUNNING",
  "RETRY_WAIT",
  "CANCELLING",
  "CANCELLED",
  "SUCCEEDED",
  "BLOCKED",
]);
const JOB_EVENT_TYPES = new Set<JobLifecycleType>([
  "job.enqueued",
  "job.claimed",
  "job.reclaimed",
  "job.heartbeat",
  "job.retry_scheduled",
  "job.succeeded",
  "job.blocked",
  "job.cancelling",
  "job.cancelled",
]);
const REQUIRED_TABLES = [
  "event_idempotency",
  "job_events",
  "job_idempotency",
  "jobs",
  "mission_checkpoints",
  "mission_events",
] as const;

type SqlValue = string | number | null;

export interface SqliteDurableStoreOptions {
  readonly limits?: Partial<DurableStoreLimits>;
  readonly busyTimeoutMs?: number;
}

export class SqliteDurableStore implements EventStore<MissionEventData>, DurableCheckpointStore {
  readonly #database: DatabaseSync;
  readonly #limits: DurableStoreLimits;
  #closed = false;

  constructor(path: string, options: SqliteDurableStoreOptions = {}) {
    if (path.trim() === "" || path.includes("\u0000")) {
      throw new TypeError("SQLite path must be trusted non-empty runtime configuration.");
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    assertSafeInteger(busyTimeoutMs, "busyTimeoutMs", 1, 60_000);
    this.#limits = mergeLimits(DEFAULT_DURABLE_LIMITS, options.limits);
    this.#database = new DatabaseSync(path, { defensive: true, timeout: busyTimeoutMs });
    try {
      this.#database.exec("PRAGMA foreign_keys = ON");
      this.#database.exec("PRAGMA journal_mode = WAL");
      this.#database.exec("PRAGMA synchronous = FULL");
      this.#database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      this.#initializeSchema();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  async append(
    missionId: string,
    expectedVersion: number,
    idempotencyKey: string,
    items: readonly EventAppendItem<MissionEventData>[],
  ): Promise<readonly StoredEvent<MissionEventData>[]> {
    this.#assertOpen();
    assertIdentifier(missionId, "missionId");
    assertIdentifier(idempotencyKey, "idempotencyKey", 500);
    assertSafeInteger(expectedVersion, "expectedVersion");
    if (items.length === 0 || items.length > this.#limits.maxEventBatch) {
      throw new TypeError("Mission event batch size is outside the configured bound.");
    }

    const normalized = items.map((item) => {
      assertCanonicalTimestamp(item.occurredAt, "event occurredAt");
      const data = missionEventCodec.decode(structuredClone(item.data));
      const dataJson = canonicalJson(data, this.#limits.maxEventBytes);
      return {
        data,
        dataHash: hashText(dataJson),
        dataJson,
        occurredAt: item.occurredAt,
      };
    });
    const fingerprint = hashText(
      canonicalJson(
        {
          expectedVersion,
          items: normalized.map(({ dataHash, occurredAt }) => ({ dataHash, occurredAt })),
        },
        this.#limits.maxEventBytes,
      ),
    );

    return withImmediateTransaction(this.#database, () => {
      const replayRow = dbGet(
        this.#database,
        "SELECT fingerprint, first_sequence, event_count FROM event_idempotency WHERE mission_id = ? AND idempotency_key = ?",
        [missionId, idempotencyKey],
      );
      if (replayRow !== undefined) {
        const replay = asRow(replayRow, "event idempotency row");
        if (rowString(replay, "fingerprint") !== fingerprint) {
          throw new EventStoreConflictError(
            "Idempotency key was reused for a different durable event batch.",
          );
        }
        const first = rowInteger(replay, "first_sequence");
        const count = rowInteger(replay, "event_count");
        return this.#loadEventRange(missionId, first, count);
      }

      const currentVersion = this.#missionEventCount(missionId);
      if (currentVersion !== expectedVersion) {
        throw new EventStoreConflictError(
          `Optimistic version conflict: expected ${expectedVersion}, current ${currentVersion}.`,
        );
      }
      if (currentVersion + normalized.length > this.#limits.maxMissionEvents) {
        throw new DurableStoreConflictError("Mission event stream exceeds its configured bound.");
      }

      const appended: StoredEvent<MissionEventData>[] = [];
      for (const [index, item] of normalized.entries()) {
        const sequence = expectedVersion + index + 1;
        dbRun(
          this.#database,
          `INSERT INTO mission_events
            (mission_id, sequence, aggregate_version, idempotency_key, occurred_at, data_json, data_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            missionId,
            sequence,
            sequence,
            idempotencyKey,
            item.occurredAt,
            item.dataJson,
            item.dataHash,
          ],
        );
        appended.push({
          aggregateVersion: sequence,
          data: structuredClone(item.data),
          idempotencyKey,
          missionId,
          occurredAt: item.occurredAt,
          sequence,
        });
      }
      dbRun(
        this.#database,
        `INSERT INTO event_idempotency
          (mission_id, idempotency_key, fingerprint, first_sequence, event_count)
         VALUES (?, ?, ?, ?, ?)`,
        [missionId, idempotencyKey, fingerprint, expectedVersion + 1, normalized.length],
      );
      return structuredClone(appended);
    });
  }

  async load(missionId: string): Promise<readonly StoredEvent<MissionEventData>[]> {
    this.#assertOpen();
    assertIdentifier(missionId, "missionId");
    const rows = dbAll(
      this.#database,
      `SELECT mission_id, sequence, aggregate_version, idempotency_key, occurred_at, data_json, data_hash
       FROM mission_events WHERE mission_id = ? ORDER BY sequence ASC`,
      [missionId],
    );
    return this.#decodeEventRows(rows, missionId, 1);
  }

  async saveCheckpoint(checkpoint: MissionCheckpoint, savedAt: string): Promise<MissionCheckpoint> {
    this.#assertOpen();
    assertCanonicalTimestamp(savedAt, "checkpoint savedAt");
    const restored = restoreMissionCheckpoint(checkpoint, checkpoint.missionId);
    const canonical = createMissionCheckpoint(restored, checkpoint.eventSequence);
    if (canonical.snapshotHash !== checkpoint.snapshotHash) {
      throw new DurableStoreCorruptionError(
        "Checkpoint canonical hash does not match supplied hash.",
      );
    }
    const json = canonicalJson(checkpoint, this.#limits.maxCheckpointBytes);

    return withImmediateTransaction(this.#database, () => {
      const eventCount = this.#missionEventCount(checkpoint.missionId);
      if (eventCount < checkpoint.aggregateVersion) {
        throw new DurableStoreConflictError(
          "Checkpoint version is ahead of the canonical mission event stream.",
        );
      }
      this.#assertCheckpointMatchesEvents(checkpoint);
      const existingRow = dbGet(
        this.#database,
        "SELECT aggregate_version, snapshot_hash, checkpoint_json FROM mission_checkpoints WHERE mission_id = ?",
        [checkpoint.missionId],
      );
      if (existingRow !== undefined) {
        const existing = asRow(existingRow, "checkpoint row");
        const existingVersion = rowInteger(existing, "aggregate_version");
        if (existingVersion > checkpoint.aggregateVersion) {
          throw new DurableStoreConflictError("Checkpoint version regression is not allowed.");
        }
        if (existingVersion === checkpoint.aggregateVersion) {
          if (
            rowString(existing, "snapshot_hash") !== checkpoint.snapshotHash ||
            rowString(existing, "checkpoint_json") !== json
          ) {
            throw new DurableStoreConflictError(
              "Checkpoint version was reused for conflicting content.",
            );
          }
          return structuredClone(checkpoint);
        }
      }

      dbRun(
        this.#database,
        `INSERT INTO mission_checkpoints
          (mission_id, aggregate_version, event_sequence, snapshot_hash, checkpoint_json, saved_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(mission_id) DO UPDATE SET
           aggregate_version = excluded.aggregate_version,
           event_sequence = excluded.event_sequence,
           snapshot_hash = excluded.snapshot_hash,
           checkpoint_json = excluded.checkpoint_json,
           saved_at = excluded.saved_at`,
        [
          checkpoint.missionId,
          checkpoint.aggregateVersion,
          checkpoint.eventSequence,
          checkpoint.snapshotHash,
          json,
          savedAt,
        ],
      );
      return structuredClone(checkpoint);
    });
  }

  async loadCheckpoint(missionId: string): Promise<MissionCheckpoint | null> {
    this.#assertOpen();
    assertIdentifier(missionId, "missionId");
    const row = dbGet(
      this.#database,
      `SELECT mission_id, aggregate_version, event_sequence, snapshot_hash, checkpoint_json
       FROM mission_checkpoints WHERE mission_id = ?`,
      [missionId],
    );
    if (row === undefined) return null;
    const record = asRow(row, "checkpoint row");
    if (rowString(record, "mission_id") !== missionId) {
      throw new DurableStoreCorruptionError("Checkpoint row mission identity is corrupt.");
    }
    const parsed = decodeCheckpoint(
      parseJson(
        rowString(record, "checkpoint_json"),
        this.#limits.maxCheckpointBytes,
        "checkpoint JSON",
      ),
    );
    if (
      parsed.aggregateVersion !== rowInteger(record, "aggregate_version") ||
      parsed.eventSequence !== rowInteger(record, "event_sequence") ||
      parsed.snapshotHash !== rowString(record, "snapshot_hash")
    ) {
      throw new DurableStoreCorruptionError("Checkpoint columns disagree with checkpoint JSON.");
    }
    try {
      restoreMissionCheckpoint(parsed, missionId);
      this.#assertCheckpointMatchesEvents(parsed);
    } catch (error) {
      if (error instanceof DurableStoreCorruptionError) throw error;
      throw new DurableStoreCorruptionError("Checkpoint failed durable integrity validation.");
    }
    return structuredClone(parsed);
  }

  async enqueueJob(input: JobEnqueueInput): Promise<DurableJobRecord> {
    this.#assertOpen();
    validateEnqueueInput(input);
    const fingerprint = jobFingerprint(input);

    return withImmediateTransaction(this.#database, () => {
      const replayRow = dbGet(
        this.#database,
        `SELECT job_id, fingerprint FROM job_idempotency
         WHERE mission_id = ? AND idempotency_key = ?`,
        [input.missionId, input.idempotencyKey],
      );
      if (replayRow !== undefined) {
        const replay = asRow(replayRow, "job idempotency row");
        if (
          rowString(replay, "fingerprint") !== fingerprint ||
          rowString(replay, "job_id") !== input.jobId
        ) {
          throw new DurableStoreConflictError(
            "Job idempotency key was reused for different immutable input.",
          );
        }
        return this.#requireJob(input.jobId);
      }

      const existingRow = this.#jobRow(input.jobId);
      if (existingRow !== undefined) {
        const existing = asRow(existingRow, "existing job row");
        if (rowString(existing, "enqueue_fingerprint") !== fingerprint) {
          throw new DurableStoreConflictError("Job ID was reused for different immutable input.");
        }
        dbRun(
          this.#database,
          `INSERT INTO job_idempotency (mission_id, idempotency_key, job_id, fingerprint)
           VALUES (?, ?, ?, ?)`,
          [input.missionId, input.idempotencyKey, input.jobId, fingerprint],
        );
        return decodeJobRow(existing);
      }

      const count = scalarCount(this.#database, "SELECT COUNT(*) AS count FROM jobs");
      if (count >= this.#limits.maxJobs) {
        throw new DurableStoreConflictError("Durable job collection exceeds its configured bound.");
      }
      dbRun(
        this.#database,
        `INSERT INTO jobs (
          job_id, mission_id, task_id, priority, status, max_attempts, attempt_count,
          available_at, payload_artifact_id, payload_sha256, lease_generation,
          lease_worker_id, lease_token_hash, lease_expires_at,
          result_artifact_id, result_sha256, created_at, updated_at, enqueue_fingerprint
        ) VALUES (?, ?, ?, ?, 'PENDING', ?, 0, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        [
          input.jobId,
          input.missionId,
          input.taskId,
          input.priority,
          input.maxAttempts,
          input.availableAt,
          input.payload.artifactId,
          input.payload.sha256,
          input.createdAt,
          input.createdAt,
          fingerprint,
        ],
      );
      dbRun(
        this.#database,
        `INSERT INTO job_idempotency (mission_id, idempotency_key, job_id, fingerprint)
         VALUES (?, ?, ?, ?)`,
        [input.missionId, input.idempotencyKey, input.jobId, fingerprint],
      );
      this.#appendJobEvent({
        generation: 0,
        jobId: input.jobId,
        missionId: input.missionId,
        occurredAt: input.createdAt,
        reasonCode: null,
        status: "PENDING",
        type: "job.enqueued",
      });
      return this.#requireJob(input.jobId);
    });
  }

  async claimJob(input: JobClaimInput): Promise<JobLease | null> {
    this.#assertOpen();
    validateClaimInput(input, this.#limits);
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashText(token);
    const expiresAt = addMilliseconds(input.now, input.leaseMs);

    return withImmediateTransaction(this.#database, () => {
      this.#maintainExpiredJobs(input.now);
      const candidateRow = dbGet(
        this.#database,
        `SELECT * FROM jobs
         WHERE (
           (status IN ('PENDING', 'RETRY_WAIT') AND available_at <= ?)
           OR
           (status = 'RUNNING' AND lease_expires_at <= ? AND attempt_count < max_attempts)
         )
         ORDER BY available_at ASC, priority DESC, created_at ASC, job_id ASC
         LIMIT 1`,
        [input.now, input.now],
      );
      if (candidateRow === undefined) return null;
      const candidate = decodeJobRow(asRow(candidateRow, "claim candidate row"));
      const reclaimed = candidate.status === "RUNNING";
      const attempt = candidate.attemptCount + 1;
      const generation = candidate.leaseGeneration + 1;
      if (attempt > candidate.maxAttempts) {
        throw new DurableStoreCorruptionError("Claim candidate exceeded its attempt ceiling.");
      }
      dbRun(
        this.#database,
        `UPDATE jobs SET
          status = 'RUNNING', attempt_count = ?, lease_generation = ?, lease_worker_id = ?,
          lease_token_hash = ?, lease_expires_at = ?, updated_at = ?
         WHERE job_id = ?`,
        [attempt, generation, input.workerId, tokenHash, expiresAt, input.now, candidate.jobId],
      );
      this.#appendJobEvent({
        generation,
        jobId: candidate.jobId,
        missionId: candidate.missionId,
        occurredAt: input.now,
        reasonCode: reclaimed ? "lease_expired" : null,
        status: "RUNNING",
        type: reclaimed ? "job.reclaimed" : "job.claimed",
      });
      return Object.freeze({
        attempt,
        expiresAt,
        generation,
        jobId: candidate.jobId,
        missionId: candidate.missionId,
        payload: structuredClone(candidate.payload),
        taskId: candidate.taskId,
        token,
        workerId: input.workerId,
      });
    });
  }

  async heartbeatJob(lease: JobLease, now: string, leaseMs: number): Promise<JobHeartbeatResult> {
    this.#assertOpen();
    validateLeaseEnvelope(lease);
    assertCanonicalTimestamp(now, "heartbeat now");
    assertSafeInteger(leaseMs, "leaseMs", 1, this.#limits.maxLeaseMs);
    const expiresAt = addMilliseconds(now, leaseMs);

    return withImmediateTransaction(this.#database, () => {
      const job = this.#requireValidLease(lease, now, true);
      if (job.status === "CANCELLING") {
        return { expiresAt: job.leaseExpiresAt ?? lease.expiresAt, state: "CANCELLING" };
      }
      dbRun(
        this.#database,
        "UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE job_id = ?",
        [expiresAt, now, lease.jobId],
      );
      this.#appendJobEvent({
        generation: lease.generation,
        jobId: job.jobId,
        missionId: job.missionId,
        occurredAt: now,
        reasonCode: null,
        status: "RUNNING",
        type: "job.heartbeat",
      });
      return { expiresAt, state: "RUNNING" };
    });
  }

  async settleJobSuccess(
    lease: JobLease,
    result: ArtifactReference,
    now: string,
  ): Promise<DurableJobRecord> {
    this.#assertOpen();
    validateLeaseEnvelope(lease);
    assertArtifactReference(result, "result");
    assertCanonicalTimestamp(now, "settlement now");
    return withImmediateTransaction(this.#database, () => {
      const job = this.#requireValidLease(lease, now, true);
      if (job.status === "CANCELLING") return this.#cancelRunningJob(job, now, "cancellation_won");
      dbRun(
        this.#database,
        `UPDATE jobs SET status = 'SUCCEEDED', result_artifact_id = ?, result_sha256 = ?,
          lease_worker_id = NULL, lease_token_hash = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE job_id = ?`,
        [result.artifactId, result.sha256, now, job.jobId],
      );
      this.#appendJobEvent({
        generation: lease.generation,
        jobId: job.jobId,
        missionId: job.missionId,
        occurredAt: now,
        reasonCode: null,
        status: "SUCCEEDED",
        type: "job.succeeded",
      });
      return this.#requireJob(job.jobId);
    });
  }

  async settleJobRetry(
    lease: JobLease,
    reasonCode: string,
    retryAfterMs: number,
    now: string,
  ): Promise<DurableJobRecord> {
    this.#assertOpen();
    validateLeaseEnvelope(lease);
    assertReasonCode(reasonCode);
    assertSafeInteger(retryAfterMs, "retryAfterMs", 0, this.#limits.maxRetryDelayMs);
    assertCanonicalTimestamp(now, "settlement now");
    const availableAt = addMilliseconds(now, retryAfterMs);
    return withImmediateTransaction(this.#database, () => {
      const job = this.#requireValidLease(lease, now, true);
      if (job.status === "CANCELLING") return this.#cancelRunningJob(job, now, "cancellation_won");
      if (job.attemptCount >= job.maxAttempts) {
        return this.#blockRunningJob(job, now, "attempts_exhausted");
      }
      dbRun(
        this.#database,
        `UPDATE jobs SET status = 'RETRY_WAIT', available_at = ?, lease_worker_id = NULL,
          lease_token_hash = NULL, lease_expires_at = NULL, updated_at = ? WHERE job_id = ?`,
        [availableAt, now, job.jobId],
      );
      this.#appendJobEvent({
        generation: lease.generation,
        jobId: job.jobId,
        missionId: job.missionId,
        occurredAt: now,
        reasonCode,
        status: "RETRY_WAIT",
        type: "job.retry_scheduled",
      });
      return this.#requireJob(job.jobId);
    });
  }

  async settleJobBlocked(
    lease: JobLease,
    reasonCode: string,
    now: string,
  ): Promise<DurableJobRecord> {
    this.#assertOpen();
    validateLeaseEnvelope(lease);
    assertReasonCode(reasonCode);
    assertCanonicalTimestamp(now, "settlement now");
    return withImmediateTransaction(this.#database, () => {
      const job = this.#requireValidLease(lease, now, true);
      if (job.status === "CANCELLING") return this.#cancelRunningJob(job, now, "cancellation_won");
      return this.#blockRunningJob(job, now, reasonCode);
    });
  }

  async settleJobCancelled(lease: JobLease, now: string): Promise<DurableJobRecord> {
    this.#assertOpen();
    validateLeaseEnvelope(lease);
    assertCanonicalTimestamp(now, "settlement now");
    return withImmediateTransaction(this.#database, () => {
      const job = this.#requireValidLease(lease, now, true);
      return this.#cancelRunningJob(job, now, "worker_cancelled");
    });
  }

  async cancelJob(jobId: string, now: string): Promise<DurableJobRecord> {
    this.#assertOpen();
    assertIdentifier(jobId, "jobId");
    assertCanonicalTimestamp(now, "cancellation now");
    return withImmediateTransaction(this.#database, () => {
      const job = this.#requireJob(jobId);
      if (job.status === "PENDING" || job.status === "RETRY_WAIT") {
        dbRun(
          this.#database,
          "UPDATE jobs SET status = 'CANCELLED', updated_at = ? WHERE job_id = ?",
          [now, jobId],
        );
        this.#appendJobEvent({
          generation: job.leaseGeneration,
          jobId,
          missionId: job.missionId,
          occurredAt: now,
          reasonCode: "cancel_requested",
          status: "CANCELLED",
          type: "job.cancelled",
        });
        return this.#requireJob(jobId);
      }
      if (job.status === "RUNNING") {
        dbRun(
          this.#database,
          "UPDATE jobs SET status = 'CANCELLING', updated_at = ? WHERE job_id = ?",
          [now, jobId],
        );
        this.#appendJobEvent({
          generation: job.leaseGeneration,
          jobId,
          missionId: job.missionId,
          occurredAt: now,
          reasonCode: "cancel_requested",
          status: "CANCELLING",
          type: "job.cancelling",
        });
        return this.#requireJob(jobId);
      }
      return job;
    });
  }

  async getJob(jobId: string): Promise<DurableJobRecord | null> {
    this.#assertOpen();
    assertIdentifier(jobId, "jobId");
    const row = this.#jobRow(jobId);
    return row === undefined ? null : decodeJobRow(asRow(row, "job row"));
  }

  async readJobEvents(
    missionId: string,
    afterCursor: number,
    limit: number,
  ): Promise<readonly JobLifecycleEvent[]> {
    this.#assertOpen();
    assertIdentifier(missionId, "missionId");
    assertSafeInteger(afterCursor, "afterCursor");
    assertSafeInteger(limit, "limit", 1, this.#limits.maxJobEventPage);
    const rows = dbAll(
      this.#database,
      `SELECT cursor, mission_id, job_id, event_type, status, generation, occurred_at, reason_code, event_hash
       FROM job_events WHERE mission_id = ? AND cursor > ? ORDER BY cursor ASC LIMIT ?`,
      [missionId, afterCursor, limit],
    );
    return rows.map((row) => decodeJobEventRow(asRow(row, "job event row"), missionId));
  }

  async jobCounts(missionId: string): Promise<Readonly<Record<DurableJobStatus, number>>> {
    this.#assertOpen();
    assertIdentifier(missionId, "missionId");
    const counts: Record<DurableJobStatus, number> = {
      BLOCKED: 0,
      CANCELLED: 0,
      CANCELLING: 0,
      PENDING: 0,
      RETRY_WAIT: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
    };
    for (const raw of dbAll(
      this.#database,
      "SELECT status, COUNT(*) AS count FROM jobs WHERE mission_id = ? GROUP BY status",
      [missionId],
    )) {
      const row = asRow(raw, "job count row");
      const status = decodeJobStatus(rowString(row, "status"));
      counts[status] = rowInteger(row, "count");
    }
    return Object.freeze({ ...counts });
  }

  #initializeSchema(): void {
    const versionRow = dbGet(this.#database, "PRAGMA user_version", []);
    const version = rowInteger(asRow(versionRow, "SQLite user_version row"), "user_version");
    if (version > SCHEMA_VERSION) {
      throw new DurableStoreCorruptionError(
        `SQLite schema version ${version} is newer than supported version ${SCHEMA_VERSION}.`,
      );
    }
    if (version === 0) {
      withImmediateTransaction(this.#database, () => {
        this.#database.exec(`
          CREATE TABLE mission_events (
            mission_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            aggregate_version INTEGER NOT NULL,
            idempotency_key TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            data_json TEXT NOT NULL,
            data_hash TEXT NOT NULL,
            PRIMARY KEY (mission_id, sequence),
            CHECK (sequence > 0),
            CHECK (aggregate_version = sequence)
          ) STRICT;

          CREATE TABLE event_idempotency (
            mission_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            first_sequence INTEGER NOT NULL,
            event_count INTEGER NOT NULL,
            PRIMARY KEY (mission_id, idempotency_key),
            CHECK (first_sequence > 0),
            CHECK (event_count > 0)
          ) STRICT;

          CREATE TABLE mission_checkpoints (
            mission_id TEXT PRIMARY KEY,
            aggregate_version INTEGER NOT NULL,
            event_sequence INTEGER NOT NULL,
            snapshot_hash TEXT NOT NULL,
            checkpoint_json TEXT NOT NULL,
            saved_at TEXT NOT NULL,
            CHECK (aggregate_version > 0),
            CHECK (event_sequence = aggregate_version)
          ) STRICT;

          CREATE TABLE jobs (
            job_id TEXT PRIMARY KEY,
            mission_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            priority INTEGER NOT NULL,
            status TEXT NOT NULL,
            max_attempts INTEGER NOT NULL,
            attempt_count INTEGER NOT NULL,
            available_at TEXT NOT NULL,
            payload_artifact_id TEXT NOT NULL,
            payload_sha256 TEXT NOT NULL,
            lease_generation INTEGER NOT NULL,
            lease_worker_id TEXT,
            lease_token_hash TEXT,
            lease_expires_at TEXT,
            result_artifact_id TEXT,
            result_sha256 TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            enqueue_fingerprint TEXT NOT NULL,
            CHECK (priority >= 0 AND priority <= 100),
            CHECK (max_attempts > 0),
            CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
            CHECK (lease_generation >= 0),
            CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','CANCELLING','CANCELLED','SUCCEEDED','BLOCKED'))
          ) STRICT;

          CREATE INDEX jobs_ready_idx
            ON jobs(status, available_at, priority DESC, created_at, job_id);
          CREATE INDEX jobs_mission_idx ON jobs(mission_id, job_id);

          CREATE TABLE job_idempotency (
            mission_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            job_id TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            PRIMARY KEY (mission_id, idempotency_key),
            FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE RESTRICT
          ) STRICT;

          CREATE TABLE job_events (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id TEXT NOT NULL,
            job_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            status TEXT NOT NULL,
            generation INTEGER NOT NULL,
            occurred_at TEXT NOT NULL,
            reason_code TEXT,
            event_hash TEXT NOT NULL,
            FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE RESTRICT,
            CHECK (generation >= 0)
          ) STRICT;

          CREATE INDEX job_events_mission_cursor_idx ON job_events(mission_id, cursor);
        `);
        this.#database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    } else if (version !== SCHEMA_VERSION) {
      throw new DurableStoreCorruptionError(`Unsupported SQLite schema version ${version}.`);
    }
    this.#verifySchema();
  }

  #verifySchema(): void {
    const rows = dbAll(
      this.#database,
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    const names = new Set(rows.map((row) => rowString(asRow(row, "sqlite_master row"), "name")));
    for (const table of REQUIRED_TABLES) {
      if (!names.has(table)) {
        throw new DurableStoreCorruptionError(`SQLite schema is missing required table ${table}.`);
      }
    }
  }

  #missionEventCount(missionId: string): number {
    const row = dbGet(
      this.#database,
      "SELECT COUNT(*) AS count FROM mission_events WHERE mission_id = ?",
      [missionId],
    );
    return rowInteger(asRow(row, "mission event count row"), "count");
  }

  #loadEventRange(
    missionId: string,
    firstSequence: number,
    count: number,
  ): readonly StoredEvent<MissionEventData>[] {
    assertSafeInteger(firstSequence, "firstSequence", 1);
    assertSafeInteger(count, "event count", 1, this.#limits.maxEventBatch);
    const rows = dbAll(
      this.#database,
      `SELECT mission_id, sequence, aggregate_version, idempotency_key, occurred_at, data_json, data_hash
       FROM mission_events WHERE mission_id = ? AND sequence >= ? AND sequence < ? ORDER BY sequence ASC`,
      [missionId, firstSequence, firstSequence + count],
    );
    if (rows.length !== count) {
      throw new DurableStoreCorruptionError(
        "Idempotency record points to an incomplete event batch.",
      );
    }
    return this.#decodeEventRows(rows, missionId, firstSequence);
  }

  #decodeEventRows(
    rows: readonly unknown[],
    missionId: string,
    firstSequence: number,
  ): readonly StoredEvent<MissionEventData>[] {
    const events: StoredEvent<MissionEventData>[] = [];
    let expected = firstSequence;
    for (const raw of rows) {
      const row = asRow(raw, "mission event row");
      const rowMissionId = rowString(row, "mission_id");
      const sequence = rowInteger(row, "sequence");
      const aggregateVersion = rowInteger(row, "aggregate_version");
      const idempotencyKey = rowString(row, "idempotency_key");
      const occurredAt = rowString(row, "occurred_at");
      const dataJson = rowString(row, "data_json");
      const dataHash = rowString(row, "data_hash");
      if (rowMissionId !== missionId || sequence !== expected || aggregateVersion !== sequence) {
        throw new DurableStoreCorruptionError("Mission event identity or sequence is corrupt.");
      }
      assertIdentifier(idempotencyKey, "persisted idempotency key", 500);
      try {
        assertCanonicalTimestamp(occurredAt, "persisted event occurredAt");
        assertSha256(dataHash, "persisted event hash");
      } catch (error) {
        throw new DurableStoreCorruptionError(
          error instanceof Error ? error.message : "Persisted event metadata is corrupt.",
        );
      }
      if (hashText(dataJson) !== dataHash) {
        throw new DurableStoreCorruptionError("Persisted mission event hash mismatch.");
      }
      const data = missionEventCodec.decode(
        parseJson(dataJson, this.#limits.maxEventBytes, "mission event JSON"),
      );
      events.push({
        aggregateVersion,
        data,
        idempotencyKey,
        missionId,
        occurredAt,
        sequence,
      });
      expected += 1;
    }
    return Object.freeze(events.map((event) => Object.freeze(structuredClone(event))));
  }

  #assertCheckpointMatchesEvents(checkpoint: MissionCheckpoint): void {
    const rows = dbAll(
      this.#database,
      `SELECT mission_id, sequence, aggregate_version, idempotency_key, occurred_at, data_json, data_hash
       FROM mission_events WHERE mission_id = ? AND sequence <= ? ORDER BY sequence ASC`,
      [checkpoint.missionId, checkpoint.aggregateVersion],
    );
    if (rows.length !== checkpoint.aggregateVersion) {
      throw new DurableStoreCorruptionError(
        "Checkpoint cannot be reproduced from canonical events.",
      );
    }
    const events = this.#decodeEventRows(rows, checkpoint.missionId, 1);
    const projected = projectMission(events);
    const rebuilt = createMissionCheckpoint(projected, projected.version);
    if (
      rebuilt.snapshotHash !== checkpoint.snapshotHash ||
      canonicalJson(rebuilt.snapshot, this.#limits.maxCheckpointBytes) !==
        canonicalJson(checkpoint.snapshot, this.#limits.maxCheckpointBytes)
    ) {
      throw new DurableStoreCorruptionError(
        "Checkpoint snapshot disagrees with canonical mission events.",
      );
    }
  }

  #jobRow(jobId: string): unknown | undefined {
    return dbGet(this.#database, "SELECT * FROM jobs WHERE job_id = ?", [jobId]);
  }

  #requireJob(jobId: string): DurableJobRecord {
    const row = this.#jobRow(jobId);
    if (row === undefined) throw new DurableStoreConflictError(`Unknown durable job ${jobId}.`);
    return decodeJobRow(asRow(row, "job row"));
  }

  #requireValidLease(lease: JobLease, now: string, allowCancelling: boolean): DurableJobRecord {
    const row = this.#requireJob(lease.jobId);
    if (row.missionId !== lease.missionId || row.taskId !== lease.taskId) {
      throw new LeaseRejectedError("Lease scope does not match the durable job identity.");
    }
    if (row.leaseWorkerId !== lease.workerId || row.leaseGeneration !== lease.generation) {
      throw new LeaseRejectedError("Lease worker or fencing generation is stale.");
    }
    const raw = this.#jobRow(lease.jobId);
    if (raw === undefined)
      throw new LeaseRejectedError("Durable job disappeared during lease validation.");
    const rawRow = asRow(raw, "lease row");
    const storedTokenHash = rowNullableString(rawRow, "lease_token_hash");
    if (storedTokenHash === null || hashText(lease.token) !== storedTokenHash) {
      throw new LeaseRejectedError("Lease token is invalid or superseded.");
    }
    if (row.leaseExpiresAt === null || Date.parse(row.leaseExpiresAt) <= Date.parse(now)) {
      throw new LeaseRejectedError("Lease has expired.");
    }
    if (row.status !== "RUNNING" && !(allowCancelling && row.status === "CANCELLING")) {
      throw new LeaseRejectedError(`Job status ${row.status} cannot be settled by this lease.`);
    }
    return row;
  }

  #blockRunningJob(job: DurableJobRecord, now: string, reasonCode: string): DurableJobRecord {
    assertReasonCode(reasonCode);
    dbRun(
      this.#database,
      `UPDATE jobs SET status = 'BLOCKED', lease_worker_id = NULL, lease_token_hash = NULL,
        lease_expires_at = NULL, updated_at = ? WHERE job_id = ?`,
      [now, job.jobId],
    );
    this.#appendJobEvent({
      generation: job.leaseGeneration,
      jobId: job.jobId,
      missionId: job.missionId,
      occurredAt: now,
      reasonCode,
      status: "BLOCKED",
      type: "job.blocked",
    });
    return this.#requireJob(job.jobId);
  }

  #cancelRunningJob(job: DurableJobRecord, now: string, reasonCode: string): DurableJobRecord {
    assertReasonCode(reasonCode);
    dbRun(
      this.#database,
      `UPDATE jobs SET status = 'CANCELLED', lease_worker_id = NULL, lease_token_hash = NULL,
        lease_expires_at = NULL, updated_at = ? WHERE job_id = ?`,
      [now, job.jobId],
    );
    this.#appendJobEvent({
      generation: job.leaseGeneration,
      jobId: job.jobId,
      missionId: job.missionId,
      occurredAt: now,
      reasonCode,
      status: "CANCELLED",
      type: "job.cancelled",
    });
    return this.#requireJob(job.jobId);
  }

  #maintainExpiredJobs(now: string): void {
    const exhausted = dbAll(
      this.#database,
      `SELECT * FROM jobs WHERE status = 'RUNNING' AND lease_expires_at <= ? AND attempt_count >= max_attempts
       ORDER BY job_id ASC`,
      [now],
    );
    for (const raw of exhausted) {
      this.#blockRunningJob(
        decodeJobRow(asRow(raw, "expired exhausted job")),
        now,
        "attempts_exhausted",
      );
    }
    const cancelling = dbAll(
      this.#database,
      `SELECT * FROM jobs WHERE status = 'CANCELLING' AND lease_expires_at <= ? ORDER BY job_id ASC`,
      [now],
    );
    for (const raw of cancelling) {
      this.#cancelRunningJob(
        decodeJobRow(asRow(raw, "expired cancelling job")),
        now,
        "cancel_lease_expired",
      );
    }
  }

  #appendJobEvent(input: {
    readonly missionId: string;
    readonly jobId: string;
    readonly type: JobLifecycleType;
    readonly status: DurableJobStatus;
    readonly generation: number;
    readonly occurredAt: string;
    readonly reasonCode: string | null;
  }): void {
    const count = scalarCount(this.#database, "SELECT COUNT(*) AS count FROM job_events");
    if (count >= this.#limits.maxJobEvents) {
      throw new DurableStoreConflictError(
        "Job lifecycle event collection exceeds its configured bound.",
      );
    }
    const eventHash = hashText(canonicalJson(input, 8_192));
    dbRun(
      this.#database,
      `INSERT INTO job_events
        (mission_id, job_id, event_type, status, generation, occurred_at, reason_code, event_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.missionId,
        input.jobId,
        input.type,
        input.status,
        input.generation,
        input.occurredAt,
        input.reasonCode,
        eventHash,
      ],
    );
  }

  #assertOpen(): void {
    if (this.#closed) throw new DurableStoreConflictError("SQLite durable store is closed.");
  }
}

function validateEnqueueInput(input: JobEnqueueInput): void {
  assertIdentifier(input.idempotencyKey, "job idempotencyKey", 500);
  assertIdentifier(input.jobId, "jobId");
  assertIdentifier(input.missionId, "missionId");
  assertIdentifier(input.taskId, "taskId");
  assertSafeInteger(input.priority, "job priority", 0, 100);
  assertSafeInteger(input.maxAttempts, "job maxAttempts", 1, 100);
  assertCanonicalTimestamp(input.availableAt, "job availableAt");
  assertCanonicalTimestamp(input.createdAt, "job createdAt");
  if (Date.parse(input.availableAt) < Date.parse(input.createdAt)) {
    throw new TypeError("job availableAt cannot precede createdAt.");
  }
  assertArtifactReference(input.payload, "job payload");
}

function validateClaimInput(input: JobClaimInput, limits: DurableStoreLimits): void {
  assertIdentifier(input.workerId, "workerId");
  assertCanonicalTimestamp(input.now, "claim now");
  assertSafeInteger(input.leaseMs, "leaseMs", 1, limits.maxLeaseMs);
}

function validateLeaseEnvelope(lease: JobLease): void {
  assertIdentifier(lease.jobId, "lease.jobId");
  assertIdentifier(lease.missionId, "lease.missionId");
  assertIdentifier(lease.taskId, "lease.taskId");
  assertIdentifier(lease.workerId, "lease.workerId");
  assertIdentifier(lease.token, "lease.token", 500);
  assertSafeInteger(lease.attempt, "lease.attempt", 1);
  assertSafeInteger(lease.generation, "lease.generation", 1);
  assertCanonicalTimestamp(lease.expiresAt, "lease.expiresAt");
  assertArtifactReference(lease.payload, "lease.payload");
}

function jobFingerprint(input: JobEnqueueInput): string {
  return hashText(
    canonicalJson(
      {
        availableAt: input.availableAt,
        createdAt: input.createdAt,
        jobId: input.jobId,
        maxAttempts: input.maxAttempts,
        missionId: input.missionId,
        payload: input.payload,
        priority: input.priority,
        taskId: input.taskId,
      },
      32_000,
    ),
  );
}

function decodeJobRow(row: Record<string, unknown>): DurableJobRecord {
  const status = decodeJobStatus(rowString(row, "status"));
  const payload: ArtifactReference = {
    artifactId: rowString(row, "payload_artifact_id"),
    sha256: rowString(row, "payload_sha256"),
  };
  const resultArtifactId = rowNullableString(row, "result_artifact_id");
  const resultSha256 = rowNullableString(row, "result_sha256");
  if ((resultArtifactId === null) !== (resultSha256 === null)) {
    throw new DurableStoreCorruptionError("Durable job result artifact columns are inconsistent.");
  }
  try {
    assertIdentifier(rowString(row, "job_id"), "persisted jobId");
    assertIdentifier(rowString(row, "mission_id"), "persisted missionId");
    assertIdentifier(rowString(row, "task_id"), "persisted taskId");
    assertSafeInteger(rowInteger(row, "priority"), "persisted priority", 0, 100);
    assertSafeInteger(rowInteger(row, "max_attempts"), "persisted maxAttempts", 1, 100);
    assertSafeInteger(rowInteger(row, "attempt_count"), "persisted attemptCount", 0, 100);
    assertSafeInteger(rowInteger(row, "lease_generation"), "persisted leaseGeneration");
    assertCanonicalTimestamp(rowString(row, "available_at"), "persisted availableAt");
    assertCanonicalTimestamp(rowString(row, "created_at"), "persisted createdAt");
    assertCanonicalTimestamp(rowString(row, "updated_at"), "persisted updatedAt");
    assertArtifactReference(payload, "persisted payload");
    const leaseExpiresAt = rowNullableString(row, "lease_expires_at");
    if (leaseExpiresAt !== null) assertCanonicalTimestamp(leaseExpiresAt, "persisted lease expiry");
    const tokenHash = rowNullableString(row, "lease_token_hash");
    if (tokenHash !== null) assertSha256(tokenHash, "persisted lease token hash");
    if (resultArtifactId !== null && resultSha256 !== null) {
      assertArtifactReference(
        { artifactId: resultArtifactId, sha256: resultSha256 },
        "persisted result",
      );
    }
  } catch (error) {
    throw new DurableStoreCorruptionError(
      error instanceof Error ? error.message : "Durable job metadata is corrupt.",
    );
  }
  const leaseWorkerId = rowNullableString(row, "lease_worker_id");
  const leaseExpiresAt = rowNullableString(row, "lease_expires_at");
  if (status === "RUNNING" || status === "CANCELLING") {
    if (
      leaseWorkerId === null ||
      leaseExpiresAt === null ||
      rowNullableString(row, "lease_token_hash") === null
    ) {
      throw new DurableStoreCorruptionError("Running durable job is missing lease metadata.");
    }
  } else if (
    leaseWorkerId !== null ||
    leaseExpiresAt !== null ||
    rowNullableString(row, "lease_token_hash") !== null
  ) {
    throw new DurableStoreCorruptionError("Non-running durable job retains lease metadata.");
  }
  const maxAttempts = rowInteger(row, "max_attempts");
  const attemptCount = rowInteger(row, "attempt_count");
  if (attemptCount > maxAttempts) {
    throw new DurableStoreCorruptionError("Durable job attempt count exceeds its ceiling.");
  }
  return Object.freeze({
    attemptCount,
    availableAt: rowString(row, "available_at"),
    createdAt: rowString(row, "created_at"),
    jobId: rowString(row, "job_id"),
    leaseExpiresAt,
    leaseGeneration: rowInteger(row, "lease_generation"),
    leaseWorkerId,
    maxAttempts,
    missionId: rowString(row, "mission_id"),
    payload: Object.freeze(payload),
    priority: rowInteger(row, "priority"),
    result:
      resultArtifactId === null || resultSha256 === null
        ? null
        : Object.freeze({ artifactId: resultArtifactId, sha256: resultSha256 }),
    status,
    taskId: rowString(row, "task_id"),
    updatedAt: rowString(row, "updated_at"),
  });
}

function decodeJobStatus(value: string): DurableJobStatus {
  const status = value as DurableJobStatus;
  if (!JOB_STATUSES.has(status)) {
    throw new DurableStoreCorruptionError(`Unsupported durable job status ${value}.`);
  }
  return status;
}

function decodeJobEventRow(
  row: Record<string, unknown>,
  expectedMissionId: string,
): JobLifecycleEvent {
  const missionId = rowString(row, "mission_id");
  const type = rowString(row, "event_type") as JobLifecycleType;
  const status = decodeJobStatus(rowString(row, "status"));
  const generation = rowInteger(row, "generation");
  const occurredAt = rowString(row, "occurred_at");
  const reasonCode = rowNullableString(row, "reason_code");
  const eventHash = rowString(row, "event_hash");
  const jobId = rowString(row, "job_id");
  if (missionId !== expectedMissionId) {
    throw new DurableStoreCorruptionError("Job event leaked across mission scope.");
  }
  if (!JOB_EVENT_TYPES.has(type)) {
    throw new DurableStoreCorruptionError(`Unsupported job lifecycle event type ${type}.`);
  }
  try {
    assertIdentifier(jobId, "persisted event jobId");
    assertSafeInteger(generation, "persisted event generation");
    assertCanonicalTimestamp(occurredAt, "persisted event occurredAt");
    assertSha256(eventHash, "persisted event hash");
    if (reasonCode !== null) assertReasonCode(reasonCode);
  } catch (error) {
    throw new DurableStoreCorruptionError(
      error instanceof Error ? error.message : "Job lifecycle event metadata is corrupt.",
    );
  }
  const expectedHash = hashText(
    canonicalJson({ generation, jobId, missionId, occurredAt, reasonCode, status, type }, 8_192),
  );
  if (expectedHash !== eventHash) {
    throw new DurableStoreCorruptionError("Job lifecycle event hash mismatch.");
  }
  return Object.freeze({
    cursor: rowInteger(row, "cursor"),
    eventHash,
    generation,
    jobId,
    missionId,
    occurredAt,
    reasonCode,
    status,
    type,
  });
}

function decodeCheckpoint(value: unknown): MissionCheckpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DurableStoreCorruptionError("Checkpoint JSON root must be an object.");
  }
  const object = value as Record<string, unknown>;
  const keys = [
    "aggregateVersion",
    "eventSequence",
    "missionId",
    "schemaVersion",
    "snapshot",
    "snapshotHash",
  ];
  if (Object.keys(object).length !== keys.length || keys.some((key) => !(key in object))) {
    throw new DurableStoreCorruptionError("Checkpoint JSON fields are incomplete or unexpected.");
  }
  if (object.schemaVersion !== 1) {
    throw new DurableStoreCorruptionError("Checkpoint JSON schema version is unsupported.");
  }
  if (typeof object.missionId !== "string" || typeof object.snapshotHash !== "string") {
    throw new DurableStoreCorruptionError("Checkpoint identity/hash fields are malformed.");
  }
  if (
    typeof object.aggregateVersion !== "number" ||
    !Number.isSafeInteger(object.aggregateVersion) ||
    typeof object.eventSequence !== "number" ||
    !Number.isSafeInteger(object.eventSequence) ||
    typeof object.snapshot !== "object" ||
    object.snapshot === null ||
    Array.isArray(object.snapshot)
  ) {
    throw new DurableStoreCorruptionError("Checkpoint version or snapshot fields are malformed.");
  }
  return structuredClone(value) as MissionCheckpoint;
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const value = Date.parse(timestamp) + milliseconds;
  if (!Number.isSafeInteger(value))
    throw new TypeError("Timestamp arithmetic exceeded safe bounds.");
  return new Date(value).toISOString();
}

function scalarCount(
  database: DatabaseSync,
  sql: string,
  parameters: readonly SqlValue[] = [],
): number {
  const row = dbGet(database, sql, parameters);
  return rowInteger(asRow(row, "SQLite count row"), "count");
}

function dbRun(database: DatabaseSync, sql: string, parameters: readonly SqlValue[]): void {
  database.prepare(sql).run(...parameters);
}

function dbGet(
  database: DatabaseSync,
  sql: string,
  parameters: readonly SqlValue[],
): unknown | undefined {
  return database.prepare(sql).get(...parameters);
}

function dbAll(database: DatabaseSync, sql: string, parameters: readonly SqlValue[]): unknown[] {
  return database.prepare(sql).all(...parameters) as unknown[];
}
