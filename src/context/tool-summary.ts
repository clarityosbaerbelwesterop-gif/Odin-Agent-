import { createHash } from "node:crypto";
import type { JsonValue } from "../providers/types.js";
import { containsObviousSecret } from "../security/secret-text.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;

export interface CompactToolResult {
  readonly schemaVersion: 1;
  readonly tool: string;
  readonly evidenceReference: string;
  readonly outputHash: string;
  readonly summary: string;
  readonly originalBytes: number;
  readonly compactBytes: number;
  readonly truncated: boolean;
  readonly redacted: boolean;
}

export function compactToolResult(input: {
  readonly tool: string;
  readonly evidenceReference: string;
  readonly output: JsonValue;
  readonly maxSummaryBytes: number;
}): CompactToolResult {
  if (!IDENTIFIER.test(input.tool) || !IDENTIFIER.test(input.evidenceReference)) {
    throw new TypeError("Tool summary identity is malformed.");
  }
  if (
    !Number.isSafeInteger(input.maxSummaryBytes) ||
    input.maxSummaryBytes < 64 ||
    input.maxSummaryBytes > 16_384
  ) {
    throw new TypeError("maxSummaryBytes must be an integer from 64 to 16384.");
  }
  const canonical = JSON.stringify(canonicalize(input.output));
  const outputHash = createHash("sha256").update(canonical).digest("hex");
  const originalBytes = Buffer.byteLength(canonical, "utf8");
  const redacted = containsObviousSecret(canonical);
  let summary = redacted ? '{"redacted":true}' : canonical;
  let truncated = redacted;
  if (Buffer.byteLength(summary, "utf8") > input.maxSummaryBytes) {
    summary = structuralSummary(input.output);
    truncated = true;
  }
  if (Buffer.byteLength(summary, "utf8") > input.maxSummaryBytes) {
    summary = '{"truncated":true}';
  }
  return Object.freeze({
    compactBytes: Buffer.byteLength(summary, "utf8"),
    evidenceReference: input.evidenceReference,
    originalBytes,
    outputHash,
    redacted,
    schemaVersion: 1,
    summary,
    tool: input.tool,
    truncated,
  });
}

function structuralSummary(value: JsonValue): string {
  if (Array.isArray(value)) {
    return JSON.stringify({ itemCount: value.length, type: "array" });
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify({
      fields: Object.keys(value).sort().slice(0, 32),
      fieldCount: Object.keys(value).length,
      type: "object",
    });
  }
  return JSON.stringify({ type: value === null ? "null" : typeof value });
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}
