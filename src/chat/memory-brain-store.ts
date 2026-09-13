import { createHash, randomUUID } from "node:crypto";
import { AdvancedMemoryEngine } from "../memory/advanced.js";
import {
  type MemoryBrainProjection,
  type MemoryBrainPulse,
  type MemoryProductSignal,
  type MemoryProductStatus,
  type MemorySourceProjection,
  projectMemoryBrain,
} from "../memory/product.js";
import type {
  ActiveMemoryRecord,
  MemoryKind,
  MemoryScope,
  MemorySensitivity,
  MemorySourceClass,
  StoredMemoryRecord,
} from "../memory/types.js";
import { canonicalJson } from "../durable/internal.js";
import type { ActorDatabase } from "./neon-database.js";
import { NeonMemoryStore } from "./neon-memory.js";
import { hashText, identifier } from "./safety.js";
import { ChatError } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KINDS = new Set<MemoryKind>(["episodic", "project", "semantic", "user_preference", "working"]);
const STATUSES = new Set<MemoryProductStatus>([
  "ACTIVE",
  "TEMPORARY",
  "STALE",
  "CONFLICTED",
  "SUPERSEDED",
  "NOISE_CANDIDATE",
  "ARCHIVED",
]);
const SOURCE_CLASSES = new Set<MemorySourceClass>([
  "explicit_user",
  "import",
  "model_summary",
  "repository",
  "tool",
  "verified_learning",
]);

interface MemoryDbRow {
  id: string;
  project_id: string;
  mission_id: string | null;
  memory_key: string;
  kind: MemoryKind;
  content: string | null;
  tags: unknown;
  sensitivity: MemorySensitivity;
  source_class: MemorySourceClass | null;
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

export interface MemoryBrainFilters {
  readonly text?: string;
  readonly kinds?: readonly MemoryKind[];
  readonly statuses?: readonly MemoryProductStatus[];
  readonly sourceClasses?: readonly MemorySourceClass[];
}

/** Product projection and explicit user controls over the canonical MemoryStore. */
export class MemoryBrainStore {
  readonly memory: NeonMemoryStore;

  constructor(
    readonly db: ActorDatabase,
    readonly userId: string,
  ) {
    this.memory = new NeonMemoryStore(db, userId);
  }

  async projection(projectId: string, filters: MemoryBrainFilters = {}): Promise<MemoryBrainProjection> {
    projectUuid(projectId);
    const evaluatedAt = new Date().toISOString();
    const { project, rows, signalRows, workspaceRows, pulseRow } = await this.db.transaction(
      async (client) => {
        const projectResult = await client.query(
          "SELECT id,title FROM odin_api.conversations WHERE id=$1",
          [projectId],
        );
        const project = projectResult.rows[0];
        if (!project) throw new ChatError("NOT_FOUND", "Project not found.", 404);
        const rows = (
          await client.query(
            `SELECT * FROM odin_api.memory_records
             WHERE project_id=$1 ORDER BY updated_at DESC,id LIMIT 500`,
            [projectId],
          )
        ).rows as MemoryDbRow[];
        const signalRows = (
          await client.query(
            `SELECT memory_id,usage_count,last_used_at,pinned,archived_at
             FROM odin_api.memory_product_signals WHERE project_id=$1`,
            [projectId],
          )
        ).rows;
        const workspaceRows = (
          await client.query(
            `SELECT item_id,title,path FROM odin_api.workspace_files
             WHERE conversation_id=$1 ORDER BY updated_at DESC LIMIT 200`,
            [projectId],
          )
        ).rows;
        const pulseRow = (
          await client.query(
            `SELECT data FROM odin_api.events
             WHERE conversation_id=$1 AND type='memory.brain.pulse'
             ORDER BY cursor DESC LIMIT 1`,
            [projectId],
          )
        ).rows[0];
        return { project, rows, signalRows, workspaceRows, pulseRow };
      },
    );

    const records = rows.map((row) => rowToRecord(row, this.userId));
    const advanced = new AdvancedMemoryEngine(this.memory, () => evaluatedAt);
    const analysis = await advanced.retrieve({
      currentSources: [],
      evaluatedAt,
      limit: 100,
      projectId,
      text: "",
      userId: this.userId,
    });
    const signals: MemoryProductSignal[] = signalRows.map((row) => ({
      id: String(row.memory_id),
      usageCount: Number(row.usage_count),
      lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null,
      pinned: row.pinned === true,
      archivedAt: row.archived_at ? iso(row.archived_at) : null,
    }));
    const sources: MemorySourceProjection[] = workspaceRows.map((row) => ({
      reference: `odin://project/${projectId}/workspace/${String(row.item_id)}`,
      title: String(row.title ?? row.path ?? "Workspace source"),
      nodeClass: "WORKSPACE_SOURCE",
    }));
    const pulse = parsePulse(pulseRow?.data);

    return projectMemoryBrain({
      projectId,
      projectTitle: String(project.title),
      evaluatedAt,
      records,
      staleIds: analysis.stale.map((entry) => entry.recordId),
      conflicts: analysis.conflicts,
      signals,
      sources,
      pulse,
      filters: normalizeFilters(filters),
      maxMemoryNodes: 160,
    });
  }

