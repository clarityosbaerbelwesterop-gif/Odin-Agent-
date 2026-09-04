import { createHash } from "node:crypto";
import type {
  ActiveMemoryRecord,
  MemoryChange,
  MemoryKind,
  MemoryReader,
  MemoryRetrievalQuery,
  MemoryRevision,
  MemoryScope,
  MemorySensitivity,
  MemorySourceClass,
  MemoryStore,
  MemoryTombstoneCommand,
  MemoryWriteCommand,
  MemoryWriteResult,
  RetrievedMemory,
  StoredMemoryRecord,
  TombstonedMemoryRecord,
} from "./types.js";

const MAX_CONTENT_LENGTH = 65_536;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 1_000;
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 64;
const MAX_RETRIEVAL_LIMIT = 100;
const MEMORY_KINDS = new Set<MemoryKind>([
  "episodic",
  "project",
  "semantic",
  "user_preference",
  "working",
]);
const SENSITIVITIES = new Set<MemorySensitivity>(["internal", "public", "sensitive"]);
const SOURCE_CLASSES = new Set<MemorySourceClass>([
  "explicit_user",
  "import",
  "model_summary",
  "repository",
  "tool",
  "verified_learning",
]);

interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly result: MemoryWriteResult;
}

export class MemoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryConflictError";
  }
}

/**
 * Contract implementation for tests and a single-process runtime. It intentionally
 * makes no durability claim; a persistent adapter can implement the same interface.
 */
export class InMemoryMemoryStore implements MemoryStore, MemoryReader {
  readonly #records = new Map<string, StoredMemoryRecord>();
  readonly #history = new Map<string, MemoryRevision[]>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #listeners = new Set<(change: MemoryChange) => void>();
  #revision = 0;

  get revision(): number {
    return this.#revision;
  }

  async write(command: MemoryWriteCommand): Promise<MemoryWriteResult> {
    validateWriteCommand(command);
    const locator = memoryLocator(command.record.id, command.record.scope);
    const replay = this.#findReplay(locator, command.idempotencyKey, command);
    if (replay !== undefined) return replay;

    const current = this.#records.get(locator);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== command.expectedVersion) {
      throw versionConflict(command.expectedVersion, currentVersion);
    }
    if (current?.status === "tombstoned") {
      throw new MemoryConflictError("Tombstoned memory cannot be restored under the same ID.");
    }
    if (current !== undefined && Date.parse(command.updatedAt) < Date.parse(current.updatedAt)) {
      throw new MemoryConflictError("Memory update timestamps must not move backwards.");
    }

