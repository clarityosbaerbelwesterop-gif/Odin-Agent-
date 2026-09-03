import { createHash } from "node:crypto";

export const MAX_IDENTIFIER_LENGTH = 200;
export const MAX_REFERENCE_LENGTH = 1_000;
export const MAX_SUMMARY_LENGTH = 2_000;
export const MAX_COLLECTION_ITEMS = 128;

export function assertIdentifier(value: string, name: string): void {
  assertText(value, name, MAX_IDENTIFIER_LENGTH);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/u.test(value) || value.includes("..")) {
    throw new TypeError(`${name} contains unsupported characters.`);
  }
}

export function assertToken(value: string, name: string): void {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(value)) {
    throw new TypeError(`${name} must be a lowercase capability token.`);
  }
}

export function assertText(value: string, name: string, maximum: number): void {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new TypeError(`${name} must contain 1-${maximum} characters.`);
  }
}

export function assertCanonicalTimestamp(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new TypeError(`${name} must be a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${name} must be a valid canonical UTC timestamp.`);
  }
  return parsed;
}

export function assertSha256(value: string, name: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
  }
}

export function normalizeUniqueTokens(values: readonly string[], name: string): string[] {
  if (values.length === 0 || values.length > MAX_COLLECTION_ITEMS) {
    throw new TypeError(`${name} must contain 1-${MAX_COLLECTION_ITEMS} entries.`);
  }
  const normalized = values.map((value) => {
    assertToken(value, name);
    return value;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${name} must not contain duplicates.`);
  }
  return normalized.sort();
}

export function normalizeRepositoryPath(value: string, name: string): string {
  assertText(value, name, MAX_REFERENCE_LENGTH);
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes("\u0000") ||
    value.endsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${name} must be a normalized workspace-relative path.`);
  }
  return value;
}

export function stableHash(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new TypeError("Cannot hash an undefined coordination value.");
  return createHash("sha256").update(encoded).digest("hex");
}

export function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, canonicalize(object[key])]),
  );
}
