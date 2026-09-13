import { createHash } from "node:crypto";
import type {
  ActiveMemoryRecord,
  MemoryChange,
  MemoryKind,
  MemoryRetrievalQuery,
  MemoryRevision,
  MemoryScope,
  MemoryStore,
  MemoryTombstoneCommand,
  MemoryWriteCommand,
  MemoryWriteResult,
  RetrievedMemory,
  StoredMemoryRecord,
} from "../memory/types.js";
import { MemoryConflictError } from "../memory/store.js";
import type { ActorDatabase } from "./neon-database.js";

const KINDS = new Set<MemoryKind>([
  "episodic",
  "project",
  "semantic",
  "user_preference",
  "working",
]);
const SOURCES = new Set([
  "explicit_user",
  "import",
  "model_summary",
  "repository",
  "tool",
  "verified_learning",
]);
const SENSITIVITIES = new Set(["internal", "public", "sensitive"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface MemoryRow {
  id: string;
  project_id: string;
  mission_id: string | null;
  memory_key: string;
  kind: MemoryKind;
  content: string | null;
  tags: unknown;
  sensitivity: ActiveMemoryRecord["sensitivity"];
  source_class: ActiveMemoryRecord["provenance"]["sourceClass"] | null;
  source_reference: string | null;
  source_version: string | null;
  source_observed_at: Date | string | null;
  source_content_hash: string | null;
  expires_at: Date | string | null;
  status: "active" | "tombstoned";
  previous_content_hash: string | null;
  version: number;
  record_hash: string;
  updated_at: Date | string;
}

/**
 * Durable implementation of the canonical MemoryStore contract for the hosted product.
 * Neon RLS remains the tenant authority; this adapter additionally binds every command to
 * the authenticated actor and exact Project before issuing SQL.
 */
export class NeonMemoryStore implements MemoryStore {
  readonly #listeners = new Set<(change: MemoryChange) => void>();
  #revision = 0;

  constructor(
    readonly db: ActorDatabase,
    readonly userId: string,
  ) {
    identifier(userId, "userId");
  }

  get revision(): number {
    return this.#revision;
  }

  async write(command: MemoryWriteCommand): Promise<MemoryWriteResult> {
    validateWrite(command, this.userId);
    const scope = command.record.scope;
    const fingerprint = stableHash(command);
    const result = await this.db.transaction(async (client) => {
      const replay = await client.query(
        `SELECT fingerprint,result FROM odin_api.memory_idempotency
         WHERE project_id=$1 AND memory_id=$2 AND idempotency_key=$3`,
        [scope.projectId, command.record.id, command.idempotencyKey],
      );
      if (replay.rows.length) {
        if (replay.rows[0]?.fingerprint !== fingerprint)
          throw new MemoryConflictError(
            "Idempotency key was reused for a different memory command.",
          );
        const stored = replay.rows[0]?.result as MemoryWriteResult;
        return { ...structuredClone(stored), replayed: true };
      }

      const current = await client.query(
        `SELECT * FROM odin_api.memory_records
         WHERE project_id=$1 AND id=$2 FOR UPDATE`,
        [scope.projectId, command.record.id],
      );
      const row = current.rows[0] as MemoryRow | undefined;
      const currentVersion = Number(row?.version ?? 0);
      if (currentVersion !== command.expectedVersion)
        throw new MemoryConflictError(
          `Optimistic version conflict: expected ${command.expectedVersion}, current ${currentVersion}.`,
        );
      if (row?.status === "tombstoned")
        throw new MemoryConflictError("Tombstoned memory cannot be restored under the same ID.");
      if (row && Date.parse(command.updatedAt) < Date.parse(iso(row.updated_at)))
        throw new MemoryConflictError("Memory update timestamps must not move backwards.");

      const version = currentVersion + 1;
      const normalizedTags = normalizeTags(command.record.tags);
      const base = {
        content: command.record.content,
        ...(command.record.expiresAt === undefined ? {} : { expiresAt: command.record.expiresAt }),
        id: command.record.id,
        key: command.record.key,
        kind: command.record.kind,
        provenance: { ...command.record.provenance },
        scope: { ...scope },
        sensitivity: command.record.sensitivity,
        status: "active" as const,
        tags: normalizedTags,
        updatedAt: command.updatedAt,
        version,
      };
      const record: ActiveMemoryRecord = { ...base, recordHash: stableHash(base) };

      if (row) {
        await client.query(
          `UPDATE odin_api.memory_records SET
            mission_id=$3,memory_key=$4,kind=$5,content=$6,tags=$7::jsonb,sensitivity=$8,
            source_class=$9,source_reference=$10,source_version=$11,source_observed_at=$12,
            source_content_hash=$13,expires_at=$14,status='active',previous_content_hash=NULL,
            version=$15,record_hash=$16,updated_at=$17
           WHERE project_id=$1 AND id=$2`,
          paramsForRecord(scope.projectId, record),
        );
      } else {
        await client.query(
          `INSERT INTO odin_api.memory_records(
            project_id,id,mission_id,memory_key,kind,content,tags,sensitivity,source_class,
            source_reference,source_version,source_observed_at,source_content_hash,expires_at,status,
            previous_content_hash,version,record_hash,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,'active',NULL,$15,$16,$17)`,
          paramsForRecord(scope.projectId, record),
        );
      }
      const revision = await client.query(
        `INSERT INTO odin_api.memory_revisions(
           project_id,memory_id,version,action,record_hash,source_reference,updated_at)
         VALUES($1,$2,$3,'written',$4,$5,$6) RETURNING cursor`,
        [scope.projectId, record.id, record.version, record.recordHash, record.provenance.reference, record.updatedAt],
      );
      await client.query(
        `INSERT INTO odin_api.memory_product_signals(project_id,memory_id)
         VALUES($1,$2) ON CONFLICT(owner_id,project_id,memory_id) DO NOTHING`,
        [scope.projectId, record.id],
      );
      const storeRevision = Number(revision.rows[0]?.cursor ?? 0);
      const output: MemoryWriteResult = { record, replayed: false, storeRevision };
      await client.query(
        `INSERT INTO odin_api.memory_idempotency(project_id,memory_id,idempotency_key,fingerprint,result)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [scope.projectId, record.id, command.idempotencyKey, fingerprint, JSON.stringify(output)],
      );
      return output;
    });
    this.#revision = Math.max(this.#revision, result.storeRevision);
    if (!result.replayed) this.#notify({ id: result.record.id, scope, storeRevision: result.storeRevision });
    return structuredClone(result);
  }

  async tombstone(command: MemoryTombstoneCommand): Promise<MemoryWriteResult> {
    validateTombstone(command, this.userId);
    const fingerprint = stableHash(command);
    const result = await this.db.transaction(async (client) => {
      const replay = await client.query(
        `SELECT fingerprint,result FROM odin_api.memory_idempotency
         WHERE project_id=$1 AND memory_id=$2 AND idempotency_key=$3`,
        [command.scope.projectId, command.id, command.idempotencyKey],
      );
      if (replay.rows.length) {
        if (replay.rows[0]?.fingerprint !== fingerprint)
          throw new MemoryConflictError(
            "Idempotency key was reused for a different memory command.",
          );
        return { ...(structuredClone(replay.rows[0]?.result) as MemoryWriteResult), replayed: true };
      }
      const current = await client.query(
        `SELECT * FROM odin_api.memory_records
         WHERE project_id=$1 AND id=$2 FOR UPDATE`,
        [command.scope.projectId, command.id],
      );
      const row = current.rows[0] as MemoryRow | undefined;
      if (!row || row.status !== "active" || Number(row.version) !== command.expectedVersion)
        throw new MemoryConflictError("Memory scope or optimistic version did not match.");
      if (Date.parse(command.updatedAt) < Date.parse(iso(row.updated_at)))
        throw new MemoryConflictError("Memory update timestamps must not move backwards.");
      const active = fromRow(row, this.userId);
      if (active.status !== "active") throw new MemoryConflictError("Memory scope did not match.");
      const base = {
        content: null,
        id: active.id,
        previousContentHash: active.provenance.contentHash,
        scope: { ...command.scope },
        status: "tombstoned" as const,
        updatedAt: command.updatedAt,
        version: active.version + 1,
      };
      const record: StoredMemoryRecord = { ...base, recordHash: stableHash(base) };
      await client.query(
        `UPDATE odin_api.memory_records SET content=NULL,source_class=NULL,source_reference=NULL,
          source_version=NULL,source_observed_at=NULL,source_content_hash=NULL,expires_at=NULL,
          status='tombstoned',previous_content_hash=$3,version=$4,record_hash=$5,updated_at=$6
         WHERE project_id=$1 AND id=$2`,
        [command.scope.projectId, command.id, active.provenance.contentHash, record.version, record.recordHash, record.updatedAt],
      );
      const revision = await client.query(
        `INSERT INTO odin_api.memory_revisions(
           project_id,memory_id,version,action,record_hash,source_reference,updated_at)
         VALUES($1,$2,$3,'tombstoned',$4,$5,$6) RETURNING cursor`,
        [command.scope.projectId, command.id, record.version, record.recordHash, active.provenance.reference, record.updatedAt],
      );
      await client.query(
        "DELETE FROM odin_api.memory_idempotency WHERE project_id=$1 AND memory_id=$2",
        [command.scope.projectId, command.id],
      );
      const storeRevision = Number(revision.rows[0]?.cursor ?? 0);
      const output: MemoryWriteResult = { record, replayed: false, storeRevision };
      await client.query(
        `INSERT INTO odin_api.memory_idempotency(project_id,memory_id,idempotency_key,fingerprint,result)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [command.scope.projectId, command.id, command.idempotencyKey, fingerprint, JSON.stringify(output)],
      );
      return output;
    });
    this.#revision = Math.max(this.#revision, result.storeRevision);
    if (!result.replayed)
      this.#notify({ id: command.id, scope: command.scope, storeRevision: result.storeRevision });
    return structuredClone(result);
  }

  async get(id: string, scope: MemoryScope): Promise<StoredMemoryRecord | undefined> {
    identifier(id, "id");
    this.#scope(scope);
    return this.db.transaction(async (client) => {
      const result = await client.query(
        "SELECT * FROM odin_api.memory_records WHERE project_id=$1 AND id=$2",
        [scope.projectId, id],
      );
      const row = result.rows[0] as MemoryRow | undefined;
      return row ? fromRow(row, this.userId) : undefined;
    });
  }

  async history(id: string, scope: MemoryScope): Promise<readonly MemoryRevision[]> {
    identifier(id, "id");
    this.#scope(scope);
    return this.db.transaction(async (client) => {
      const rows = (
        await client.query(
          `SELECT version,action,record_hash,source_reference,updated_at
           FROM odin_api.memory_revisions WHERE project_id=$1 AND memory_id=$2 ORDER BY version`,
          [scope.projectId, id],
        )
      ).rows;
      return rows.map((row) => ({
        action: row.action as MemoryRevision["action"],
        id,
        recordHash: String(row.record_hash),
        sourceReference: String(row.source_reference),
        updatedAt: iso(row.updated_at),
        version: Number(row.version),
      }));
    });
  }

  async retrieve(query: MemoryRetrievalQuery): Promise<readonly RetrievedMemory[]> {
    validateQuery(query, this.userId);
    const records = await this.db.transaction(async (client) => {
      const rows = (
        await client.query(
          `SELECT * FROM odin_api.memory_records
           WHERE project_id=$1 AND status='active' AND kind=ANY($2::text[])
           ORDER BY updated_at DESC LIMIT 1000`,
          [query.projectId, query.kinds],
        )
      ).rows as MemoryRow[];
      return rows.map((row) => fromRow(row, this.userId)).filter(isActive);
    });
    const wantedTokens = tokenize(query.text);
    const wantedTags = new Set(normalizeTags(query.tags ?? []));
    const at = Date.parse(query.evaluatedAt);
    const matches: RetrievedMemory[] = [];
    for (const record of records) {
      if (record.kind === "working" && record.scope.missionId !== query.missionId) continue;
      if (record.expiresAt && Date.parse(record.expiresAt) <= at) continue;
      if (record.provenance.sourceClass === "verified_learning" && !wantedTags.has("m13-learning"))
        continue;
      const score = scoreRecord(record, wantedTokens, wantedTags);
      if ((wantedTokens.size || wantedTags.size) && score === 0) continue;
      matches.push({ record, score });
    }
    matches.sort(
      (a, b) =>
        b.score - a.score ||
        b.record.updatedAt.localeCompare(a.record.updatedAt) ||
        a.record.id.localeCompare(b.record.id),
    );
    return matches.slice(0, query.limit);
  }

  subscribe(listener: (change: MemoryChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #scope(scope: MemoryScope): void {
    identifier(scope.userId, "scope.userId");
    if (scope.userId !== this.userId) throw new MemoryConflictError("Memory scope did not match.");
    if (!UUID.test(scope.projectId)) throw new TypeError("scope.projectId must be a Project UUID.");
    if (scope.missionId !== undefined) identifier(scope.missionId, "scope.missionId");
  }

  #notify(change: MemoryChange): void {
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(change));
      } catch {
        // Persistence already committed. Observer failures cannot mutate canonical memory state.
      }
    }
  }
}