  async setSignal(
    projectId: string,
    memoryId: string,
    input: { readonly pinned?: boolean; readonly archived?: boolean },
  ): Promise<void> {
    projectUuid(projectId);
    identifier(memoryId);
    if (input.pinned === undefined && input.archived === undefined)
      throw new ChatError("INVALID_MEMORY_ACTION", "Choose a memory action.");
    await this.db.transaction(async (client) => {
      const exists = await client.query(
        "SELECT 1 FROM odin_api.memory_records WHERE project_id=$1 AND id=$2",
        [projectId, memoryId],
      );
      if (!exists.rows.length) throw new ChatError("NOT_FOUND", "Memory not found.", 404);
      await client.query(
        `INSERT INTO odin_api.memory_product_signals(project_id,memory_id,pinned,archived_at,updated_at)
         VALUES($1,$2,$3,$4,now())
         ON CONFLICT(owner_id,project_id,memory_id) DO UPDATE SET
           pinned=CASE WHEN $5::boolean THEN excluded.pinned ELSE odin_api.memory_product_signals.pinned END,
           archived_at=CASE WHEN $6::boolean THEN excluded.archived_at ELSE odin_api.memory_product_signals.archived_at END,
           updated_at=now()`,
        [
          projectId,
          memoryId,
          input.pinned ?? false,
          input.archived === undefined ? null : input.archived ? new Date().toISOString() : null,
          input.pinned !== undefined,
          input.archived !== undefined,
        ],
      );
      await productEvent(client, projectId, "memory.signal.changed", {
        memoryId,
        ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      });
    });
  }

  async clear(projectId: string, memoryId: string, expectedVersion: number): Promise<void> {
    projectUuid(projectId);
    identifier(memoryId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new ChatError("INVALID_MEMORY_VERSION", "A positive memory version is required.");
    await this.memory.tombstone({
      expectedVersion,
      id: memoryId,
      idempotencyKey: `product-clear-${memoryId}-v${expectedVersion}`,
      scope: { userId: this.userId, projectId },
      updatedAt: new Date().toISOString(),
    });
  }

  async promoteWorkspaceItem(
    projectId: string,
    itemId: string,
    input: { readonly key?: string; readonly kind?: "project" | "semantic" },
  ): Promise<StoredMemoryRecord> {
    projectUuid(projectId);
    projectUuid(itemId);
    const item = await this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT item_id,title,path,content,sha,version,origin,updated_at
           FROM odin_api.workspace_files WHERE conversation_id=$1 AND item_id=$2`,
          [projectId, itemId],
        )
      ).rows[0];
      if (!row) throw new ChatError("NOT_FOUND", "Workspace item not found.", 404);
      return row;
    });
    const content = String(item.content);
    if (hashText(content) !== String(item.sha))
      throw new ChatError("INTEGRITY_FAILURE", "Workspace item failed integrity verification.", 500);
    const id = `workspace-${itemId}`;
    const scope: MemoryScope = { userId: this.userId, projectId };
    const existing = await this.memory.get(id, scope);
    if (existing?.status === "tombstoned")
      throw new ChatError(
        "MEMORY_TOMBSTONED",
        "This source was explicitly cleared. Create a new memory instead of silently restoring it.",
        409,
      );
    const sourceClass: MemorySourceClass =
      item.origin === "user" ? "explicit_user" : item.origin === "import" ? "import" : "tool";
    const result = await this.memory.write({
      expectedVersion: existing?.version ?? 0,
      idempotencyKey: `workspace-promote-${itemId}-v${String(item.version)}`,
      record: {
        id,
        key: cleanKey(input.key ?? String(item.title ?? item.path ?? "Project memory")),
        kind: input.kind ?? "project",
        scope,
        content,
        tags: ["workspace-promoted"],
        sensitivity: "internal",
        provenance: {
          sourceClass,
          reference: `odin://project/${projectId}/workspace/${itemId}`,
          sourceVersion: String(item.version),
          observedAt: iso(item.updated_at),
          contentHash: hashText(content),
        },
      },
      updatedAt: new Date().toISOString(),
    });
    return result.record;
  }

  async rememberExplicit(
    projectId: string,
    input: {
      readonly key: string;
      readonly content: string;
      readonly kind: "project" | "semantic" | "user_preference";
      readonly sensitivity: MemorySensitivity;
    },
  ): Promise<StoredMemoryRecord> {
    projectUuid(projectId);
    const content = input.content.trim();
    if (!content || content.length > 65_536)
      throw new ChatError("INVALID_MEMORY", "Memory content must contain 1-65536 characters.");
    if (!KINDS.has(input.kind)) throw new ChatError("INVALID_MEMORY", "Unsupported memory kind.");
    const now = new Date().toISOString();
    const id = `user-${randomUUID()}`;
    return (
      await this.memory.write({
        expectedVersion: 0,
        idempotencyKey: `explicit-${id}`,
        record: {
          id,
          key: cleanKey(input.key),
          kind: input.kind,
          scope: { userId: this.userId, projectId },
          content,
          tags: ["explicit-user"],
          sensitivity: input.sensitivity,
          provenance: {
            sourceClass: "explicit_user",
            reference: `odin://project/${projectId}/memory/user-entry`,
            sourceVersion: "1",
            observedAt: now,
            contentHash: hashText(content),
          },
        },
        updatedAt: now,
      })
    ).record;
  }
}

