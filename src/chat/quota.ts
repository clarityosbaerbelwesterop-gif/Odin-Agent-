import type { TokenUsage } from "../providers/types.js";
import type { ActorDatabase } from "./neon-database.js";
import { ChatError, type ChatMode, type ProductPlan } from "./types.js";

export interface PlanQuota {
  readonly monthlyOcu: number;
  readonly dailyOcu: number;
  readonly maxConcurrentMissions: number;
}

const DEFAULT_PLAN_QUOTAS: Readonly<Record<ProductPlan, PlanQuota>> = Object.freeze({
  free: { monthlyOcu: 1_000, dailyOcu: 100, maxConcurrentMissions: 1 },
  pro: { monthlyOcu: 15_000, dailyOcu: 1_500, maxConcurrentMissions: 3 },
  developer: { monthlyOcu: 45_000, dailyOcu: 4_500, maxConcurrentMissions: 5 },
  ultra: { monthlyOcu: 150_000, dailyOcu: 15_000, maxConcurrentMissions: 10 },
});

const MODEL_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  "gpt-oss-20b": 1,
  "gpt-oss-120b": 2.5,
  "deepseek-v4-flash": 2,
  kimi: 3,
  "mistral-medium-3-5": 4,
  "deepseek-v4-pro": 5,
  "openrouter-gpt-5-6-luna": 3,
  "openrouter-claude-fable-5-1": 8,
  "openrouter-claude-opus-5": 10,
});

function configuredInt(
  env: NodeJS.ProcessEnv,
  plan: ProductPlan,
  field: string,
  fallback: number,
): number {
  const raw = env[`ODIN_QUOTA_${plan.toUpperCase()}_${field}`];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) return fallback;
  return value;
}

export function planQuota(plan: ProductPlan, env: NodeJS.ProcessEnv = process.env): PlanQuota {
  const base = DEFAULT_PLAN_QUOTAS[plan];
  return {
    monthlyOcu: configuredInt(env, plan, "MONTHLY_OCU", base.monthlyOcu),
    dailyOcu: configuredInt(env, plan, "DAILY_OCU", base.dailyOcu),
    maxConcurrentMissions: configuredInt(
      env,
      plan,
      "MAX_CONCURRENT_MISSIONS",
      base.maxConcurrentMissions,
    ),
  };
}

export function computeUnitsForUsage(
  modelId: string,
  usage: Pick<TokenUsage, "inputTokens" | "outputTokens">,
): number {
  const weight = MODEL_WEIGHTS[modelId] ?? 1;
  const normalized = usage.inputTokens / 1_000 + usage.outputTokens / 500;
  return Math.max(1, Math.ceil(normalized * weight));
}

export interface QuotaReservationRequest {
  readonly requestId: string;
  readonly missionId: string;
  readonly mode: ChatMode;
  readonly modelId: string;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
}

export interface QuotaReservation {
  readonly requestId: string;
  readonly estimatedOcu: number;
}

export interface QuotaSnapshot {
  readonly plan: ProductPlan;
  readonly monthlyOcu: number;
  readonly dailyOcu: number;
  readonly consumedOcu: number;
  readonly reservedOcu: number;
  readonly remainingOcu: number;
  readonly dailyConsumedOcu: number;
  readonly dailyReservedOcu: number;
  readonly maxConcurrentMissions: number;
  readonly resetAt: string;
}

export interface ChatQuotaController {
  reserve(request: QuotaReservationRequest): Promise<QuotaReservation>;
  settle(reservation: QuotaReservation, usage: TokenUsage, provider: string): Promise<void>;
  release(reservation: QuotaReservation): Promise<void>;
}

function monthWindow(now = new Date()): { start: string; end: string; resetAt: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    resetAt: end.toISOString(),
  };
}

