import type { IncomingMessage, ServerResponse } from "node:http";
import { attachDatabasePool } from "@vercel/functions";
import { resolveNeonAuthUrl } from "../chat/deployment.js";
import { NeonAuth } from "../chat/neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "../chat/neon-database.js";
import { NeonChatStore } from "../chat/neon-store.js";
import { CredentialVault, planAllows, ProductStore, runtimePlan } from "../chat/product.js";
import { publicError } from "../chat/safety.js";
import { ChatError } from "../chat/types.js";
import { connectorDescriptor } from "./catalog.js";
import { ConnectorService } from "./service.js";
import { ConnectorStore } from "./store.js";
import { ConnectorError } from "./types.js";

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

export async function connectorApiHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const origin = allowedOrigin(req);
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/api" && url.searchParams.has("odin_path"))
      url.pathname = `/api/${url.searchParams.get("odin_path")}`;
    if (!url.pathname.startsWith("/api/connectors"))
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
    if (!["GET", "HEAD"].includes(method) && req.headers["x-odin-request"] !== "1")
      throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);

    if (url.pathname === "/api/connectors/oauth/client-metadata" && method === "GET") {
      const { connectorClientMetadata } = await import("./oauth.js");
      send(res, 200, connectorClientMetadata(origin));
      return;
    }

    services ??= createServices();
    const identity = await services.auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(services.pool, identity);
    const vault = new CredentialVault(process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY);
    const product = new ProductStore(db, vault);
    const plan = runtimePlan(await product.account());
    if (!planAllows(plan, "pro"))
      throw new ChatError(
        "CONNECTOR_ENTITLEMENT_REQUIRED",
        "Connections require Pro or higher.",
        403,
      );
    const store = new ConnectorStore(db, vault);
    const service = new ConnectorService(store, process.env);

    if (url.pathname === "/api/connectors" && method === "GET") {
      send(res, 200, await service.catalog());
      return;
    }

    if (url.pathname === "/api/connectors/oauth/callback" && method === "GET") {
      if (url.searchParams.get("error"))
        throw new ConnectorError(
          "AUTH_RESPONSE_INVALID",
          "Connector authorization was not completed.",
          400,
        );
      const connection = await service.finishOAuth({
        state: url.searchParams.get("state") ?? "",
        code: url.searchParams.get("code") ?? "",
        ...(url.searchParams.get("iss")
          ? { issuer: url.searchParams.get("iss") ?? undefined }
          : {}),
      });
      res.statusCode = 303;
      res.setHeader(
        "Location",
        `/app?connector=${encodeURIComponent(connection.connectorId)}&connected=1`,
      );
      res.end();
      return;
    }

    const connect = /^\/api\/connectors\/([a-z0-9.-]+)\/connect$/u.exec(url.pathname);
    if (connect && method === "POST") {
      await rate(db, "connector-connect", 12);
      const connectorId = connect[1] ?? "";
      const descriptor = connectorDescriptor(connectorId);
      if (descriptor.id === "custom-mcp" && !planAllows(plan, "developer"))
        throw new ChatError(
          "CONNECTOR_ENTITLEMENT_REQUIRED",
          "Custom MCP requires Developer or Ultra.",
          403,
        );
      const body = await jsonBody(req);
      only(body, ["authMode", "endpoint", "scopes", "apiKey"]);
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : undefined;
      if (body.authMode === "none") {
        send(res, 201, {
          connection: await service.connectNoAuth({
            connectorId,
            ...(endpoint ? { endpoint } : {}),
          }),
        });
        return;
      }
      if (body.authMode === "api_key") {
        if (typeof body.apiKey !== "string")
          throw new ChatError("INVALID_CREDENTIAL", "Connector credential is required.");
        send(res, 201, {
          connection: await service.connectApiKey({
            connectorId,
            ...(endpoint ? { endpoint } : {}),
            apiKey: body.apiKey,
          }),
        });
        return;
      }
      const scopes =
        Array.isArray(body.scopes) && body.scopes.every((item) => typeof item === "string")
          ? body.scopes.slice(0, 40)
          : [];
      send(
        res,
        201,
        await service.startOAuth({
          connectorId,
          origin,
          ...(endpoint ? { endpoint } : {}),
          scopes,
        }),
      );
      return;
    }

    const connection =
      /^\/api\/connectors\/connections\/([A-Za-z0-9_.-]+)(?:\/(tools|refresh))?$/u.exec(
        url.pathname,
      );
    if (connection) {
      const id = connection[1] ?? "";
      if (!connection[2] && method === "DELETE") {
        await jsonBody(req);
        await store.deleteConnection(id);
        send(res, 200, { disconnected: true });
        return;
      }
      if (connection[2] === "tools" && method === "GET") {
        send(res, 200, { tools: await service.refreshTools(id) });
        return;
      }
      if (connection[2] === "refresh" && method === "POST") {
        await rate(db, `connector-refresh:${id}`, 6);
        await jsonBody(req);
        send(res, 200, { tools: await service.refreshTools(id, true) });
        return;
      }
    }

    const approval = /^\/api\/connectors\/approvals\/([A-Za-z0-9_-]+)\/([a-f0-9]{32,64})$/u.exec(
      url.pathname,
    );
    if (approval && method === "POST") {
      const body = await jsonBody(req);
      only(body, ["decision"]);
      if (!["approve", "deny"].includes(String(body.decision)))
        throw new ChatError("INVALID_INPUT", "Choose approve or deny.");
      const chat = new NeonChatStore(db);
      const turn = await chat.turn(approval[1] ?? "");
      const request = await approvalRequest(chat, turn.conversationId, turn.id, approval[2] ?? "");
      if (Date.parse(String(request.expiresAt ?? "")) <= Date.now())
        throw new ChatError(
          "APPROVAL_EXPIRED",
          "This approval request expired. Ask Odin to prepare it again.",
          409,
        );
      const resolved = await approvalResolution(
        chat,
        turn.conversationId,
        turn.id,
        approval[2] ?? "",
      );
      if (resolved)
        throw new ChatError(
          "APPROVAL_RESOLVED",
          "This approval request was already resolved.",
          409,
        );
      const granted = body.decision === "approve";
      await chat.emit(turn, granted ? "approval.granted" : "approval.denied", {
        approvalId: approval[2],
        tool: request.tool,
        inputHash: request.inputHash,
        expiresAt: request.expiresAt,
        risk: "high",
        action: request.action,
      });
      send(res, 200, { granted, turnId: turn.id });
      return;
    }

    throw new ChatError("NOT_FOUND", "Connector endpoint not found.", 404);
  } catch (error) {
    const translated =
      error instanceof ConnectorError
        ? new ChatError(error.code, error.message, error.status)
        : error;
    send(res, translated instanceof ChatError ? translated.status : 500, publicError(translated));
  }
}

