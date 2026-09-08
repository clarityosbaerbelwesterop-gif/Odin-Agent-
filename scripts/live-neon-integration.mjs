import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { ChatEngine } from "../dist/src/chat/engine.js";
import { hostedHandler } from "../dist/src/chat/hosted.js";
import { NeonAuth } from "../dist/src/chat/neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "../dist/src/chat/neon-database.js";
import { NeonChatStore, NeonMissionStore } from "../dist/src/chat/neon-store.js";
import { NeonWorkspace } from "../dist/src/chat/neon-workspace.js";
import { provider, response } from "../dist/test/chat/helpers.js";

// Deliberately pinned to the approved disposable preview branch; no production fallback.
const project = "cold-mode-01560070";
const branch = "br-old-breeze-b1ncpy1i";
const report = {
  status: "INCOMPLETE",
  project,
  branch,
  head: process.env.GITHUB_SHA ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  evaluatedAt: new Date().toISOString(),
  checks: [],
  boundaries: [
    "Actual Neon database, managed Auth sessions and signed JWTs",
    "Provider responses are deterministic test fixtures",
    "Email delivery and real-user browser sign-in are not tested",
  ],
};
const record = (name) => {
  report.checks.push({ name, status: "PASS" });
};
const users = [];
const actors = [];
let pool;
let server;
let stage = "configuration";
try {
  assert(process.env.NEON_API_KEY, "NEON_API_KEY unavailable");
  const api = async (path) => {
    const result = await fetch(`https://console.neon.tech/api/v2/projects/${project}/${path}`, {
      headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    assert(result.ok, `Neon management API status ${result.status}`);
    return result.json();
  };
  const [connection, settings] = await Promise.all([
    api(
      `connection_uri?branch_id=${branch}&database_name=neondb&role_name=neondb_owner&pooled=true`,
    ),
    api(`branches/${branch}/auth`),
  ]);
  assert(new URL(connection.uri).hostname.startsWith("ep-floral-dust-b1vbwmm6"));
  const authUrl = settings.base_url ?? settings.auth?.base_url;
  assert(
    typeof authUrl === "string" && new URL(authUrl).hostname.startsWith("ep-floral-dust-b1vbwmm6"),
  );
  pool = createNeonPool(connection.uri);
  const auth = new NeonAuth(authUrl);
  const origin =
    "https://odin-agent-git-ag-55f873-clarityosbaerbelwesterop-gifs-projects.vercel.app";
  stage = "database RLS";
  const script = await readFile("scripts/test-neon-rls.sql", "utf8");
  const client = await pool.connect();
  try {
    await client.query(script);
  } finally {
    client.release();
  }
  record(
    "RLS denies foreign SELECT, UPDATE and DELETE on all eight tables; ownership forgery, foreign child and missing actor denied",
  );
  for (const suffix of ["a", "b"]) {
    stage = `managed auth signup ${suffix}`;
    const email = `odin-integration-${randomUUID()}-${suffix}@example.invalid`;
    const password = randomBytes(32).toString("base64url");
    const signup = await auth.upstream("sign-up/email", "POST", origin, "", {
      email,
      password,
      name: "Odin integration fixture",
    });
    report.authHttpStatus = signup.status;
    if (!signup.ok) {
      const failure = await signup.json().catch(() => ({}));
      report.authErrorCode =
        typeof failure.code === "string" && /^[A-Z_]{1,80}$/u.test(failure.code)
          ? failure.code
          : "UNSPECIFIED";
    }
    assert(signup.ok, `Managed signup status ${signup.status}`);
    stage = `managed auth account persistence ${suffix}`;
    const row = (await pool.query('SELECT id FROM neon_auth."user" WHERE email=$1', [email]))
      .rows[0];
    assert(row?.id);
    users.push({ id: row.id, email });
    stage = `managed auth session cookie ${suffix}`;
    report.authCookieNames = signup.headers
      .getSetCookie()
      .map((cookie) => cookie.split("=")[0])
      .filter((name) => /^[A-Za-z0-9_.-]{1,100}$/u.test(name));
    const signupCookie = auth
      .cookies(signup)
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    assert(signupCookie, "Expected managed session cookie");
    stage = `managed unverified session validation ${suffix}`;
    let unverified;
    try {
      await auth.session(signupCookie, origin);
    } catch (error) {
      unverified = error.code;
    }
    report.unverifiedResult = unverified ?? "unexpected_success";
    assert.equal(unverified, "EMAIL_UNVERIFIED");
    record(`Unverified synthetic user ${suffix} is refused by application Auth`);
    // Controlled test setup only, targeting the account just created above. This is not an email-delivery test.
    await pool.query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1 AND email=$2', [
      row.id,
      email,
    ]);
    stage = `managed verified login ${suffix}`;
    const login = await auth.upstream("sign-in/email", "POST", origin, "", { email, password });
    assert(login.ok, `Managed login status ${login.status}`);
    const cookie = auth
      .cookies(login)
      .map((value) => value.split(";")[0])
      .join("; ");
    const identity = await auth.session(cookie, origin);
    assert.equal(identity.id, row.id);
    assert.equal(identity.emailVerified, true);
    actors.push({ identity, cookie, db: new NeonActorDatabase(pool, identity) });
    record(`Managed session and EdDSA issuer/audience verification for user ${suffix}`);
  }
  stage = "durable engine and isolated workspace";
  const [a, b] = actors;
  const store = new NeonChatStore(a.db);
  const conversation = await store.createConversation("Synthetic live integration");
  const model = provider(() => response("Fixture response; not a live model benchmark."));
  const engine = new ChatEngine({
    store,
    events: new NeonMissionStore(a.db),
    models: [{ id: "fixture", label: "Fixture", model: "test-model", provider: model }],
    atomic: (action) =>
      a.db.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${a.identity.id}:${conversation.id}`,
        ]);
        return action();
      }),
  });
  stage = "durable mission submit and commit";
  const turn = await engine.submit({
    conversationId: conversation.id,
    text: "Check durable execution",
    mode: "chat",
    modelId: "fixture",
    requestId: randomUUID(),
  });
  stage = "durable worker execution after commit";
  await engine.idle();
  assert.equal((await engine.view(turn.id)).state, "COMPLETED");
  assert.equal(
    (await store.events(conversation.id)).filter((event) => event.type === "answer").length,
    1,
  );
  await assert.rejects(
    new NeonChatStore(b.db).conversation(conversation.id),
    (error) => error.status === 404,
  );
  stage = "isolated workspace and worker fencing";
  const workspace = new NeonWorkspace(a.db, conversation.id, async () => {});
  await workspace.patch({
    path: "index.html",
    content: "<!doctype html><button onclick=\"this.textContent='Ready'\">Run</button>",
    expectedSha: "absent",
    signal: AbortSignal.timeout(10000),
  });
  assert.match(await workspace.preview("index.html"), /button/u);
  assert.equal((await workspace.run("web-syntax", AbortSignal.timeout(10000))).exitCode, 0);
  assert.equal((await new NeonWorkspace(b.db, conversation.id, async () => {}).files()).length, 0);
  const lease = await a.db.claim(`integration:${turn.id}`, 30);
  assert(lease);
  assert.equal(await a.db.claim(`integration:${turn.id}`, 30), null);
  await a.db.release(`integration:${turn.id}`, lease);
  await assert.rejects(
    new NeonActorDatabase(pool, a.identity, {
      resource: `integration:${turn.id}`,
      token: lease,
    }).transaction(async () => true),
    (error) => error.code === "LEASE_EXPIRED",
  );
  await engine.close();
  record(
    "Real PG mission lifecycle, nested atomic transactions, event integrity, private workspace and expired worker fencing",
  );
  stage = "hosted HTTP boundary";
  process.env.ODIN_DATABASE_URL = connection.uri;
  process.env.NEON_AUTH_BASE_URL = authUrl;
  process.env.ODIN_PUBLIC_ORIGIN = origin;
  server = createServer(hostedHandler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const request = async (path, cookie = "", method = "GET", body) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Host: new URL(origin).host,
        Origin: origin,
        Cookie: cookie,
        "X-Odin-Request": "1",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await request("/api/conversations")).status, 401);
  assert.equal((await request(`/api/conversations/${conversation.id}`, a.cookie)).status, 200);
  assert.equal((await request(`/api/conversations/${conversation.id}`, b.cookie)).status, 404);
  assert.equal(
    (
      await request("/api/conversations", b.cookie, "POST", {
        title: "Forge",
        owner_id: a.identity.id,
      })
    ).status,
    400,
  );
  const preview = await request(`/api/conversations/${conversation.id}/preview`, a.cookie);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy"), /sandbox allow-scripts/u);
  const config = await request("/api/config", a.cookie);
  assert.equal(config.status, 200);
  assert.equal((await config.json()).execution, "request");
  assert.equal((await request("/api/session", a.cookie, "DELETE", {})).status, 200);
  assert.equal((await request("/api/config", a.cookie)).status, 401);
  record(
    "HTTP authentication, two-user isolation, forged owner rejection, preview CSP and immediate session revocation",
  );
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED";
  report.failedStage = stage;
  report.errorClass = error?.constructor?.name ?? "Error";
  report.errorCode = typeof error?.code === "string" ? error.code : null;
  // Never emit upstream bodies, connection strings, cookies, passwords or raw stack traces.
  process.exitCode = 1;
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (pool) {
    try {
      for (const { db } of actors)
        await db.transaction(async (c) => {
          for (const table of [
            "workspace_files",
            "events",
            "checkpoints",
            "turns",
            "mission_streams",
            "leases",
            "rate_limits",
            "conversations",
          ])
            await c.query(`DELETE FROM odin_api.${table}`);
        });
      for (const user of users)
        await pool.query('DELETE FROM neon_auth."user" WHERE id=$1 AND email=$2', [
          user.id,
          user.email,
        ]);
      report.cleanup = "PASS";
    } catch {
      report.cleanup = "FAILED";
      report.status = "FAILED";
      process.exitCode = 1;
    }
    await pool.end();
  }
  await writeFile("neon-integration-result.json", `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
