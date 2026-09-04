import { createHash } from "node:crypto";
import { ReliabilityError } from "./types.js";

const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9._:/@-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) invalid(`${label} is malformed.`);
  return value;
}

export function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

export function boundedInteger(value: unknown, label: string, maximum = 1_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    invalid(`${label} is outside its integer bounds.`);
  }
  return value as number;
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be boolean.`);
  return value;
}

export function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function exactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in record) || record[key] === undefined) invalid(`${label} is missing ${key}.`);
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(`${label} contains unknown field ${key}.`);
  }
}

export function invalid(message: string): never {
  throw new ReliabilityError("INVALID_INPUT", message);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
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
  invalid("Reliability data contains an unsupported value.");
}
