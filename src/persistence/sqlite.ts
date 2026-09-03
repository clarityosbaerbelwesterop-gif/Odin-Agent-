import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const ODIN_SQLITE_SCHEMA_VERSION = 1;
export const MAX_EVENT_JSON_BYTES = 256 * 1024;
export const MAX_CHECKPOINT_JSON_BYTES = 2 * 1024 * 1024;

export class PersistenceCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceCorruptionError";
  }
}

export function openOdinSqlite(path: string): DatabaseSync {
  assertIdentifier(path, "database path", 4096);
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 2500");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS odin_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT
  `);

  const row = database
    .prepare("SELECT value FROM odin_meta WHERE key = 'schema_version'")
    .get() as Record<string, unknown> | undefined;
  if (row === undefined) {
    database
      .prepare("INSERT INTO odin_meta(key, value) VALUES ('schema_version', ?)")
      .run(String(ODIN_SQLITE_SCHEMA_VERSION));
  } else {
    const version = Number(row.value);
    if (!Number.isSafeInteger(version) || version !== ODIN_SQLITE_SCHEMA_VERSION) {
      database.close();
      throw new PersistenceCorruptionError(
        `Unsupported SQLite schema version: ${String(row.value)}.`,
      );
    }
  }
  return database;
}

export function withImmediateTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original error. A failed rollback means the connection itself is unusable.
    }
    throw error;
  }
}

export function assertIdentifier(value: string, name: string, maxLength = 256): void {
  if (value.trim() === "" || value.length > maxLength || value.includes("\u0000")) {
    throw new TypeError(`${name} must be a bounded non-empty identifier.`);
  }
}

export function assertCanonicalUtc(value: string, name: string): void {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC timestamp.`);
  }
}

export function canonicalJson(value: unknown, maxBytes: number, name: string): string {
  const json = JSON.stringify(canonicalize(value, name));
  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    throw new TypeError(`${name} exceeds its serialized size limit.`);
  }
  return json;
}

export function parseBoundedJson(text: string, maxBytes: number, name: string): unknown {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new PersistenceCorruptionError(`${name} exceeds its persisted size limit.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PersistenceCorruptionError(`${name} is not valid JSON.`);
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown, name: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${name} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, name));
  if (typeof value !== "object") throw new TypeError(`${name} is not JSON-serializable.`);

  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    if (key.includes("\u0000")) throw new TypeError(`${name} contains an invalid object key.`);
    result[key] = canonicalize(object[key], name);
  }
  return result;
}
