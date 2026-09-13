import type { IncomingMessage, ServerResponse } from "node:http";
import { attachDatabasePool } from "@vercel/functions";
import {
  AdvancedMemoryEngine,
  AdvancedMemoryError,
  type CurrentSourceObservation,
} from "../memory/advanced.js";
import type { MemoryProductStatus } from "../memory/product.js";
import type { MemoryKind, MemorySensitivity, MemorySourceClass } from "../memory/types.js";
import { containsObviousSecret } from "../security/secret-text.js";
import { resolveNeonAuthUrl } from "./deployment.js";
import { MemoryBrainStore } from "./memory-brain-store.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { object, publicError } from "./safety.js";
import { ChatError } from "./types.js";

let services: ReturnType<typeof createServices> | undefined;
const RETENTION_POLICY = Object.freeze({
  episodicMaxAgeMs: 45 * 24 * 60 * 60 * 1000,
  projectMaxAgeMs: 365 * 24 * 60 * 60 * 1000,
});

function createServices() {
  const connection =
    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const authUrl = resolveNeonAuthUrl(connection, process.env);
  if (!connection || !authUrl)
    throw new ChatError(
      "BACKEND_CONFIG",
      "Neon database and Auth must be configured for this deployment.",
      503,
    );
  const pool = createNeonPool(connection);
  attachDatabasePool(pool);
  return { pool, auth: new NeonAuth(authUrl) };
}