function rowToRecord(row: MemoryDbRow, userId: string): StoredMemoryRecord {
  const scope: MemoryScope = {
    userId,
    projectId: String(row.project_id),
    ...(row.mission_id ? { missionId: String(row.mission_id) } : {}),
  };
  if (row.status === "tombstoned") {
    if (!row.previous_content_hash) throw new ChatError("INTEGRITY_FAILURE", "Invalid memory tombstone.", 500);
    return {
      id: String(row.id),
      scope,
      status: "tombstoned",
      content: null,
      previousContentHash: String(row.previous_content_hash),
      version: Number(row.version),
      updatedAt: iso(row.updated_at),
      recordHash: String(row.record_hash),
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
    throw new ChatError("INTEGRITY_FAILURE", "Invalid active memory record.", 500);
  return {
    id: String(row.id),
    scope,
    status: "active",
    key: String(row.memory_key),
    kind: row.kind,
    content: String(row.content),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    sensitivity: row.sensitivity,
    provenance: {
      sourceClass: row.source_class,
      reference: String(row.source_reference),
      sourceVersion: String(row.source_version),
      observedAt: iso(row.source_observed_at),
      contentHash: String(row.source_content_hash),
    },
    ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}),
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
    recordHash: String(row.record_hash),
  };
}

function normalizeFilters(filters: MemoryBrainFilters): MemoryBrainFilters {
  const text = filters.text?.trim();
  if (text && text.length > 240) throw new ChatError("INVALID_FILTER", "Memory search is too long.");
  for (const kind of filters.kinds ?? []) if (!KINDS.has(kind)) throw new ChatError("INVALID_FILTER", "Unknown memory kind.");
  for (const status of filters.statuses ?? []) if (!STATUSES.has(status)) throw new ChatError("INVALID_FILTER", "Unknown memory status.");
  for (const source of filters.sourceClasses ?? []) if (!SOURCE_CLASSES.has(source)) throw new ChatError("INVALID_FILTER", "Unknown memory source.");
  return {
    ...(text ? { text } : {}),
    ...(filters.kinds?.length ? { kinds: [...new Set(filters.kinds)] } : {}),
    ...(filters.statuses?.length ? { statuses: [...new Set(filters.statuses)] } : {}),
    ...(filters.sourceClasses?.length ? { sourceClasses: [...new Set(filters.sourceClasses)] } : {}),
  };
}

function parsePulse(value: unknown): MemoryBrainPulse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.turnId !== "string" ||
    !Array.isArray(row.selectedMemoryIds) ||
    !Array.isArray(row.selectedWorkspaceReferences) ||
    typeof row.contextResultHash !== "string" ||
    typeof row.at !== "string" ||
    !Array.isArray(row.dropped)
  )
    return null;
  return {
    turnId: row.turnId,
    selectedMemoryIds: row.selectedMemoryIds.map(String),
    selectedWorkspaceReferences: row.selectedWorkspaceReferences.map(String),
    contextResultHash: row.contextResultHash,
    at: row.at,
    dropped: row.dropped.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      return typeof item.id === "string" && typeof item.reason === "string"
        ? [{ id: item.id, reason: item.reason }]
        : [];
    }),
  };
}

async function productEvent(
  client: { query(text: string, values?: readonly unknown[]): Promise<{ rows: any[] }> },
  projectId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const encoded = canonicalJson(data, 300_000);
  await client.query(
    "INSERT INTO odin_api.events(conversation_id,turn_id,type,data,data_hash) VALUES($1,NULL,$2,$3,$4)",
    [projectId, type, encoded, hashText(encoded)],
  );
}

function projectUuid(value: string): string {
  if (!UUID.test(value)) throw new ChatError("INVALID_PROJECT", "Invalid Project identifier.");
  return value;
}

function cleanKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 200) throw new ChatError("INVALID_MEMORY", "Memory key must contain 1-200 characters.");
  return key;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function memoryContentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
