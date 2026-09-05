import { createHash } from "node:crypto";
import type {
  ActiveMemoryRecord,
  MemoryScope,
  MemorySensitivity,
  MemoryStore,
  MemoryWriteResult,
  RetrievedMemory,
} from "./types.js";

export interface CurrentSourceObservation {
  readonly contentHash: string;
  readonly key: string;
  readonly observedAt: string;
  readonly sourceVersion: string;
}

export interface AdvancedMemoryQuery {
  readonly currentSources: readonly CurrentSourceObservation[];
  readonly evaluatedAt: string;
  readonly limit: number;
  readonly projectId: string;
  readonly tags?: readonly string[];
  readonly text: string;
  readonly userId: string;
}

export interface StaleMemoryEntry {
  readonly reason: "current_source_newer" | "newer_project_memory";
  readonly recordHash: string;
  readonly recordId: string;
}

export interface MemoryConflictGroup {
  readonly key: string;
  readonly recordHashes: readonly string[];
  readonly recordIds: readonly string[];
}

export interface AdvancedMemoryResult {
  readonly conflicts: readonly MemoryConflictGroup[];
  readonly evaluatedAt: string;
  readonly resultHash: string;
  readonly selected: readonly RetrievedMemory[];
  readonly stale: readonly StaleMemoryEntry[];
}

export interface MemoryRetentionPolicy {
  readonly episodicMaxAgeMs: number;
  readonly projectMaxAgeMs: number;
}

export interface MemoryRetentionCandidate {
  readonly id: string;
  readonly kind: "episodic" | "project";
  readonly recordHash: string;
  readonly version: number;
}

export interface MemoryRetentionPlan {
  readonly candidates: readonly MemoryRetentionCandidate[];
  readonly evaluatedAt: string;
  readonly planHash: string;
  readonly projectId: string;
  readonly userId: string;
}

export interface MemoryCompressionProposal {
  readonly contentHash: string;
  readonly createdAt: string;
  readonly key: string;
  readonly projectId: string;
  readonly proposalHash: string;
  readonly sensitivity: MemorySensitivity;
  readonly sourceRecords: readonly {
    readonly id: string;
    readonly recordHash: string;
  }[];
  readonly summary: string;
  readonly userId: string;
}

export class AdvancedMemoryError extends Error {
  constructor(
    readonly code: "CONFLICT" | "INVALID_INPUT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AdvancedMemoryError";
  }
}

export class AdvancedMemoryEngine {
  readonly #store: MemoryStore;
  readonly #clock: () => string;

  constructor(store: MemoryStore, clock: () => string = () => new Date().toISOString()) {
    this.#store = store;
    this.#clock = clock;
  }