export async function memoryApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const host = req.headers.host ?? "";
    const origins = [
      process.env.ODIN_PUBLIC_ORIGIN,
      ...[
        process.env.VERCEL_URL,
        process.env.VERCEL_BRANCH_URL,
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
      ]
        .filter(Boolean)
        .map((value) => `https://${value}`),
    ].filter((value): value is string => Boolean(value));
    const origin = `https://${host}`;
    if (
      !origins.includes(origin) ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw new ChatError("ORIGIN_DENIED", "Unrecognized application origin.", 403);

    const method = req.method ?? "GET";
    if (!["GET", "HEAD"].includes(method) && req.headers["x-odin-request"] !== "1")
      throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/api" && url.searchParams.has("odin_path"))
      url.pathname = `/api/${url.searchParams.get("odin_path")}`;
    if (!url.pathname.startsWith("/api/memory/"))
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);

    services ??= createServices();
    const identity = await services.auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(services.pool, identity);
    const brain = new MemoryBrainStore(db, identity.id);
    const advanced = new AdvancedMemoryEngine(brain.memory);

    const root = /^\/api\/memory\/projects\/([\w-]+)$/u.exec(url.pathname);
    if (root && method === "GET") {
      const projectId = root[1] ?? "";
      const text = optional(url.searchParams.get("q"));
      const kinds = list(url.searchParams.get("kind")) as MemoryKind[] | undefined;
      const statuses = list(url.searchParams.get("status")) as MemoryProductStatus[] | undefined;
      const sourceClasses = list(url.searchParams.get("source")) as
        | MemorySourceClass[]
        | undefined;
      const [projection, analysis] = await Promise.all([
        brain.projection(projectId, {
          ...(text === undefined ? {} : { text }),
          ...(kinds === undefined ? {} : { kinds }),
          ...(statuses === undefined ? {} : { statuses }),
          ...(sourceClasses === undefined ? {} : { sourceClasses }),
        }),
        analyzeMemory(db, advanced, identity.id, projectId),
      ]);
      send(res, 200, {
        ...projection,
        advanced: {
          conflicts: analysis.conflicts,
          stale: analysis.stale,
          resultHash: analysis.resultHash,
        },
      });
      return;
    }

    const retention = /^\/api\/memory\/projects\/([\w-]+)\/retention$/u.exec(url.pathname);
    if (retention && method === "GET") {
      const projectId = retention[1] ?? "";
      await requireProject(db, projectId);
      send(res, 200, {
        plan: await advanced.planRetention({
          evaluatedAt: new Date().toISOString(),
          policy: RETENTION_POLICY,
          projectId,
          userId: identity.id,
        }),
        destructiveAction: "explicit_only",
      });
      return;
    }

    const history = /^\/api\/memory\/projects\/([\w-]+)\/records\/([\w-]+)\/history$/u.exec(
      url.pathname,
    );
    if (history && method === "GET") {
      const projectId = history[1] ?? "";
      const memoryId = history[2] ?? "";
      await requireProject(db, projectId);
      const record = await brain.memory.get(memoryId, { userId: identity.id, projectId });
      if (!record) throw new ChatError("NOT_FOUND", "Memory not found.", 404);
      send(res, 200, {
        history: await brain.memory.history(memoryId, { userId: identity.id, projectId }),
      });
      return;
    }

    const signal = /^\/api\/memory\/projects\/([\w-]+)\/signals\/([\w-]+)$/u.exec(url.pathname);
    if (signal && method === "POST") {
      const body = object(await jsonBody(req), ["pinned", "archived"]);
      if (body.pinned !== undefined && typeof body.pinned !== "boolean")
        throw new ChatError("INVALID_MEMORY_ACTION", "pinned must be boolean.");
      if (body.archived !== undefined && typeof body.archived !== "boolean")
        throw new ChatError("INVALID_MEMORY_ACTION", "archived must be boolean.");
      await brain.setSignal(signal[1] ?? "", signal[2] ?? "", {
        ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
        ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
      });
      send(res, 200, { updated: true });
      return;
    }

    const record = /^\/api\/memory\/projects\/([\w-]+)\/records\/([\w-]+)$/u.exec(url.pathname);
    if (record && method === "GET") {
      const projectId = record[1] ?? "";
      const memoryId = record[2] ?? "";
      await requireProject(db, projectId);
      const stored = await brain.memory.get(memoryId, { userId: identity.id, projectId });
      if (!stored) throw new ChatError("NOT_FOUND", "Memory not found.", 404);
      send(res, 200, {
        record:
          stored.status === "active" && stored.sensitivity === "sensitive"
            ? { ...stored, content: null, contentHidden: true }
            : stored,
      });
      return;
    }
    if (record && method === "DELETE") {
      const body = object(await jsonBody(req), ["expectedVersion"]);
      if (typeof body.expectedVersion !== "number")
        throw new ChatError("INVALID_MEMORY_VERSION", "expectedVersion is required.");
      await brain.clear(record[1] ?? "", record[2] ?? "", body.expectedVersion);
      send(res, 200, { cleared: true });
      return;
    }

    const compression = /^\/api\/memory\/projects\/([\w-]+)\/compression$/u.exec(url.pathname);
    if (compression && method === "POST") {
      const projectId = compression[1] ?? "";
      await requireProject(db, projectId);
      const body = object(await jsonBody(req), [
        "key",
        "sourceRecordIds",
        "summary",
        "sensitivity",
        "idempotencyKey",
      ]);
      if (
        typeof body.key !== "string" ||
        typeof body.summary !== "string" ||
        !Array.isArray(body.sourceRecordIds) ||
        !body.sourceRecordIds.every((value) => typeof value === "string") ||
        typeof body.idempotencyKey !== "string" ||
        !["public", "internal", "sensitive"].includes(String(body.sensitivity))
      )
        throw new ChatError("INVALID_MEMORY", "Compression input is invalid.");
      const proposal = await advanced.proposeCompression({
        key: body.key,
        projectId,
        sensitivity: body.sensitivity,
        sourceRecordIds: body.sourceRecordIds,
        summary: body.summary,
        userId: identity.id,
      });
      const committed = await advanced.commitCompression(proposal, body.idempotencyKey);
      send(res, 201, { proposal, committed });
      return;
    }

    const promote = /^\/api\/memory\/projects\/([\w-]+)\/from-workspace$/u.exec(url.pathname);
    if (promote && method === "POST") {
      const projectId = promote[1] ?? "";
      const body = object(await jsonBody(req), ["itemId", "key", "kind"]);
      if (typeof body.itemId !== "string")
        throw new ChatError("INVALID_MEMORY", "A Workspace item is required.");
      if (body.kind !== undefined && body.kind !== "project" && body.kind !== "semantic")
        throw new ChatError("INVALID_MEMORY", "Workspace memory must be project or semantic.");
      const source = await db.transaction(async (client) =>
        (
          await client.query(
            "SELECT content FROM odin_api.workspace_files WHERE conversation_id=$1 AND item_id=$2",
            [projectId, body.itemId],
          )
        ).rows[0],
      );
      if (!source) throw new ChatError("NOT_FOUND", "Workspace item not found.", 404);
      if (containsObviousSecret(String(source.content)))
        throw new ChatError(
          "SECRET_MEMORY_DENIED",
          "Secret-like Workspace content cannot be promoted into durable Memory.",
          400,
        );
      send(res, 201, {
        memory: await brain.promoteWorkspaceItem(projectId, body.itemId, {
          ...(typeof body.key === "string" ? { key: body.key } : {}),
          ...(body.kind === "project" || body.kind === "semantic" ? { kind: body.kind } : {}),
        }),
      });
      return;
    }

    const explicit = /^\/api\/memory\/projects\/([\w-]+)\/records$/u.exec(url.pathname);
    if (explicit && method === "POST") {
      const body = object(await jsonBody(req), ["key", "content", "kind", "sensitivity"]);
      const sensitivities = new Set<MemorySensitivity>(["public", "internal", "sensitive"]);
      if (
        typeof body.key !== "string" ||
        typeof body.content !== "string" ||
        !["project", "semantic", "user_preference"].includes(String(body.kind)) ||
        !sensitivities.has(String(body.sensitivity ?? "internal") as MemorySensitivity)
      )
        throw new ChatError(
          "INVALID_MEMORY",
          "Provide a valid key, content, kind and sensitivity.",
        );
      if (containsObviousSecret(body.content))
        throw new ChatError(
          "SECRET_MEMORY_DENIED",
          "Secret-like content cannot be persisted as durable product Memory.",
          400,
        );
      send(res, 201, {
        memory: await brain.rememberExplicit(explicit[1] ?? "", {
          key: body.key,
          content: body.content,
          kind: body.kind as "project" | "semantic" | "user_preference",
          sensitivity: String(body.sensitivity ?? "internal") as MemorySensitivity,
        }),
      });
      return;
    }

    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    if (error instanceof AdvancedMemoryError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "DENIED" ? 403 : 409;
      send(res, status, { code: `MEMORY_${error.code}`, message: error.message });
      return;
    }
    send(res, error instanceof ChatError ? error.status : 500, publicError(error));
  }
}