function paramsForRecord(projectId: string, record: ActiveMemoryRecord): unknown[] {
  return [
    projectId,
    record.id,
    record.scope.missionId ?? null,
    record.key,
    record.kind,
    record.content,
    JSON.stringify(record.tags),
    record.sensitivity,
    record.provenance.sourceClass,
    record.provenance.reference,
    record.provenance.sourceVersion,
    record.provenance.observedAt,
    record.provenance.contentHash,
    record.expiresAt ?? null,
    record.version,
    record.recordHash,
    record.updatedAt,
  ];
}

function fromRow(row: MemoryRow, userId: string): StoredMemoryRecord {
  const scope: MemoryScope = {
    userId,
    projectId: row.project_id,
    ...(row.mission_id ? { missionId: row.mission_id } : {}),
  };
  if (row.status === "tombstoned") {
    if (!row.previous_content_hash) throw new TypeError("Invalid persisted memory tombstone.");
    return {
      id: row.id,
      scope,
      status: "tombstoned",
      content: null,
      previousContentHash: row.previous_content_hash,
      version: Number(row.version),
      updatedAt: iso(row.updated_at),
      recordHash: row.record_hash,
    };
  }
  if (
    row.content === null ||
    !row.source_class ||
    !row.source_reference ||
    !row.source_version ||
    !row.source_observed_at ||
    !row.source_content_hash
  )
    throw new TypeError("Invalid persisted active memory record.");
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  return {
    id: row.id,
    scope,
    status: "active",
    key: row.memory_key,
    kind: row.kind,
    content: row.content,
    tags,
    sensitivity: row.sensitivity,
    provenance: {
      sourceClass: row.source_class,
      reference: row.source_reference,
      sourceVersion: row.source_version,
      observedAt: iso(row.source_observed_at),
      contentHash: row.source_content_hash,
    },
    ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}),
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
    recordHash: row.record_hash,
  };
}