    const version = currentVersion + 1;
    const recordWithoutHash = {
      content: command.record.content,
      ...(command.record.expiresAt === undefined ? {} : { expiresAt: command.record.expiresAt }),
      id: command.record.id,
      key: command.record.key,
      kind: command.record.kind,
      provenance: normalizeProvenance(command.record.provenance),
      scope: normalizeScope(command.record.scope),
      sensitivity: command.record.sensitivity,
      status: "active" as const,
      tags: normalizeTags(command.record.tags),
      updatedAt: command.updatedAt,
      version,
    };
    const record: ActiveMemoryRecord = {
      ...recordWithoutHash,
      recordHash: stableHash(recordWithoutHash),
    };
    const storeRevision = this.#commit(locator, record, {
      action: "written",
      id: record.id,
      recordHash: record.recordHash,
      sourceReference: record.provenance.reference,
      updatedAt: record.updatedAt,
      version: record.version,
    });
    const result: MemoryWriteResult = { record, replayed: false, storeRevision };
    this.#rememberIdempotency(locator, command.idempotencyKey, command, result);
    this.#notify({ id: record.id, scope: record.scope, storeRevision });
    return cloneResult(result);
  }

  async tombstone(command: MemoryTombstoneCommand): Promise<MemoryWriteResult> {
    validateTombstoneCommand(command);
    const locator = memoryLocator(command.id, command.scope);
    const replay = this.#findReplay(locator, command.idempotencyKey, command);
    if (replay !== undefined) return replay;

    const current = this.#records.get(locator);
    if (current === undefined || current.version !== command.expectedVersion) {
      // The same error is used for absent and out-of-scope records to avoid an existence oracle.
      throw new MemoryConflictError("Memory scope or optimistic version did not match.");
    }
    if (current.status === "tombstoned") {
      throw new MemoryConflictError("Memory scope or optimistic version did not match.");
    }
    if (Date.parse(command.updatedAt) < Date.parse(current.updatedAt)) {
      throw new MemoryConflictError("Memory update timestamps must not move backwards.");
    }

    const recordWithoutHash = {
      content: null,
      id: current.id,
      previousContentHash: current.provenance.contentHash,
      scope: normalizeScope(current.scope),
      status: "tombstoned" as const,
      updatedAt: command.updatedAt,
      version: current.version + 1,
    };
    const record: TombstonedMemoryRecord = {
      ...recordWithoutHash,
      recordHash: stableHash(recordWithoutHash),
    };
    const storeRevision = this.#commit(locator, record, {
      action: "tombstoned",
      id: record.id,
      recordHash: record.recordHash,
      sourceReference: current.provenance.reference,
      updatedAt: record.updatedAt,
      version: record.version,
    });
    const result: MemoryWriteResult = { record, replayed: false, storeRevision };
    this.#forgetIdempotency(locator);
    this.#rememberIdempotency(locator, command.idempotencyKey, command, result);
    this.#notify({ id: record.id, scope: record.scope, storeRevision });
    return cloneResult(result);
  }

  async get(id: string, scope: MemoryScope): Promise<StoredMemoryRecord | undefined> {
    assertIdentifier(id, "id");
    validateScope(scope);
    const record = this.#records.get(memoryLocator(id, scope));
    return record === undefined ? undefined : structuredClone(record);
  }

  async history(id: string, scope: MemoryScope): Promise<readonly MemoryRevision[]> {
    assertIdentifier(id, "id");
    validateScope(scope);
    return structuredClone(this.#history.get(memoryLocator(id, scope)) ?? []);
  }

  async retrieve(query: MemoryRetrievalQuery): Promise<readonly RetrievedMemory[]> {
    validateRetrievalQuery(query);
    const evaluatedAt = Date.parse(query.evaluatedAt);
    const wantedKinds = new Set(query.kinds);
    const wantedTokens = tokenize(query.text);
    const wantedTags = new Set(normalizeTags(query.tags ?? []));
    const matches: RetrievedMemory[] = [];

    for (const record of this.#records.values()) {
      if (record.status !== "active") continue;
      if (record.scope.userId !== query.userId || record.scope.projectId !== query.projectId) {
        continue;
      }
      if (!wantedKinds.has(record.kind)) continue;
      if (record.kind === "working" && record.scope.missionId !== query.missionId) continue;
      if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= evaluatedAt) continue;

      const score = scoreRecord(record, wantedTokens, wantedTags);
      if ((wantedTokens.size > 0 || wantedTags.size > 0) && score === 0) continue;
      matches.push({ record: structuredClone(record), score });
    }

    matches.sort(
      (left, right) =>
        right.score - left.score ||
        right.record.updatedAt.localeCompare(left.record.updatedAt) ||
        left.record.id.localeCompare(right.record.id),
    );
    return matches.slice(0, query.limit);
  }

  subscribe(listener: (change: MemoryChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #commit(locator: string, record: StoredMemoryRecord, revision: MemoryRevision): number {
    this.#revision += 1;
    this.#records.set(locator, structuredClone(record));
    const revisions = this.#history.get(locator) ?? [];
    this.#history.set(locator, [...revisions, structuredClone(revision)]);
    return this.#revision;
  }

  #findReplay(
    locator: string,
    idempotencyKey: string,
    command: MemoryWriteCommand | MemoryTombstoneCommand,
  ): MemoryWriteResult | undefined {
    const replay = this.#idempotency.get(idempotencyLocator(locator, idempotencyKey));
    if (replay === undefined) return undefined;
    if (replay.fingerprint !== stableHash(command)) {
      throw new MemoryConflictError("Idempotency key was reused for a different memory command.");
    }
    const result = cloneResult(replay.result);
    return { ...result, replayed: true };
  }

  #rememberIdempotency(
    locator: string,
    idempotencyKey: string,
    command: MemoryWriteCommand | MemoryTombstoneCommand,
    result: MemoryWriteResult,
  ): void {
    this.#idempotency.set(idempotencyLocator(locator, idempotencyKey), {
      fingerprint: stableHash(command),
      result: cloneResult(result),
    });
  }

  #forgetIdempotency(locator: string): void {
    const prefix = `${locator}\u0000`;
    for (const key of this.#idempotency.keys()) {
      if (key.startsWith(prefix)) this.#idempotency.delete(key);
    }
  }

  #notify(change: MemoryChange): void {
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(change));
      } catch {
        // A cache or observer must not roll back an already committed memory mutation.
      }
    }
  }
}

