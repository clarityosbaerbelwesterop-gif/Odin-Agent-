import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";

const scope = Object.freeze({
  repository: "clarityosbaerbelwesterop-gif/Odin-Agent-",
  repoId: 1355059364,
  team: "team_5KyyWAPW9vLU4EiaKaYZuhaG",
  project: "prj_GdWyUqh2FXRUAwCUZrewFwa0w4yl",
  neonProject: "cold-mode-01560070",
  neonBranch: "br-muddy-boat-b1po0mwo",
  origin: "https://odin-agent-xi.vercel.app",
  role: "odin_prod_app",
  githubMcpUrl: "https://api.githubcopilot.com/mcp/readonly",
  stripePrices: Object.freeze({
    pro: "price_1UDr55EmDA2oLCpoQJNERPTA",
    developer: "price_1UDr5HEmDA2oLCpoTuUlXUH0",
    ultra: "price_1UDr5REmDA2oLCpoiETsQLQf",
  }),
});

function requireSecret(name) {
  const value = process.env[name] ?? "";
  assert(value && !/[\r\n]/u.test(value), `MISSING_${name}`);
  return value;
}

function optionalSecret(name) {
  const value = process.env[name] ?? "";
  if (!value) return undefined;
  assert(!/[\r\n]/u.test(value), `INVALID_${name}`);
  return value;
}

function validateInvocation() {
  assert.equal(process.env.GITHUB_REPOSITORY, scope.repository, "REPOSITORY_SCOPE");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "MAIN_ONLY");
  assert.match(process.env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/u, "HEAD_REQUIRED");
  requireSecret("VERCEL_TOKEN");
  requireSecret("NEON_API_KEY");
  requireSecret("NV_API_KEY");
  requireSecret("NV_API_KEY_2");
}

async function management(service, path, method = "GET", body) {
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `${service.toUpperCase()}_HTTP_${response.status}`);
  return response.status === 204 ? {} : response.json();
}

function productionVariable(key, value) {
  assert.equal(typeof value, "string");
  assert(value.length > 0 && !/[\r\n]/u.test(value), `INVALID_${key}`);
  return { key, value, type: "sensitive", target: ["production"] };
}

async function upsertProductionVariable(key, value) {
  const result = await management(
    "vercel",
    `/v10/projects/${scope.project}/env?upsert=true`,
    "POST",
    productionVariable(key, value),
  );
  assert.equal(result.failed?.length ?? 0, 0, `ENV_WRITE_FAILED_${key}`);
}

async function currentProductionEnv() {
  const result = await management("vercel", `/v10/projects/${scope.project}/env`);
  return Array.isArray(result.envs)
    ? result.envs.filter((entry) => Array.isArray(entry.target) && entry.target.includes("production"))
    : [];
}