function validateWrite(command: MemoryWriteCommand, userId: string): void {
  expectedVersion(command.expectedVersion);
  identifier(command.idempotencyKey, "idempotencyKey");
  timestamp(command.updatedAt, "updatedAt");
  const record = command.record;
  identifier(record.id, "record.id");
  identifier(record.key, "record.key");
  scope(record.scope, userId);
  if (!KINDS.has(record.kind)) throw new TypeError("record.kind is not supported.");
  if (!SENSITIVITIES.has(record.sensitivity)) throw new TypeError("record.sensitivity is not supported.");
  if (!record.content.trim() || record.content.length > 65_536)
    throw new TypeError("record.content must contain 1-65536 characters.");
  normalizeTags(record.tags);
  if (record.kind === "working" && !record.scope.missionId)
    throw new TypeError("Working memory requires a mission scope.");
  if (record.kind === "user_preference" && record.provenance.sourceClass !== "explicit_user")
    throw new TypeError("User preferences require explicit user provenance.");
  if (!SOURCES.has(record.provenance.sourceClass))
    throw new TypeError("record.provenance.sourceClass is not supported.");
  text(record.provenance.reference, "record.provenance.reference", 1000);
  identifier(record.provenance.sourceVersion, "record.provenance.sourceVersion");
  const observed = timestamp(record.provenance.observedAt, "record.provenance.observedAt");
  if (observed > Date.parse(command.updatedAt))
    throw new TypeError("Memory provenance cannot be observed after the write timestamp.");
  if (sha(record.content) !== record.provenance.contentHash)
    throw new TypeError("record.provenance.contentHash does not match record.content.");
  if (record.expiresAt !== undefined) timestamp(record.expiresAt, "record.expiresAt");
}

