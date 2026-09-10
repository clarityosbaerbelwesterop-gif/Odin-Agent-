import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";

const SCOPE = Object.freeze({
  repository: "clarityosbaerbelwesterop-gif/Odin-Agent-",
  repoId: 1355059364,
  team: "team_5KyyWAPW9vLU4EiaKaYZuhaG",
  vercelProject: "prj_GdWyUqh2FXRUAwCUZrewFwa0w4yl",
  neonProject: "cold-mode-01560070",
  neonBranch: "br-muddy-boat-b1po0mwo",
  database: "neondb",
  origin: "https://odin-agent-xi.vercel.app",
  appRole: "odin_prod_app",
});

const EXACT_PRICE_IDS = Object.freeze({
  STRIPE_PRO_PRICE_ID: "price_1UDr55EmDA2oLCpoQJNERPTA",
  STRIPE_DEVELOPER_PRICE_ID: "price_1UDr5HEmDA2oLCpoTuUlXUH0",
  STRIPE_ULTRA_PRICE_ID: "price_1UDr5REmDA2oLCpoiETsQLQf",
});

const SOURCE_MAPPINGS = Object.freeze([
  ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_ID"],
  ["GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_OAUTH_CLIENT_SECRET"],
  ["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY"],
  ["STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET"],
  ["OPENAI_API_KEY", "OPENAI_API_KEY"],
  ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
  ["OPENROUTER_API_KEY", "OPENROUTER_API_KEY"],
  ["GOOGLE_API_KEY", "GOOGLE_API_KEY"],
  ["FREE_API_KEY", "FREE_API_KEY"],
]);

function safeSecret(name, required = false) {
  const value = process.env[name] ?? "";
  if (required) assert(value, `MISSING_${name}`);
  if (value) assert(!/[\r\n]/u.test(value), `INVALID_${name}`);
  return value;
}

function validateInvocation() {
  assert.equal(process.env.GITHUB_REPOSITORY, SCOPE.repository, "REPOSITORY_SCOPE");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "MAIN_ONLY");
  assert.match(process.env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/u, "HEAD_REQUIRED");
  safeSecret("VERCEL_TOKEN", true);
  safeSecret("NEON_API_KEY", true);
}

