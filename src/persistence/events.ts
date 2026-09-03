import type { DatabaseSync } from "node:sqlite";
import {
  EventStoreConflictError,
  type EventAppendItem,
  type EventStore,
  type StoredEvent,
} from "../events/store.js";
import {
  assertCanonicalUtc,
  assertIdentifier,
  canonicalJson,
  MAX_EVENT_JSON_BYTES,
  openOdinSqlite,
  parseBoundedJson,
  PersistenceCorruptionError,
  sha256,
  withImmediateTransaction,
} from "./sqlite.js";

const MAX_EVENT_BATCH_SIZE = 64;

export interface PersistenceCodec<T> {
  encode(value: T): unknown;
  decode(value: unknown): T;
}

interface RawEventRow {
  readonly missionId: string;
  readonly sequence: number;
  readonly aggregateVersion: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly dataJson: string;
}

export class SQLiteEventStore<T> implements EventStore<T> {
  readonly #database: DatabaseSync;
  readonly #codec: PersistenceCodec<T>;

  constructor(path: string, codec: PersistenceCodec<T>) {
    this.#database = openOdinSqlite(path);
    this.#codec = codec;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS mission_event_batches (
        mission_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        start_sequence INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        PRIMARY KEY (mission_id, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS mission_events (
        mission_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        aggregate_version INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (mission_id, sequence),
        UNIQUE (mission_id, aggregate_version)
      ) STRICT;
    `);
  }

  close(): void {
    this.#database.close();
  }

  async append(
    missionId: string,
    expectedVersion: number,
    idempotencyKey: string,
    items: readonly EventAppendItem<T>[],
  ): Promise<readonly StoredEvent<T>[]> {
    assertIdentifier(missionId, "missionId");
    assertIdentifier(idempotencyKey, "idempotencyKey");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new TypeError("expectedVersion must be a non-negative safe integer.");
    }
    if (items.length === 0 || items.length > MAX_EVENT_BATCH_SIZE) {
      throw new TypeError(`Event append batches must contain 1-${MAX_EVENT_BATCH_SIZE} items.`);
    }

    const encoded = items.map((item) => {
      assertCanonicalUtc(item.occurredAt, "event occurredAt");
      return {
        dataJson: canonicalJson(this.#codec.encode(item.data), MAX_EVENT_JSON_BYTES, "event data"),
        occurredAt: item.occurredAt,
      };
    });
    const fingerprint = sha256(
      canonicalJson(encoded, MAX_EVENT_JSON_BYTES * items.length, "event batch"),
    );

    const rows = withImmediateTransaction(this.#database, () => {
      const replay = this.#database
        .prepare(
          `SELECT fingerprint, start_sequence, event_count
           FROM mission_event_batches
           WHERE mission_id = ? AND idempotency_key = ?`,
        )
        .get(missionId, idempotencyKey) as Record<string, unknown> | undefined;
      if (replay !== undefined) {
        if (readString(replay.fingerprint, "batch fingerprint") !== fingerprint) {
          throw new EventStoreConflictError(
            "Idempotency key was reused for a different event batch.",
          );
        }
        const start = readPositiveInteger(replay.start_sequence, "batch start sequence");
        const count = readPositiveInteger(replay.event_count, "batch event count");
        return this.#readRawRange(missionId, start, count);
      }

      const state = this.#database
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(MAX(sequence), 0) AS max_sequence
           FROM mission_events WHERE mission_id = ?`,
        )
        .get(missionId) as Record<string, unknown>;
      const count = readNonNegativeInteger(state.count, "mission event count");
      const maxSequence = readNonNegativeInteger(state.max_sequence, "mission max sequence");
      if (count !== maxSequence) {
        throw new PersistenceCorruptionError("Mission event stream contains a sequence gap.");
      }
      if (count !== expectedVersion) {
        throw new EventStoreConflictError(
          `Optimistic version conflict: expected ${expectedVersion}, current ${count}.`,
        );
      }

      const startSequence = expectedVersion + 1;
      this.#database
        .prepare(
          `INSERT INTO mission_event_batches(
             mission_id, idempotency_key, fingerprint, start_sequence, event_count
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(missionId, idempotencyKey, fingerprint, startSequence, encoded.length);

      const insert = this.#database.prepare(
        `INSERT INTO mission_events(
           mission_id, sequence, aggregate_version, idempotency_key, occurred_at, data_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const [index, item] of encoded.entries()) {
        const sequence = startSequence + index;
        insert.run(
          missionId,
          sequence,
          sequence,
          idempotencyKey,
          item.occurredAt,
          item.dataJson,
        );
      }
      return this.#readRawRange(missionId, startSequence, encoded.length);
    });

