import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { ChatEngine } from "./engine.js";
import { assemblePreview, PREVIEW_CSP } from "./preview.js";
import { identifier, integer, object, publicError } from "./safety.js";
import { ChatError } from "./types.js";

export interface ChatHttpOptions {
  engine: ChatEngine;
  accessToken: string;
  webRoot: string;
  host?: "127.0.0.1" | "::1" | "0.0.0.0";
  port?: number;
  publicOrigin?: string;
  benchmark?: unknown;
}

export async function startChatServer(options: ChatHttpOptions) {
  if (options.accessToken.length < 24)
    throw new ChatError("AUTH_CONFIG", "Configure an access token of at least 24 characters.");
  if (options.publicOrigin) {
    const configured = new URL(options.publicOrigin);
    if (
      configured.origin !== options.publicOrigin ||
      !["https:", "http:"].includes(configured.protocol)
    )
      throw new ChatError("ORIGIN_CONFIG", "Configure an exact HTTP(S) origin.");
  }
  const tokenHash = digest(options.accessToken);
  const sessions = new Map<string, { expires: number; streams: number }>();
  const attempts = new Map<string, { count: number; reset: number }>();
  let origin = "";
  const connections = new Set<ServerResponse>();
  const allowedAssets: Record<string, [string, string]> = {
    "/": ["chat.html", "text/html"],
    "/chat.js": ["chat.js", "text/javascript"],
    "/chat.css": ["chat.css", "text/css"],
    "/reference": ["index.html", "text/html"],
    "/app.js": ["app.js", "text/javascript"],
    "/styles.css": ["styles.css", "text/css"],
  };
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    try {
      const url = new URL(req.url ?? "/", origin);
      const method = req.method ?? "GET";
      if (req.headers.host !== new URL(origin).host)
        throw new ChatError("HOST_DENIED", "Unrecognized host.", 403);
      if (req.headers.origin !== undefined && req.headers.origin !== origin)
        throw new ChatError("ORIGIN_DENIED", "Cross-origin requests are denied.", 403);
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new ChatError("ORIGIN_DENIED", "Cross-site requests are denied.", 403);
      if (!["GET", "HEAD"].includes(method) && req.headers["x-odin-request"] !== "1")
        throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);
      if (method === "GET" && Object.hasOwn(allowedAssets, url.pathname)) {
        const asset = allowedAssets[url.pathname];
        if (!asset) throw new ChatError("NOT_FOUND", "Not found.", 404);
        res.setHeader("Content-Type", `${asset[1]}; charset=utf-8`);
        res.end(await readFile(join(options.webRoot, asset[0])));
        return;
      }
      if (method === "GET" && url.pathname === "/api/auth/config") {
        send(res, 200, { provider: "local" });
        return;
      }
      if (url.pathname === "/api/session" && method === "POST") {
        const address = req.socket.remoteAddress ?? "unknown";
        const previous = attempts.get(address);
        const rate =
          previous && previous.reset > Date.now()
            ? previous
            : { count: 0, reset: Date.now() + 60_000 };
        if (++rate.count > 10)
          throw new ChatError(
            "LOGIN_RATE_LIMIT",
            "Too many sign-in attempts. Try again in a minute.",
            429,
          );
        if (attempts.size > 1000)
          for (const [key, entry] of attempts) if (entry.reset <= Date.now()) attempts.delete(key);
        if (!attempts.has(address) && attempts.size >= 1000)
          throw new ChatError(
            "LOGIN_RATE_LIMIT",
            "Sign-in capacity reached. Try again shortly.",
            429,
          );
        attempts.set(address, rate);
        const body = object(await jsonBody(req), ["token"]);
        const token = typeof body.token === "string" && body.token.length <= 4096 ? body.token : "";
        if (!timingSafeEqual(tokenHash, digest(token)))
          throw new ChatError("UNAUTHORIZED", "Invalid access token.", 401);
        for (const [key, session] of sessions)
          if (session.expires <= Date.now()) sessions.delete(key);
        if (sessions.size >= 64)
          throw new ChatError("SESSION_LIMIT", "Session limit reached.", 429);
        const secret = randomBytes(32).toString("base64url");
        sessions.set(digest(secret).toString("hex"), {
          expires: Date.now() + 8 * 60 * 60_000,
          streams: 0,
        });
        res.setHeader(
          "Set-Cookie",
          `odin_session=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith("https:") ? "; Secure" : ""}`,
        );
        send(res, 200, { authenticated: true });
        return;
      }
      const cookie = /(?:^|;\s*)odin_session=([A-Za-z0-9_-]{43})(?:;|$)/u.exec(
        req.headers.cookie ?? "",
      )?.[1];
      const sessionKey = digest(cookie ?? "").toString("hex");
      const session = sessions.get(sessionKey);
      if (!session || session.expires <= Date.now())
        throw new ChatError("UNAUTHORIZED", "Sign in to access Odin.", 401);
      if (url.pathname === "/api/session" && method === "DELETE") {
        sessions.delete(sessionKey);
        res.setHeader("Set-Cookie", "odin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
        send(res, 200, { authenticated: false });
        return;
      }
      if (url.pathname === "/api/config" && method === "GET") {
        send(res, 200, options.engine.capabilities());
        return;
      }
      if (url.pathname === "/api/benchmarks" && method === "GET") {
        send(res, 200, options.benchmark ?? { status: "UNAVAILABLE" });
        return;
      }
      if (url.pathname === "/api/conversations") {
        if (method === "GET") {
          send(res, 200, { conversations: await options.engine.store.conversations() });
          return;
        }
        if (method === "POST") {
          const body = object(await jsonBody(req), ["title"]);
          send(
            res,
            201,
            await options.engine.store.createConversation(
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
        if (conversation[2] === "preview" && method === "GET") {
          const files = new Map<string, { path: string; content: string }>();
          let cursor = 0;
          while (true) {
            const events = await options.engine.store.events(id, cursor, 1000);
            for (const event of events)
              if (
                event.type === "file.changed" &&
                typeof event.data.path === "string" &&
                typeof event.data.after === "string"
              )
                files.set(event.data.path, { path: event.data.path, content: event.data.after });
            if (events.length < 1000) break;
            cursor = events.at(-1)?.cursor ?? cursor;
          }
          const html = assemblePreview(
            [...files.values()],
            url.searchParams.get("file") ?? "index.html",
          );
          res.removeHeader("X-Frame-Options");
          res.setHeader("Content-Security-Policy", PREVIEW_CSP);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
          return;
        }
        if (!conversation[2] && method === "GET") {
          send(res, 200, await options.engine.conversation(id));
          return;
        }
        if (conversation[2] === "turns" && method === "POST") {
          const body = object(await jsonBody(req), ["text", "mode", "modelId", "requestId"]);
          send(
            res,
            202,
            await options.engine.submit({
              conversationId: id,
              text: typeof body.text === "string" ? body.text : "",
              mode: body.mode,
              modelId: identifier(body.modelId),
              requestId: identifier(body.requestId),
            }),
          );
          return;
        }
        if (conversation[2] === "events" && method === "GET") {
          let cursor = integer(
            Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0),
            0,
            Number.MAX_SAFE_INTEGER,
          );
          await options.engine.store.conversation(id);
          if (req.headers.accept !== "text/event-stream") {
            send(res, 200, { events: await options.engine.store.events(id, cursor, 1000) });
            return;
          }
          if (session.streams >= 4 || connections.size >= 64)
            throw new ChatError("STREAM_LIMIT", "Too many live connections.", 429);
          session.streams++;
          connections.add(res);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          let busy = false;
          const poll = async () => {
            if (busy || res.destroyed) return;
            if (!sessions.has(sessionKey) || session.expires <= Date.now()) {
              res.end();
              return;
            }
            busy = true;
            try {
              for (const event of await options.engine.store.events(id, cursor, 200)) {
                const accepted = res.write(
                  `id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`,
                );
                cursor = event.cursor;
                if (!accepted) break;
              }
              if (res.writableLength > 2_000_000) res.end();
            } catch {
              res.end();
            } finally {
              busy = false;
            }
          };
          const timer = setInterval(poll, 250);
          const heartbeat = setInterval(() => {
            if (!res.destroyed && res.writableLength === 0) res.write(": heartbeat\n\n");
          }, 15_000);
          res.on("close", () => {
            clearInterval(timer);
            clearInterval(heartbeat);
            connections.delete(res);
            session.streams--;
          });
          poll();
          return;
        }
      }
      const task = /^\/api\/turns\/([\w-]+)(?:\/(control|steer))?$/u.exec(url.pathname);
      if (task) {
        const id = identifier(task[1]);
        if (method === "GET" && !task[2]) {
          send(res, 200, await options.engine.view(id));
          return;
        }
        if (method === "POST" && task[2] === "control") {
          const body = object(await jsonBody(req), ["command", "expectedVersion"]);
          send(
            res,
            200,
            await options.engine.control(
              id,
              String(body.command),
              integer(body.expectedVersion, 1, Number.MAX_SAFE_INTEGER),
            ),
          );
          return;
        }
        if (method === "POST" && task[2] === "steer") {
          const body = object(await jsonBody(req), ["text"]);
          await options.engine.steer(id, typeof body.text === "string" ? body.text : "");
          send(res, 202, { accepted: true });
          return;
        }
      }
      throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
    } catch (error) {
      if (res.headersSent) res.end();
      else send(res, error instanceof ChatError ? error.status : 500, publicError(error));
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 50;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4318, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address unavailable.");
  origin =
    options.publicOrigin ??
    `http://${options.host === "::1" ? "[::1]" : "127.0.0.1"}:${address.port}`;
  return {
    origin,
    server,
    close: async () => {
      for (const res of connections) res.end();
      const closing = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      await closing;
      await options.engine.close();
    },
  };
}

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"))
    throw new ChatError("CONTENT_TYPE", "Use application/json.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > 65_536) throw new ChatError("BODY_LIMIT", "Request body exceeds 64 KiB.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ChatError("INVALID_JSON", "Request body is not valid JSON.");
  }
}
function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