function validateWriteCommand(command: MemoryWriteCommand): void {
  assertVersion(command.expectedVersion);
  assertIdentifier(command.idempotencyKey, "idempotencyKey");
  assertCanonicalTimestamp(command.updatedAt, "updatedAt");
  const { record } = command;
  assertIdentifier(record.id, "record.id");
  assertIdentifier(record.key, "record.key");
  validateScope(record.scope);
  if (!MEMORY_KINDS.has(record.kind)) throw new TypeError("record.kind is not supported.");
  if (!SENSITIVITIES.has(record.sensitivity)) {
    throw new TypeError("record.sensitivity is not supported.");
  }
  if (record.content.trim() === "" || record.content.length > MAX_CONTENT_LENGTH) {
    throw new TypeError(`record.content must contain 1-${MAX_CONTENT_LENGTH} characters.`);
  }
  normalizeTags(record.tags);
  if (record.kind === "working" && record.scope.missionId === undefined) {
    throw new TypeError("Working memory requires a mission scope.");
  }
  if (record.kind === "user_preference" && record.provenance.sourceClass !== "explicit_user") {
    throw new TypeError("User preferences require explicit user provenance.");
  }
  if (!SOURCE_CLASSES.has(record.provenance.sourceClass)) {
    throw new TypeError("record.provenance.sourceClass is not supported.");
  }
  assertText(record.provenance.reference, "record.provenance.reference", MAX_REFERENCE_LENGTH);
  assertIdentifier(record.provenance.sourceVersion, "record.provenance.sourceVersion");
  const observedAt = assertCanonicalTimestamp(
    record.provenance.observedAt,
    "record.provenance.observedAt",
  );
  const updatedAt = Date.parse(command.updatedAt);
  if (observedAt > updatedAt) {
    throw new TypeError("Memory provenance cannot be observed after the write timestamp.");
  }
  if (!isSha256(record.provenance.contentHash)) {
    throw new TypeError("record.provenance.contentHash must be a lowercase SHA-256 digest.");
  }
  if (sha256(record.content) !== record.provenance.contentHash) {
    throw new TypeError("record.provenance.contentHash does not match record.content.");
  }
  if (record.expiresAt !== undefined) {
    assertCanonicalTimestamp(record.expiresAt, "record.expiresAt");
  }
}

function validateTombstoneCommand(command: MemoryTombstoneCommand): void {
  assertVersion(command.expectedVersion);
  if (command.expectedVersion === 0) {
    throw new TypeError("A tombstone requires an existing positive version.");
  }
  assertIdentifier(command.id, "id");
  assertIdentifier(command.idempotencyKey, "idempotencyKey");
  validateScope(command.scope);
  assertCanonicalTimestamp(command.updatedAt, "updatedAt");
}

