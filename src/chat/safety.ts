import { createHash } from "node:crypto";
import { containsObviousSecret } from "../security/secret-text.js";
import { ChatError } from "./types.js";

export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");

export function safeText(value: unknown, max = 32_000): string {
  if (typeof value !== "string" || value.length > max || value.includes("\u0000")) {
    throw new ChatError("INVALID_TEXT", "Text is invalid or exceeds its limit.");
  }
  if (containsObviousSecret(value)) {
    throw new ChatError("SECRET_REJECTED", "Remove credentials before sending or storing content.");
  }
  return value;
}

export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatError("INVALID_REQUEST", "Expected a JSON object.");
  }
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ChatError("INVALID_REQUEST", "Request contains unknown fields.");
  }
  return value as Record<string, unknown>;
}

export function identifier(value: unknown): string {
  // Colons are allowed for bounded internal composite/idempotency keys such as
  // <task-id>:<specialist-id>:<phase>. They remain path-safe and SQL-safe while avoiding
  // accidental INVALID_ID failures in durable agent orchestration.
  if (typeof value !== "string" || !/^[a-zA-Z0-9_:-]{1,100}$/u.test(value)) {
    throw new ChatError("INVALID_ID", "Invalid identifier.");
  }
  return value;
}

export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ChatError("INVALID_BOUND", "Value exceeds its allowed bounds.");
  }
  return value;
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof ChatError) return { code: error.code, message: error.message };
  const category =
    error !== null && typeof error === "object" && "category" in error
      ? String(error.category)
      : "failed";
  const messages: Record<string, string> = {
    authentication: "Provider credentials are unavailable or invalid.",
    rate_limit:
      "Provider rate limit reached. Start a follow-up later; no automatic retry was started.",
    timeout: "The provider or tool timed out.",
    context_overflow: "The selected model's context limit was reached.",
    unsupported: "The configured model does not support this operation.",
    denied: "The operation is outside this task's permissions.",
    conflict: "The workspace changed. Read the file again before editing.",
  };
  return {
    code: Object.hasOwn(messages, category) ? category : "EXECUTION_FAILED",
    message:
      messages[category] ?? "Execution failed. Details were withheld to protect private data.",
  };
}