  async retrieve(value: unknown): Promise<AdvancedMemoryResult> {
    const query = normalizeQuery(value);
    const recalled = await this.#store.retrieve({
      evaluatedAt: query.evaluatedAt,
      kinds: ["episodic", "project"],
      limit: query.limit,
      projectId: query.projectId,
      ...(query.tags === undefined ? {} : { tags: query.tags }),
      text: query.text,
      userId: query.userId,
    });
    const sourceByKey = new Map(query.currentSources.map((source) => [source.key, source]));
    const stale = new Map<string, StaleMemoryEntry>();

    for (const item of recalled) {
      if (item.record.kind !== "project") continue;
      const current = sourceByKey.get(item.record.key);
      if (
        current !== undefined &&
        Date.parse(current.observedAt) >= Date.parse(item.record.provenance.observedAt) &&
        (current.contentHash !== item.record.provenance.contentHash ||
          current.sourceVersion !== item.record.provenance.sourceVersion)
      ) {
        stale.set(item.record.id, {
          reason: "current_source_newer",
          recordHash: item.record.recordHash,
          recordId: item.record.id,
        });
      }
    }

    const byKey = new Map<string, RetrievedMemory[]>();
    for (const item of recalled) {
      if (item.record.kind !== "project" || stale.has(item.record.id)) continue;
      const group = byKey.get(item.record.key) ?? [];
      group.push(item);
      byKey.set(item.record.key, group);
    }

    const conflicts: MemoryConflictGroup[] = [];
    for (const [key, group] of byKey) {
      const newestObservedAt = group
        .map((item) => item.record.provenance.observedAt)
        .sort()
        .at(-1);
      if (newestObservedAt === undefined) continue;
      const newest = group.filter((item) => item.record.provenance.observedAt === newestObservedAt);
      for (const older of group.filter(
        (item) => item.record.provenance.observedAt !== newestObservedAt,
      )) {
        stale.set(older.record.id, {
          reason: "newer_project_memory",
          recordHash: older.record.recordHash,
          recordId: older.record.id,
        });
      }
      const hashes = [...new Set(newest.map((item) => item.record.provenance.contentHash))].sort();
      if (hashes.length > 1) {
        conflicts.push({
          key,
          recordHashes: Object.freeze(newest.map((item) => item.record.recordHash).sort()),
          recordIds: Object.freeze(newest.map((item) => item.record.id).sort()),
        });
      }
    }

    const conflictedIds = new Set(conflicts.flatMap((group) => group.recordIds));
    const selected = recalled.filter(
      (item) => !stale.has(item.record.id) && !conflictedIds.has(item.record.id),
    );
    const normalizedStale = [...stale.values()].sort((left, right) =>
      left.recordId.localeCompare(right.recordId),
    );
    conflicts.sort((left, right) => left.key.localeCompare(right.key));
    const body = {
      conflicts,
      evaluatedAt: query.evaluatedAt,
      selected,
      stale: normalizedStale,
    };
    return Object.freeze({
      ...structuredClone(body),
      resultHash: stableHash(body),
    });
  }

  async planRetention(value: unknown): Promise<MemoryRetentionPlan> {
    const input = normalizeRetention(value);
    const recalled = await this.#store.retrieve({
      evaluatedAt: input.evaluatedAt,
      kinds: ["episodic", "project"],
      limit: 100,
      projectId: input.projectId,
      text: "",
      userId: input.userId,
    });
    const evaluatedAt = Date.parse(input.evaluatedAt);
    const candidates = recalled
      .filter((item) => {
        const maxAge =
          item.record.kind === "episodic"
            ? input.policy.episodicMaxAgeMs
            : input.policy.projectMaxAgeMs;
        return evaluatedAt - Date.parse(item.record.updatedAt) > maxAge;
      })
      .map((item) => ({
        id: item.record.id,
        kind: item.record.kind as "episodic" | "project",
        recordHash: item.record.recordHash,
        version: item.record.version,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const body = {
      candidates,
      evaluatedAt: input.evaluatedAt,
      projectId: input.projectId,
      userId: input.userId,
    };
    return Object.freeze({ ...body, planHash: stableHash({ ...body, policy: input.policy }) });
  }

  async tombstone(input: {
    readonly expectedVersion: number;
    readonly id: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly userId: string;
  }): Promise<MemoryWriteResult> {
    validateIdentifier(input.id, "id");
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    validateIdentifier(input.userId, "userId");
    validateIdentifier(input.projectId, "projectId");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      invalid("expectedVersion must be a positive safe integer.");
    }
    return this.#store.tombstone({
      expectedVersion: input.expectedVersion,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      scope: { projectId: input.projectId, userId: input.userId },
      updatedAt: canonicalTime(this.#clock()),
    });
  }

  async proposeCompression(value: unknown): Promise<MemoryCompressionProposal> {
    const input = normalizeCompression(value);
    const scope: MemoryScope = { projectId: input.projectId, userId: input.userId };
    const sourceRecords: { id: string; recordHash: string }[] = [];
    for (const id of input.sourceRecordIds) {
      const record = await this.#store.get(id, scope);
      if (
        record === undefined ||
        record.status !== "active" ||
        (record.kind !== "episodic" && record.kind !== "project")
      ) {
        throw new AdvancedMemoryError(
          "NOT_FOUND",
          "Compression source must be an active episodic or project record in exact scope.",
        );
      }
      sourceRecords.push({ id: record.id, recordHash: record.recordHash });
    }
    sourceRecords.sort((left, right) => left.id.localeCompare(right.id));
    const createdAt = canonicalTime(this.#clock());
    const body = {
      contentHash: sha256(input.summary),
      createdAt,
      key: input.key,
      projectId: input.projectId,
      sensitivity: input.sensitivity,
      sourceRecords,
      summary: input.summary,
      userId: input.userId,
    };
    return Object.freeze({ ...body, proposalHash: stableHash(body) });
  }

  async commitCompression(
    value: unknown,
    idempotencyKey: string,
  ): Promise<MemoryWriteResult> {
    const proposal = normalizeProposal(value);
    validateIdentifier(idempotencyKey, "idempotencyKey");
    const { proposalHash, ...body } = proposal;
    if (stableHash(body) !== proposalHash) {
      throw new AdvancedMemoryError("CONFLICT", "Compression proposal integrity check failed.");
    }
    const scope: MemoryScope = { projectId: proposal.projectId, userId: proposal.userId };
    for (const source of proposal.sourceRecords) {
      const current = await this.#store.get(source.id, scope);
      if (
        current === undefined ||
        current.status !== "active" ||
        current.recordHash !== source.recordHash
      ) {
        throw new AdvancedMemoryError(
          "CONFLICT",
          "Compression source changed after proposal creation.",
        );
      }
    }
    const id = `m24-compressed-${proposalHash.slice(0, 24)}`;
    return this.#store.write({
      expectedVersion: 0,
      idempotencyKey,
      record: {
        content: proposal.summary,
        id,
        key: proposal.key,
        kind: "project",
        provenance: {
          contentHash: proposal.contentHash,
          observedAt: proposal.createdAt,
          reference: `m24-compression:${proposalHash}`,
          sourceClass: "model_summary",
          sourceVersion: "m24-compression-v1",
        },
        scope,
        sensitivity: proposal.sensitivity,
        tags: ["m24-compressed"],
      },
      updatedAt: canonicalTime(this.#clock()),
    });
  }
}