async function waitForDeployment(id) {
  const started = Date.now();
  while (Date.now() - started < 8 * 60_000) {
    const deployment = await management("vercel", `/v13/deployments/${id}`);
    const state = deployment.readyState ?? deployment.state;
    if (state === "READY") return deployment;
    if (["ERROR", "CANCELED"].includes(state)) throw new Error(`DEPLOYMENT_${state}`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("DEPLOYMENT_TIMEOUT");
}

async function ensureDeveloperPlan(ownerPool, report) {
  const current = await ownerPool.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid='odin_api.accounts'::regclass AND conname='accounts_plan_check'`,
  );
  const definition = String(current.rows[0]?.definition ?? "");
  if (!definition.includes("developer")) {
    const client = await ownerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE odin_api.accounts DROP CONSTRAINT IF EXISTS accounts_plan_check");
      await client.query(
        "ALTER TABLE odin_api.accounts ADD CONSTRAINT accounts_plan_check CHECK (plan IN ('free','pro','developer','ultra'))",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  const verified = await ownerPool.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid='odin_api.accounts'::regclass AND conname='accounts_plan_check'`,
  );
  const finalDefinition = String(verified.rows[0]?.definition ?? "");
  for (const plan of ["free", "pro", "developer", "ultra"])
    assert(finalDefinition.includes(plan), `PLAN_CONSTRAINT_${plan.toUpperCase()}`);
  report.checks.push("Production Neon accepts exactly the four Odin product tiers including Developer");
}

async function configure() {
  const report = {
    status: "INCOMPLETE",
    evaluatedAt: new Date().toISOString(),
    head: process.env.GITHUB_SHA,
    checks: [],
    operatorGates: [],
    catalog: {
      currency: "usd",
      billing: "monthly",
      pro: { amount: 999, priceId: scope.stripePrices.pro },
      developer: { amount: 1999, priceId: scope.stripePrices.developer },
      ultra: { amount: 4999, priceId: scope.stripePrices.ultra },
    },
  };
  let ownerPool;
  try {
    validateInvocation();

    const project = await management("vercel", `/v9/projects/${scope.project}`);
    assert.equal(project.id, scope.project);
    assert.equal(project.accountId, scope.team);
    assert.equal(Number(project.link?.repoId), scope.repoId);
    report.checks.push("Vercel project is linked to the expected private Odin repository");

    const branch = await management("neon", `branches/${scope.neonBranch}`);
    assert.equal(branch.branch?.id, scope.neonBranch);
    assert.equal(branch.branch?.default, true, "NEON_PRODUCTION_BRANCH_REQUIRED");

    const connection = await management(
      "neon",
      `connection_uri?branch_id=${scope.neonBranch}&database_name=neondb&role_name=neondb_owner&pooled=true`,
    );
    const ownerUri = new URL(connection.uri);
    assert(ownerUri.hostname.endsWith(".neon.tech"), "NEON_HOST");
    ownerPool = new Pool({
      connectionString: ownerUri.toString(),
      ssl: { rejectUnauthorized: true },
      max: 1,
      connectionTimeoutMillis: 10_000,
    });

    const schema = await ownerPool.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
        count(p.policyname) FILTER (WHERE p.policyname='owner_isolation')::int AS owner_policies
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
       WHERE n.nspname='odin_api' AND c.relname=ANY($1::text[])
       GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity`,
      [["accounts", "credentials", "github_connections", "oauth_states", "stripe_events"]],
    );
    assert.equal(schema.rows.length, 5, "PRODUCT_SCHEMA_MISSING");
    for (const row of schema.rows) {
      assert.equal(row.relrowsecurity, true, `RLS_${row.relname}`);
      assert.equal(row.relforcerowsecurity, true, `FORCE_RLS_${row.relname}`);
      assert.equal(row.owner_policies, 1, `OWNER_POLICY_${row.relname}`);
    }
    report.checks.push("Production product schema has FORCE RLS owner isolation");
    await ensureDeveloperPlan(ownerPool, report);

    const envs = await currentProductionEnv();
    const has = (key) => envs.some((entry) => entry.key === key);
    const role = (await ownerPool.query("SELECT * FROM pg_roles WHERE rolname=$1", [scope.role])).rows[0];
    if (!has("ODIN_DATABASE_URL")) {
      const password = randomBytes(32).toString("base64url");
      assert.match(password, /^[A-Za-z0-9_-]{43}$/u);
      const client = await ownerPool.connect();
      try {
        await client.query("BEGIN");
        if (role) {
          await client.query(`ALTER ROLE ${scope.role} PASSWORD '${password}'`);
        } else {
          await client.query(
            `CREATE ROLE ${scope.role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD '${password}'`,
          );
          await client.query(`GRANT odin_runtime TO ${scope.role} WITH INHERIT FALSE, SET TRUE`);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      const uri = new URL(ownerUri.toString());
      uri.username = scope.role;
      uri.password = password;
      await upsertProductionVariable("ODIN_DATABASE_URL", uri.toString());
    }

    const checked = (await ownerPool.query("SELECT * FROM pg_roles WHERE rolname=$1", [scope.role])).rows[0];
    assert(checked?.rolcanlogin, "PRODUCTION_APP_LOGIN");
    for (const field of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolbypassrls",
      "rolreplication",
    ])
      assert.equal(checked[field], false, `ROLE_${field}`);
    const membership = await ownerPool.query(
      `SELECT r.rolname,m.admin_option,m.inherit_option,m.set_option
       FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
       WHERE m.member=$1::regrole`,
      [scope.role],
    );
    assert.deepEqual(membership.rows, [
      { rolname: "odin_runtime", admin_option: false, inherit_option: false, set_option: true },
    ]);
    report.checks.push("Production DB login is restricted and cannot bypass RLS");

    const auth = await management("neon", `branches/${scope.neonBranch}/auth`);
    const managedAuthUrl = auth.base_url ?? auth.auth?.base_url;
    assert.equal(typeof managedAuthUrl, "string", "NEON_AUTH_URL");
    assert(
      managedAuthUrl.startsWith("https://") && managedAuthUrl.includes(".neonauth."),
      "NEON_AUTH_URL",
    );
    const configuredAuthUrl = optionalSecret("NEON_AUTH_URL");
    if (configuredAuthUrl) {
      assert(configuredAuthUrl.startsWith("https://"), "NEON_AUTH_SECRET_URL");
      assert.equal(
        new URL(configuredAuthUrl).origin,
        new URL(managedAuthUrl).origin,
        "NEON_AUTH_SECRET_MISMATCH",
      );
    }

    await upsertProductionVariable("NEON_AUTH_BASE_URL", managedAuthUrl);
    await upsertProductionVariable("ODIN_PUBLIC_ORIGIN", scope.origin);
    await upsertProductionVariable("NV_API_KEY", process.env.NV_API_KEY);
    await upsertProductionVariable("NV_API_KEY_2", process.env.NV_API_KEY_2);
    await upsertProductionVariable("GITHUB_MCP_URL", scope.githubMcpUrl);
    await upsertProductionVariable("STRIPE_PRO_PRICE_ID", scope.stripePrices.pro);
    await upsertProductionVariable("STRIPE_DEVELOPER_PRICE_ID", scope.stripePrices.developer);
    await upsertProductionVariable("STRIPE_ULTRA_PRICE_ID", scope.stripePrices.ultra);

    const oauthClientId = optionalSecret("OAUTH_CLIENT_ID");
    const oauthClientSecret = optionalSecret("CLIENT_SECRET");
    if (oauthClientId && oauthClientSecret) {
      await upsertProductionVariable("GITHUB_OAUTH_CLIENT_ID", oauthClientId);
      await upsertProductionVariable("GITHUB_OAUTH_CLIENT_SECRET", oauthClientSecret);
      report.checks.push("GitHub OAuth credentials are mapped from repository secrets into Vercel Production");
    } else {
      report.operatorGates.push("OAUTH_CLIENT_ID/CLIENT_SECRET repository secrets");
    }

    const stripeSecret = optionalSecret("STRIPE_SECRET_KEY");
    const stripeWebhookSecret = optionalSecret("STRIPE_WEBHOOK_SECRET");
    if (stripeSecret) await upsertProductionVariable("STRIPE_SECRET_KEY", stripeSecret);
    else if (!has("STRIPE_SECRET_KEY")) report.operatorGates.push("STRIPE_SECRET_KEY");
    if (stripeWebhookSecret)
      await upsertProductionVariable("STRIPE_WEBHOOK_SECRET", stripeWebhookSecret);
    else if (!has("STRIPE_WEBHOOK_SECRET")) report.operatorGates.push("STRIPE_WEBHOOK_SECRET");

    if (!has("ODIN_CREDENTIAL_ENCRYPTION_KEY"))
      await upsertProductionVariable(
        "ODIN_CREDENTIAL_ENCRYPTION_KEY",
        randomBytes(32).toString("base64url"),
      );
    report.checks.push(
      "Production Neon/Auth/origin/encryption/NVIDIA/GitHub-MCP/Stripe-price variables are configured server-side",
    );

    if (optionalSecret("FREE_API_KEY"))
      report.checks.push(
        "FREE_API_KEY exists in GitHub Secrets but is intentionally not copied until a reviewed runtime consumer is merged",
      );

    const deployment = await management("vercel", "/v13/deployments", "POST", {
      name: "odin-agent",
      project: scope.project,
      target: "production",
      gitSource: {
        type: "github",
        repoId: scope.repoId,
        ref: "main",
        sha: process.env.GITHUB_SHA,
      },
    });
    assert.match(deployment.id ?? "", /^dpl_[A-Za-z0-9]+$/u, "DEPLOYMENT_ID");
    const ready = await waitForDeployment(deployment.id);
    assert.equal(ready.readyState ?? ready.state, "READY", "DEPLOYMENT_READY");
    const url = `https://${ready.url}`;
    report.deployment = { id: ready.id, url, target: ready.target };

    const authSmoke = await fetch(`${url}/api/auth/config`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(authSmoke.status, 200, "AUTH_CONFIG_HTTP");
    const configSmoke = await fetch(`${url}/api/config`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(configSmoke.status, 401, "UNAUTHENTICATED_CONFIG_MUST_BE_401");
    report.checks.push(
      "Fresh production deployment is READY; Auth config works and protected API fails closed with 401",
    );

    report.status = report.operatorGates.length ? "READY_WITH_OPERATOR_GATES" : "READY";
  } catch (error) {
    report.status = "FAILED";
    report.failure = {
      name: typeof error?.name === "string" ? error.name : "Error",
      message: typeof error?.message === "string" ? error.message.slice(0, 300) : "Setup failed",
    };
    process.exitCode = 1;
  } finally {
    await ownerPool?.end().catch(() => {});
    await writeFile("production-setup-result.json", `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

await configure();
