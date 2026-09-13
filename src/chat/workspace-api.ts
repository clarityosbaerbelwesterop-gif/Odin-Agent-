import type { IncomingMessage, ServerResponse } from "node:http";
import { attachDatabasePool } from "@vercel/functions";
import { resolveNeonAuthUrl } from "./deployment.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { object, publicError } from "./safety.js";
import { ChatError } from "./types.js";
import { WorkspaceOsStore } from "./workspace-os.js";

let services: ReturnType<typeof createServices> | undefined;

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

export async function workspaceApiHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
    if (!url.pathname.startsWith("/api/workspace/"))
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);

    services ??= createServices();
    const identity = await services.auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(services.pool, identity);
    const workspace = new WorkspaceOsStore(db);

    const root = /^\/api\/workspace\/projects\/([\w:-]+)$/u.exec(url.pathname);
    if (root && method === "GET") {
      send(res, 200, await workspace.summary(root[1] ?? ""));
      return;
    }

    const items = /^\/api\/workspace\/projects\/([\w:-]+)\/items$/u.exec(url.pathname);
    if (items && method === "GET") {
      send(res, 200, {
        items: await workspace.items(items[1] ?? "", url.searchParams.get("q") ?? ""),
      });
      return;
    }

    const item = /^\/api\/workspace\/projects\/([\w:-]+)\/items\/([\w:-]+)$/u.exec(url.pathname);
    if (item && method === "GET") {
      send(res, 200, { item: await workspace.item(item[1] ?? "", item[2] ?? "") });
      return;
    }
    if (item && method === "PUT") {
      const body = object(await jsonBody(req), ["title", "content", "expectedVersion"]);
      if (
        typeof body.title !== "string" ||
        typeof body.content !== "string" ||
        typeof body.expectedVersion !== "number"
      )
        throw new ChatError(
          "INVALID_DOCUMENT",
          "Document title, content and expectedVersion are required.",
        );
      send(res, 200, {
        item: await workspace.updateDocument(item[1] ?? "", item[2] ?? "", {
          title: body.title,
          content: body.content,
          expectedVersion: body.expectedVersion,
        }),
      });
      return;
    }

    const documents = /^\/api\/workspace\/projects\/([\w:-]+)\/documents$/u.exec(url.pathname);
    if (documents && method === "POST") {
      const body = object(await jsonBody(req), ["title", "content", "format"]);
      if (typeof body.title !== "string")
        throw new ChatError("INVALID_DOCUMENT", "Document title is required.");
      const format = body.format === "text" || body.format === "note" ? body.format : "markdown";
      send(res, 201, {
        item: await workspace.createDocument(documents[1] ?? "", {
          title: body.title,
          content: typeof body.content === "string" ? body.content : "",
          format,
        }),
      });
      return;
    }

    const imports = /^\/api\/workspace\/projects\/([\w:-]+)\/import$/u.exec(url.pathname);
    if (imports && method === "POST") {
      const body = object(await jsonBody(req, 350_000), ["filename", "mimeType", "content"]);
      if (
        typeof body.filename !== "string" ||
        typeof body.mimeType !== "string" ||
        typeof body.content !== "string"
      )
        throw new ChatError("INVALID_FILE", "filename, mimeType and textual content are required.");
      send(res, 201, {
        item: await workspace.importText(
          imports[1] ?? "",
          body as { filename: string; mimeType: string; content: string },
        ),
      });
      return;
    }

    const artifact = /^\/api\/workspace\/projects\/([\w:-]+)\/artifacts\/from-run$/u.exec(
      url.pathname,
    );
    if (artifact && method === "POST") {
      const body = object(await jsonBody(req), ["turnId", "title"]);
      if (typeof body.turnId !== "string")
        throw new ChatError("INVALID_PROVENANCE", "A Run is required.");
      send(res, 201, {
        item: await workspace.createArtifactFromRun(
          artifact[1] ?? "",
          body.turnId,
          typeof body.title === "string" ? body.title : undefined,
        ),
      });
      return;
    }

    const context = /^\/api\/workspace\/projects\/([\w:-]+)\/context$/u.exec(url.pathname);
    if (context && method === "POST") {
      const body = object(await jsonBody(req), ["itemId", "selected", "reason"]);
      if (typeof body.itemId !== "string" || typeof body.selected !== "boolean")
        throw new ChatError("INVALID_CONTEXT", "itemId and selected are required.");
      send(res, 200, {
        context: await workspace.setContext(
          context[1] ?? "",
          body.itemId,
          body.selected,
          typeof body.reason === "string" ? body.reason : undefined,
        ),
      });
      return;
    }

    const layout = /^\/api\/workspace\/projects\/([\w:-]+)\/layout$/u.exec(url.pathname);
    if (layout && method === "PUT") {
      const body = object(await jsonBody(req), ["openItemIds", "activeItemId", "expectedVersion"]);
      if (!Array.isArray(body.openItemIds) || typeof body.expectedVersion !== "number")
        throw new ChatError("INVALID_LAYOUT", "openItemIds and expectedVersion are required.");
      if (
        body.activeItemId !== null &&
        body.activeItemId !== undefined &&
        typeof body.activeItemId !== "string"
      )
        throw new ChatError("INVALID_LAYOUT", "activeItemId must be an item id or null.");
      send(res, 200, {
        layout: await workspace.saveLayout(
          layout[1] ?? "",
          body.openItemIds.map(String),
          typeof body.activeItemId === "string" ? body.activeItemId : null,
          body.expectedVersion,
        ),
      });
      return;
    }

    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    send(res, error instanceof ChatError ? error.status : 500, publicError(error));
  }
}

async function jsonBody(req: IncomingMessage, maxBytes = 300_000): Promise<unknown> {
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