function normalizeQuery(value: unknown): AdvancedMemoryQuery {
  const object = exactObject(value, [
    "currentSources",
    "evaluatedAt",
    "limit",
    "projectId",
    "tags",
    "text",
    "userId",
  ], ["tags"]);
  if (!Array.isArray(object.currentSources) || object.currentSources.length > 64) {
    invalid("currentSources must contain at most 64 observations.");
  }
  const currentSources = object.currentSources.map(normalizeCurrentSource);
  if (new Set(currentSources.map((source) => source.key)).size !== currentSources.length) {
    invalid("currentSources keys must be unique.");
  }
  if (!Number.isSafeInteger(object.limit) || (object.limit as number) < 1 || (object.limit as number) > 100) {
    invalid("limit must be 1-100.");
  }
  if (typeof object.text !== "string" || object.text.length > 4_000) invalid("text is invalid.");
  let tags: readonly string[] | undefined;
  if (object.tags !== undefined) {
    if (!Array.isArray(object.tags) || object.tags.length > 32) invalid("tags are invalid.");
    tags = Object.freeze(object.tags.map((tag) => normalizedTag(tag)));
  }
  return Object.freeze({
    currentSources: Object.freeze(currentSources),
    evaluatedAt: canonicalTime(object.evaluatedAt),
    limit: object.limit as number,
    projectId: validateIdentifier(object.projectId, "projectId"),
    ...(tags === undefined ? {} : { tags }),
    text: object.text,
    userId: validateIdentifier(object.userId, "userId"),
  });
}

function normalizeCurrentSource(value: unknown): CurrentSourceObservation {
  const object = exactObject(value, ["contentHash", "key", "observedAt", "sourceVersion"]);
  return Object.freeze({
    contentHash: shaValue(object.contentHash, "current source contentHash"),
    key: validateIdentifier(object.key, "current source key"),
    observedAt: canonicalTime(object.observedAt),
    sourceVersion: validateIdentifier(object.sourceVersion, "current source version"),
  });
}

function normalizeRetention(value: unknown): {
  evaluatedAt: string;
  policy: MemoryRetentionPolicy;
  projectId: string;
  userId: string;
} {
  const object = exactObject(value, ["evaluatedAt", "policy", "projectId", "userId"]);
  const policyObject = exactObject(object.policy, ["episodicMaxAgeMs", "projectMaxAgeMs"]);
  const episodicMaxAgeMs = positiveDuration(policyObject.episodicMaxAgeMs, "episodicMaxAgeMs");
  const projectMaxAgeMs = positiveDuration(policyObject.projectMaxAgeMs, "projectMaxAgeMs");
  return Object.freeze({
    evaluatedAt: canonicalTime(object.evaluatedAt),
    policy: Object.freeze({ episodicMaxAgeMs, projectMaxAgeMs }),
    projectId: validateIdentifier(object.projectId, "projectId"),
    userId: validateIdentifier(object.userId, "userId"),
  });
}

