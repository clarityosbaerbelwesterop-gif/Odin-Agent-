import { createHash } from "node:crypto";
import { RoutingError } from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value));
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function assertSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 hex digest.`);
  }
  return value;
}

export function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    invalid(`${label} is malformed.`);
  }
  return value;
}

export function nonEmptyText(value: unknown, label: string, maxBytes = 512): string {
  if (typeof value !== "string" || value.trim() === "") invalid(`${label} must be non-empty.`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) invalid(`${label} exceeds its size bound.`);
  return value;
}

export function canonicalTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    invalid(`${label} must be a canonical UTC timestamp.`);
  }
  return value;
}

export function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(`${label} is outside its integer bounds.`);
  }
  return value;
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be boolean.`);
  return value;
}

export function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const requiredSet = new Set(required);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) invalid(`${label} is missing ${key}.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${label} contains unknown field ${key}.`);
  }
  for (const key of requiredSet) {
    if (value[key] === undefined) invalid(`${label} field ${key} cannot be undefined.`);
  }
}

export function invalid(message: string): never {
  throw new RoutingError("INVALID_INPUT", message);
}

function normalizeCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeCanonical(entry)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  invalid("Canonical routing data contains an unsupported value.");
}
