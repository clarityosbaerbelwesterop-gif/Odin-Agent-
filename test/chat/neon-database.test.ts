import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { resolveNeonAuthUrl } from "../../src/chat/deployment.js";
import { NeonActorDatabase } from "../../src/chat/neon-database.js";

test("nested actor operations share a transaction; detached work obtains a fresh actor context", async () => {
  const connections: { statements: string[]; released: boolean }[] = [];
  // Pool transport boundary only; actual Postgres/RLS correctness has a separate live gate.
  const pool = {
    connect: async () => {
      const state = { statements: [] as string[], released: false };
      connections.push(state);
      return {
        query: async (sql: string) => {
          assert.equal(state.released, false, "query on a released pooled connection");
          state.statements.push(sql);
          return { rows: [] };
        },
        release: () => {
          state.released = true;
        },
      };
    },
  } as unknown as Pool;
  const db = new NeonActorDatabase(pool, { id: "fixture-user" });
  let continueDetached = () => {};
  const ready = new Promise<void>((resolve) => {
    continueDetached = resolve;
  });
  let detached: Promise<void> | undefined;
  await db.transaction(async (client) => {
    await db.transaction(async (nested) => assert.equal(nested, client));
    detached = ready.then(async () => {
      await db.transaction(async (fresh) => {
        assert.notEqual(fresh, client);
        await fresh.query("SELECT fixture");
      });
    });
  });
  continueDetached();
  await detached;
  assert.equal(connections.length, 2);
  for (const connection of connections) {
    assert.equal(connection.statements[0], "BEGIN");
    assert.equal(connection.statements[1], "SET LOCAL ROLE odin_runtime");
    assert(connection.statements.includes("SELECT set_config('odin.user_id', $1, true)"));
    assert.equal(connection.statements.at(-1), "COMMIT");
    assert.equal(connection.released, true);
  }
});

test("bounded leases atomically distinguish duplicate workers from plan concurrency exhaustion", async () => {
  const active = new Map<string, string>();
  const pool = {
    connect: async () => ({
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.startsWith("SELECT 1 FROM odin_api.leases WHERE resource=$1")) {
          return { rows: active.has(String(values[0])) ? [{ exists: 1 }] : [] };
        }
        if (sql.startsWith("SELECT count(*)::int AS n FROM odin_api.leases")) {
          const prefix = String(values[0]).replace(/%$/u, "");
          return { rows: [{ n: [...active.keys()].filter((key) => key.startsWith(prefix)).length }] };
        }
        if (sql.startsWith("INSERT INTO odin_api.leases(resource,token,expires_at)")) {
          const resource = String(values[0]);
          const token = String(values[1]);
          if (active.has(resource)) return { rows: [] };
          active.set(resource, token);
          return { rows: [{ token }] };
        }
        if (sql.startsWith("DELETE FROM odin_api.leases WHERE resource=$1 AND token=$2")) {
          const resource = String(values[0]);
          if (active.get(resource) === String(values[1])) active.delete(resource);
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  } as unknown as Pool;
  const db = new NeonActorDatabase(pool, { id: "fixture-user" });

  const first = await db.claimBounded("run:first", "run:", 2);
  assert.equal(first.status, "claimed");
  const duplicate = await db.claimBounded("run:first", "run:", 2);
  assert.equal(duplicate.status, "busy");
  const second = await db.claimBounded("run:second", "run:", 2);
  assert.equal(second.status, "claimed");
  const overLimit = await db.claimBounded("run:third", "run:", 2);
  assert.equal(overLimit.status, "limit");

  assert.equal(first.status, "claimed");
  if (first.status === "claimed") await db.release("run:first", first.token);
  const afterRelease = await db.claimBounded("run:third", "run:", 2);
  assert.equal(afterRelease.status, "claimed");
});

test("public Auth fallback is bound to verified database hosts and Vercel environments", () => {
  const connection =
    "postgresql://fixture:fixture@ep-rapid-union-b14h469x-pooler.c-5.eu-central-1.aws.neon.tech/neondb";
  const expected =
    "https://ep-rapid-union-b14h469x.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth";
  assert.equal(resolveNeonAuthUrl(connection, { VERCEL_ENV: "preview" }), expected);
  assert.equal(resolveNeonAuthUrl(connection, { VERCEL_ENV: "production" }), expected);
  assert.equal(
    resolveNeonAuthUrl(connection.replace("-pooler", ""), { VERCEL_ENV: "preview" }),
    expected,
  );
  assert.equal(
    resolveNeonAuthUrl(connection.replace("-pooler", ""), { VERCEL_ENV: "production" }),
    expected,
  );
  for (const database of [
    undefined,
    "malformed",
    connection.replace("ep-rapid-union-b14h469x", "ep-unknown-branch"),
    connection.replace("/neondb", "/other"),
    connection.replace("postgresql:", "https:"),
  ]) {
    assert.equal(resolveNeonAuthUrl(database, { VERCEL_ENV: "preview" }), undefined);
    assert.equal(resolveNeonAuthUrl(database, { VERCEL_ENV: "production" }), undefined);
  }
  assert.equal(resolveNeonAuthUrl(connection, {}), undefined);
  assert.equal(resolveNeonAuthUrl(connection, { NEON_AUTH_BASE_URL: expected }), expected);
});