function validateTombstone(command: MemoryTombstoneCommand, userId: string): void {
  expectedVersion(command.expectedVersion);
  if (command.expectedVersion === 0) throw new TypeError("A tombstone requires an existing positive version.");
  identifier(command.id, "id");
  identifier(command.idempotencyKey, "idempotencyKey");
  scope(command.scope, userId);
  timestamp(command.updatedAt, "updatedAt");
}

function validateQuery(query: MemoryRetrievalQuery, userId: string): void {
  identifier(query.userId, "query.userId");
  if (query.userId !== userId) throw new MemoryConflictError("Memory scope did not match.");
  if (!UUID.test(query.projectId)) throw new TypeError("query.projectId must be a Project UUID.");
  if (!query.kinds.length || new Set(query.kinds).size !== query.kinds.length)
    throw new TypeError("query.kinds must be a non-empty unique list.");
  for (const kind of query.kinds) if (!KINDS.has(kind)) throw new TypeError("Unsupported memory kind.");
  if (query.kinds.includes("working") && !query.missionId)
    throw new TypeError("Retrieving working memory requires a mission scope.");
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)
    throw new TypeError("query.limit must be an integer from 1 to 100.");
  if (query.text.length > 65_536) throw new TypeError("query.text is too long.");
  normalizeTags(query.tags ?? []);
  timestamp(query.evaluatedAt, "query.evaluatedAt");
}

