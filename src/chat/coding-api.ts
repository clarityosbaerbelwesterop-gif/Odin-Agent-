import type { IncomingMessage, ServerResponse } from "node:http";
import { attachDatabasePool } from "@vercel/functions";
import { CodingProductStore } from "./coding-product.js";
import { resolveNeonAuthUrl } from "./deployment.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { CredentialVault, ProductStore } from "./product.js";
import { integer, object, publicError } from "./safety.js";
import { ChatError } from "./types.js";

let services: ReturnType<typeof createServices> | undefined;

function createServices() {
  const connection = process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const authUrl = resolveNeonAuthUrl(connection, process.env);
  if (!connection || !authUrl)
    throw new ChatError("BACKEND_CONFIG", "Neon database and Auth must be configured for this deployment.", 503);
  const pool = createNeonPool(connection);
  attachDatabasePool(pool);
  return { pool, auth: new NeonAuth(authUrl) };
}

export async function codingApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const origin = allowedOrigin(req);
    const method = req.method ?? "GET";
    if (!["GET", "HEAD"].includes(method) && req.headers["x-odin-request"] !== "1")
      throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/api" && url.searchParams.has("odin_path"))
      url.pathname = `/api/${url.searchParams.get("odin_path")}`;
    if (!url.pathname.startsWith("/api/coding/"))
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);

    services ??= createServices();
    const identity = await services.auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(services.pool, identity);
    const product = new ProductStore(db, new CredentialVault(process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY));
    const connection = await product.github();
    const token = connection.connected ? await product.githubToken() : undefined;
    if (!token || !connection.repository || !connection.defaultBranch)
      throw new ChatError(
        "GITHUB_WORKSPACE_REQUIRED",
        "Connect GitHub and select a repository before opening Coding Mode.",
        409,
      );
    const coding = new CodingProductStore(db, identity.id, {
      token,
      repository: connection.repository,
      defaultBranch: connection.defaultBranch,
    });

    const root = /^\/api\/coding\/projects\/([\w-]+)$/u.exec(url.pathname);
    if (root && method === "GET") {
      send(res, 200, await coding.summary(root[1] ?? ""));
      return;
    }

    const tree = /^\/api\/coding\/projects\/([\w-]+)\/tree$/u.exec(url.pathname);
    if (tree && method === "GET") {
      send(res, 200, { entries: await coding.tree(tree[1] ?? "", url.searchParams.get("q") ?? "") });
      return;
    }

    const file = /^\/api\/coding\/projects\/([\w-]+)\/file$/u.exec(url.pathname);
    if (file && method === "GET") {
      const path = url.searchParams.get("path");
      if (!path) throw new ChatError("CODING_FILE_REQUIRED", "Choose a repository file.");
      send(res, 200, { file: await coding.file(file[1] ?? "", path) });
      return;
    }

    const search = /^\/api\/coding\/projects\/([\w-]+)\/search$/u.exec(url.pathname);
    if (search && method === "GET") {
      send(res, 200, {
        results: await coding.search(
          search[1] ?? "",
          url.searchParams.get("q") ?? "",
          url.searchParams.get("path") ?? ".",
        ),
      });
      return;
    }

    const pull = /^\/api\/coding\/projects\/([\w-]+)\/pull-request$/u.exec(url.pathname);
    if (pull && method === "POST") {
      const body = object(await jsonBody(req), ["turnId", "title"]);
      if (typeof body.turnId !== "string")
        throw new ChatError("CODING_RUN_REQUIRED", "A verified Coding Run is required.");
      send(
        res,
        201,
        await coding.pullRequest(
          pull[1] ?? "",
          body.turnId,
          typeof body.title === "string" ? body.title : undefined,
        ),
      );
      return;
    }

    const review = /^\/api\/coding\/projects\/([\w-]+)\/review\/([0-9]+)$/u.exec(url.pathname);
    if (review && method === "GET") {
      send(res, 200, await coding.review(review[1] ?? "", integer(Number(review[2]), 1, 10_000_000)));
      return;
    }

    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    send(res, error instanceof ChatError ? error.status : 500, publicError(error));
  }
}

function allowedOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? "";
  const configured = [
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
    !configured.includes(origin) ||
    (req.headers.origin && req.headers.origin !== origin) ||
    req.headers["sec-fetch-site"] === "cross-site"
  )
    throw new ChatError("ORIGIN_DENIED", "Unrecognized application origin.", 403);
  return origin;
}

async function jsonBody(req: IncomingMessage, maxBytes = 64_000): Promise<unknown> {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"))
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
