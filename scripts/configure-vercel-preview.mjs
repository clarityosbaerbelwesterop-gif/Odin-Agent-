import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createNeonPool } from "../dist/src/chat/neon-database.js";

export const scope = Object.freeze({
  repository: "clarityosbaerbelwesterop-gif/Odin-Agent-",
  repoId: 1355059364,
  gitBranch: "agent/chathub-modes-evidence",
  team: "team_5KyyWAPW9vLU4EiaKaYZuhaG",
  project: "prj_GdWyUqh2FXRUAwCUZrewFwa0w4yl",
  neonProject: "cold-mode-01560070",
  neonBranch: "br-withered-shadow-b1q366c3",
  endpoint: "ep-rapid-union-b14h469x",
});

export function validateInvocation(env) {
  assert.equal(env.GITHUB_REPOSITORY, scope.repository, "REPOSITORY_SCOPE");
  assert.equal(env.GITHUB_REF, `refs/heads/${scope.gitBranch}`, "BRANCH_SCOPE");
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/u, "HEAD_REQUIRED");
  for (const key of ["VERCEL_TOKEN", "NEON_API_KEY", "NV_API_KEY"])
    assert(env[key] && !/[\r\n]/u.test(env[key]), `MISSING_${key}`);
}

export function previewVariable(key, value) {
  assert(["ODIN_DATABASE_URL", "NEON_AUTH_BASE_URL", "NV_API_KEY"].includes(key));
  assert.equal(typeof value, "string");
  assert(value.length > 0);
  return { key, value, type: "sensitive", target: ["preview"], gitBranch: scope.gitBranch };
}

export function classifyFreeKey(value) {
  if (!value) return "NOT_CONFIGURED";
  if (value.startsWith("fla_")) return "CATALOG_LICENSE_NOT_INFERENCE";
  if (value.startsWith("freellmapi-")) return "ROUTER_KEY_ENDPOINT_REQUIRED";
  return "UNRECOGNIZED_PROVIDER_ENDPOINT_REQUIRED";
}