async function api(service, path, method = "GET", body) {
  const isVercel = service === "vercel";
  const url = isVercel
    ? `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${SCOPE.team}`
    : `https://console.neon.tech/api/v2/projects/${SCOPE.neonProject}/${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${isVercel ? process.env.VERCEL_TOKEN : process.env.NEON_API_KEY}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `${service.toUpperCase()}_HTTP_${response.status}`);
  if (response.status === 204) return {};
  return response.json();
}

function vercelVariable(key, value) {
  assert.equal(typeof value, "string");
  assert(value && !/[\r\n]/u.test(value), `INVALID_${key}`);
  return { key, value, type: "sensitive", target: ["production"] };
}

async function upsert(key, value, envKeys) {
  const result = await api(
    "vercel",
    `/v10/projects/${SCOPE.vercelProject}/env?upsert=true`,
    "POST",
    vercelVariable(key, value),
  );
  assert.equal(result.failed?.length ?? 0, 0, `ENV_WRITE_FAILED_${key}`);
  envKeys.add(key);
}

async function waitForDeployment(id) {
  const started = Date.now();
  while (Date.now() - started < 8 * 60_000) {
    const deployment = await api("vercel", `/v13/deployments/${id}`);
    const state = deployment.readyState ?? deployment.state;
    if (state === "READY") return deployment;
    if (["ERROR", "CANCELED"].includes(state)) throw new Error(`DEPLOYMENT_${state}`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("DEPLOYMENT_TIMEOUT");
}

async function waitForHttpStatus(url, expectedStatus, label) {
  let lastFailure = "not attempted";
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === expectedStatus) return;
      lastFailure = `HTTP_${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.name : "FETCH_FAILED";
    }
    if (attempt < 18) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${label}_${lastFailure}`);
}

async function configureDatabase(report, envKeys) {
  const branch = await api("neon", `branches/${SCOPE.neonBranch}`);
  assert.equal(branch.branch?.id, SCOPE.neonBranch, "NEON_BRANCH_SCOPE");
  assert.equal(branch.branch?.default, true, "NEON_DEFAULT_BRANCH_REQUIRED");

  const connection = await api(
    "neon",
    `connection_uri?branch_id=${SCOPE.neonBranch}&database_name=${SCOPE.database}&role_name=neondb_owner&pooled=true`,
  );
  const ownerUri = new URL(connection.uri);
  assert(ownerUri.hostname.endsWith(".neon.tech"), "NEON_HOST");
  const pool = new Pool({
    connectionString: ownerUri.toString(),
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const botMigration = await readFile(
      new URL("../migrations/006_odin_bot_m1_m3.sql", import.meta.url),
      "utf8",
    );
    await pool.query(botMigration);
    report.checks.push("Odin Bot M1-M3 additive schema reconciled");

    const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [SCOPE.appRole]);
    const bindingAlreadyPresent = role.rows.length > 0 && envKeys.has("ODIN_DATABASE_URL");
    if (!bindingAlreadyPresent) {
      const password = randomBytes(32).toString("base64url");
      if (role.rows.length === 0) {
        await pool.query(
          `CREATE ROLE ${SCOPE.appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD '${password}'`,
        );
      } else {
        await pool.query(
          `ALTER ROLE ${SCOPE.appRole} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD '${password}'`,
        );
      }
      const appUri = new URL(ownerUri.toString());
      appUri.username = SCOPE.appRole;
      appUri.password = password;
      await upsert("ODIN_DATABASE_URL", appUri.toString(), envKeys);
      report.checks.push(
        "Restricted odin_prod_app credential provisioned and ODIN_DATABASE_URL synchronized",
      );
    } else {
      report.checks.push(
        "Existing restricted odin_prod_app credential and ODIN_DATABASE_URL retained on retry",
      );
    }

    await pool.query(`GRANT odin_runtime TO ${SCOPE.appRole} WITH INHERIT FALSE, SET TRUE`);
    await pool.query(`GRANT USAGE ON SCHEMA odin_control TO ${SCOPE.appRole}`);
    await pool.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON odin_control.bot_wakeups TO ${SCOPE.appRole}`,
    );
    const checked = (
      await pool.query(
        "SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls,rolreplication FROM pg_roles WHERE rolname=$1",
        [SCOPE.appRole],
      )
    ).rows[0];
    assert.equal(checked?.rolcanlogin, true, "APP_ROLE_LOGIN");
    for (const key of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolbypassrls",
      "rolreplication",
    ])
      assert.equal(checked[key], false, `APP_ROLE_${key}`);
  } finally {
    await pool.end().catch(() => {});
  }

  const auth = await api("neon", `branches/${SCOPE.neonBranch}/auth`);
  const authUrl = auth.base_url ?? auth.auth?.base_url ?? "";
  assert(authUrl.startsWith("https://") && authUrl.includes(".neonauth."), "NEON_AUTH_URL");
  await upsert("NEON_AUTH_BASE_URL", authUrl, envKeys);
  report.checks.push("Neon Auth production endpoint synchronized");
}

