import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startChatServer } from "../../src/chat/http.js";
import { fixture } from "./helpers.js";

const TOKEN = "fixture-local-operator-access-token";
const headers = { "Content-Type": "application/json", "X-Odin-Request": "1" };

test("real HTTP service enforces auth/CSRF, submits tasks and resumes durable event replay", async () => {
  const f = await fixture();
  const app = await startChatServer({
    engine: f.engine,
    accessToken: TOKEN,
    webRoot: fileURLToPath(new URL("../../web/", import.meta.url)),
    port: 0,
  });
  try {
    const denied = await fetch(`${app.origin}/api/config`);
    assert.equal(denied.status, 401);
    const csrf = await fetch(`${app.origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(csrf.status, 403);
    const foreign = await fetch(`${app.origin}/api/session`, {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.example" },
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(foreign.status, 403);
    const login = await fetch(`${app.origin}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.match(login.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/u);
    const auth = { ...headers, Cookie: cookie };
    const config = await fetch(`${app.origin}/api/config`, { headers: auth });
    assert.equal(config.status, 200);
    assert.doesNotMatch(await config.text(), new RegExp(TOKEN));
    const sent = await fetch(`${app.origin}/api/conversations/${f.conversation.id}/turns`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        text: "Hello",
        mode: "chat",
        modelId: "fixture",
        requestId: "http-1",
      }),
    });
    assert.equal(sent.status, 202);
    await f.engine.idle();
    const page = (await (
      await fetch(`${app.origin}/api/conversations/${f.conversation.id}/events`, { headers: auth })
    ).json()) as { events: { type: string; cursor: number }[] };
    assert(page.events.some((event: { type: string }) => event.type === "answer"));
    const cursor = page.events.at(-1)?.cursor;
    const reconnect = (await (
      await fetch(`${app.origin}/api/conversations/${f.conversation.id}/events?after=${cursor}`, {
        headers: auth,
      })
    ).json()) as { events: unknown[] };
    assert.equal(reconnect.events.length, 0);
    const controller = new AbortController();
    const sse = await fetch(`${app.origin}/api/conversations/${f.conversation.id}/events?after=0`, {
      headers: { ...auth, Accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = sse.body?.getReader();
    assert(reader);
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /id: \d+\ndata: /u);
    controller.abort();
    const logout = await fetch(`${app.origin}/api/session`, {
      method: "DELETE",
      headers: auth,
      body: "{}",
    });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${app.origin}/api/config`, { headers: auth })).status, 401);
  } finally {
    await app.close();
    await f.close();
  }
});
