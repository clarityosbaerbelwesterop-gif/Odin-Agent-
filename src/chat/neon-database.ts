import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { ChatError } from "./types.js";

export interface VerifiedActor {
  readonly id: string;
}
export type DatabaseAction<T> = (client: Pick<PoolClient, "query">) => Promise<T>;
export interface ActorDatabase {
  transaction<T>(action: DatabaseAction<T>): Promise<T>;
}

export type BoundedLeaseResult =
  | { readonly status: "claimed"; readonly token: string }
  | { readonly status: "busy"; readonly token: null }
  | { readonly status: "limit"; readonly token: null };

/** Never hold this transaction open during a provider or tool call. */
export class NeonActorDatabase implements ActorDatabase {
  readonly #transaction = new AsyncLocalStorage<{ client: PoolClient; active: boolean }>();
  constructor(
    readonly pool: Pool,
    readonly actor: VerifiedActor,
    readonly fence?: { resource: string; token: string },
  ) {
    if (!actor.id || actor.id.length > 200 || [...actor.id].some((char) => char.charCodeAt(0) < 32))
      throw new ChatError("UNAUTHORIZED", "Invalid authenticated user.", 401);
  }
  async transaction<T>(action: DatabaseAction<T>): Promise<T> {
    const current = this.#transaction.getStore();
    if (current?.active) return action(current.client);
    const client = await this.pool.connect();
    const context = { client, active: true };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE odin_runtime");
      await client.query("SET LOCAL statement_timeout = '8s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      await client.query("SELECT set_config('odin.user_id', $1, true)", [this.actor.id]);
      if (this.fence) {
        const lease = await client.query(
          "SELECT token FROM odin_api.leases WHERE resource=$1 AND token=$2 AND expires_at>now() FOR SHARE",
          [this.fence.resource, this.fence.token],
        );
        if (!lease.rows.length)
          throw new ChatError(
            "LEASE_EXPIRED",
            "Execution lease expired; late writes were rejected.",
            409,
          );
      }
      const result = await this.#transaction.run(context, () => action(client));
      context.active = false;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      context.active = false;
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      context.active = false;
      client.release();
    }
  }
  async claim(resource: string, seconds = 280): Promise<string | null> {
    const token = randomUUID();
    const rows = await this.withLeaseLock(
      resource,
      async (c) =>
        (
          await c.query(
            `INSERT INTO odin_api.leases(resource,token,expires_at) VALUES($1,$2,now()+$3*interval '1 second')
       ON CONFLICT(owner_id,resource) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
       WHERE odin_api.leases.expires_at < now() RETURNING token`,
            [resource, token, seconds],
          )
        ).rows,
    );
    return rows.length ? token : null;
  }
  /**
   * Atomically claims one lease inside a per-owner prefix budget. This closes the race where two
   * simultaneous run requests can both observe one remaining mission slot and over-admit work.
   */
  async claimBounded(
    resource: string,
    prefix: string,
    limit: number,
    seconds = 280,
  ): Promise<BoundedLeaseResult> {
    if (
      !/^[A-Za-z0-9:-]{1,80}$/u.test(prefix) ||
      !resource.startsWith(prefix) ||
      resource.length > 150 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      !Number.isSafeInteger(seconds) ||
      seconds < 1 ||
      seconds > 3600
    )
      throw new ChatError("LEASE_CONFIG", "Invalid bounded lease configuration.", 500);
    const token = randomUUID();
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify(["odin-bounded-lease", this.actor.id, prefix]),
      ]);
      await client.query("DELETE FROM odin_api.leases WHERE resource LIKE $1 AND expires_at<now()", [
        `${prefix}%`,
      ]);
      const existing = await client.query(
        "SELECT 1 FROM odin_api.leases WHERE resource=$1 AND expires_at>now()",
        [resource],
      );
      if (existing.rows.length) return { status: "busy", token: null };
      const active = Number(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM odin_api.leases WHERE resource LIKE $1 AND expires_at>now()",
            [`${prefix}%`],
          )
        ).rows[0]?.n ?? 0,
      );
      if (active >= limit) return { status: "limit", token: null };
      const inserted = await client.query(
        `INSERT INTO odin_api.leases(resource,token,expires_at) VALUES($1,$2,now()+$3*interval '1 second')
         ON CONFLICT(owner_id,resource) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
         WHERE odin_api.leases.expires_at < now() RETURNING token`,
        [resource, token, seconds],
      );
      return inserted.rows.length
        ? { status: "claimed", token }
        : { status: "busy", token: null };
    });
  }
  /** Lock order is resource, lease row, then mission. Workers lock lease before mission too. */
  async withLeaseLock<T>(resource: string, action: DatabaseAction<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify(["odin-lease", this.actor.id, resource]),
      ]);
      await client.query("SELECT token FROM odin_api.leases WHERE resource=$1 FOR UPDATE", [
        resource,
      ]);
      return action(client);
    });
  }
  async release(resource: string, token: string): Promise<void> {
    await this.transaction(async (c) => {
      await c.query("DELETE FROM odin_api.leases WHERE resource=$1 AND token=$2", [
        resource,
        token,
      ]);
    });
  }
}

export function createNeonPool(connectionString: string): Pool {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech"))
    throw new ChatError("DATABASE_CONFIG", "Configure the connected Neon database.", 503);
  // Enforce certificate verification even if a supplied URL requests sslmode=require/no-verify.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  return new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    maxLifetimeSeconds: 60,
  });
}