function scope(value: MemoryScope, userId: string): void {
  identifier(value.userId, "scope.userId");
  if (value.userId !== userId) throw new MemoryConflictError("Memory scope did not match.");
  if (!UUID.test(value.projectId)) throw new TypeError("scope.projectId must be a Project UUID.");
  if (value.missionId !== undefined) identifier(value.missionId, "scope.missionId");
}

function scoreRecord(record: ActiveMemoryRecord, tokens: ReadonlySet<string>, tags: ReadonlySet<string>): number {
  const recordTags = new Set(record.tags);
  const keyTokens = tokenize(record.key);
  const contentTokens = tokenize(record.content);
  let score = 0;
  for (const tag of tags) if (recordTags.has(tag)) score += 20;
  for (const token of tokens) {
    if (recordTags.has(token)) score += 8;
    if (keyTokens.has(token)) score += 4;
    if (contentTokens.has(token)) score += 1;
  }
  return score;
}

function isActive(record: StoredMemoryRecord): record is ActiveMemoryRecord {
  return record.status === "active";
}

function normalizeTags(tags: readonly string[]): string[] {
  if (tags.length > 32) throw new TypeError("Memory tags are limited to 32.");
  const values = tags.map((tag) => tag.trim().toLocaleLowerCase("en-US"));
  if (values.some((tag) => !tag || tag.length > 64) || new Set(values).size !== values.length)
    throw new TypeError("Memory tags must be unique values with 1-64 characters.");
  return values.sort();
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

function expectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError("expectedVersion must be a non-negative safe integer.");
}

function identifier(value: string, name: string): void {
  text(value, name, 200);
  if (value.includes("\u0000")) throw new TypeError(`${name} must not contain a null character.`);
}

function text(value: string, name: string, max: number): void {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new TypeError(`${name} must contain 1-${max} characters.`);
}

function timestamp(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new TypeError(`${name} must be a canonical UTC timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new TypeError(`${name} must be a valid canonical UTC timestamp.`);
  return parsed;
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.toISOString();
}

function stableHash(value: unknown): string {
  return sha(JSON.stringify(canonical(value)));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, canonical(object[key])]),
  );
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