async function configure() {
  const report = {
    status: "INCOMPLETE",
    evaluatedAt: new Date().toISOString(),
    head: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    project: scope.project,
    branch: scope.gitBranch,
    checks: [],
    freeLLM: classifyFreeKey(process.env.FREE_API_KEY),
    boundaries: [
      "Preview only; no production migration or promotion",
      "FreeLLM key is classified in memory, not exported or sent to any endpoint",
      "Neon integration-managed owner credentials are not removed by this workflow",
    ],
  };
  let pool;
  let stage = "invocation";
  try {
    validateInvocation(process.env);
    const api = async (service, path, method = "GET", body) => {
      const vercel = service === "vercel";
      const url = vercel
        ? `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${scope.team}`
        : `https://console.neon.tech/api/v2/projects/${scope.neonProject}/${path}`;
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${vercel ? process.env.VERCEL_TOKEN : process.env.NEON_API_KEY}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      // Never echo response bodies: management APIs can include plaintext credentials.
      assert(response.ok, `${service.toUpperCase()}_HTTP_${response.status}`);
      return response.json();
    };
    stage = "project scope";
    const project = await api("vercel", `/v9/projects/${scope.project}`);
    assert.equal(project.id, scope.project);
    assert.equal(project.accountId, scope.team);
    assert.equal(project.name, "odin-agent");
    assert.equal(Number(project.link?.repoId), scope.repoId);
    const variables = await api("vercel", `/v10/projects/${scope.project}/env`);
    const existing = variables.envs?.find(
      (entry) =>
        entry.key === "ODIN_DATABASE_URL" &&
        entry.gitBranch === scope.gitBranch &&
        entry.target?.length === 1 &&
        entry.target[0] === "preview",
    );
    report.checks.push("Existing Vercel project and GitHub repository matched");
    stage = "Neon preview scope";
    const branch = await api("neon", `branches/${scope.neonBranch}`);
    assert.equal(branch.branch?.id, scope.neonBranch);
    assert.equal(branch.branch?.name, `preview/${scope.gitBranch}`);
    assert.equal(branch.branch?.default, false);
    const connection = await api(
      "neon",
      `connection_uri?branch_id=${scope.neonBranch}&database_name=neondb&role_name=neondb_owner&pooled=true`,
    );
    const uri = new URL(connection.uri);
    assert.equal(uri.hostname, `${scope.endpoint}-pooler.c-5.eu-central-1.aws.neon.tech`);
    assert.equal(uri.pathname, "/neondb");
    const settings = await api("neon", `branches/${scope.neonBranch}/auth`);
    const authUrl = settings.base_url ?? settings.auth?.base_url;
    assert.equal(
      authUrl,
      `https://${scope.endpoint}.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth`,
    );
    stage = "restricted application login";
    pool = createNeonPool(connection.uri);
    const role = (await pool.query("SELECT * FROM pg_roles WHERE rolname='odin_app'")).rows[0];
    assert.equal(
      Boolean(existing),
      Boolean(role),
      "APP_CREDENTIAL_PAIR_MISSING_MANUAL_RECOVERY_REQUIRED",
    );
    let appUri;
    if (!role) {
      // SQL-created roles never receive Neon console/API administrator membership.
      const password = randomBytes(32).toString("base64url");
      assert.match(password, /^[A-Za-z0-9_-]{43}$/u);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `CREATE ROLE odin_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD '${password}'`,
        );
        await client.query("GRANT odin_runtime TO odin_app WITH INHERIT FALSE, SET TRUE");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      uri.username = "odin_app";
      uri.password = password;
      appUri = uri.toString();
    }
    const checked = (await pool.query("SELECT * FROM pg_roles WHERE rolname='odin_app'")).rows[0];
    assert(checked?.rolcanlogin);
    for (const field of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolbypassrls",
      "rolreplication",
    ])
      assert.equal(checked[field], false, `ROLE_${field}`);
    const memberships = (
      await pool.query(
        "SELECT r.rolname, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='odin_app'::regrole",
      )
    ).rows;
    assert.deepEqual(memberships, [
      { rolname: "odin_runtime", admin_option: false, inherit_option: false, set_option: true },
    ]);
    if (appUri) {
      const appPool = createNeonPool(appUri);
      try {
        const client = await appPool.connect();
        try {
          assert.equal(
            (await client.query("SELECT current_user")).rows[0].current_user,
            "odin_app",
          );
          await assert.rejects(client.query('SELECT id FROM neon_auth."user" LIMIT 1'), {
            code: "42501",
          });
          await client.query("BEGIN");
          await client.query("SET LOCAL ROLE odin_runtime");
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM odin_api.conversations")).rows[0].n,
            0,
          );
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      } finally {
        await appPool.end();
      }
    }
    report.checks.push(
      "Restricted SQL-created login; no admin, owner, auth-table or RLS bypass access",
    );
    stage = "preview environment";
    const values = [
      ...(appUri ? [previewVariable("ODIN_DATABASE_URL", appUri)] : []),
      previewVariable("NEON_AUTH_BASE_URL", authUrl),
      previewVariable("NV_API_KEY", process.env.NV_API_KEY),
    ];
    for (const value of values) {
      const result = await api(
        "vercel",
        `/v10/projects/${scope.project}/env?upsert=true`,
        "POST",
        value,
      );
      assert.equal(result.failed?.length ?? 0, 0, "ENV_WRITE_FAILED");
    }
    report.checks.push(
      "Database, Auth and NVIDIA credentials set only for the approved preview branch",
    );
    stage = "preview deployment";
    const deployment = await api("vercel", "/v13/deployments", "POST", {
      name: "odin-agent",
      project: scope.project,
      gitSource: {
        type: "github",
        repoId: scope.repoId,
        ref: scope.gitBranch,
        sha: process.env.GITHUB_SHA,
      },
      // No target means preview. Never request production or promotion here.
    });
    assert.equal(deployment.target ?? null, null);
    assert.match(deployment.id ?? "", /^dpl_[A-Za-z0-9]+$/u);
    assert.match(deployment.url ?? "", /^odin-agent-[a-z0-9-]+\.vercel\.app$/u);
    report.deployment = {
      id: deployment.id,
      url: `https://${deployment.url}`,
      state: deployment.readyState,
    };
    report.status = "CONFIGURED_BUILD_PENDING";
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
    await pool?.end();
    const output = JSON.stringify(report, null, 2);
    await writeFile("vercel-preview-result.json", `${output}\n`);
    process.stdout.write(`${output}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await configure();