function validateRetrievalQuery(query: MemoryRetrievalQuery): void {
  assertIdentifier(query.userId, "query.userId");
  assertIdentifier(query.projectId, "query.projectId");
  if (query.missionId !== undefined) assertIdentifier(query.missionId, "query.missionId");
  if (query.kinds.length === 0 || new Set(query.kinds).size !== query.kinds.length) {
    throw new TypeError("query.kinds must be a non-empty unique list.");
  }
  for (const kind of query.kinds) {
    if (!MEMORY_KINDS.has(kind)) throw new TypeError("query.kinds contains an unsupported kind.");
  }
  if (query.kinds.includes("working") && query.missionId === undefined) {
    throw new TypeError("Retrieving working memory requires a mission scope.");
  }
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_RETRIEVAL_LIMIT) {
    throw new TypeError(`query.limit must be an integer from 1 to ${MAX_RETRIEVAL_LIMIT}.`);
  }
  if (query.text.length > MAX_CONTENT_LENGTH) throw new TypeError("query.text is too long.");
  normalizeTags(query.tags ?? []);
  assertCanonicalTimestamp(query.evaluatedAt, "query.evaluatedAt");
}

function validateScope(scope: MemoryScope): void {
  assertIdentifier(scope.userId, "scope.userId");
  assertIdentifier(scope.projectId, "scope.projectId");
  if (scope.missionId !== undefined) assertIdentifier(scope.missionId, "scope.missionId");
}

function normalizeScope(scope: MemoryScope): MemoryScope {
  return {
    ...(scope.missionId === undefined ? {} : { missionId: scope.missionId }),
    projectId: scope.projectId,
    userId: scope.userId,
  };
}

function normalizeProvenance(
  provenance: ActiveMemoryRecord["provenance"],
): ActiveMemoryRecord["provenance"] {
  return {
    contentHash: provenance.contentHash,
    observedAt: provenance.observedAt,
    reference: provenance.reference,
    sourceClass: provenance.sourceClass,
    sourceVersion: provenance.sourceVersion,
  };
}

function normalizeTags(tags: readonly string[]): string[] {
  if (tags.length > MAX_TAGS) throw new TypeError(`Memory tags are limited to ${MAX_TAGS}.`);
  const normalized = tags.map((tag) => {
    const value = tag.trim().toLocaleLowerCase("en-US");
    if (value === "" || value.length > MAX_TAG_LENGTH) {
      throw new TypeError(`Each memory tag must contain 1-${MAX_TAG_LENGTH} characters.`);
    }
    return value;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Memory tags must be unique after normalization.");
  }
  return normalized.sort();
}

function scoreRecord(
  record: ActiveMemoryRecord,
  wantedTokens: ReadonlySet<string>,
  wantedTags: ReadonlySet<string>,
): number {
  const recordTags = new Set(record.tags);
  const keyTokens = tokenize(record.key);
  const contentTokens = tokenize(record.content);
  let score = 0;
  for (const tag of wantedTags) {
    if (recordTags.has(tag)) score += 20;
  }
  for (const token of wantedTokens) {
    if (recordTags.has(token)) score += 8;
    if (keyTokens.has(token)) score += 4;
    if (contentTokens.has(token)) score += 1;
  }
  return score;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

function memoryLocator(id: string, scope: MemoryScope): string {
  return [scope.userId, scope.projectId, scope.missionId ?? "", id].join("\u0000");
}

function idempotencyLocator(locator: string, idempotencyKey: string): string {
  return `${locator}\u0000${idempotencyKey}`;
}

function assertIdentifier(value: string, name: string): void {
  assertText(value, name, MAX_IDENTIFIER_LENGTH);
  if (value.includes("\u0000")) throw new TypeError(`${name} must not contain a null character.`);
}

function assertText(value: string, name: string, maximum: number): void {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new TypeError(`${name} must contain 1-${maximum} characters.`);
  }
}

function assertVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("expectedVersion must be a non-negative safe integer.");
  }
}

function assertCanonicalTimestamp(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new TypeError(`${name} must be a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${name} must be a valid canonical UTC timestamp.`);
  }
  return parsed;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new TypeError("Cannot hash an undefined memory value.");
  return sha256(encoded);
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

function versionConflict(expected: number, current: number): MemoryConflictError {
  return new MemoryConflictError(
    `Optimistic version conflict: expected ${expected}, current ${current}.`,
  );
}

function cloneResult(result: MemoryWriteResult): MemoryWriteResult {
  return structuredClone(result);
}
