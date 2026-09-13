import type { IncomingMessage, ServerResponse } from "node:http";
import { attachDatabasePool } from "@vercel/functions";
import { BuildProductStore, type BuildStack, type BuildTarget } from "./build-mode.js";
import { resolveNeonAuthUrl } from "./deployment.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { object, publicError } from "./safety.js";
import { ChatError } from "./types.js";

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

export async function buildApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    if (url.pathname !== "/api/build" && !url.pathname.startsWith("/api/build/"))
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);

    services ??= createServices();
    const identity = await services.auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(services.pool, identity);
    const build = new BuildProductStore(db, identity.id);

    if (url.pathname === "/api/build" && method === "POST") {
      const body = object(await jsonBody(req), ["goal", "target", "stack"]);
      if (body.target !== undefined && body.target !== "greenfield")
        throw new ChatError(
          "BUILD_PROJECT_REQUIRED",
          "Start existing-app Build Mode from an existing Project.",
        );
      send(
        res,
        201,
        await build.start({
          goal: String(body.goal ?? ""),
          target: "greenfield",
          stack: "static-web",
        }),
      );
      return;
    }

    const project = /^\/api\/build\/projects\/([\w-]+)$/u.exec(url.pathname);
    if (project && method === "GET") {
      send(res, 200, await build.summary(project[1] ?? ""));
      return;
    }
    if (project && method === "POST") {
      const body = object(await jsonBody(req), ["goal", "target", "stack"]);
      send(
        res,
        201,
        await build.start({
          projectId: project[1] ?? "",
          goal: String(body.goal ?? ""),
          target: buildTarget(body.target),
          stack: buildStack(body.stack, body.target),
        }),
      );
      return;
    }

    const iterate = /^\/api\/build\/projects\/([\w-]+)\/iterate$/u.exec(url.pathname);
    if (iterate && method === "POST") {
      const body = object(await jsonBody(req), ["instruction", "targetRef", "rememberDecision"]);
      if (body.rememberDecision !== undefined && typeof body.rememberDecision !== "boolean")
        throw new ChatError("INVALID_BUILD", "rememberDecision must be boolean.");
      send(
        res,
        202,
        await build.requestIteration(iterate[1] ?? "", {
          instruction: String(body.instruction ?? ""),
          targetRef: typeof body.targetRef === "string" ? body.targetRef : null,
          rememberDecision: body.rememberDecision === true,
        }),
      );
      return;
    }

    const targets = /^\/api\/build\/projects\/([\w-]+)\/targets$/u.exec(url.pathname);
    if (targets && method === "GET") {
      send(res, 200, { targets: await build.targets(targets[1] ?? "") });
      return;
    }

    const bind = /^\/api\/build\/projects\/([\w-]+)\/runs\/([\w-]+)$/u.exec(url.pathname);
    if (bind && method === "POST") {
      const body = object(await jsonBody(req), ["requestId"]);
      if (typeof body.requestId !== "string")
        throw new ChatError("INVALID_BUILD", "Build request identity is required.");
      send(res, 200, await build.bindRun(bind[1] ?? "", bind[2] ?? "", body.requestId));
      return;
    }

    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    send(res, error instanceof ChatError ? error.status : 500, publicError(error));
  }
}

function buildTarget(value: unknown): BuildTarget {
  if (value !== "greenfield" && value !== "existing")
    throw new ChatError("INVALID_BUILD_TARGET", "Choose greenfield or existing.");
  return value;
}

function buildStack(value: unknown, target: unknown): BuildStack {
  const expected = target === "existing" ? "existing" : "static-web";
  if (value !== undefined && value !== expected)
    throw new ChatError("INVALID_BUILD_STACK", "Choose the supported stack for this Build target.");
  return expected;
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
