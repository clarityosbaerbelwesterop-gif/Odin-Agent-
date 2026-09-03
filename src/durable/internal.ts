import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ArtifactReference, DurableStoreLimits } from "./types.js";
import { DurableStoreCorruptionError, DurableStoreError } from "./types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;

export function assertIdentifier(value: string, name: string, maxLength = 200): void {
  if (value.trim() === "" || value.length > maxLength || value.includes("\u0000")) {
    throw new TypeError(`${name} must be a bounded non-empty identifier.`);
  }
}

export function assertReasonCode(value: string): void {
  if (!REASON_CODE_PATTERN.test(value)) {
    throw new TypeError("reasonCode must be a stable lowercase identifier.");
  }
}

export function assertCanonicalTimestamp(value: string, name: string): void {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC ISO timestamp.`);
  }
}

export function assertSafeInteger(
  value: number,
  name: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a safe integer between ${minimum} and ${maximum}.`);
  }
}

export function assertArtifactReference(reference: ArtifactReference, name = "artifact"): void {
  assertIdentifier(reference.artifactId, `${name}.artifactId`, 500);
  if (!SHA256_PATTERN.test(reference.sha256)) {
    throw new TypeError(`${name}.sha256 must be a lowercase SHA-256 hex digest.`);
  }
}

export function assertSha256(value: string, name: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 hex digest.`);
  }
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown, maxBytes: number): string {
  assertSafeInteger(maxBytes, "maxBytes", 1);
  const normalized = canonicalize(value);
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new DurableStoreError("Serialized durable value exceeds its configured byte bound.");
  }
  return serialized;
}

export function parseJson(value: string, maxBytes: number, label: string): unknown {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new DurableStoreCorruptionError(`${label} exceeds its configured byte bound.`);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new DurableStoreCorruptionError(`${label} contains malformed JSON.`);
  }
}

export function mergeLimits(
  defaults: DurableStoreLimits,
  overrides: Partial<DurableStoreLimits> | undefined,
): DurableStoreLimits {
  const merged = { ...defaults, ...overrides };
  for (const [name, value] of Object.entries(merged)) {
    assertSafeInteger(value, `limits.${name}`, 1);
  }
  return Object.freeze(merged);
}

export function withImmediateTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original failure. The connection remains fail-closed for the caller.
    }
    throw error;
  }
}

export function asRow(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DurableStoreCorruptionError(`${label} is not a SQLite row object.`);
  }
  return value as Record<string, unknown>;
}

export function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new DurableStoreCorruptionError(`SQLite column ${key} is not text.`);
  }
  return value;
}

export function rowNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new DurableStoreCorruptionError(`SQLite column ${key} is not nullable text.`);
  }
  return value;
}

export function rowInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new DurableStoreCorruptionError(`SQLite column ${key} is not an integer.`);
  }
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number)) {
    throw new DurableStoreCorruptionError(`SQLite column ${key} exceeds safe integer bounds.`);
  }
  return number;
}

export function compareTimestamp(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => {
          const child = object[key];
          if (child === undefined) {
            throw new DurableStoreError("Durable JSON cannot contain undefined values.");
          }
          return [key, canonicalize(child)];
        }),
    );
  }
  throw new DurableStoreError("Durable JSON contains a non-serializable value.");
}
