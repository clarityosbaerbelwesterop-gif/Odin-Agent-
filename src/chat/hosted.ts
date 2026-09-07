import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { attachDatabasePool } from "@vercel/functions";
import { CapabilityRegistry, makeCapabilities } from "../providers/capabilities.js";
import { NvidiaProvider } from "../providers/nvidia.js";
import { ChatEngine } from "./engine.js";
import { DEFAULT_CHAT_LIMITS } from "./modes.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { NeonChatStore, NeonMissionStore } from "./neon-store.js";
import { NeonWorkspace } from "./neon-workspace.js";
import { PREVIEW_CSP } from "./preview.js";
import { WikipediaResearchAdapter } from "./research.js";
import { hashText, identifier, integer, object, publicError } from "./safety.js";
import { ChatError, type ChatModel } from "./types.js";

let services: ReturnType<typeof createServices> | undefined;
function createServices() {
  const connection =
    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const authUrl = process.env.NEON_AUTH_BASE_URL ?? process.env.NEON_AUTH_URL;
  if (!connection || !authUrl)
    throw new ChatError(
      "BACKEND_CONFIG",
      "Neon database and Auth must be configured for this deployment.",
      503,
    );
  const pool = createNeonPool(connection);
  attachDatabasePool(pool);
  const auth = new NeonAuth(authUrl);
  const models: ChatModel[] = [];
  const credential = () => process.env.NV_API_KEY ?? process.env.NVIDIA_API_KEY ?? "";
  if (credential()) {
    const model = "moonshotai/kimi-k3";
    const capabilities = new CapabilityRegistry([
      {
        model,
        provider: "nvidia",
        version: "nvidia-build-2026-09-04",
        provenance: {
          kind: "provider",
          observedAt: "2026-09-04T00:00:00.000Z",
          reference: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer",
        },
        capabilities: makeCapabilities({
          textInput: true,
          toolUse: true,
          streaming: true,
          reasoningEfforts: ["low", "high", "max"],
          contextWindowTokens: 1048576,
          maxOutputTokens: 65536,
        }),
      },
    ]);
    models.push({
      id: "kimi",
      label: "Kimi K3",
      model,
      provider: new NvidiaProvider({
        capabilities,
        credential,
        reasoningParameter: "reasoning_effort",
        defaultTimeoutMs: 180000,
      }),
    });
  }
  return { pool, auth, models };
}
export async function hostedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const security =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", security);
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
        .map((host) => `https://${host}`),
    ].filter((v): v is string => !!v);
    const origin = `https://${host}`;
    if (
      !origins.includes(origin) ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw new ChatError("ORIGIN_DENIED", "Unrecognized application origin.", 403);
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/api" && url.searchParams.has("odin_path"))
      url.pathname = `/api/${url.searchParams.get("odin_path")}`;
    if (!["GET", "HEAD"].includes(method) && req.headers["x-odin-request"] !== "1")
      throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);
    if (url.pathname === "/api/auth/config") {
      send(res, 200, { provider: "neon", emailVerificationRequired: true });
      return;
    }
    services ??= createServices();
    const { auth, pool, models } = services;
    if (url.pathname.startsWith("/api/auth/") && method === "POST") {
      const address =
        String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0] ?? "unknown";
      const limiter = new NeonActorDatabase(pool, { id: "odin-internal-auth-throttle" });
      await rate(limiter, hashText(address), 10, 60);
      const body = object(await jsonBody(req), ["email", "password", "name", "otp"]);
      const operation = url.pathname.slice("/api/auth/".length);
      const actions: Record<string, string> = {
        login: "sign-in/email",
        signup: "sign-up/email",
        logout: "sign-out",
        sendCode: "email-otp/send-verification-otp",
        verify: "email-otp/verify-email",
        forgot: "email-otp/request-password-reset",
        reset: "email-otp/reset-password",
      };
      const path = actions[operation];
      if (!path) throw new ChatError("NOT_FOUND", "Unknown authentication action.", 404);
      const payload: Record<string, string> = {};
      if (operation !== "logout") {
        if (
          typeof body.email !== "string" ||
          body.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(body.email)
        )
          throw new ChatError("INVALID_EMAIL", "Enter a valid email address.");
        payload.email = body.email;
      }
      if (["login", "signup", "reset"].includes(operation)) {
        if (
          typeof body.password !== "string" ||
          body.password.length > 128 ||
          body.password.length < (["signup", "reset"].includes(operation) ? 14 : 1)
        )
          throw new ChatError("INVALID_PASSWORD", "Use a password with at least 14 characters.");
        payload.password = body.password;
      }
      if (operation === "signup")
        payload.name = typeof body.name === "string" ? body.name.slice(0, 100) : "Odin user";
      if (operation === "sendCode") payload.type = "email-verification";
      if (["verify", "reset"].includes(operation)) {
        if (typeof body.otp !== "string" || !/^\d{6}$/u.test(body.otp))
          throw new ChatError("INVALID_CODE", "Enter the six-digit email code.");
        payload.otp = body.otp;
      }
      const upstream = await auth.upstream(path, "POST", origin, req.headers.cookie ?? "", payload);
      const cookies = auth.cookies(upstream);
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      // Auth responses can contain session secrets; only a minimal status crosses this boundary.
      if (!upstream.ok)
        throw new ChatError(
          "AUTH_FAILED",
          "Authentication failed. Check your details and email verification.",
          upstream.status === 429 ? 429 : 400,
        );
      send(res, 200, { ok: true, requiresVerification: operation === "signup" });
      return;
    }
    const identity = await auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(pool, identity);
    const store = new NeonChatStore(db);
    const createEngine = (
      database: NeonActorDatabase,
      conversationId?: string,
      signal?: AbortSignal,
    ) => {
      const quality = conversationId
        ? new NeonWorkspace(database, conversationId, async () => {})
        : undefined;
      return new ChatEngine({
        store: new NeonChatStore(database),
        events: new NeonMissionStore(database),
        models,
        autoRun: false,
        atomic: (action) =>
          database.transaction(async (client) => {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
              `${identity.id}:${conversationId ?? "account"}`,
            ]);
            return action();
          }),
        limits: { ...DEFAULT_CHAT_LIMITS, maxTurnMs: 240000 },
        allowWorkspaceWrites: true,
        ...(quality && conversationId
          ? {
              quality,
              workspace: (changed) => new NeonWorkspace(database, conversationId, changed),
            }
          : {}),
        research: new WikipediaResearchAdapter("de"),
        ...(signal ? { signal } : {}),
      });
    };
    if (url.pathname === "/api/session" && method === "DELETE") {
      const response = await auth.upstream(
        "sign-out",
        "POST",
        origin,
        req.headers.cookie ?? "",
        {},
      );
      if (!response.ok) throw new ChatError("AUTH_FAILED", "Sign-out failed.", 502);
      res.setHeader("Set-Cookie", auth.cookies(response));
      send(res, 200, { authenticated: false });
      return;
    }
    if (url.pathname === "/api/config" && method === "GET") {
      send(res, 200, {
        ...createEngine(db).capabilities(),
        user: { email: identity.email },
        execution: "request",
        workspace: {
          connected: true,
          writable: true,
          kind: "static-web",
          quality: "Syntax checks only; browser execution is isolated in the preview.",
        },
      });
      return;
    }
    if (url.pathname === "/api/benchmarks" && method === "GET") {
      send(
        res,
        200,
        JSON.parse(
          await readFile(
            join(process.cwd(), "docs/evals/paced-kimi-2026-09-07-summary.json"),
            "utf8",
          ).catch(() => '{"status":"UNAVAILABLE"}'),
        ),
      );
      return;
    }
    if (url.pathname === "/api/conversations") {
      if (method === "GET") {
        send(res, 200, { conversations: await store.conversations() });
        return;
      }
      if (method === "POST") {
        await rate(db, "conversations", 10, 60);
        const body = object(await jsonBody(req), ["title"]);
        send(
          res,
          201,
          await store.createConversation(
            typeof body.title === "string" ? body.title : "New conversation",
          ),
        );
        return;
      }
    }
    const conversation = /^\/api\/conversations\/([\w-]+)(?:\/(turns|events|preview))?$/u.exec(
      url.pathname,
    );
    if (conversation) {
      const id = identifier(conversation[1]);
      await store.conversation(id);
      const engine = createEngine(db, id);
      if (!conversation[2] && method === "GET") {
        send(res, 200, await engine.conversation(id));
        return;
      }
      if (conversation[2] === "preview" && method === "GET") {
        const workspace = new NeonWorkspace(db, id, async () => {});
        const html = await workspace.preview(url.searchParams.get("file") ?? "index.html");
        res.setHeader("Content-Security-Policy", PREVIEW_CSP);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }
      if (conversation[2] === "turns" && method === "POST") {
        await rate(db, "turns", 10, 60);
        const token = await db.claim(`submit:${id}`, 15);
        if (!token) throw new ChatError("BUSY", "A submission is already being saved.", 409);
        try {
          const body = object(await jsonBody(req), ["text", "mode", "modelId", "requestId"]);
          send(
            res,
            202,
            await engine.submit({
              conversationId: id,
              text: typeof body.text === "string" ? body.text : "",
              mode: body.mode,
              modelId: identifier(body.modelId),
              requestId: identifier(body.requestId),
            }),
          );
        } finally {
          await db.release(`submit:${id}`, token);
        }
        return;
      }
      if (conversation[2] === "events" && method === "GET") {
        let cursor = integer(
          Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0),
          0,
          Number.MAX_SAFE_INTEGER,
        );
        if (req.headers.accept !== "text/event-stream") {
          send(res, 200, { events: await store.events(id, cursor, 1000) });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        const end = Date.now() + 20000;
        while (!res.destroyed && Date.now() < end) {
          const events = await store.events(id, cursor, 200);
          for (const event of events) {
            if (!res.write(`id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`)) {
              res.end();
              return;
            }
            cursor = event.cursor;
          }
          if (!events.length) res.write(": heartbeat\n\n");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        res.end();
        return;
      }
    }
    const turn = /^\/api\/turns\/([\w-]+)(?:\/(control|steer|run))?$/u.exec(url.pathname);
    if (turn) {
      const id = identifier(turn[1]);
      const found = await store.turn(id);
      const engine = createEngine(db, found.conversationId);
      if (!turn[2] && method === "GET") {
        send(res, 200, await engine.view(id));
        return;
      }
      if (turn[2] === "steer" && method === "POST") {
        await rate(db, "steering", 30, 60);
        const body = object(await jsonBody(req), ["text"]);
        await engine.steer(id, typeof body.text === "string" ? body.text : "");
        send(res, 200, { ok: true });
        return;
      }
      if (turn[2] === "control" && method === "POST") {
        const body = object(await jsonBody(req), ["command", "expectedVersion"]);
        send(
          res,
          200,
          await engine.control(id, String(body.command), Number(body.expectedVersion)),
        );
        return;
      }
      if (turn[2] === "run" && method === "POST") {
        await jsonBody(req);
        const resource = `run:${id}`;
        const lease = await db.claim(resource);
        if (!lease) throw new ChatError("BUSY", "This task already has an active worker.", 409);
        const controller = new AbortController();
        const workerDb = new NeonActorDatabase(pool, identity, { resource, token: lease });
        const worker = createEngine(workerDb, found.conversationId, controller.signal);
        let checking = false,
          lastAuth = Date.now();
        const monitor = setInterval(() => {
          if (checking) return;
          checking = true;
          void (async () => {
            try {
              const view = await engine.view(id);
              if (["PAUSED", "CANCELLED", "BLOCKED", "FAILED"].includes(view.state))
                controller.abort();
              if (Date.now() - lastAuth > 30000) {
                await auth.session(req.headers.cookie ?? "", origin);
                lastAuth = Date.now();
              }
            } catch {
              controller.abort();
            } finally {
              checking = false;
            }
          })();
        }, 1000);
        const disconnect = () => controller.abort();
        res.once("close", disconnect);
        try {
          await worker.execute(id);
          send(res, 200, await engine.view(id));
        } finally {
          clearInterval(monitor);
          res.off("close", disconnect);
          await db.release(resource, lease);
        }
        return;
      }
    }
    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    if (!res.headersSent)
      send(res, error instanceof ChatError ? error.status : 500, publicError(error));
    else res.end();
  }
}
async function rate(
  db: NeonActorDatabase,
  scope: string,
  limit: number,
  seconds: number,
): Promise<void> {
  await db.transaction(async (c) => {
    await c.query("DELETE FROM odin_api.rate_limits WHERE expires_at<now()");
    const rows = (
      await c.query(
        `INSERT INTO odin_api.rate_limits(scope,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(owner_id,scope) DO UPDATE SET hits=odin_api.rate_limits.hits+1 WHERE odin_api.rate_limits.hits<$3 RETURNING hits`,
        [scope, seconds, limit],
      )
    ).rows;
    if (!rows.length)
      throw new ChatError("RATE_LIMIT", "Too many requests. Try again shortly.", 429);
  });
}
async function jsonBody(req: IncomingMessage): Promise<unknown> {
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
    if (size > 64000) throw new ChatError("BODY_LIMIT", "Request is too large.", 413);
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ChatError("INVALID_JSON", "Invalid JSON body.");
  }
}
function send(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
