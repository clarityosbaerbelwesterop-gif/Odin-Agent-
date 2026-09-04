import { createHash } from "node:crypto";

const MAX_METADATA_ENTRIES = 32;
const MAX_METADATA_TEXT = 512;
const MAX_IDENTIFIER = 160;
const MAX_REASON_CODE = 120;

const FORBIDDEN_KEY =
  /(?:secret|token|password|authorization|credential|cookie|api[_-]?key|private[_-]?key|chain[_-]?of[_-]?thought|reasoning|prompt|stdout|stderr|environment|env)/iu;
const FORBIDDEN_VALUE =
  /(?:\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{8,}|\bxox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u;

export type RuntimeEventSeverity = "info" | "warning" | "error";
export type RuntimeEventKind =
  | "backup"
  | "network"
  | "process"
  | "provider"
  | "recovery"
  | "release"
  | "sandbox"
  | "security";
export type RuntimeEventMetadataValue = boolean | number | string | null;

export interface RuntimeEventInput {
  readonly kind: RuntimeEventKind;
  readonly severity: RuntimeEventSeverity;
  readonly reasonCode: string;
  readonly source: string;
  readonly occurredAt: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly metadata?: Readonly<Record<string, RuntimeEventMetadataValue>>;
}

export interface RuntimeEvent extends RuntimeEventInput {
  readonly eventHash: string;
  readonly metadata: Readonly<Record<string, RuntimeEventMetadataValue>>;
}

export class ObservabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservabilityError";
  }
}

export class BoundedRuntimeEventBuffer {
  readonly #capacity: number;
  readonly #events: RuntimeEvent[] = [];

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) {
      throw new ObservabilityError("Event buffer capacity must be a bounded positive integer.");
    }
    this.#capacity = capacity;
  }

  append(input: RuntimeEventInput): RuntimeEvent {
    const event = createRuntimeEvent(input);
    this.#events.push(event);
    if (this.#events.length > this.#capacity) this.#events.shift();
    return event;
  }

  list(): readonly RuntimeEvent[] {
    return Object.freeze(this.#events.map((event) => freezeEvent(event)));
  }
}

export function createRuntimeEvent(input: RuntimeEventInput): RuntimeEvent {
  if (typeof input !== "object" || input === null) {
    throw new ObservabilityError("Runtime event input must be an object.");
  }
  if (!isKind(input.kind) || !isSeverity(input.severity)) {
    throw new ObservabilityError("Runtime event kind or severity is invalid.");
  }
  const reasonCode = boundedIdentifier(input.reasonCode, "reasonCode", MAX_REASON_CODE);
  const source = boundedIdentifier(input.source, "source", MAX_IDENTIFIER);
  const occurredAt = canonicalTimestamp(input.occurredAt, "occurredAt");
  const missionId = optionalIdentifier(input.missionId, "missionId");
  const taskId = optionalIdentifier(input.taskId, "taskId");
  const metadata = normalizeMetadata(input.metadata ?? {});
  const canonical = canonicalJson({
    kind: input.kind,
    metadata,
    missionId: missionId ?? null,
    occurredAt,
    reasonCode,
    severity: input.severity,
    source,
    taskId: taskId ?? null,
  });
  return freezeEvent({
    eventHash: sha256(canonical),
    kind: input.kind,
    metadata,
    ...(missionId === undefined ? {} : { missionId }),
    occurredAt,
    reasonCode,
    severity: input.severity,
    source,
    ...(taskId === undefined ? {} : { taskId }),
  });
}

function normalizeMetadata(
  metadata: Readonly<Record<string, RuntimeEventMetadataValue>>,
): Readonly<Record<string, RuntimeEventMetadataValue>> {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new ObservabilityError("Runtime event metadata must be a record.");
  }
  const entries = Object.entries(metadata);
  if (entries.length > MAX_METADATA_ENTRIES) {
    throw new ObservabilityError("Runtime event metadata exceeds its entry bound.");
  }
  const normalized: Record<string, RuntimeEventMetadataValue> = {};
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(key) || FORBIDDEN_KEY.test(key)) {
      throw new ObservabilityError("Runtime event metadata key is invalid or sensitive.");
    }
    if (typeof value === "string") {
      if (
        value.length > MAX_METADATA_TEXT ||
        value.includes("\u0000") ||
        FORBIDDEN_VALUE.test(value)
      ) {
        throw new ObservabilityError("Runtime event metadata text is invalid or secret-like.");
      }
      normalized[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        throw new ObservabilityError("Runtime event numeric metadata must be a safe integer.");
      }
      normalized[key] = value;
      continue;
    }
    if (typeof value === "boolean" || value === null) {
      normalized[key] = value;
      continue;
    }
    throw new ObservabilityError("Runtime event metadata value type is unsupported.");
  }
  return Object.freeze(normalized);
}

function freezeEvent(event: RuntimeEvent): RuntimeEvent {
  return Object.freeze({ ...event, metadata: Object.freeze({ ...event.metadata }) });
}

function canonicalJson(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalTimestamp(value: string, label: string): string {
  if (typeof value !== "string") throw new ObservabilityError(`${label} must be a timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ObservabilityError(`${label} must be canonical UTC.`);
  }
  return value;
}

function boundedIdentifier(value: string, label: string, maximum = MAX_IDENTIFIER): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u.test(value)
  ) {
    throw new ObservabilityError(`${label} is invalid.`);
  }
  return value;
}

function optionalIdentifier(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : boundedIdentifier(value, label);
}

function isKind(value: string): value is RuntimeEventKind {
  return [
    "backup",
    "network",
    "process",
    "provider",
    "recovery",
    "release",
    "sandbox",
    "security",
  ].includes(value);
}

function isSeverity(value: string): value is RuntimeEventSeverity {
  return value === "info" || value === "warning" || value === "error";
}
