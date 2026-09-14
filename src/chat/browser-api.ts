import type { IncomingMessage, ServerResponse } from "node:http";
import { attachDatabasePool } from "@vercel/functions";
import { BrowserProductStore } from "./browser-store.js";
import { resolveNeonAuthUrl } from "./deployment.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { object, publicError, safeText } from "./safety.js";
import { ChatError } from "./types.js";
import type { BrowserActionRequest, BrowserOperation, BrowserOutcome, BrowserRiskProfile } from "./browser-mode.js";

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

export async function browserApiHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    if (!url.pathname.startsWith("/api/browser/"))
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);

    services ??= createServices();
    const identity = await services.auth.session(req.headers.cookie ?? "", origin);
    const browser = new BrowserProductStore(new NeonActorDatabase(services.pool, identity), identity.id);

    const sessions = /^\/api\/browser\/projects\/([\w-]+)\/sessions$/u.exec(url.pathname);
    if (sessions && method === "GET") {
      send(res, 200, { sessions: await browser.list(sessions[1] ?? "") });
      return;
    }
    if (sessions && method === "POST") {
      const body = object(await jsonBody(req), ["runId", "allowedOrigins", "riskProfile"]);
      if (typeof body.runId !== "string" || !Array.isArray(body.allowedOrigins) || !body.allowedOrigins.every((item) => typeof item === "string"))
        throw new ChatError("BROWSER_INPUT", "Run and allowed HTTPS origins are required.");
      const risk = body.riskProfile ?? "ASSISTED";
      if (risk !== "READ_ONLY" && risk !== "ASSISTED" && risk !== "CONTROLLED")
        throw new ChatError("BROWSER_INPUT", "Choose a valid browser risk profile.");
      send(res, 201, { session: await browser.start(sessions[1] ?? "", body.runId, body.allowedOrigins, risk as BrowserRiskProfile) });
      return;
    }

    const route = /^\/api\/browser\/projects\/([\w-]+)\/sessions\/([\w-]+)(?:\/(observe|prepare|approve|execute|reconcile|pause|resume|complete))?$/u.exec(url.pathname);
    if (!route) throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
    const projectId = route[1] ?? "";
    const sessionId = route[2] ?? "";
    const action = route[3];
    if (!action && method === "GET") {
      send(res, 200, { session: await browser.session(projectId, sessionId) });
      return;
    }
    if (method !== "POST") throw new ChatError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);

    if (action === "observe") {
      const body = object(await jsonBody(req), ["url"]);
      if (typeof body.url !== "string") throw new ChatError("BROWSER_INPUT", "A page URL is required.");
      send(res, 200, await browser.observe(projectId, sessionId, body.url));
      return;
    }
    if (action === "prepare") {
      send(res, 200, await browser.prepareAction(projectId, sessionId, actionRequest(await jsonBody(req))));
      return;
    }
    if (action === "approve") {
      const body = object(await jsonBody(req), ["actionId"]);
      if (typeof body.actionId !== "string") throw new ChatError("BROWSER_INPUT", "Approval action ID is required.");
      await browser.approve(projectId, sessionId, body.actionId);
      send(res, 200, { approved: true, actionId: body.actionId });
      return;
    }
    if (action === "execute") {
      const body = object(await jsonBody(req), ["operation", "url", "fields", "workspaceItemId", "actionId"]);
      const request = actionRequest(body);
      send(res, 200, await browser.execute(projectId, sessionId, request, typeof body.actionId === "string" ? body.actionId : undefined));
      return;
    }
    if (action === "reconcile") {
      const body = object(await jsonBody(req), ["outcome"]);
      if (body.outcome !== "EXECUTED" && body.outcome !== "NOT_EXECUTED")
        throw new ChatError("BROWSER_INPUT", "Reconciliation requires verified executed/not-executed state.");
      send(res, 200, { session: await browser.reconcile(projectId, sessionId, body.outcome as BrowserOutcome) });
      return;
    }
    if (action === "pause" || action === "resume" || action === "complete") {
      send(res, 200, { session: await browser.control(projectId, sessionId, action) });
      return;
    }
    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    send(res, error instanceof ChatError ? error.status : 500, publicError(error));
  }
}

function actionRequest(raw: unknown): BrowserActionRequest {
  const body = object(raw, ["operation", "url", "fields", "workspaceItemId", "actionId"]);
  const operation = body.operation;
  const allowed: readonly BrowserOperation[] = ["navigate", "read", "search", "extract", "download", "fill", "click", "submit", "upload", "send", "publish", "delete", "purchase"];
  if (typeof operation !== "string" || !allowed.includes(operation as BrowserOperation) || typeof body.url !== "string")
    throw new ChatError("BROWSER_INPUT", "Valid browser operation and URL are required.");
  let fields: Record<string, string> | undefined;
  if (body.fields !== undefined) {
    if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields))
      throw new ChatError("BROWSER_INPUT", "Form fields must be a string map.");
    fields = {};
    for (const [key, value] of Object.entries(body.fields)) {
      if (typeof value !== "string") throw new ChatError("BROWSER_INPUT", "Form field values must be text.");
      fields[safeText(key, 300)] = safeText(value, 4_000);
    }
  }
  return {
    operation: operation as BrowserOperation,
    url: safeText(body.url, 4_000),
    ...(fields === undefined ? {} : { fields }),
    ...(typeof body.workspaceItemId === "string" ? { workspaceItemId: body.workspaceItemId } : {}),
  };
}

function allowedOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? "";
  const configured = [
    process.env.ODIN_PUBLIC_ORIGIN,
    ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
      .filter(Boolean)
      .map((value) => `https://${value}`),
  ].filter((value): value is string => Boolean(value));
  const origin = `https://${host}`;
  if (!configured.includes(origin) || (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site")
    throw new ChatError("ORIGIN_DENIED", "Unrecognized application origin.", 403);
  return origin;
}

async function jsonBody(req: IncomingMessage, maxBytes = 80_000): Promise<unknown> {
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
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new ChatError("INVALID_JSON", "Invalid JSON body."); }
}
function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
