import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";

const SCOPE = Object.freeze({
  repository: "clarityosbaerbelwesterop-gif/Odin-Agent-",
  project: "cold-mode-01560070",
  branch: "br-muddy-boat-b1po0mwo",
  database: "neondb",
  region: "aws-eu-central-1",
});

function requireSecret(name) {
  const value = process.env[name] ?? "";
  assert(value && !/[\r\n]/u.test(value), `MISSING_${name}`);
  return value;
}

function validateInvocation() {
  assert.equal(process.env.GITHUB_REPOSITORY, SCOPE.repository, "REPOSITORY_SCOPE");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "MAIN_ONLY");
  assert.match(process.env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/u, "HEAD_REQUIRED");
  requireSecret("NEON_API_KEY");
}

async function neon(path) {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${SCOPE.project}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.NEON_API_KEY}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  assert(response.ok, `NEON_HTTP_${response.status}`);
  return response.json();
}

async function main() {
  const report = {
    status: "INCOMPLETE",
    evaluatedAt: new Date().toISOString(),
    head: process.env.GITHUB_SHA,
    checks: [],
    boundaries: [
      "NEON_API_KEY is control-plane only and is never written into PostgreSQL or Vercel runtime",
      "This workflow verifies production Auth, roles and RLS without copying provider/OAuth/Stripe secrets into Neon",
      "No table is dropped, truncated or rewritten by this verifier",
    ],
  };
  let pool;
  try {
    validateInvocation();

    const projectResponse = await fetch(
      `https://console.neon.tech/api/v2/projects/${SCOPE.project}`,
      {
        headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert(projectResponse.ok, `NEON_PROJECT_HTTP_${projectResponse.status}`);
    const projectBody = await projectResponse.json();
    const project = projectBody.project ?? projectBody;
    assert.equal(project.id, SCOPE.project, "NEON_PROJECT_SCOPE");
    assert.equal(project.region_id, SCOPE.region, "NEON_REGION");
    assert.equal(project.pg_version, 18, "POSTGRES_VERSION");
    report.checks.push("Neon project scope is Odin production in eu-central-1 on PostgreSQL 18");

    const branch = await neon(`branches/${SCOPE.branch}`);
    assert.equal(branch.branch?.id, SCOPE.branch, "NEON_BRANCH_SCOPE");
    assert.equal(branch.branch?.default, true, "NEON_DEFAULT_BRANCH");
    assert.equal(branch.branch?.current_state, "ready", "NEON_BRANCH_READY");
    report.checks.push("Production branch is the ready default branch");

    const auth = await neon(`branches/${SCOPE.branch}/auth`);
    assert.equal(auth.auth_provider, "better_auth", "NEON_AUTH_PROVIDER");
    assert.equal(auth.db_name, SCOPE.database, "NEON_AUTH_DATABASE");
    assert.match(
      auth.base_url ?? "",
      /^https:\/\/[^/]+\.neonauth\.[^/]+\/neondb\/auth$/u,
      "NEON_AUTH_URL",
    );
    report.checks.push("Neon Auth is provisioned with Better Auth on neondb");

    const connection = await neon(
      `connection_uri?branch_id=${SCOPE.branch}&database_name=${SCOPE.database}&role_name=neondb_owner&pooled=true`,
    );
    const uri = new URL(connection.uri);
    assert(uri.hostname.endsWith(".neon.tech"), "NEON_CONNECTION_HOST");
    pool = new Pool({
      connectionString: uri.toString(),
      ssl: { rejectUnauthorized: true },
      max: 1,
      connectionTimeoutMillis: 10_000,
    });

    const tables = await pool.query(
      `SELECT c.relname AS table_name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
       COUNT(p.policyname)::int AS policy_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
       WHERE n.nspname='odin_api' AND c.relkind='r'
       GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity ORDER BY c.relname`,
    );
    assert(tables.rows.length >= 26, "ODIN_TABLE_COUNT");
    for (const row of tables.rows) {
      assert.equal(row.rls, true, `RLS_${row.table_name}`);
      assert.equal(row.force_rls, true, `FORCE_RLS_${row.table_name}`);
      assert(row.policy_count >= 1, `POLICY_${row.table_name}`);
    }
    report.checks.push(
      `${tables.rows.length} odin_api tables enforce RLS + FORCE RLS with policies`,
    );
    const botTables = new Set([
      "bots",
      "bot_tasks",
      "bot_task_events",
      "bot_automations",
      "bot_inbox",
      "bot_approvals",
      "bot_memories",
      "bot_focus",
    ]);
    for (const name of botTables)
      assert(
        tables.rows.some((row) => row.table_name === name),
        `BOT_TABLE_${name}`,
      );
    const control = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='odin_control' AND c.relname='bot_wakeups' AND c.relkind='r'`,
    );
    assert.equal(control.rows.length, 1, "BOT_WAKEUP_CONTROL_PLANE");
    report.checks.push(
      "Odin Bot user state is FORCE-RLS isolated and durable wakeups use a payload-free control index",
    );

    const runtimeRole = (
      await pool.query(
        "SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls,rolreplication FROM pg_roles WHERE rolname='odin_runtime'",
      )
    ).rows[0];
    assert(runtimeRole, "ODIN_RUNTIME_ROLE");
    assert.equal(runtimeRole.rolcanlogin, false, "ODIN_RUNTIME_LOGIN");
    for (const key of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolbypassrls",
      "rolreplication",
    ])
      assert.equal(runtimeRole[key], false, `ODIN_RUNTIME_${key}`);
    report.checks.push("odin_runtime is a non-login, non-privileged, non-RLS-bypass role");

    const runtimeControlGrants = (
      await pool.query(
        `SELECT
          has_schema_privilege('odin_runtime','odin_control','USAGE') AS schema_usage,
          has_function_privilege(
            'odin_runtime',
            'odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer)',
            'EXECUTE'
          ) AS enqueue_execute`,
      )
    ).rows[0];
    assert.equal(runtimeControlGrants?.schema_usage, true, "ODIN_RUNTIME_CONTROL_SCHEMA_USAGE");
    assert.equal(runtimeControlGrants?.enqueue_execute, true, "ODIN_RUNTIME_ENQUEUE_EXECUTE");
    report.checks.push(
      "odin_runtime can resolve and execute the scoped bot wakeup API without direct control-table grants",
    );

    const planConstraint = await pool.query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
       JOIN pg_namespace n ON n.oid=t.relnamespace
       WHERE n.nspname='odin_api' AND t.relname='accounts' AND c.conname='accounts_plan_check'`,
    );
    assert.match(planConstraint.rows[0]?.definition ?? "", /developer/u, "DEVELOPER_PLAN_SCHEMA");
    report.checks.push("Production account schema accepts the Developer tier");

    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.failure = {
      name: typeof error?.name === "string" ? error.name : "Error",
      message:
        typeof error?.message === "string"
          ? error.message.slice(0, 220)
          : "Neon verification failed",
    };
    process.exitCode = 1;
  } finally {
    await pool?.end().catch(() => {});
    await writeFile("neon-production-verify-result.json", `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

await main();
