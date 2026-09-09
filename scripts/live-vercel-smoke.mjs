import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createNeonPool, NeonActorDatabase } from "../dist/src/chat/neon-database.js";
import { temporaryDeploymentShare } from "./preview-access.mjs";

// One explicitly pinned READY preview. This is not a production test or an open-ended model loop.
const deploymentId = "dpl_Gb5fgd6vjppYKjBPuxD1Q5QGcYH4";
const deploymentHead = "cdc52f01b57176f06db6aad67eadcca5ecaa3599";
const origin = "https://odin-agent-opk9qmojv-clarityosbaerbelwesterop-gifs-projects.vercel.app";
const team = "team_5KyyWAPW9vLU4EiaKaYZuhaG";
const project = "prj_GdWyUqh2FXRUAwCUZrewFwa0w4yl";
const neonProject = "cold-mode-01560070";
const branch = "br-withered-shadow-b1q366c3";
const report = {
  status: "INCOMPLETE",
  evaluatedAt: new Date().toISOString(),
  runId: process.env.GITHUB_RUN_ID,
  runnerHead: process.env.GITHUB_SHA,
  deploymentId,
  deploymentHead,
  origin,
  checks: [],
  boundaries: [
    "One synthetic account and one actual Kimi chat task on the pinned preview",
    "Chat policy permits at most four provider calls; no retries of the task",
    "Email verification is set only on the new fixture account; no email delivery claim",
    "An existing deployment-specific temporary share is reused without changing its expiry",
  ],
};
let stage = "scope";
let pool;
let user;
try {
  assert.equal(process.env.GITHUB_REPOSITORY, "clarityosbaerbelwesterop-gif/Odin-Agent-");
  assert.equal(process.env.GITHUB_REF, "refs/heads/agent/chathub-modes-evidence");
  assert(process.env.VERCEL_TOKEN && process.env.NEON_API_KEY);
  const management = async (path, method = "GET", body) => {
    const response = await fetch(`https://api.vercel.com${path}?teamId=${team}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    report.managementStatus = response.status;
    assert(response.ok, `MANAGEMENT_HTTP_${response.status}`);
    return response.json();
  };
  const deployment = await management(`/v13/deployments/${deploymentId}`);
  assert.equal(deployment.projectId, project);
  assert.equal(deployment.target ?? null, null);
  assert.equal(deployment.readyState, "READY");
  assert.equal(`https://${deployment.url}`, origin);
  assert.equal(deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha, deploymentHead);
  stage = "existing temporary preview share";
  report.shareMetadataPresent = typeof deployment.protectionBypass === "object";
  const share = temporaryDeploymentShare(deployment.protectionBypass);
  if (!share)
    throw Object.assign(new Error("Temporary preview share required"), {
      code: "PREVIEW_SHARE_REQUIRED",
    });
  const shareValue = share.secret;
  report.shareExpiresAt = new Date(share.expires).toISOString();
  // Keep Vercel's share token/cookie entirely inside this job. Never disable project protection.
  const protection = new Map();
  let url = `${origin}/?_vercel_share=${encodeURIComponent(shareValue)}`;
  for (let redirects = 0; redirects < 5; redirects++) {
    stage = "preview share cookie exchange";
    const response = await fetch(url, {
      headers: { Cookie: [...protection].map(([key, value]) => `${key}=${value}`).join("; ") },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    report.shareExchangeStatus = response.status;
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const key = pair.slice(0, index);
      if (key.startsWith("_vercel_")) protection.set(key, pair.slice(index + 1));
    }
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get("location"), origin);
      report.shareRedirectSameOrigin = next.origin === origin;
      assert.equal(next.origin, origin, "PREVIEW_ACCESS_NOT_GRANTED");
      url = next.href;
      await response.body?.cancel();
    } else {
      assert.equal(response.status, 200);
      await response.body?.cancel();
      break;
    }
  }
  stage = "preview access cookie presence";
  assert(protection.size > 0, "PREVIEW_COOKIE_MISSING");
  const protectionCookie = [...protection].map(([key, value]) => `${key}=${value}`).join("; ");
  const request = (path, cookie = "", method = "GET", body) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: `${protectionCookie}; ${cookie}`,
        Origin: origin,
        "Content-Type": "application/json",
        "X-Odin-Request": "1",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(method === "POST" && path.endsWith("/run") ? 260000 : 30000),
    });
  stage = "anonymous API rejection";
  assert.equal((await request("/api/config")).status, 401);
  report.checks.push("Anonymous API access is rejected on the real Vercel deployment");
  stage = "preview database scope";
  const connectionResponse = await fetch(
    `https://console.neon.tech/api/v2/projects/${neonProject}/connection_uri?branch_id=${branch}&database_name=neondb&role_name=neondb_owner&pooled=true`,
    {
      headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  assert(connectionResponse.ok);
  const connection = await connectionResponse.json();
  assert.equal(
    new URL(connection.uri).hostname,
    "ep-rapid-union-b14h469x-pooler.c-5.eu-central-1.aws.neon.tech",
  );
  pool = createNeonPool(connection.uri);
  stage = "hosted managed signup";
  const email = `odin-vercel-${randomUUID()}@example.invalid`;
  const signup = await request("/api/auth/signup", "", "POST", {
    email,
    password: randomBytes(32).toString("base64url"),
    name: "Odin Vercel smoke fixture",
  });
  report.signupStatus = signup.status;
  assert.equal(signup.status, 200);
  const row = (await pool.query('SELECT id FROM neon_auth."user" WHERE email=$1', [email])).rows[0];
  assert(row?.id);
  user = { id: row.id, email };
  const cookie = signup.headers
    .getSetCookie()
    .filter(
      (value) =>
        value.startsWith("__Secure-neon-auth.session_token=") ||
        value.startsWith("neon-auth.session_token="),
    )
    .map((value) => value.split(";")[0])
    .join("; ");
  assert(cookie);
  assert.equal((await request("/api/config", cookie)).status, 401);
  await pool.query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1 AND email=$2', [
    user.id,
    user.email,
  ]);
  stage = "hosted verified authentication";
  const configResponse = await request("/api/config", cookie);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert(config.models.some((model) => model.id === "kimi"));
  assert.equal(config.execution, "request");
  report.checks.push(
    "Managed signup, unverified rejection and verified session work through Vercel and restricted Postgres login",
  );
  stage = "real hosted chat task";
  const created = await request("/api/conversations", cookie, "POST", {
    title: "Disposable hosted smoke",
  });
  assert.equal(created.status, 201);
  const conversation = await created.json();
  const sent = await request(`/api/conversations/${conversation.id}/turns`, cookie, "POST", {
    text: "Reply with exactly ODIN_PREVIEW_OK. Do not use any tools.",
    mode: "chat",
    modelId: "kimi",
    requestId: randomUUID(),
  });
  assert.equal(sent.status, 202);
  const turn = await sent.json();
  const executed = await request(`/api/turns/${turn.id}/run`, cookie, "POST", {});
  report.executionStatus = executed.status;
  assert.equal(executed.status, 200);
  const viewResponse = await request(`/api/turns/${turn.id}`, cookie);
  assert.equal(viewResponse.status, 200);
  const view = await viewResponse.json();
  report.taskState = view.state;
  assert.equal(view.state, "COMPLETED");
  const eventsResponse = await request(`/api/conversations/${conversation.id}/events`, cookie);
  assert.equal(eventsResponse.status, 200);
  const { events } = await eventsResponse.json();
  assert(
    events.some((event) => event.type === "answer" && event.data.text?.includes("ODIN_PREVIEW_OK")),
  );
  report.checks.push(
    "One actual Kimi task completes in the deployed Odin runtime and its answer replays from Neon",
  );
  stage = "hosted logout revocation";
  assert.equal((await request("/api/session", cookie, "DELETE", {})).status, 200);
  assert.equal((await request("/api/config", cookie)).status, 401);
  report.checks.push("Sign-out immediately rejects replay of the old managed session");
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED";
  report.failure = {
    stage,
    code:
      typeof error?.code === "string" && /^[A-Z_0-9]{1,60}$/u.test(error.code)
        ? error.code
        : "CHECK_FAILED",
  };
  process.exitCode = 1;
} finally {
  if (pool && user) {
    try {
      await new NeonActorDatabase(pool, { id: user.id }).transaction(async (client) => {
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
          await client.query(`DELETE FROM odin_api.${table} WHERE owner_id=$1`, [user.id]);
      });
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
  }
  await pool?.end();
  const output = JSON.stringify(report, null, 2);
  await writeFile("vercel-smoke-result.json", `${output}\n`);
  process.stdout.write(`${output}\n`);
}