async function approvalRequest(
  store: NeonChatStore,
  conversationId: string,
  turnId: string,
  approvalId: string,
) {
  let cursor = 0;
  while (true) {
    const events = await store.events(conversationId, cursor, 1000);
    for (const event of events)
      if (
        event.turnId === turnId &&
        event.type === "approval.requested" &&
        event.data.approvalId === approvalId
      )
        return event.data;
    cursor = events.at(-1)?.cursor ?? cursor;
    if (events.length < 1000) break;
  }
  throw new ChatError("APPROVAL_NOT_FOUND", "Approval request not found.", 404);
}

async function approvalResolution(
  store: NeonChatStore,
  conversationId: string,
  turnId: string,
  approvalId: string,
) {
  let cursor = 0;
  while (true) {
    const events = await store.events(conversationId, cursor, 1000);
    for (const event of events)
      if (
        event.turnId === turnId &&
        ["approval.granted", "approval.denied"].includes(event.type) &&
        event.data.approvalId === approvalId
      )
        return event;
    cursor = events.at(-1)?.cursor ?? cursor;
    if (events.length < 1000) break;
  }
  return undefined;
}

async function rate(db: NeonActorDatabase, scope: string, limit: number): Promise<void> {
  await db.transaction(async (client) => {
    await client.query("DELETE FROM odin_api.rate_limits WHERE expires_at<now()");
    const rows = (
      await client.query(
        `INSERT INTO odin_api.rate_limits(scope,hits,expires_at) VALUES($1,1,now()+interval '1 minute')
       ON CONFLICT(owner_id,scope) DO UPDATE SET hits=odin_api.rate_limits.hits+1
       WHERE odin_api.rate_limits.hits<$2 RETURNING hits`,
        [scope, limit],
      )
    ).rows;
    if (!rows.length) throw new ChatError("RATE_LIMIT", "Too many connector requests.", 429);
  });
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

async function jsonBody(req: IncomingMessage, maxBytes = 96_000): Promise<Record<string, unknown>> {
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
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ChatError("INVALID_JSON", "Invalid JSON body.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChatError("INVALID_JSON", "Request body must be an object.");
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new ChatError("INVALID_INPUT", "Connector request contained unsupported fields.");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
