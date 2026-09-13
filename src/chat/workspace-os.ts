import { randomUUID } from "node:crypto";
import { canonicalJson } from "../durable/internal.js";
import type { ActorDatabase, DatabaseAction } from "./neon-database.js";
import { hashText, identifier, integer, safeText } from "./safety.js";
import { ChatError } from "./types.js";

export const WORKSPACE_ITEM_KINDS = [
  "DOCUMENT",
  "NOTE",
  "TEXT",
  "MARKDOWN",
  "CODE",
  "HTML",
  "JSON",
  "IMAGE_REFERENCE",
  "FILE_REFERENCE",
  "GENERATED_ARTIFACT",
  "RESEARCH_RESULT",
  "PLAN",
  "REPORT",
] as const;
export type WorkspaceItemKind = (typeof WORKSPACE_ITEM_KINDS)[number];
export type WorkspaceOrigin = "user" | "runtime" | "import";

export interface WorkspaceItem {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly kind: WorkspaceItemKind;
  readonly title: string;
  readonly mimeType: string | null;
  readonly origin: WorkspaceOrigin;
  readonly sourceRunId: string | null;
  readonly sourceTaskId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly size: number;
  readonly sha: string;
  readonly metadata: Record<string, unknown>;
  readonly content?: string;
}

export interface WorkspaceLayout {
  readonly openItemIds: readonly string[];
  readonly activeItemId: string | null;
  readonly version: number;
  readonly updatedAt: string | null;
}

const TEXT_IMPORTS: Readonly<Record<string, WorkspaceItemKind>> = {
  "text/plain": "TEXT",
  "text/markdown": "MARKDOWN",
  "text/html": "HTML",
  "text/css": "CODE",
  "text/javascript": "CODE",
  "application/javascript": "CODE",
  "application/json": "JSON",
};
const iso = (value: Date | string) => new Date(value).toISOString();
const missing = () => new ChatError("NOT_FOUND", "Workspace item not found.", 404);

export class WorkspaceOsStore {
  constructor(readonly db: ActorDatabase) {}

  async summary(projectId: string) {
    const id = identifier(projectId);
    await this.#project(id);
    const [items, context, layout] = await Promise.all([
      this.items(id),
      this.context(id),
      this.layout(id),
    ]);
    return {
      projectId: id,
      items,
      context,
      layout,
      counts: {
        documents: items.filter((item) =>
          ["DOCUMENT", "NOTE", "TEXT", "MARKDOWN"].includes(item.kind),
        ).length,
        artifacts: items.filter((item) =>
          ["GENERATED_ARTIFACT", "RESEARCH_RESULT", "PLAN", "REPORT", "HTML", "JSON"].includes(
            item.kind,
          ),
        ).length,
        files: items.filter((item) => item.origin === "import" || item.kind === "FILE_REFERENCE")
          .length,
      },
    };
  }