    return rows.map((row) => this.#decodeRow(row));
  }

  async load(missionId: string): Promise<readonly StoredEvent<T>[]> {
    assertIdentifier(missionId, "missionId");
    const records = this.#database
      .prepare(
        `SELECT mission_id, sequence, aggregate_version, idempotency_key, occurred_at, data_json
         FROM mission_events WHERE mission_id = ? ORDER BY sequence ASC`,
      )
      .all(missionId) as readonly Record<string, unknown>[];
    const rows = records.map(readRawEventRow);
    let expected = 1;
    for (const row of rows) {
      if (row.sequence !== expected || row.aggregateVersion !== expected) {
        throw new PersistenceCorruptionError("Mission event stream is not contiguous.");
      }
      expected += 1;
    }
    return rows.map((row) => this.#decodeRow(row));
  }

  #readRawRange(missionId: string, start: number, count: number): readonly RawEventRow[] {
    const records = this.#database
      .prepare(
        `SELECT mission_id, sequence, aggregate_version, idempotency_key, occurred_at, data_json
         FROM mission_events
         WHERE mission_id = ? AND sequence >= ? AND sequence < ?
         ORDER BY sequence ASC`,
      )
      .all(missionId, start, start + count) as readonly Record<string, unknown>[];
    if (records.length !== count) {
      throw new PersistenceCorruptionError("Persisted event batch is incomplete.");
    }
    return records.map(readRawEventRow);
  }

  #decodeRow(row: RawEventRow): StoredEvent<T> {
    const decoded = this.#codec.decode(
      parseBoundedJson(row.dataJson, MAX_EVENT_JSON_BYTES, "event data"),
    );
    return {
      aggregateVersion: row.aggregateVersion,
      data: structuredClone(decoded),
      idempotencyKey: row.idempotencyKey,
      missionId: row.missionId,
      occurredAt: row.occurredAt,
      sequence: row.sequence,
    };
  }
}

function readRawEventRow(row: Record<string, unknown>): RawEventRow {
  const missionId = readString(row.mission_id, "mission event mission id");
  const sequence = readPositiveInteger(row.sequence, "mission event sequence");
  const aggregateVersion = readPositiveInteger(
    row.aggregate_version,
    "mission event aggregate version",
  );
  const idempotencyKey = readString(row.idempotency_key, "mission event idempotency key");
  const occurredAt = readString(row.occurred_at, "mission event occurredAt");
  const dataJson = readString(row.data_json, "mission event data");
  assertIdentifier(missionId, "persisted missionId");
  assertIdentifier(idempotencyKey, "persisted idempotencyKey");
  assertCanonicalUtc(occurredAt, "persisted event occurredAt");
  if (aggregateVersion !== sequence) {
    throw new PersistenceCorruptionError("Mission event aggregate version does not match sequence.");
  }
  return { aggregateVersion, dataJson, idempotencyKey, missionId, occurredAt, sequence };
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

function readPositiveInteger(value: unknown, name: string): number {
  const result = readNonNegativeInteger(value, name);
  if (result < 1) throw new PersistenceCorruptionError(`${name} must be positive.`);
  return result;
}