async function analyzeMemory(
  db: NeonActorDatabase,
  advanced: AdvancedMemoryEngine,
  userId: string,
  projectId: string,
) {
  await requireProject(db, projectId);
  const currentSources = await currentSourceObservations(db, projectId);
  return advanced.retrieve({
    currentSources,
    evaluatedAt: new Date().toISOString(),
    limit: 100,
    projectId,
    text: "",
    userId,
  });
}

async function currentSourceObservations(
  db: NeonActorDatabase,
  projectId: string,
): Promise<CurrentSourceObservation[]> {
  return db.transaction(async (client) => {
    const rows = (
      await client.query(
        `SELECT DISTINCT ON(title) title,sha,version,updated_at
           FROM odin_api.workspace_files
          WHERE conversation_id=$1
          ORDER BY title,updated_at DESC,item_id
          LIMIT 64`,
        [projectId],
      )
    ).rows;
    return rows.map((row) => ({
      key: String(row.title),
      contentHash: String(row.sha),
      sourceVersion: String(row.version),
      observedAt: new Date(row.updated_at).toISOString(),
    }));
  });
}

async function requireProject(db: NeonActorDatabase, projectId: string): Promise<void> {
  const found = await db.transaction(async (client) =>
    (
      await client.query("SELECT 1 FROM odin_api.conversations WHERE id=$1", [projectId])
    ).rows.length,
  );
  if (!found) throw new ChatError("NOT_FOUND", "Project not found.", 404);
}

function optional(value: string | null): string | undefined {
  const clean = value?.trim();
  return clean ? clean : undefined;
}

function list(value: string | null): string[] | undefined {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? [...new Set(values)] : undefined;
}

async function jsonBody(req: IncomingMessage, maxBytes = 100_000): Promise<unknown> {
  if (
    !String(req.headers["content-type"] ?? "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new ChatError("CONTENT_TYPE", "Use an application/json request body.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > maxBytes) throw new ChatError("BODY_LIMIT", "Request is too large.", 413);
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ChatError("INVALID_JSON", "Invalid JSON body.");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