export class QuotaStore implements ChatQuotaController {
  constructor(
    readonly db: ActorDatabase,
    readonly plan: ProductPlan,
    readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async snapshot(): Promise<QuotaSnapshot> {
    const quota = planQuota(this.plan, this.env);
    const window = monthWindow();
    return this.db.transaction(async (client) => {
      await this.syncEntitlement(client, quota);
      await this.ensurePeriod(client, quota, window.start, window.end);
      await this.expireReservations(client, window.start);
      const period = (
        await client.query(
          "SELECT consumed_ocus,reserved_ocus FROM odin_api.usage_periods WHERE period_start=$1",
          [window.start],
        )
      ).rows[0];
      const dailyConsumed = Number(
        (
          await client.query(
            "SELECT COALESCE(SUM(compute_units),0)::bigint AS total FROM odin_api.usage_ledger WHERE created_at>=date_trunc('day',now())",
          )
        ).rows[0]?.total ?? 0,
      );
      const dailyReserved = Number(
        (
          await client.query(
            "SELECT COALESCE(SUM(estimated_ocus),0)::bigint AS total FROM odin_api.quota_reservations WHERE status='reserved' AND created_at>=date_trunc('day',now())",
          )
        ).rows[0]?.total ?? 0,
      );
      const consumed = Number(period?.consumed_ocus ?? 0);
      const reserved = Number(period?.reserved_ocus ?? 0);
      return {
        plan: this.plan,
        monthlyOcu: quota.monthlyOcu,
        dailyOcu: quota.dailyOcu,
        consumedOcu: consumed,
        reservedOcu: reserved,
        remainingOcu: Math.max(0, quota.monthlyOcu - consumed - reserved),
        dailyConsumedOcu: dailyConsumed,
        dailyReservedOcu: dailyReserved,
        maxConcurrentMissions: quota.maxConcurrentMissions,
        resetAt: window.resetAt,
      };
    });
  }

  async reserve(request: QuotaReservationRequest): Promise<QuotaReservation> {
    const quota = planQuota(this.plan, this.env);
    const window = monthWindow();
    const estimatedOcu = computeUnitsForUsage(request.modelId, {
      inputTokens: Math.max(0, Math.trunc(request.estimatedInputTokens)),
      outputTokens: Math.max(0, Math.trunc(request.estimatedOutputTokens)),
    });
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `quota:${window.start}`,
      ]);
      await this.syncEntitlement(client, quota);
      await this.ensurePeriod(client, quota, window.start, window.end);
      await this.expireReservations(client, window.start);
      const replay = (
        await client.query(
          "SELECT estimated_ocus,status FROM odin_api.quota_reservations WHERE request_id=$1",
          [request.requestId],
        )
      ).rows[0];
      if (replay) {
        if (replay.status !== "reserved")
          throw new ChatError(
            "QUOTA_RESERVATION_REPLAY",
            "Usage reservation is already finalized.",
            409,
          );
        return { requestId: request.requestId, estimatedOcu: Number(replay.estimated_ocus) };
      }
      const period = (
        await client.query(
          "SELECT consumed_ocus,reserved_ocus FROM odin_api.usage_periods WHERE period_start=$1 FOR UPDATE",
          [window.start],
        )
      ).rows[0];
      const consumed = Number(period?.consumed_ocus ?? 0);
      const reserved = Number(period?.reserved_ocus ?? 0);
      const dailyConsumed = Number(
        (
          await client.query(
            "SELECT COALESCE(SUM(compute_units),0)::bigint AS total FROM odin_api.usage_ledger WHERE created_at>=date_trunc('day',now())",
          )
        ).rows[0]?.total ?? 0,
      );
      const dailyReserved = Number(
        (
          await client.query(
            "SELECT COALESCE(SUM(estimated_ocus),0)::bigint AS total FROM odin_api.quota_reservations WHERE status='reserved' AND created_at>=date_trunc('day',now())",
          )
        ).rows[0]?.total ?? 0,
      );
      if (consumed + reserved + estimatedOcu > quota.monthlyOcu)
        throw new ChatError(
          "MONTHLY_QUOTA_EXHAUSTED",
          "Monthly shared-compute quota is exhausted.",
          429,
        );
      if (dailyConsumed + dailyReserved + estimatedOcu > quota.dailyOcu)
        throw new ChatError(
          "DAILY_QUOTA_EXHAUSTED",
          "Daily shared-compute burst limit is exhausted.",
          429,
        );
      await client.query(
        `INSERT INTO odin_api.quota_reservations(request_id,mission_id,period_start,mode,model_id,estimated_ocus,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 minutes')`,
        [
          request.requestId,
          request.missionId,
          window.start,
          request.mode,
          request.modelId,
          estimatedOcu,
        ],
      );
      await client.query(
        "UPDATE odin_api.usage_periods SET reserved_ocus=reserved_ocus+$2,updated_at=now() WHERE period_start=$1",
        [window.start, estimatedOcu],
      );
      return { requestId: request.requestId, estimatedOcu };
    });
  }

  async settle(reservation: QuotaReservation, usage: TokenUsage, provider: string): Promise<void> {
    const actualOcu = computeUnitsForUsage(await this.modelIdFor(reservation.requestId), usage);
    await this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `quota-settle:${reservation.requestId}`,
      ]);
      const row = (
        await client.query(
          "SELECT mission_id,period_start,mode,model_id,estimated_ocus,status FROM odin_api.quota_reservations WHERE request_id=$1 FOR UPDATE",
          [reservation.requestId],
        )
      ).rows[0];
      if (row?.status !== "reserved") return;
      const inserted = await client.query(
        `INSERT INTO odin_api.usage_ledger(request_id,mission_id,plan,mode,model_id,provider,input_tokens,output_tokens,compute_units)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING request_id`,
        [
          reservation.requestId,
          row.mission_id,
          this.plan,
          row.mode,
          row.model_id,
          provider,
          usage.inputTokens,
          usage.outputTokens,
          actualOcu,
        ],
      );
      if (!inserted.rows.length) return;
      await client.query(
        `UPDATE odin_api.quota_reservations
         SET status='settled',actual_ocus=$2,settled_at=now() WHERE request_id=$1`,
        [reservation.requestId, actualOcu],
      );
      await client.query(
        `UPDATE odin_api.usage_periods
         SET reserved_ocus=GREATEST(0,reserved_ocus-$2),consumed_ocus=consumed_ocus+$3,updated_at=now()
         WHERE period_start=$1`,
        [row.period_start, Number(row.estimated_ocus), actualOcu],
      );
    });
  }

  async release(reservation: QuotaReservation): Promise<void> {
    await this.db.transaction(async (client) => {
      const row = (
        await client.query(
          "UPDATE odin_api.quota_reservations SET status='released',settled_at=now() WHERE request_id=$1 AND status='reserved' RETURNING period_start,estimated_ocus",
          [reservation.requestId],
        )
      ).rows[0];
      if (!row) return;
      await client.query(
        "UPDATE odin_api.usage_periods SET reserved_ocus=GREATEST(0,reserved_ocus-$2),updated_at=now() WHERE period_start=$1",
        [row.period_start, Number(row.estimated_ocus)],
      );
    });
  }

  private async modelIdFor(requestId: string): Promise<string> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query("SELECT model_id FROM odin_api.quota_reservations WHERE request_id=$1", [
          requestId,
        ])
      ).rows[0];
      if (!row)
        throw new ChatError("QUOTA_RESERVATION_MISSING", "Usage reservation is missing.", 500);
      return String(row.model_id);
    });
  }

  private async syncEntitlement(
    client: {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    },
    quota: PlanQuota,
  ) {
    await client.query(
      `INSERT INTO odin_api.plan_entitlements(plan,monthly_ocu,daily_ocu,max_concurrent_missions,bot_enabled)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(owner_id,plan) DO UPDATE SET monthly_ocu=excluded.monthly_ocu,daily_ocu=excluded.daily_ocu,
       max_concurrent_missions=excluded.max_concurrent_missions,bot_enabled=excluded.bot_enabled,updated_at=now()`,
      [
        this.plan,
        quota.monthlyOcu,
        quota.dailyOcu,
        quota.maxConcurrentMissions,
        this.plan !== "free",
      ],
    );
  }

  private async ensurePeriod(
    client: {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    },
    quota: PlanQuota,
    start: string,
    end: string,
  ) {
    await client.query(
      `INSERT INTO odin_api.usage_periods(period_start,period_end,plan,allowance_ocus)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(owner_id,period_start) DO UPDATE SET plan=excluded.plan,allowance_ocus=excluded.allowance_ocus,updated_at=now()`,
      [start, end, this.plan, quota.monthlyOcu],
    );
  }

  private async expireReservations(
    client: {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    },
    periodStart: string,
  ) {
    const expired = (
      await client.query(
        "UPDATE odin_api.quota_reservations SET status='expired',settled_at=now() WHERE status='reserved' AND expires_at<now() RETURNING period_start,estimated_ocus",
      )
    ).rows;
    const released = expired
      .filter((row) => String(row.period_start).slice(0, 10) === periodStart)
      .reduce((sum, row) => sum + Number(row.estimated_ocus), 0);
    if (released > 0)
      await client.query(
        "UPDATE odin_api.usage_periods SET reserved_ocus=GREATEST(0,reserved_ocus-$2),updated_at=now() WHERE period_start=$1",
        [periodStart, released],
      );
  }
}
