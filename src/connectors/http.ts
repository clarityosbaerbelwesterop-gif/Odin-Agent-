import type { IncomingMessage, ServerResponse } from "node:http";
import type { NeonActorDatabase } from "../chat/neon-database.js";
import {
  CredentialVault,
  effectivePlan,
  planAllows,
  type ProductStore,
} from "../chat/product.js";
import { ChatError } from "../chat/types.js";
import { connectorDescriptor } from "./catalog.js";
import { ConnectorService } from "./service.js";
import { ConnectorStore } from "./store.js";
import { ConnectorError } from "./types.js";

export interface ConnectorHttpContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly origin: string;
  readonly actorId: string;
  readonly db: NeonActorDatabase;
  readonly product: ProductStore;
  readonly env?: NodeJS.ProcessEnv;
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"))
    throw new ChatError("CONTENT_TYPE", "Use an application/json request body.", 415);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 96_000) throw new ChatError("BODY_LIMIT", "Request is too large.", 413);
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

function allowedBody(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new ChatError("INVALID_INPUT", "Connector request contained unsupported fields.");
  return value;
}

function identifier(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/u.test(value))
    throw new ChatError("INVALID_INPUT", "Connector identifier is invalid.");
  return value;
}

function asScopes(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40 || !value.every((item) => typeof item === "string"))
    throw new ChatError("INVALID_INPUT", "Connector scopes must be a bounded string array.");
  return value;
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

function translate(error: unknown): never {
  if (error instanceof ChatError) throw error;
  if (error instanceof ConnectorError)
    throw new ChatError(error.code, error.message, error.status);
  throw error;
}

export async function handleConnectorApi(context: ConnectorHttpContext): Promise<boolean> {
  const { req, res, method, url, origin, actorId, db, product } = context;
  if (!url.pathname.startsWith("/api/connectors")) return false;
  const account = await product.account();
  const plan = effectivePlan(account);
  if (!planAllows(plan, "pro"))
    throw new ChatError("CONNECTOR_ENTITLEMENT_REQUIRED", "Connectors require Pro or higher.", 403);
  const store = new ConnectorStore(
    db,
    new CredentialVault((context.env ?? process.env).ODIN_CREDENTIAL_ENCRYPTION_KEY),
  );
  const service = new ConnectorService(store, context.env ?? process.env);

  try {
    if (url.pathname === "/api/connectors" && method === "GET") {
      send(res, 200, await service.catalog());
      return true;
    }

    if (url.pathname === "/api/connectors/oauth/callback" && method === "GET") {
      const error = url.searchParams.get("error");
      if (error)
        throw new ConnectorError(
          "AUTH_RESPONSE_INVALID",
          "Connector authorization was not completed.",
          400,
        );
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const issuer = url.searchParams.get("iss") ?? undefined;
      const connection = await service.finishOAuth({ state, code, ...(issuer ? { issuer } : {}) });
      res.statusCode = 303;
      res.setHeader(
        "Location",
        `/bot?connector=${encodeURIComponent(connection.connectorId)}&connected=1`,
      );
      res.end();
      return true;
    }

    const connect = /^\/api\/connectors\/([a-z0-9.-]+)\/connect$/u.exec(url.pathname);
    if (connect && method === "POST") {
      await rate(db, "connector-connect", 12);
      const connectorId = identifier(connect[1] ?? "");
      const descriptor = connectorDescriptor(connectorId);
      if (descriptor.id === "custom-mcp" && !planAllows(plan, "developer"))
        throw new ChatError(
          "CONNECTOR_ENTITLEMENT_REQUIRED",
          "Custom MCP connections require Developer or Ultra.",
          403,
        );
      const body = allowedBody(await jsonBody(req), ["authMode", "endpoint", "scopes", "apiKey"]);
      const authMode = body.authMode === "api_key" ? "api_key" : "oauth";
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : undefined;
      if (authMode === "api_key") {
        if (typeof body.apiKey !== "string")
          throw new ChatError("INVALID_CREDENTIAL", "Connector credential is required.");
        const connection = await service.connectApiKey({
          connectorId,
          ...(endpoint ? { endpoint } : {}),
          apiKey: body.apiKey,
        });
        send(res, 201, { connection });
        return true;
      }
      const result = await service.startOAuth({
        connectorId,
        origin,
        ...(endpoint ? { endpoint } : {}),
        scopes: asScopes(body.scopes),
      });
      send(res, 201, result);
      return true;
    }

    const connectionRoute = /^\/api\/connectors\/connections\/([A-Za-z0-9_.-]+)(?:\/(tools|refresh))?$/u.exec(
      url.pathname,
    );
    if (connectionRoute) {
      const connectionId = identifier(connectionRoute[1] ?? "");
      if (!connectionRoute[2] && method === "DELETE") {
        await jsonBody(req);
        await store.deleteConnection(connectionId);
        send(res, 200, { disconnected: true });
        return true;
      }
      if (connectionRoute[2] === "tools" && method === "GET") {
        send(res, 200, { tools: await service.refreshTools(connectionId) });
        return true;
      }
      if (connectionRoute[2] === "refresh" && method === "POST") {
        await rate(db, `connector-refresh:${connectionId}`, 6);
        await jsonBody(req);
        send(res, 200, { tools: await service.refreshTools(connectionId, true) });
        return true;
      }
    }

    throw new ChatError("NOT_FOUND", "Connector endpoint not found.", 404);
  } catch (error) {
    return translate(error);
  } finally {
    void actorId;
  }
}