  async items(projectId: string, query = ""): Promise<WorkspaceItem[]> {
    const id = identifier(projectId);
    await this.#project(id);
    const needle = safeText(query, 200).trim();
    return this.db.transaction(async (c) => {
      const rows = (
        await c.query(
          `SELECT item_id,path,kind,title,mime_type,origin,source_turn_id,source_task_id,version,
                  metadata,created_at,updated_at,sha,octet_length(content) AS size
             FROM odin_api.workspace_files
            WHERE conversation_id=$1
              AND ($2='' OR coalesce(title,'') ILIKE '%'||$2||'%' OR path ILIKE '%'||$2||'%' OR content ILIKE '%'||$2||'%')
            ORDER BY updated_at DESC,path
            LIMIT 200`,
          [id, needle],
        )
      ).rows;
      return rows.map((row) => this.#item(id, row));
    });
  }

  async item(projectId: string, itemId: string): Promise<WorkspaceItem> {
    const project = identifier(projectId);
    const item = identifier(itemId);
    await this.#project(project);
    return this.db.transaction(async (c) => {
      const row = (
        await c.query(
          `SELECT item_id,path,kind,title,mime_type,origin,source_turn_id,source_task_id,version,
                  metadata,created_at,updated_at,sha,content,octet_length(content) AS size
             FROM odin_api.workspace_files WHERE conversation_id=$1 AND item_id=$2`,
          [project, item],
        )
      ).rows[0];
      if (!row) throw missing();
      if (hashText(String(row.content)) !== row.sha)
        throw new ChatError(
          "INTEGRITY_FAILURE",
          "Workspace item failed integrity verification.",
          500,
        );
      return this.#item(project, row, String(row.content));
    });
  }

  async createDocument(
    projectId: string,
    input: { title: string; content?: string; format?: "markdown" | "text" | "note" },
  ): Promise<WorkspaceItem> {
    const project = identifier(projectId);
    await this.#project(project);
    const title = safeText(input.title, 200).trim();
    if (!title) throw new ChatError("INVALID_TITLE", "Document title is required.");
    const content = safeText(input.content ?? "", 262144);
    const format = input.format ?? "markdown";
    const kind: WorkspaceItemKind =
      format === "note" ? "NOTE" : format === "text" ? "TEXT" : "MARKDOWN";
    const extension = format === "markdown" || format === "note" ? "md" : "txt";
    const itemId = randomUUID();
    const path = `documents/${itemId}.${extension}`;
    const sha = hashText(content);
    await this.db.transaction(async (c) => {
      await this.#checkLimit(c, project, Buffer.byteLength(content), false);
      await c.query(
        `INSERT INTO odin_api.workspace_files
          (conversation_id,item_id,path,content,sha,kind,title,mime_type,origin,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'user','{}'::jsonb)`,
        [
          project,
          itemId,
          path,
          content,
          sha,
          kind,
          title,
          extension === "md" ? "text/markdown" : "text/plain",
        ],
      );
      await this.#emit(c, project, "workspace.item.created", {
        itemId,
        kind,
        title,
        origin: "user",
      });
    });
    return this.item(project, itemId);
  }

  async updateDocument(
    projectId: string,
    itemId: string,
    input: { title: string; content: string; expectedVersion: number },
  ): Promise<WorkspaceItem> {
    const project = identifier(projectId);
    const item = identifier(itemId);
    const title = safeText(input.title, 200).trim();
    const content = safeText(input.content, 262144);
    const expectedVersion = integer(input.expectedVersion, 1, 1_000_000);
    if (!title) throw new ChatError("INVALID_TITLE", "Document title is required.");
    await this.#project(project);
    await this.db.transaction(async (c) => {
      const row = (
        await c.query(
          `SELECT content,version,origin,kind,updated_at FROM odin_api.workspace_files
            WHERE conversation_id=$1 AND item_id=$2 FOR UPDATE`,
          [project, item],
        )
      ).rows[0];
      if (!row) throw missing();
      if (
        !["DOCUMENT", "NOTE", "TEXT", "MARKDOWN"].includes(String(row.kind)) ||
        row.origin === "runtime"
      )
        throw new ChatError(
          "READ_ONLY_ARTIFACT",
          "Generated artifacts are read only. Create a document copy to edit them.",
          409,
        );
      if (Number(row.version) !== expectedVersion)
        throw new ChatError(
          "STALE_DOCUMENT",
          "This document changed. Reload before saving again.",
          409,
        );
      await this.#checkLimit(
        c,
        project,
        Buffer.byteLength(content),
        true,
        Buffer.byteLength(String(row.content)),
      );
      await c.query(
        `UPDATE odin_api.workspace_files
            SET title=$3,content=$4,sha=$5,version=version+1,updated_at=now()
          WHERE conversation_id=$1 AND item_id=$2`,
        [project, item, title, content, hashText(content)],
      );
      if (Date.now() - new Date(row.updated_at).getTime() > 60_000)
        await this.#emit(c, project, "workspace.document.updated", { itemId: item, title });
    });
    return this.item(project, item);
  }

  async importText(
    projectId: string,
    input: { filename: string; mimeType: string; content: string },
  ): Promise<WorkspaceItem> {
    const project = identifier(projectId);
    await this.#project(project);
    const mimeType = safeText(input.mimeType, 120).toLowerCase();
    const kind = TEXT_IMPORTS[mimeType];
    if (!kind)
      throw new ChatError(
        "UNSUPPORTED_FILE",
        "This file type is not supported in Workspace yet.",
        415,
      );
    const content = safeText(input.content, 262144);
    if (mimeType === "application/json") {
      try {
        JSON.parse(content);
      } catch {
        throw new ChatError("INVALID_FILE", "Imported JSON must be valid JSON.");
      }
    }
    const filename = safeFilename(input.filename);
    const itemId = randomUUID();
    const path = `imports/${itemId}-${filename}`;
    await this.db.transaction(async (c) => {
      await this.#checkLimit(c, project, Buffer.byteLength(content), false);
      await c.query(
        `INSERT INTO odin_api.workspace_files
          (conversation_id,item_id,path,content,sha,kind,title,mime_type,origin,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'import',$9)`,
        [
          project,
          itemId,
          path,
          content,
          hashText(content),
          kind,
          filename,
          mimeType,
          canonicalJson({ originalFilename: filename }, 16000),
        ],
      );
      await this.#emit(c, project, "workspace.file.imported", {
        itemId,
        title: filename,
        mimeType,
      });
    });
    return this.item(project, itemId);
  }

  async createArtifactFromRun(
    projectId: string,
    turnId: string,
    title?: string,
  ): Promise<WorkspaceItem> {
    const project = identifier(projectId);
    const run = identifier(turnId);
    await this.#project(project);
    const artifactId = randomUUID();
    await this.db.transaction(async (c) => {
      const turn = (
        await c.query("SELECT id FROM odin_api.turns WHERE conversation_id=$1 AND id=$2", [
          project,
          run,
        ])
      ).rows[0];
      if (!turn)
        throw new ChatError(
          "INVALID_PROVENANCE",
          "The selected Run does not belong to this Project.",
          409,
        );
      const answer = (
        await c.query(
          "SELECT data,data_hash FROM odin_api.events WHERE conversation_id=$1 AND turn_id=$2 AND type='answer' ORDER BY cursor DESC LIMIT 1",
          [project, run],
        )
      ).rows[0];
      if (!answer)
        throw new ChatError(
          "ARTIFACT_UNAVAILABLE",
          "This Run has no completed result to save.",
          409,
        );
      const encoded = canonicalJson(answer.data, 300000);
      if (hashText(encoded) !== answer.data_hash)
        throw new ChatError("INTEGRITY_FAILURE", "Run output failed integrity verification.", 500);
      const content = safeText(String(answer.data.text ?? ""), 262144);
      if (!content.trim())
        throw new ChatError("ARTIFACT_UNAVAILABLE", "This Run has no textual result to save.", 409);
      const artifactTitle = safeText(title ?? "Run result", 200).trim() || "Run result";
      const path = `artifacts/${artifactId}.md`;
      await this.#checkLimit(c, project, Buffer.byteLength(content), false);
      await c.query(
        `INSERT INTO odin_api.workspace_files
          (conversation_id,item_id,path,content,sha,kind,title,mime_type,origin,source_turn_id,metadata)
         VALUES($1,$2,$3,$4,$5,'GENERATED_ARTIFACT',$6,'text/markdown','runtime',$7,'{}'::jsonb)`,
        [project, artifactId, path, content, hashText(content), artifactTitle, run],
      );
      await this.#emit(c, project, "workspace.artifact.created", {
        itemId: artifactId,
        title: artifactTitle,
        sourceRunId: run,
      });
    });
    return this.item(project, artifactId);
  }

  async context(projectId: string) {
    const project = identifier(projectId);
    await this.#project(project);
    return this.db.transaction(async (c) =>
      (
        await c.query(
          `SELECT x.item_id,x.reason,x.added_at,w.title,w.path,w.kind
             FROM odin_api.workspace_context_items x
             JOIN odin_api.workspace_files w
               ON w.owner_id=x.owner_id AND w.conversation_id=x.conversation_id AND w.item_id=x.item_id
            WHERE x.conversation_id=$1 ORDER BY x.added_at`,
          [project],
        )
      ).rows.map((row) => ({
        itemId: row.item_id,
        title: row.title ?? basename(row.path),
        kind: row.kind,
        reason: row.reason,
        addedAt: iso(row.added_at),
      })),
    );
  }

  async setContext(
    projectId: string,
    itemId: string,
    selected: boolean,
    reason = "Selected by user",
  ) {
    const project = identifier(projectId);
    const item = identifier(itemId);
    const why = safeText(reason, 240).trim() || "Selected by user";
    await this.#project(project);
    await this.db.transaction(async (c) => {
      const exists = (
        await c.query(
          "SELECT 1 FROM odin_api.workspace_files WHERE conversation_id=$1 AND item_id=$2",
          [project, item],
        )
      ).rows[0];
      if (!exists) throw missing();
      if (selected) {
        const count = Number(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM odin_api.workspace_context_items WHERE conversation_id=$1",
              [project],
            )
          ).rows[0]?.n ?? 0,
        );
        if (count >= 16)
          throw new ChatError("CONTEXT_LIMIT", "Remove a context item before adding another.", 409);
        await c.query(
          `INSERT INTO odin_api.workspace_context_items(conversation_id,item_id,reason)
           VALUES($1,$2,$3) ON CONFLICT(owner_id,conversation_id,item_id) DO UPDATE SET reason=excluded.reason`,
          [project, item, why],
        );
      } else {
        await c.query(
          "DELETE FROM odin_api.workspace_context_items WHERE conversation_id=$1 AND item_id=$2",
          [project, item],
        );
      }
      await this.#emit(
        c,
        project,
        selected ? "workspace.context.added" : "workspace.context.removed",
        { itemId: item },
      );
    });
    return this.context(project);
  }

  async layout(projectId: string): Promise<WorkspaceLayout> {
    const project = identifier(projectId);
    await this.#project(project);
    return this.db.transaction(async (c) => {
      const row = (
        await c.query(
          "SELECT open_items,active_item_id,version,updated_at FROM odin_api.workspace_layouts WHERE conversation_id=$1",
          [project],
        )
      ).rows[0];
      if (!row) return { openItemIds: [], activeItemId: null, version: 0, updatedAt: null };
      return {
        openItemIds: Array.isArray(row.open_items) ? row.open_items.map(String) : [],
        activeItemId: row.active_item_id ?? null,
        version: Number(row.version),
        updatedAt: iso(row.updated_at),
      };
    });
  }

  async saveLayout(
    projectId: string,
    openItemIds: readonly string[],
    activeItemId: string | null,
    expectedVersion: number,
  ) {
    const project = identifier(projectId);
    await this.#project(project);
    const ids = [...new Set(openItemIds.map(identifier))].slice(0, 12);
    const active = activeItemId === null ? null : identifier(activeItemId);
    if (active && !ids.includes(active))
      throw new ChatError("INVALID_LAYOUT", "Active item must be an open tab.");
    integer(expectedVersion, 0, 1_000_000);
    await this.db.transaction(async (c) => {
      if (ids.length) {
        const rows = await c.query(
          "SELECT item_id FROM odin_api.workspace_files WHERE conversation_id=$1 AND item_id = ANY($2::uuid[])",
          [project, ids],
        );
        if (rows.rows.length !== ids.length)
          throw new ChatError("INVALID_LAYOUT", "One or more tabs no longer exist.", 409);
      }
      const current = (
        await c.query(
          "SELECT version FROM odin_api.workspace_layouts WHERE conversation_id=$1 FOR UPDATE",
          [project],
        )
      ).rows[0];
      const version = Number(current?.version ?? 0);
      if (version !== expectedVersion)
        throw new ChatError(
          "STALE_LAYOUT",
          "Workspace layout changed; reload before retrying.",
          409,
        );
      if (!current) {
        await c.query(
          "INSERT INTO odin_api.workspace_layouts(conversation_id,open_items,active_item_id,version) VALUES($1,$2,$3,1)",
          [project, canonicalJson(ids, 1200), active],
        );
      } else {
        await c.query(
          "UPDATE odin_api.workspace_layouts SET open_items=$2,active_item_id=$3,version=version+1,updated_at=now() WHERE conversation_id=$1",
          [project, canonicalJson(ids, 1200), active],
        );
      }
    });
    return this.layout(project);
  }

  async #project(projectId: string): Promise<void> {
    const exists = await this.db.transaction(
      async (c) =>
        (await c.query("SELECT 1 FROM odin_api.conversations WHERE id=$1", [projectId])).rows[0],
    );
    if (!exists) throw new ChatError("NOT_FOUND", "Project not found.", 404);
  }

  #item(projectId: string, row: Record<string, unknown>, content?: string): WorkspaceItem {
    return {
      id: String(row.item_id),
      projectId,
      path: String(row.path),
      kind: String(row.kind) as WorkspaceItemKind,
      title: typeof row.title === "string" && row.title ? row.title : basename(String(row.path)),
      mimeType: row.mime_type ?? null,
      origin: String(row.origin) as WorkspaceOrigin,
      sourceRunId: row.source_turn_id ?? null,
      sourceTaskId: row.source_task_id ?? null,
      version: Number(row.version),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      size: Number(row.size ?? Buffer.byteLength(content ?? "")),
      sha: String(row.sha),
      metadata:
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? row.metadata
          : {},
      ...(content === undefined ? {} : { content }),
    };
  }

  async #checkLimit(
    c: Parameters<DatabaseAction<unknown>>[0],
    projectId: string,
    nextBytes: number,
    replacing: boolean,
    oldBytes = 0,
  ) {
    const stats = (
      await c.query(
        "SELECT count(*)::int AS n,coalesce(sum(octet_length(content)),0)::bigint AS bytes FROM odin_api.workspace_files WHERE conversation_id=$1",
        [projectId],
      )
    ).rows[0];
    if (
      (!replacing && Number(stats.n) >= 200) ||
      Number(stats.bytes) - oldBytes + nextBytes > 10_000_000
    )
      throw new ChatError("STORAGE_LIMIT", "Workspace size limit reached.", 409);
  }

  async #emit(
    c: Parameters<DatabaseAction<unknown>>[0],
    projectId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    const encoded = canonicalJson(data, 300000);
    await c.query(
      "INSERT INTO odin_api.events(conversation_id,turn_id,type,data,data_hash) VALUES($1,NULL,$2,$3,$4)",
      [projectId, type, encoded, hashText(encoded)],
    );
  }
}

function basename(path: string): string {
  return path.split("/").at(-1) || "Workspace item";
}

function safeFilename(value: string): string {
  const raw = safeText(value, 180).trim();
  const normalized = raw.normalize("NFKC");
  const cleaned = [...normalized]
    .map((char) => {
      const code = char.charCodeAt(0);
      return char === "/" || char === "\\" || code < 32 || code == 127 ? "-" : char;
    })
    .join("")
    .replace(/^\.+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..")
    throw new ChatError("INVALID_FILE", "Choose a valid filename.");
  return cleaned.slice(0, 160);
}
