import type { DatabaseSync } from "node:sqlite";
import {
  type MissionCheckpoint,
  restoreMissionCheckpoint,
} from "../mission/checkpoint.js";
import {
  assertCanonicalUtc,
  assertIdentifier,
  canonicalJson,
  MAX_CHECKPOINT_JSON_BYTES,
  openOdinSqlite,
  parseBoundedJson,
  PersistenceCorruptionError,
  withImmediateTransaction,
} from "./sqlite.js";

export class CheckpointConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointConflictError";
  }
}

export class SQLiteMissionCheckpointStore {
  readonly #database: DatabaseSync;
  readonly #clock: () => string;

  constructor(path: string, clock: () => string = () => new Date().toISOString()) {
    this.#database = openOdinSqlite(path);
    this.#clock = clock;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS mission_checkpoints (
        mission_id TEXT PRIMARY KEY,
        aggregate_version INTEGER NOT NULL,
        event_sequence INTEGER NOT NULL,
        snapshot_hash TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL,
        saved_at TEXT NOT NULL
      ) STRICT
    `);
  }

  close(): void {
    this.#database.close();
  }

  async save(checkpoint: MissionCheckpoint): Promise<void> {
    const normalized = validateCheckpoint(checkpoint, checkpoint.missionId);
    const checkpointJson = canonicalJson(
      normalized,
      MAX_CHECKPOINT_JSON_BYTES,
      "mission checkpoint",
    );
    const savedAt = this.#clock();
    assertCanonicalUtc(savedAt, "checkpoint savedAt");

    withImmediateTransaction(this.#database, () => {
      const current = this.#database
        .prepare(
          `SELECT aggregate_version, checkpoint_json
           FROM mission_checkpoints WHERE mission_id = ?`,
        )
        .get(normalized.missionId) as Record<string, unknown> | undefined;
      if (current !== undefined) {
        const currentVersion = readNonNegativeInteger(
          current.aggregate_version,
          "checkpoint aggregate version",
        );
        const currentJson = readString(current.checkpoint_json, "checkpoint JSON");
        if (currentVersion > normalized.aggregateVersion) {
          throw new CheckpointConflictError("Checkpoint version regression is not allowed.");
        }
        if (currentVersion === normalized.aggregateVersion) {
          if (currentJson !== checkpointJson) {
            throw new CheckpointConflictError(
              "Checkpoint version was reused with different content.",
            );
          }
          return;
        }
      }

      this.#database
        .prepare(
          `INSERT INTO mission_checkpoints(
             mission_id, aggregate_version, event_sequence, snapshot_hash, checkpoint_json, saved_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(mission_id) DO UPDATE SET
             aggregate_version = excluded.aggregate_version,
             event_sequence = excluded.event_sequence,
             snapshot_hash = excluded.snapshot_hash,
             checkpoint_json = excluded.checkpoint_json,
             saved_at = excluded.saved_at`,
        )
        .run(
          normalized.missionId,
          normalized.aggregateVersion,
          normalized.eventSequence,
          normalized.snapshotHash,
          checkpointJson,
          savedAt,
        );
    });
  }

  async load(missionId: string): Promise<MissionCheckpoint | null> {
    assertIdentifier(missionId, "missionId");
    const row = this.#database
      .prepare(
        `SELECT mission_id, aggregate_version, event_sequence, snapshot_hash, checkpoint_json, saved_at
         FROM mission_checkpoints WHERE mission_id = ?`,
      )
      .get(missionId) as Record<string, unknown> | undefined;
    if (row === undefined) return null;

    const persistedMissionId = readString(row.mission_id, "checkpoint mission id");
    const aggregateVersion = readNonNegativeInteger(
      row.aggregate_version,
      "checkpoint aggregate version",
    );
    const eventSequence = readNonNegativeInteger(row.event_sequence, "checkpoint event sequence");
    const snapshotHash = readString(row.snapshot_hash, "checkpoint snapshot hash");
    const checkpointJson = readString(row.checkpoint_json, "checkpoint JSON");
    const savedAt = readString(row.saved_at, "checkpoint savedAt");
    assertIdentifier(persistedMissionId, "persisted checkpoint mission id");
    assertCanonicalUtc(savedAt, "persisted checkpoint savedAt");
    if (persistedMissionId !== missionId) {
      throw new PersistenceCorruptionError("Checkpoint row identity is inconsistent.");
    }

    const decoded = validateCheckpoint(
      parseBoundedJson(checkpointJson, MAX_CHECKPOINT_JSON_BYTES, "mission checkpoint"),
      missionId,
    );
    if (
      decoded.aggregateVersion !== aggregateVersion ||
      decoded.eventSequence !== eventSequence ||
      decoded.snapshotHash !== snapshotHash
    ) {
      throw new PersistenceCorruptionError("Checkpoint row metadata does not match its payload.");
    }
    return decoded;
  }
}

function validateCheckpoint(value: unknown, expectedMissionId: string): MissionCheckpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PersistenceCorruptionError("Persisted mission checkpoint is malformed.");
  }
  const checkpoint = value as MissionCheckpoint;
  try {
    restoreMissionCheckpoint(checkpoint, expectedMissionId);
  } catch {
    throw new PersistenceCorruptionError("Persisted mission checkpoint failed integrity validation.");
  }
  return structuredClone(checkpoint);
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new PersistenceCorruptionError(`${name} is malformed.`);
  return value;
}

function readNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PersistenceCorruptionError(`${name} is malformed.`);
  }
  return value;
}
