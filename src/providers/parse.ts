import { ProviderError } from "./errors.js";
import type { JsonObject, JsonValue } from "./types.js";

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asFiniteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : undefined;
}

export function expectObject(
  provider: string,
  value: unknown,
  description: string,
): Record<string, unknown> {
  const object = asObject(value);
  if (object === undefined) malformed(provider, `Expected ${description} to be an object.`);
  return object;
}

export function expectArray(
  provider: string,
  value: unknown,
  description: string,
): readonly unknown[] {
  const array = asArray(value);
  if (array === undefined) malformed(provider, `Expected ${description} to be an array.`);
  return array;
}

export function expectString(provider: string, value: unknown, description: string): string {
  const string = asString(value);
  if (string === undefined) malformed(provider, `Expected ${description} to be a string.`);
  return string;
}

export function nonNegativeInteger(value: unknown): number {
  const integer = asFiniteInteger(value);
  return integer !== undefined && integer >= 0 ? integer : 0;
}

export function parseJsonObject(provider: string, value: string, description: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    const object = asObject(parsed);
    if (object === undefined) malformed(provider, `${description} must decode to a JSON object.`);
    return object as JsonObject;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError({
      category: "malformed_response",
      cause: error,
      message: `${description} contained invalid JSON.`,
      provider,
      retryable: false,
    });
  }
}

export function parseJsonValue(provider: string, value: string, description: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new ProviderError({
      category: "malformed_response",
      cause: error,
      message: `${description} contained invalid JSON.`,
      provider,
      retryable: false,
    });
  }
}

export function parseEventJson(provider: string, value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return expectObject(provider, parsed, "streaming event");
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError({
      category: "malformed_response",
      cause: error,
      message: "The provider emitted invalid JSON in its event stream.",
      provider,
      retryable: false,
    });
  }
}

export function malformed(provider: string, message: string): never {
  throw new ProviderError({
    category: "malformed_response",
    message,
    provider,
    retryable: false,
  });
}