function normalizeCompression(value: unknown): {
  key: string;
  projectId: string;
  sensitivity: MemorySensitivity;
  sourceRecordIds: readonly string[];
  summary: string;
  userId: string;
} {
  const object = exactObject(value, ["key", "projectId", "sensitivity", "sourceRecordIds", "summary", "userId"]);
  if (!Array.isArray(object.sourceRecordIds) || object.sourceRecordIds.length < 2 || object.sourceRecordIds.length > 32) {
    invalid("Compression requires 2-32 source records.");
  }
  const sourceRecordIds = object.sourceRecordIds.map((id) => validateIdentifier(id, "sourceRecordId")).sort();
  if (new Set(sourceRecordIds).size !== sourceRecordIds.length) invalid("Compression sources must be unique.");
  if (typeof object.summary !== "string" || object.summary.trim() === "" || object.summary.length > 16_384) {
    invalid("Compression summary is invalid.");
  }
  if (object.sensitivity !== "public" && object.sensitivity !== "internal" && object.sensitivity !== "sensitive") {
    invalid("Compression sensitivity is invalid.");
  }
  return Object.freeze({
    key: validateIdentifier(object.key, "key"),
    projectId: validateIdentifier(object.projectId, "projectId"),
    sensitivity: object.sensitivity,
    sourceRecordIds: Object.freeze(sourceRecordIds),
    summary: object.summary,
    userId: validateIdentifier(object.userId, "userId"),
  });
}

function normalizeProposal(value: unknown): MemoryCompressionProposal {
  const object = exactObject(value, [
    "contentHash",
    "createdAt",
    "key",
    "projectId",
    "proposalHash",
    "sensitivity",
    "sourceRecords",
    "summary",
    "userId",
  ]);
  if (!Array.isArray(object.sourceRecords) || object.sourceRecords.length < 2 || object.sourceRecords.length > 32) {
    invalid("Compression proposal sources are invalid.");
  }
  const sourceRecords = object.sourceRecords.map((value) => {
    const source = exactObject(value, ["id", "recordHash"]);
    return Object.freeze({
      id: validateIdentifier(source.id, "source record id"),
      recordHash: shaValue(source.recordHash, "source record hash"),
    });
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(sourceRecords.map((source) => source.id)).size !== sourceRecords.length) invalid("Compression proposal sources must be unique.");
  const normalized = normalizeCompression({
    key: object.key,
    projectId: object.projectId,
    sensitivity: object.sensitivity,
    sourceRecordIds: sourceRecords.map((source) => source.id),
    summary: object.summary,
    userId: object.userId,
  });
  return Object.freeze({
    contentHash: shaValue(object.contentHash, "proposal contentHash"),
    createdAt: canonicalTime(object.createdAt),
    key: normalized.key,
    projectId: normalized.projectId,
    proposalHash: shaValue(object.proposalHash, "proposalHash"),
    sensitivity: normalized.sensitivity,
    sourceRecords: Object.freeze(sourceRecords),
    summary: normalized.summary,
    userId: normalized.userId,
  });
}

function exactObject(value: unknown, allowed: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Expected an object.");
  const object = value as Record<string, unknown>;
  const allowedSet = new Set(allowed);
  if (Object.keys(object).some((key) => !allowedSet.has(key))) invalid("Object contains unknown fields.");
  const optionalSet = new Set(optional);
  for (const key of allowed) if (!optionalSet.has(key) && !(key in object)) invalid(`Object is missing ${key}.`);
  return object;
}

function validateIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200 || value.includes("\u0000")) {
    invalid(`${name} is invalid.`);
  }
  return value;
}

function normalizedTag(value: unknown): string {
  if (typeof value !== "string") invalid("tag is invalid.");
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (normalized === "" || normalized.length > 64) invalid("tag is invalid.");
  return normalized;
}

function canonicalTime(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    invalid("Timestamp must be canonical UTC.");
  }
  return value;
}

function positiveDuration(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3650 * 24 * 60 * 60 * 1000) {
    invalid(`${name} is invalid.`);
  }
  return value as number;
}

function shaValue(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) invalid(`${name} must be SHA-256.`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function invalid(message: string): never {
  throw new AdvancedMemoryError("INVALID_INPUT", message);
}