async function main() {
  const report = {
    status: "INCOMPLETE",
    evaluatedAt: new Date().toISOString(),
    head: process.env.GITHUB_SHA,
    synced: [],
    checks: [],
    operatorGates: [],
    boundaries: [
      "GitHub control-plane credentials are never copied into the Odin runtime",
      "NEON_API_KEY and VERCEL_TOKEN remain GitHub Actions control-plane secrets",
      "Production NVIDIA capacity is fail-closed unless explicitly authorized",
      "Secret values are never printed or stored in artifacts",
      "Retries preserve an existing odin_prod_app credential instead of rotating it again",
    ],
  };
  try {
    validateInvocation();

    const project = await api("vercel", `/v9/projects/${SCOPE.vercelProject}`);
    assert.equal(project.id, SCOPE.vercelProject, "VERCEL_PROJECT_SCOPE");
    assert.equal(project.accountId, SCOPE.team, "VERCEL_TEAM_SCOPE");
    assert.equal(Number(project.link?.repoId), SCOPE.repoId, "VERCEL_REPO_SCOPE");

    const current = await api("vercel", `/v10/projects/${SCOPE.vercelProject}/env`);
    const envKeys = new Set(
      (Array.isArray(current.envs) ? current.envs : [])
        .filter((entry) => Array.isArray(entry.target) && entry.target.includes("production"))
        .map((entry) => entry.key),
    );

    await configureDatabase(report, envKeys);
    await upsert("ODIN_PUBLIC_ORIGIN", SCOPE.origin, envKeys);
    await upsert("GITHUB_MCP_URL", "https://api.githubcopilot.com/mcp/readonly", envKeys);
    for (const [key, value] of Object.entries(EXACT_PRICE_IDS)) await upsert(key, value, envKeys);

    if (!envKeys.has("ODIN_CREDENTIAL_ENCRYPTION_KEY")) {
      await upsert(
        "ODIN_CREDENTIAL_ENCRYPTION_KEY",
        randomBytes(32).toString("base64url"),
        envKeys,
      );
    }

    for (const [source, target] of SOURCE_MAPPINGS) {
      const value = safeSecret(source);
      if (value) {
        await upsert(target, value, envKeys);
        report.synced.push(target);
      }
    }

    for (const required of [
      "GITHUB_OAUTH_CLIENT_ID",
      "GITHUB_OAUTH_CLIENT_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]) {
      if (!envKeys.has(required)) report.operatorGates.push(required);
    }

    const productionAuthorized = safeSecret("ODIN_NVIDIA_PRODUCTION_AUTHORIZED") === "true";
    const productionNvidia = safeSecret("NVIDIA_PRODUCTION_API_KEY");
    const productionNvidia2 = safeSecret("NVIDIA_PRODUCTION_API_KEY_2");
    if (productionAuthorized && productionNvidia) {
      await upsert("ODIN_NVIDIA_PRODUCTION_AUTHORIZED", "true", envKeys);
      await upsert("NVIDIA_PRODUCTION_API_KEY", productionNvidia, envKeys);
      if (productionNvidia2)
        await upsert("NVIDIA_PRODUCTION_API_KEY_2", productionNvidia2, envKeys);
      report.synced.push("ODIN_NVIDIA_PRODUCTION_AUTHORIZED", "NVIDIA_PRODUCTION_API_KEY");
      if (productionNvidia2) report.synced.push("NVIDIA_PRODUCTION_API_KEY_2");
    } else {
      await upsert("ODIN_NVIDIA_PRODUCTION_AUTHORIZED", "false", envKeys);
      report.operatorGates.push(
        productionAuthorized ? "NVIDIA_PRODUCTION_API_KEY" : "NVIDIA_PRODUCTION_AUTHORIZATION",
      );
    }

    const deployment = await api("vercel", "/v13/deployments", "POST", {
      name: "odin-agent",
      project: SCOPE.vercelProject,
      target: "production",
      gitSource: {
        type: "github",
        repoId: SCOPE.repoId,
        ref: "main",
        sha: process.env.GITHUB_SHA,
      },
    });
    assert.match(deployment.id ?? "", /^dpl_[A-Za-z0-9]+$/u, "DEPLOYMENT_ID");
    const ready = await waitForDeployment(deployment.id);
    assert.equal(ready.readyState ?? ready.state, "READY", "DEPLOYMENT_READY");
    const deploymentUrl = `https://${ready.url}`;
    report.deployment = { id: ready.id, url: deploymentUrl, target: ready.target };

    // A READY deployment can precede DNS propagation for its generated hostname.
    // Smoke the stable production alias with bounded retries instead of failing on
    // one transient resolver/network error after the production mutation succeeded.
    await waitForHttpStatus(`${SCOPE.origin}/api/auth/config`, 200, "AUTH_CONFIG");
    await waitForHttpStatus(`${SCOPE.origin}/api/config`, 401, "PROTECTED_API");
    report.checks.push(
      "Exact-main production deployment is READY and canonical protected API fails closed with 401",
    );

    report.status = report.operatorGates.length ? "READY_WITH_OPERATOR_GATES" : "READY";
  } catch (error) {
    report.status = "FAILED";
    report.failure = {
      name: typeof error?.name === "string" ? error.name : "Error",
      message:
        typeof error?.message === "string" ? error.message.slice(0, 220) : "Production sync failed",
    };
    process.exitCode = 1;
  } finally {
    await writeFile("vercel-production-sync-result.json", `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

await main();
