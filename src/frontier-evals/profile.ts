import { createHash } from "node:crypto";
import type { FrontierBudgetProfile } from "./types.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PROFILE_INPUT_FIELDS = [
  "provider",
  "model",
  "profileVersion",
  "reasoningEffort",
  "contextWindowTokens",
  "maxOutputTokens",
  "reasoningEfforts",
  "textInput",
  "imageInput",
  "toolUse",
  "structuredOutput",
  "strictStructuredOutput",
  "streaming",
  "provenance",
] as const;
const PROFILE_FIELDS = [...PROFILE_INPUT_FIELDS, "profileHash"] as const;

export type FrontierProfileProvenanceKind = "provider" | "runtime" | "evaluation";

export interface FrontierProfileProvenance {
  readonly kind: FrontierProfileProvenanceKind;
  readonly observedAt: string;
  readonly reference: string;
  readonly evidenceHash: string;
}

export interface FrontierEvaluationProfileInput {
  readonly provider: string;
  readonly model: string;
  readonly profileVersion: string;
  readonly reasoningEffort: string | null;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly reasoningEfforts: readonly string[];
  readonly textInput: boolean;
  readonly imageInput: boolean;
  readonly toolUse: boolean;
  readonly structuredOutput: boolean;
  readonly strictStructuredOutput: boolean;
  readonly streaming: boolean;
  readonly provenance: FrontierProfileProvenance;
}

export interface FrontierEvaluationProfile extends FrontierEvaluationProfileInput {
  readonly profileHash: string;
}

export class FrontierProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontierProfileError";
  }
}

export function createFrontierEvaluationProfile(
  value: FrontierEvaluationProfileInput,
): FrontierEvaluationProfile {
  exactKeys(value, PROFILE_INPUT_FIELDS);

  const reasoningEfforts = normalizeReasoningEfforts(value.reasoningEfforts);
  const reasoningEffort =
    value.reasoningEffort === null ? null : identifier(value.reasoningEffort, "reasoningEffort");
  if (reasoningEffort !== null && !reasoningEfforts.includes(reasoningEffort)) {
    throw new FrontierProfileError("Requested reasoning effort is not supported by this profile.");
  }

  const provenance = normalizeProvenance(value.provenance);
  const body = {
    contextWindowTokens: boundedInteger(
      value.contextWindowTokens,
      "contextWindowTokens",
      1,
      100_000_000,
    ),
    imageInput: boolean(value.imageInput, "imageInput"),
    maxOutputTokens: boundedInteger(value.maxOutputTokens, "maxOutputTokens", 1, 10_000_000),
    model: identifier(value.model, "model"),
    profileVersion: identifier(value.profileVersion, "profileVersion"),
    provider: identifier(value.provider, "provider"),
    provenance,
    reasoningEffort,
    reasoningEfforts,
    streaming: boolean(value.streaming, "streaming"),
    strictStructuredOutput: boolean(value.strictStructuredOutput, "strictStructuredOutput"),
    structuredOutput: boolean(value.structuredOutput, "structuredOutput"),
    textInput: boolean(value.textInput, "textInput"),
    toolUse: boolean(value.toolUse, "toolUse"),
  } as const;

  if (body.maxOutputTokens > body.contextWindowTokens) {
    throw new FrontierProfileError("Profile max output cannot exceed its context window.");
  }
  if (body.strictStructuredOutput && !body.structuredOutput) {
    throw new FrontierProfileError(
      "Strict structured output cannot be declared without structured output support.",
    );
  }

  return Object.freeze({ ...body, profileHash: hashJson(body) });
}

export function validateFrontierEvaluationProfile(
  profile: FrontierEvaluationProfile,
): FrontierEvaluationProfile {
  exactKeys(profile, PROFILE_FIELDS);
  if (!SHA256.test(profile.profileHash)) {
    throw new FrontierProfileError("Frontier profile hash must be SHA-256.");
  }
  const rebuilt = createFrontierEvaluationProfile(profileInput(profile));
  if (profile.profileHash !== rebuilt.profileHash) {
    throw new FrontierProfileError("Frontier profile hash does not match its capability envelope.");
  }
  return rebuilt;
}

export function assertFrontierBudgetFitsProfile(
  profile: FrontierEvaluationProfile,
  budget: FrontierBudgetProfile,
): void {
  const normalized = validateFrontierEvaluationProfile(profile);
  if (budget.maxOutputTokens > normalized.maxOutputTokens) {
    throw new FrontierProfileError("Benchmark output budget exceeds the evaluation profile limit.");
  }
  if (budget.maxInputTokens + budget.maxOutputTokens > normalized.contextWindowTokens) {
    throw new FrontierProfileError(
      "Benchmark token budget exceeds the evaluation profile context window.",
    );
  }
}

function profileInput(profile: FrontierEvaluationProfile): FrontierEvaluationProfileInput {
  return {
    contextWindowTokens: profile.contextWindowTokens,
    imageInput: profile.imageInput,
    maxOutputTokens: profile.maxOutputTokens,
    model: profile.model,
    profileVersion: profile.profileVersion,
    provider: profile.provider,
    provenance: profile.provenance,
    reasoningEffort: profile.reasoningEffort,
    reasoningEfforts: profile.reasoningEfforts,
    streaming: profile.streaming,
    strictStructuredOutput: profile.strictStructuredOutput,
    structuredOutput: profile.structuredOutput,
    textInput: profile.textInput,
    toolUse: profile.toolUse,
  };
}

function normalizeReasoningEfforts(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > 16) {
    throw new FrontierProfileError("Reasoning effort list exceeds its bound.");
  }
  const normalized = values.map((value) => identifier(value, "supported reasoning effort"));
  if (new Set(normalized).size !== normalized.length) {
    throw new FrontierProfileError("Reasoning effort list contains duplicates.");
  }
  return Object.freeze([...normalized].sort());
}

function normalizeProvenance(value: FrontierProfileProvenance): FrontierProfileProvenance {
  exactKeys(value, ["kind", "observedAt", "reference", "evidenceHash"]);
  if (value.kind !== "provider" && value.kind !== "runtime" && value.kind !== "evaluation") {
    throw new FrontierProfileError("Profile provenance kind is unsupported.");
  }
  if (typeof value.observedAt !== "string" || !ISO_UTC.test(value.observedAt)) {
    throw new FrontierProfileError("Profile provenance time must be canonical UTC.");
  }
  const parsed = Date.parse(value.observedAt);
  if (!Number.isFinite(parsed)) {
    throw new FrontierProfileError("Profile provenance time is invalid.");
  }
  if (
    typeof value.reference !== "string" ||
    value.reference.length < 1 ||
    value.reference.length > 512
  ) {
    throw new FrontierProfileError("Profile provenance reference is invalid.");
  }
  if (!SHA256.test(value.evidenceHash)) {
    throw new FrontierProfileError("Profile provenance evidence hash must be SHA-256.");
  }
  return Object.freeze({
    evidenceHash: value.evidenceHash,
    kind: value.kind,
    observedAt: value.observedAt,
    reference: value.reference,
  });
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new FrontierProfileError(`Frontier ${label} is invalid.`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new FrontierProfileError(`Frontier ${label} is outside its bound.`);
  }
  return value as number;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new FrontierProfileError(`Frontier ${label} must be boolean.`);
  }
  return value;
}

function exactKeys(value: object, required: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new FrontierProfileError("Frontier profile object has unexpected or missing fields.");
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
