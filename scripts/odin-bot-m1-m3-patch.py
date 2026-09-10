from pathlib import Path


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    target.write_text(text.replace(old, new, 1))


write(
    "migrations/006_odin_bot_m1_m3.sql",
    r"""-- Odin Bot M1-M3: persistent bot identity, durable task/wakeup control plane and inbox.
-- Additive and idempotent. User-owned data remains FORCE-RLS isolated in odin_api.
-- odin_control contains only scheduler references (owner id + target id + timing), never task payloads or secrets.
BEGIN;

CREATE SCHEMA IF NOT EXISTS odin_control;
REVOKE ALL ON SCHEMA odin_control FROM PUBLIC;

CREATE TABLE IF NOT EXISTS odin_api.bots (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Odin Bot' CHECK(length(name) BETWEEN 1 AND 100),
  goal text NOT NULL DEFAULT 'Take ownership of delegated work.' CHECK(length(goal) BETWEEN 1 AND 2000),
  autonomy_level smallint NOT NULL DEFAULT 2 CHECK(autonomy_level BETWEEN 0 AND 4),
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS odin_bot_one_default ON odin_api.bots(owner_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS odin_api.bot_tasks (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  bot_id uuid NOT NULL,
  goal text NOT NULL CHECK(length(goal) BETWEEN 1 AND 16000),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','working','waiting','approval','blocked','done','cancelled','failed')),
  current_step text NOT NULL DEFAULT 'Queued' CHECK(length(current_step) BETWEEN 1 AND 300),
  agent text NOT NULL DEFAULT 'odin_general' CHECK(length(agent) BETWEEN 1 AND 80),
  mode text NOT NULL DEFAULT 'thinking' CHECK(mode IN ('chat','thinking','research','coding','ultra')),
  model_id text CHECK(model_id IS NULL OR length(model_id) BETWEEN 1 AND 160),
  priority smallint NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
  budget jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(budget)='object' AND octet_length(budget::text)<=20000),
  permissions jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(permissions)='object' AND octet_length(permissions::text)<=20000),
  artifacts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(artifacts)='array' AND octet_length(artifacts::text)<=100000),
  checkpoint jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(checkpoint)='object' AND octet_length(checkpoint::text)<=500000),
  checkpoint_version integer NOT NULL DEFAULT 0 CHECK(checkpoint_version BETWEEN 0 AND 1000000),
  source_automation_id uuid,
  conversation_id uuid,
  turn_id uuid,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 160),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  next_wakeup_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  UNIQUE(owner_id,idempotency_key),
  FOREIGN KEY(owner_id,bot_id) REFERENCES odin_api.bots(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_tasks_status ON odin_api.bot_tasks(owner_id,status,priority DESC,created_at);

CREATE TABLE IF NOT EXISTS odin_api.bot_task_events (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  cursor bigint GENERATED ALWAYS AS IDENTITY,
  task_id uuid NOT NULL,
  type text NOT NULL CHECK(type ~ '^[a-z0-9_.-]{1,80}$'),
  data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,cursor),
  FOREIGN KEY(owner_id,task_id) REFERENCES odin_api.bot_tasks(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_events_replay ON odin_api.bot_task_events(owner_id,task_id,cursor);

CREATE TABLE IF NOT EXISTS odin_api.bot_automations (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  bot_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  instruction text NOT NULL CHECK(length(instruction) BETWEEN 1 AND 4000),
  trigger_type text NOT NULL CHECK(trigger_type IN ('schedule','event','webhook','condition','dependency','retry','app_event')),
  trigger jsonb NOT NULL CHECK(jsonb_typeof(trigger)='object' AND octet_length(trigger::text)<=30000),
  action jsonb NOT NULL CHECK(jsonb_typeof(action)='object' AND octet_length(action::text)<=30000),
  notification_policy text NOT NULL DEFAULT 'important' CHECK(notification_policy IN ('critical','important','all','digest','silent')),
  budget jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(budget)='object' AND octet_length(budget::text)<=20000),
  enabled boolean NOT NULL DEFAULT true,
  next_wakeup_at timestamptz,
  last_fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,bot_id) REFERENCES odin_api.bots(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_automations_due ON odin_api.bot_automations(owner_id,next_wakeup_at) WHERE enabled;

CREATE TABLE IF NOT EXISTS odin_api.bot_inbox (
  owner_id text NOT NULL DEFAULT odin_api.actor(),
  id uuid NOT NULL,
  task_id uuid,
  category text NOT NULL CHECK(category IN ('approval','information','important','critical')),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  action jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(action)='object' AND octet_length(action::text)<=20000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,task_id) REFERENCES odin_api.bot_tasks(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS odin_bot_inbox_unread ON odin_api.bot_inbox(owner_id,created_at DESC) WHERE read_at IS NULL;

-- Cross-tenant scheduler index. It deliberately contains no goal, prompt, tool payload, credential or artifact.
CREATE TABLE IF NOT EXISTS odin_control.bot_wakeups (
  owner_id text NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('task','automation')),
  target_id uuid NOT NULL,
  dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 240),
  available_at timestamptz NOT NULL,
  priority smallint NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,id),
  UNIQUE(owner_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS odin_bot_wakeups_due ON odin_control.bot_wakeups(available_at,priority DESC,created_at)
  WHERE lease_expires_at IS NULL;
REVOKE ALL ON odin_control.bot_wakeups FROM PUBLIC;

DO $policies$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['bots','bot_tasks','bot_task_events','bot_automations','bot_inbox'] LOOP
    EXECUTE format('ALTER TABLE odin_api.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE odin_api.%I FORCE ROW LEVEL SECURITY',tab);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='odin_api' AND tablename=tab AND policyname='owner_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY owner_isolation ON odin_api.%I TO odin_runtime USING(owner_id=(SELECT odin_api.actor())) WITH CHECK(owner_id=(SELECT odin_api.actor()))',
        tab
      );
    END IF;
    EXECUTE format('REVOKE ALL ON odin_api.%I FROM PUBLIC',tab);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON odin_api.%I TO odin_runtime',tab);
  END LOOP;
END $policies$;
GRANT USAGE ON SEQUENCE odin_api.bot_task_events_cursor_seq TO odin_runtime;

CREATE OR REPLACE FUNCTION odin_control.enqueue_bot_wakeup(
  p_kind text,
  p_target uuid,
  p_available timestamptz,
  p_dedupe text,
  p_priority integer DEFAULT 50
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_owner text := NULLIF(current_setting('odin.user_id', true), '');
  v_id uuid := gen_random_uuid();
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Missing Odin actor'; END IF;
  IF p_kind NOT IN ('task','automation') THEN RAISE EXCEPTION 'Invalid wakeup kind'; END IF;
  IF p_kind='task' AND NOT EXISTS (
    SELECT 1 FROM odin_api.bot_tasks WHERE owner_id=v_owner AND id=p_target
  ) THEN RAISE EXCEPTION 'Task not owned by actor'; END IF;
  IF p_kind='automation' AND NOT EXISTS (
    SELECT 1 FROM odin_api.bot_automations WHERE owner_id=v_owner AND id=p_target
  ) THEN RAISE EXCEPTION 'Automation not owned by actor'; END IF;
  INSERT INTO odin_control.bot_wakeups(owner_id,id,kind,target_id,dedupe_key,available_at,priority)
  VALUES(v_owner,v_id,p_kind,p_target,p_dedupe,p_available,GREATEST(0,LEAST(100,p_priority)))
  ON CONFLICT(owner_id,dedupe_key) DO UPDATE
    SET available_at=LEAST(odin_control.bot_wakeups.available_at,excluded.available_at),
        priority=GREATEST(odin_control.bot_wakeups.priority,excluded.priority)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;
REVOKE ALL ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION odin_control.enqueue_bot_wakeup(text,uuid,timestamptz,text,integer) TO odin_runtime;

CREATE OR REPLACE FUNCTION odin_control.cleanup_bot_wakeup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  DELETE FROM odin_control.bot_wakeups
  WHERE owner_id=OLD.owner_id AND target_id=OLD.id
    AND kind=CASE WHEN TG_TABLE_NAME='bot_tasks' THEN 'task' ELSE 'automation' END;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION odin_control.cleanup_bot_wakeup() FROM PUBLIC;

DROP TRIGGER IF EXISTS bot_task_wakeup_cleanup ON odin_api.bot_tasks;
CREATE TRIGGER bot_task_wakeup_cleanup AFTER DELETE ON odin_api.bot_tasks
FOR EACH ROW EXECUTE FUNCTION odin_control.cleanup_bot_wakeup();
DROP TRIGGER IF EXISTS bot_automation_wakeup_cleanup ON odin_api.bot_automations;
CREATE TRIGGER bot_automation_wakeup_cleanup AFTER DELETE ON odin_api.bot_automations
FOR EACH ROW EXECUTE FUNCTION odin_control.cleanup_bot_wakeup();

DO $grant_worker$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='odin_prod_app') THEN
    GRANT USAGE ON SCHEMA odin_control TO odin_prod_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON odin_control.bot_wakeups TO odin_prod_app;
  END IF;
END $grant_worker$;

ALTER DEFAULT PRIVILEGES IN SCHEMA odin_api REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA odin_control REVOKE ALL ON TABLES FROM PUBLIC;
COMMIT;
""",
)

write(
    "src/bot/types.ts",
    r"""import type { ChatMode, ProductPlan } from "../chat/types.js";

export type BotTaskStatus =
  | "queued"
  | "working"
  | "waiting"
  | "approval"
  | "blocked"
  | "done"
  | "cancelled"
  | "failed";
export type BotNotificationPolicy = "critical" | "important" | "all" | "digest" | "silent";
export type BotTriggerType =
  | "schedule"
  | "event"
  | "webhook"
  | "condition"
  | "dependency"
  | "retry"
  | "app_event";

export interface BotIdentity {
  id: string;
  name: string;
  goal: string;
  autonomyLevel: number;
  status: "active" | "paused";
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotTask {
  id: string;
  botId: string;
  goal: string;
  status: BotTaskStatus;
  currentStep: string;
  agent: string;
  mode: ChatMode;
  modelId: string | null;
  priority: number;
  budget: Record<string, unknown>;
  permissions: Record<string, unknown>;
  artifacts: unknown[];
  checkpoint: Record<string, unknown>;
  checkpointVersion: number;
  sourceAutomationId: string | null;
  conversationId: string | null;
  turnId: string | null;
  nextWakeupAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotTaskEvent {
  cursor: number;
  taskId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface BotAutomation {
  id: string;
  botId: string;
  name: string;
  instruction: string;
  triggerType: BotTriggerType;
  trigger: Record<string, unknown>;
  action: Record<string, unknown>;
  notificationPolicy: BotNotificationPolicy;
  budget: Record<string, unknown>;
  enabled: boolean;
  nextWakeupAt: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotInboxItem {
  id: string;
  taskId: string | null;
  category: "approval" | "information" | "important" | "critical";
  title: string;
  body: string;
  action: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface BotPlanLimits {
  enabled: boolean;
  plan: ProductPlan;
  maxActiveTasks: number;
  maxAutomations: number;
  maxParallelTasks: number;
  maxTaskMinutes: number;
  maxDailyWakeups: number;
}

export interface ParsedAutomation {
  name: string;
  triggerType: BotTriggerType;
  trigger: Record<string, unknown>;
  nextWakeupAt: string | null;
  display: string;
}

export interface ClaimedWakeup {
  ownerId: string;
  id: string;
  kind: "task" | "automation";
  targetId: string;
  token: string;
  attempt: number;
}
""",
)

write(
    "src/bot/entitlements.ts",
    r"""import type { ProductPlan } from "../chat/types.js";
import type { BotPlanLimits } from "./types.js";

const DEFAULTS: Readonly<Record<ProductPlan, Omit<BotPlanLimits, "plan">>> = Object.freeze({
  free: {
    enabled: false,
    maxActiveTasks: 0,
    maxAutomations: 0,
    maxParallelTasks: 0,
    maxTaskMinutes: 0,
    maxDailyWakeups: 0,
  },
  pro: {
    enabled: true,
    maxActiveTasks: 3,
    maxAutomations: 12,
    maxParallelTasks: 2,
    maxTaskMinutes: 90,
    maxDailyWakeups: 120,
  },
  developer: {
    enabled: true,
    maxActiveTasks: 6,
    maxAutomations: 30,
    maxParallelTasks: 3,
    maxTaskMinutes: 240,
    maxDailyWakeups: 600,
  },
  ultra: {
    enabled: true,
    maxActiveTasks: 12,
    maxAutomations: 100,
    maxParallelTasks: 6,
    maxTaskMinutes: 480,
    maxDailyWakeups: 2400,
  },
});

function configured(env: NodeJS.ProcessEnv, plan: ProductPlan, field: string, fallback: number): number {
  const key = `ODIN_BOT_${plan.toUpperCase()}_${field}`;
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) return fallback;
  return value;
}

export function botPlanLimits(
  plan: ProductPlan,
  env: NodeJS.ProcessEnv = process.env,
): BotPlanLimits {
  const base = DEFAULTS[plan];
  return {
    plan,
    enabled: base.enabled,
    maxActiveTasks: configured(env, plan, "MAX_ACTIVE_TASKS", base.maxActiveTasks),
    maxAutomations: configured(env, plan, "MAX_AUTOMATIONS", base.maxAutomations),
    maxParallelTasks: configured(env, plan, "MAX_PARALLEL_TASKS", base.maxParallelTasks),
    maxTaskMinutes: configured(env, plan, "MAX_TASK_MINUTES", base.maxTaskMinutes),
    maxDailyWakeups: configured(env, plan, "MAX_DAILY_WAKEUPS", base.maxDailyWakeups),
  };
}
""",
)

write(
    "src/bot/wakeup.ts",
    r"""import { ChatError } from "../chat/types.js";
import type { ParsedAutomation } from "./types.js";

function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new ChatError("INVALID_TIMEZONE", "Choose a valid timezone.");
  }
}

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((item) => item.type !== "literal")
      .map((item) => [item.type, Number(item.value)]),
  );
  return values as Record<string, number>;
}

function zonedUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const observed = parts(new Date(guess), timeZone);
    const represented = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    guess += Date.UTC(year, month - 1, day, hour, minute, 0, 0) - represented;
  }
  return new Date(guess);
}

export function nextDailyWake(
  from: Date,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  validTimeZone(timeZone);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new ChatError("INVALID_SCHEDULE", "Choose a valid daily time.");
  const local = parts(from, timeZone);
  let candidate = zonedUtc(local.year, local.month, local.day, hour, minute, timeZone);
  if (candidate.getTime() <= from.getTime()) {
    const noon = new Date(Date.UTC(local.year, local.month - 1, local.day, 12));
    noon.setUTCDate(noon.getUTCDate() + 1);
    const next = parts(noon, timeZone);
    candidate = zonedUtc(next.year, next.month, next.day, hour, minute, timeZone);
  }
  return candidate;
}

export function nextAutomationWake(trigger: Record<string, unknown>, from = new Date()): string | null {
  if (trigger.kind !== "schedule") return null;
  if (trigger.cadence === "interval") {
    const minutes = Number(trigger.everyMinutes);
    if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 43_200)
      throw new ChatError("INVALID_SCHEDULE", "Intervals must be between 5 minutes and 30 days.");
    return new Date(from.getTime() + minutes * 60_000).toISOString();
  }
  if (trigger.cadence === "daily") {
    return nextDailyWake(
      from,
      Number(trigger.hour),
      Number(trigger.minute),
      String(trigger.timeZone),
    ).toISOString();
  }
  return null;
}

export function parseAutomationText(
  instruction: string,
  timeZone = "UTC",
  now = new Date(),
): ParsedAutomation {
  const text = instruction.trim();
  if (!text || text.length > 4000)
    throw new ChatError("INVALID_AUTOMATION", "Describe the automation in one clear instruction.");
  const zone = validTimeZone(timeZone);
  const lower = text.toLowerCase();
  const interval = /(?:every|alle|jede[nr]?)\s+(\d{1,3})\s*(minutes?|minuten?|hours?|stunden?)/u.exec(lower);
  if (interval) {
    const amount = Number(interval[1]);
    const everyMinutes = /hour|stund/u.test(interval[2]) ? amount * 60 : amount;
    if (everyMinutes < 5)
      throw new ChatError("INVALID_SCHEDULE", "Background intervals start at five minutes.");
    const trigger = { kind: "schedule", cadence: "interval", everyMinutes, timeZone: zone };
    return {
      name: text.slice(0, 120),
      triggerType: "schedule",
      trigger,
      nextWakeupAt: nextAutomationWake(trigger, now),
      display: `Every ${everyMinutes} min`,
    };
  }

  const daily = /(?:every day|daily|jeden tag|jeden morgen|jeden abend)(?:[^0-9]{0,20}(?:at|um)\s*)?(\d{1,2})?(?::(\d{2}))?/u.exec(lower);
  if (daily) {
    const fallbackHour = /morgen/u.test(lower) ? 8 : /abend/u.test(lower) ? 19 : 8;
    const hour = daily[1] === undefined ? fallbackHour : Number(daily[1]);
    const minute = daily[2] === undefined ? 0 : Number(daily[2]);
    const trigger = { kind: "schedule", cadence: "daily", hour, minute, timeZone: zone };
    return {
      name: text.slice(0, 120),
      triggerType: "schedule",
      trigger,
      nextWakeupAt: nextAutomationWake(trigger, now),
      display: `Every day · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  }

  if (/\b(?:when|wenn)\b/u.test(lower)) {
    const source = /github|pull request|\bpr\b|\bci\b/u.test(lower)
      ? "github"
      : /vercel|deploy/u.test(lower)
        ? "deployment"
        : "generic";
    return {
      name: text.slice(0, 120),
      triggerType: /fertig|complete|finished/u.test(lower) ? "dependency" : "condition",
      trigger: { kind: "event", source, expression: text },
      nextWakeupAt: null,
      display: source === "generic" ? "When condition becomes true" : `On ${source} event`,
    };
  }

  throw new ChatError(
    "AUTOMATION_AMBIGUOUS",
    "Include a schedule like “jeden Morgen um 8” or a condition beginning with “wenn”.",
  );
}
""",
)

write(
    "src/bot/store.ts",
    r"""import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ActorDatabase } from "../chat/neon-database.js";
import { ChatError, type ChatMode } from "../chat/types.js";
import { nextAutomationWake } from "./wakeup.js";
import type {
  BotAutomation,
  BotIdentity,
  BotInboxItem,
  BotNotificationPolicy,
  BotPlanLimits,
  BotTask,
  BotTaskEvent,
  BotTaskStatus,
  ClaimedWakeup,
  ParsedAutomation,
} from "./types.js";

const iso = (value: string | Date | null | undefined) => (value ? new Date(value).toISOString() : null);
const terminal = new Set<BotTaskStatus>(["done", "cancelled", "failed", "blocked"]);

function safeString(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new ChatError("INVALID_BOT_INPUT", `${label} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(clean))
    throw new ChatError("INVALID_BOT_INPUT", `${label} is invalid.`);
  return clean;
}

function task(row: Record<string, any>): BotTask {
  return {
    id: row.id,
    botId: row.bot_id,
    goal: row.goal,
    status: row.status,
    currentStep: row.current_step,
    agent: row.agent,
    mode: row.mode,
    modelId: row.model_id ?? null,
    priority: Number(row.priority),
    budget: row.budget ?? {},
    permissions: row.permissions ?? {},
    artifacts: row.artifacts ?? [],
    checkpoint: row.checkpoint ?? {},
    checkpointVersion: Number(row.checkpoint_version),
    sourceAutomationId: row.source_automation_id ?? null,
    conversationId: row.conversation_id ?? null,
    turnId: row.turn_id ?? null,
    nextWakeupAt: iso(row.next_wakeup_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  };
}

function automation(row: Record<string, any>): BotAutomation {
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    instruction: row.instruction,
    triggerType: row.trigger_type,
    trigger: row.trigger ?? {},
    action: row.action ?? {},
    notificationPolicy: row.notification_policy,
    budget: row.budget ?? {},
    enabled: row.enabled === true,
    nextWakeupAt: iso(row.next_wakeup_at),
    lastFiredAt: iso(row.last_fired_at),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  };
}

export class BotStore {
  constructor(readonly db: ActorDatabase) {}

  async ensureDefaultBot(): Promise<BotIdentity> {
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["odin-default-bot"]);
      let row = (await client.query("SELECT * FROM odin_api.bots WHERE is_default=true LIMIT 1")).rows[0];
      if (!row) {
        row = (
          await client.query(
            "INSERT INTO odin_api.bots(id,name,goal,is_default) VALUES($1,'Odin Bot','Take ownership of delegated work.',true) RETURNING *",
            [randomUUID()],
          )
        ).rows[0];
      }
      return {
        id: row.id,
        name: row.name,
        goal: row.goal,
        autonomyLevel: Number(row.autonomy_level),
        status: row.status,
        isDefault: row.is_default,
        createdAt: iso(row.created_at) as string,
        updatedAt: iso(row.updated_at) as string,
      };
    });
  }

  async tasks(limit = 100): Promise<BotTask[]> {
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
    return this.db.transaction(async (client) =>
      (await client.query("SELECT * FROM odin_api.bot_tasks ORDER BY created_at DESC LIMIT $1", [bounded])).rows.map(task),
    );
  }

  async task(id: string): Promise<BotTask> {
    return this.db.transaction(async (client) => {
      const row = (await client.query("SELECT * FROM odin_api.bot_tasks WHERE id=$1", [id])).rows[0];
      if (!row) throw new ChatError("BOT_TASK_NOT_FOUND", "Bot task not found.", 404);
      return task(row);
    });
  }

  async events(taskId: string, after = 0): Promise<BotTaskEvent[]> {
    const found = await this.task(taskId);
    return this.db.transaction(async (client) =>
      (
        await client.query(
          "SELECT cursor,task_id,type,data,created_at FROM odin_api.bot_task_events WHERE task_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 500",
          [found.id, Math.max(0, Math.trunc(after))],
        )
      ).rows.map((row) => ({
        cursor: Number(row.cursor),
        taskId: row.task_id,
        type: row.type,
        data: row.data ?? {},
        createdAt: iso(row.created_at) as string,
      })),
    );
  }

  async createTask(input: {
    goal: string;
    mode?: ChatMode;
    modelId?: string | null;
    priority?: number;
    idempotencyKey?: string;
    sourceAutomationId?: string | null;
    budget?: Record<string, unknown>;
    permissions?: Record<string, unknown>;
  }, limits: BotPlanLimits): Promise<BotTask> {
    if (!limits.enabled) throw new ChatError("BOT_ENTITLEMENT_REQUIRED", "Odin Bot requires Pro or higher.", 403);
    const goal = safeString(input.goal, 16_000, "Goal");
    const mode = input.mode ?? "thinking";
    if (!["chat", "thinking", "research", "coding", "ultra"].includes(mode))
      throw new ChatError("INVALID_BOT_MODE", "Choose a supported bot mode.");
    const idempotencyKey = safeString(input.idempotencyKey ?? randomUUID(), 160, "Idempotency key");
    const priority = Math.max(0, Math.min(100, Math.trunc(input.priority ?? 50)));
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ goal, mode, modelId: input.modelId ?? null, sourceAutomationId: input.sourceAutomationId ?? null }))
      .digest("hex");
    const bot = await this.ensureDefaultBot();
    return this.db.transaction(async (client) => {
      const active = Number(
        (await client.query("SELECT count(*)::int AS n FROM odin_api.bot_tasks WHERE status NOT IN ('done','cancelled','failed','blocked')")).rows[0]?.n ?? 0,
      );
      if (active >= limits.maxActiveTasks)
        throw new ChatError("BOT_TASK_LIMIT", "Your active Odin Bot task limit is reached.", 409);
      const row = (
        await client.query(
          `INSERT INTO odin_api.bot_tasks(id,bot_id,goal,mode,model_id,priority,idempotency_key,request_hash,source_automation_id,budget,permissions)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(owner_id,idempotency_key) DO UPDATE SET updated_at=odin_api.bot_tasks.updated_at
           RETURNING *`,
          [randomUUID(), bot.id, goal, mode, input.modelId ?? null, priority, idempotencyKey, requestHash, input.sourceAutomationId ?? null, input.budget ?? {}, input.permissions ?? {}],
        )
      ).rows[0];
      if (row.request_hash !== requestHash)
        throw new ChatError("IDEMPOTENCY_CONFLICT", "This request key already belongs to another bot task.", 409);
      await client.query(
        "INSERT INTO odin_api.bot_task_events(task_id,type,data) VALUES($1,'task.queued',$2)",
        [row.id, { step: "Queued", sourceAutomationId: input.sourceAutomationId ?? null }],
      );
      await client.query(
        "SELECT odin_control.enqueue_bot_wakeup('task',$1,now(),$2,$3)",
        [row.id, `task:${row.id}:initial`, priority],
      );
      return task(row);
    });
  }

  async updateTask(
    id: string,
    status: BotTaskStatus,
    currentStep: string,
    eventType: string,
    data: Record<string, unknown> = {},
  ): Promise<BotTask> {
    const step = safeString(currentStep, 300, "Current step");
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `UPDATE odin_api.bot_tasks SET status=$2,current_step=$3,
           started_at=CASE WHEN $2='working' THEN COALESCE(started_at,now()) ELSE started_at END,
           completed_at=CASE WHEN $2 IN ('done','cancelled','failed','blocked') THEN now() ELSE NULL END,
           updated_at=now() WHERE id=$1 RETURNING *`,
          [id, status, step],
        )
      ).rows[0];
      if (!row) throw new ChatError("BOT_TASK_NOT_FOUND", "Bot task not found.", 404);
      await client.query("INSERT INTO odin_api.bot_task_events(task_id,type,data) VALUES($1,$2,$3)", [id, eventType, { ...data, step }]);
      return task(row);
    });
  }

  async linkMission(id: string, conversationId: string, turnId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      const result = await client.query(
        "UPDATE odin_api.bot_tasks SET conversation_id=$2,turn_id=$3,updated_at=now() WHERE id=$1",
        [id, conversationId, turnId],
      );
      if (!result.rowCount) throw new ChatError("BOT_TASK_NOT_FOUND", "Bot task not found.", 404);
    });
  }

  async saveCheckpoint(id: string, checkpoint: Record<string, unknown>, nextWakeupAt?: string | null): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        "UPDATE odin_api.bot_tasks SET checkpoint=$2,checkpoint_version=checkpoint_version+1,next_wakeup_at=$3,updated_at=now() WHERE id=$1",
        [id, checkpoint, nextWakeupAt ?? null],
      );
    });
  }

  async cancel(id: string): Promise<BotTask> {
    const found = await this.task(id);
    if (terminal.has(found.status)) return found;
    return this.updateTask(id, "cancelled", "Stopped by user", "task.cancelled", {});
  }

  async automations(): Promise<BotAutomation[]> {
    return this.db.transaction(async (client) =>
      (await client.query("SELECT * FROM odin_api.bot_automations ORDER BY created_at DESC LIMIT 200")).rows.map(automation),
    );
  }

  async automation(id: string): Promise<BotAutomation> {
    return this.db.transaction(async (client) => {
      const row = (await client.query("SELECT * FROM odin_api.bot_automations WHERE id=$1", [id])).rows[0];
      if (!row) throw new ChatError("BOT_AUTOMATION_NOT_FOUND", "Automation not found.", 404);
      return automation(row);
    });
  }

  async createAutomation(
    instruction: string,
    parsed: ParsedAutomation,
    limits: BotPlanLimits,
    notificationPolicy: BotNotificationPolicy = "important",
  ): Promise<BotAutomation> {
    if (!limits.enabled) throw new ChatError("BOT_ENTITLEMENT_REQUIRED", "Odin Bot requires Pro or higher.", 403);
    const text = safeString(instruction, 4000, "Automation");
    const bot = await this.ensureDefaultBot();
    return this.db.transaction(async (client) => {
      const count = Number((await client.query("SELECT count(*)::int AS n FROM odin_api.bot_automations WHERE enabled")).rows[0]?.n ?? 0);
      if (count >= limits.maxAutomations)
        throw new ChatError("BOT_AUTOMATION_LIMIT", "Your Odin Bot automation limit is reached.", 409);
      const id = randomUUID();
      const row = (
        await client.query(
          `INSERT INTO odin_api.bot_automations(id,bot_id,name,instruction,trigger_type,trigger,action,notification_policy,next_wakeup_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [id, bot.id, parsed.name, text, parsed.triggerType, parsed.trigger, { goal: text, mode: "thinking" }, notificationPolicy, parsed.nextWakeupAt],
        )
      ).rows[0];
      if (parsed.nextWakeupAt) {
        await client.query(
          "SELECT odin_control.enqueue_bot_wakeup('automation',$1,$2,$3,50)",
          [id, parsed.nextWakeupAt, `automation:${id}:${parsed.nextWakeupAt}`],
        );
      }
      return automation(row);
    });
  }

  async fireAutomation(id: string, scheduledAt: string, limits: BotPlanLimits): Promise<BotTask | null> {
    const item = await this.automation(id);
    if (!item.enabled) return null;
    const goal = typeof item.action.goal === "string" ? item.action.goal : item.instruction;
    const mode = typeof item.action.mode === "string" ? (item.action.mode as ChatMode) : "thinking";
    const created = await this.createTask(
      { goal, mode, idempotencyKey: `automation:${id}:${scheduledAt}`, sourceAutomationId: id },
      limits,
    );
    const next = nextAutomationWake(item.trigger, new Date(scheduledAt));
    await this.db.transaction(async (client) => {
      await client.query(
        "UPDATE odin_api.bot_automations SET last_fired_at=$2,next_wakeup_at=$3,updated_at=now() WHERE id=$1",
        [id, scheduledAt, next],
      );
      if (next) {
        await client.query(
          "SELECT odin_control.enqueue_bot_wakeup('automation',$1,$2,$3,50)",
          [id, next, `automation:${id}:${next}`],
        );
      }
    });
    return created;
  }

  async deleteAutomation(id: string): Promise<void> {
    await this.db.transaction(async (client) => {
      const result = await client.query("DELETE FROM odin_api.bot_automations WHERE id=$1", [id]);
      if (!result.rowCount) throw new ChatError("BOT_AUTOMATION_NOT_FOUND", "Automation not found.", 404);
    });
  }

  async inbox(): Promise<BotInboxItem[]> {
    return this.db.transaction(async (client) =>
      (await client.query("SELECT * FROM odin_api.bot_inbox ORDER BY created_at DESC LIMIT 100")).rows.map((row) => ({
        id: row.id,
        taskId: row.task_id ?? null,
        category: row.category,
        title: row.title,
        body: row.body,
        action: row.action ?? {},
        readAt: iso(row.read_at),
        createdAt: iso(row.created_at) as string,
      })),
    );
  }

  async addInbox(taskId: string | null, category: BotInboxItem["category"], title: string, body: string, action: Record<string, unknown> = {}): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        "INSERT INTO odin_api.bot_inbox(id,task_id,category,title,body,action) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), taskId, category, safeString(title, 180, "Inbox title"), safeString(body, 2000, "Inbox body"), action],
      );
    });
  }
}

export class BotWakeQueue {
  constructor(readonly pool: Pool) {}

  async claim(workerId: string, leaseSeconds = 280, ownerId?: string): Promise<ClaimedWakeup | null> {
    const client = await this.pool.connect();
    const token = randomUUID();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query(
          `SELECT owner_id,id,kind,target_id,attempts FROM odin_control.bot_wakeups
           WHERE available_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<now())
           AND ($1::text IS NULL OR owner_id=$1)
           ORDER BY priority DESC,available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
          [ownerId ?? null],
        )
      ).rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const updated = (
        await client.query(
          `UPDATE odin_control.bot_wakeups SET lease_owner=$3,lease_token=$4,
           lease_expires_at=now()+$5*interval '1 second',attempts=attempts+1
           WHERE owner_id=$1 AND id=$2 RETURNING attempts`,
          [row.owner_id, row.id, workerId.slice(0, 160), token, leaseSeconds],
        )
      ).rows[0];
      await client.query("COMMIT");
      return { ownerId: row.owner_id, id: row.id, kind: row.kind, targetId: row.target_id, token, attempt: Number(updated.attempts) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async ack(item: ClaimedWakeup): Promise<void> {
    await this.pool.query(
      "DELETE FROM odin_control.bot_wakeups WHERE owner_id=$1 AND id=$2 AND lease_token=$3",
      [item.ownerId, item.id, item.token],
    );
  }

  async retry(item: ClaimedWakeup, delaySeconds: number): Promise<void> {
    await this.pool.query(
      `UPDATE odin_control.bot_wakeups SET available_at=now()+$4*interval '1 second',
       lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL
       WHERE owner_id=$1 AND id=$2 AND lease_token=$3`,
      [item.ownerId, item.id, item.token, Math.max(5, Math.min(3600, Math.trunc(delaySeconds)))],
    );
  }
}
""",
)

write(
    "src/bot/worker-auth.ts",
    r"""import { createRemoteJWKSet, jwtVerify } from "jose";
import { ChatError } from "../chat/types.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "odin-bot-worker";
const REPOSITORY = "clarityosbaerbelwesterop-gif/Odin-Agent-";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export async function verifyBotSchedulerAuthorization(header: string | undefined): Promise<void> {
  const match = /^Bearer\s+(.+)$/u.exec(header ?? "");
  if (!match) throw new ChatError("BOT_WORKER_UNAUTHORIZED", "Worker authorization is required.", 401);
  try {
    const { payload } = await jwtVerify(match[1], JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
    });
    if (
      payload.repository !== REPOSITORY ||
      payload.ref !== "refs/heads/main" ||
      !["schedule", "workflow_dispatch"].includes(String(payload.event_name ?? "")) ||
      typeof payload.workflow_ref !== "string" ||
      !payload.workflow_ref.startsWith(`${REPOSITORY}/.github/workflows/odin-bot-scheduler.yml@refs/heads/main`)
    )
      throw new Error("claim mismatch");
  } catch {
    throw new ChatError("BOT_WORKER_UNAUTHORIZED", "Worker authorization is invalid.", 401);
  }
}
""",
)

write(
    "src/bot/executor.ts",
    r"""import type { Pool } from "pg";
import { DEFAULT_CHAT_LIMITS } from "../chat/modes.js";
import { ChatEngine } from "../chat/engine.js";
import { GitHubWorkspace } from "../chat/github-workspace.js";
import { NeonActorDatabase } from "../chat/neon-database.js";
import { NeonChatStore, NeonMissionStore } from "../chat/neon-store.js";
import { NeonWorkspace } from "../chat/neon-workspace.js";
import { CredentialVault, effectivePlan, MODE_MINIMUM_PLAN, planAllows, ProductStore } from "../chat/product.js";
import { WikipediaResearchAdapter } from "../chat/research.js";
import { ChatError, type ChatModel } from "../chat/types.js";
import { botPlanLimits } from "./entitlements.js";
import { BotStore, BotWakeQueue } from "./store.js";
import type { ClaimedWakeup } from "./types.js";

export interface BotWorkerOptions {
  pool: Pool;
  baseModels: readonly ChatModel[];
  credentialEncryptionKey?: string;
}

export class OdinBotWorker {
  readonly queue: BotWakeQueue;
  constructor(readonly options: BotWorkerOptions) {
    this.queue = new BotWakeQueue(options.pool);
  }

  async runBatch(workerId: string, maxItems = 2, ownerId?: string) {
    const completed: Array<{ kind: string; targetId: string; result: string }> = [];
    const bounded = Math.max(1, Math.min(4, Math.trunc(maxItems)));
    for (let index = 0; index < bounded; index += 1) {
      const wake = await this.queue.claim(workerId, 280, ownerId);
      if (!wake) break;
      try {
        const result = wake.kind === "automation" ? await this.runAutomation(wake) : await this.runTask(wake);
        await this.queue.ack(wake);
        completed.push({ kind: wake.kind, targetId: wake.targetId, result });
      } catch (error) {
        if (wake.attempt >= 5) {
          await this.markPermanentFailure(wake, error);
          await this.queue.ack(wake);
          completed.push({ kind: wake.kind, targetId: wake.targetId, result: "failed" });
        } else {
          await this.markRetry(wake, error);
          await this.queue.retry(wake, Math.min(1800, 15 * 2 ** Math.max(0, wake.attempt - 1)));
          completed.push({ kind: wake.kind, targetId: wake.targetId, result: "retry" });
        }
      }
    }
    return { claimed: completed.length, completed };
  }

  private async runAutomation(wake: ClaimedWakeup): Promise<string> {
    const db = new NeonActorDatabase(this.options.pool, { id: wake.ownerId });
    const product = new ProductStore(db, new CredentialVault(this.options.credentialEncryptionKey));
    const account = await product.account();
    const limits = botPlanLimits(effectivePlan(account));
    if (!limits.enabled) return "entitlement-paused";
    const store = new BotStore(db);
    const automation = await store.automation(wake.targetId);
    if (!automation.enabled) return "disabled";
    await store.fireAutomation(automation.id, automation.nextWakeupAt ?? new Date().toISOString(), limits);
    return "fired";
  }

  private async runTask(wake: ClaimedWakeup): Promise<string> {
    const db = new NeonActorDatabase(this.options.pool, { id: wake.ownerId });
    const bot = new BotStore(db);
    let task = await bot.task(wake.targetId);
    if (["done", "cancelled", "failed", "blocked"].includes(task.status)) return task.status;

    const product = new ProductStore(db, new CredentialVault(this.options.credentialEncryptionKey));
    const account = await product.account();
    const plan = effectivePlan(account);
    const limits = botPlanLimits(plan);
    if (!limits.enabled) {
      await bot.updateTask(task.id, "blocked", "Pro entitlement required", "task.blocked", { code: "BOT_ENTITLEMENT_REQUIRED" });
      return "blocked";
    }
    const requiredPlan = MODE_MINIMUM_PLAN[task.mode];
    if (!planAllows(plan, requiredPlan)) {
      await bot.updateTask(task.id, "blocked", `Plan ${requiredPlan} required`, "task.blocked", { code: "MODE_ENTITLEMENT_REQUIRED" });
      return "blocked";
    }

    const availableModels = this.options.baseModels.filter((model) => planAllows(plan, model.plan ?? "free"));
    const selected = task.modelId
      ? availableModels.find((model) => model.id === task.modelId)
      : availableModels[0];
    if (!selected) {
      await bot.updateTask(task.id, "blocked", "No server model is available", "task.blocked", { code: "MODEL_UNAVAILABLE" });
      return "blocked";
    }

    const githubConnection = await product.github();
    const githubToken = githubConnection.connected ? await product.githubToken() : undefined;
    const githubReady = Boolean(
      githubConnection.connected && githubConnection.repository && githubConnection.defaultBranch && githubToken,
    );
    if (task.mode === "coding" && !githubReady) {
      await bot.updateTask(task.id, "blocked", "GitHub workspace required", "task.blocked", { code: "GITHUB_WORKSPACE_REQUIRED" });
      return "blocked";
    }

    let conversationId = task.conversationId;
    let turnId = task.turnId;
    const makeEngine = (id: string) => {
      const quality = githubReady
        ? new GitHubWorkspace(githubToken as string, githubConnection.repository as string, githubConnection.defaultBranch as string, async () => {})
        : new NeonWorkspace(db, id, async () => {});
      return new ChatEngine({
        store: new NeonChatStore(db),
        events: new NeonMissionStore(db),
        models: availableModels,
        autoRun: false,
        atomic: (action) => db.transaction(async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`bot:${wake.ownerId}:${id}`]);
          return action();
        }),
        limits: { ...DEFAULT_CHAT_LIMITS, maxTurnMs: Math.min(240_000, limits.maxTaskMinutes * 60_000) },
        allowWorkspaceWrites: true,
        quality,
        workspace: (changed) =>
          githubReady
            ? new GitHubWorkspace(githubToken as string, githubConnection.repository as string, githubConnection.defaultBranch as string, changed)
            : new NeonWorkspace(db, id, changed),
        research: new WikipediaResearchAdapter("de"),
      });
    };

    if (!conversationId || !turnId) {
      const chatStore = new NeonChatStore(db);
      const conversation = await chatStore.createConversation(`Odin Bot · ${task.goal.slice(0, 100)}`);
      conversationId = conversation.id;
      const engine = makeEngine(conversation.id);
      const turn = await engine.submit({
        conversationId: conversation.id,
        text: task.goal,
        mode: task.mode,
        modelId: selected.id,
        requestId: task.id,
      });
      turnId = turn.id;
      await bot.linkMission(task.id, conversationId, turnId);
      task = await bot.task(task.id);
    }

    await bot.updateTask(task.id, "working", "Executing durable mission", "runtime.started", { turnId });
    const engine = makeEngine(conversationId);
    await engine.execute(turnId);
    const view = await engine.view(turnId);
    await bot.saveCheckpoint(task.id, { missionState: view.state, missionVersion: view.version, usage: view.usage });
    if (view.state === "COMPLETED") {
      await bot.updateTask(task.id, "done", "Completed", "runtime.completed", { turnId });
      return "done";
    }
    if (view.state === "BLOCKED") {
      await bot.updateTask(task.id, "blocked", "Mission blocked", "runtime.blocked", { turnId });
      return "blocked";
    }
    if (view.state === "FAILED") {
      throw new ChatError("BOT_MISSION_FAILED", "The mission failed after verification and repair.", 500);
    }
    await bot.updateTask(task.id, "waiting", `Checkpointed at ${view.state}`, "runtime.checkpointed", { turnId, state: view.state });
    throw new ChatError("BOT_RESUME_REQUIRED", "The mission needs another durable execution quantum.", 503);
  }

  private async markRetry(wake: ClaimedWakeup, error: unknown): Promise<void> {
    if (wake.kind !== "task") return;
    const db = new NeonActorDatabase(this.options.pool, { id: wake.ownerId });
    const bot = new BotStore(db);
    const code = error instanceof ChatError ? error.code : "TRANSIENT_FAILURE";
    await bot.updateTask(wake.targetId, "waiting", "Retry scheduled", "runtime.retry", { code, attempt: wake.attempt });
  }

  private async markPermanentFailure(wake: ClaimedWakeup, error: unknown): Promise<void> {
    if (wake.kind !== "task") return;
    const db = new NeonActorDatabase(this.options.pool, { id: wake.ownerId });
    const bot = new BotStore(db);
    const code = error instanceof ChatError ? error.code : "WORKER_FAILURE";
    await bot.updateTask(wake.targetId, "failed", "Blocked after repeated failures", "runtime.failed", { code, attempts: wake.attempt });
    await bot.addInbox(wake.targetId, "important", "Odin Bot needs attention", "A background task could not recover after repeated attempts.", { taskId: wake.targetId });
  }
}
""",
)

write(
    "test/bot/entitlements.test.ts",
    r"""import assert from "node:assert/strict";
import test from "node:test";
import { botPlanLimits } from "../../src/bot/entitlements.js";

test("Odin Bot is server-entitled for Pro and above, never Free", () => {
  assert.equal(botPlanLimits("free", {}).enabled, false);
  assert.equal(botPlanLimits("pro", {}).enabled, true);
  assert.equal(botPlanLimits("developer", {}).enabled, true);
  assert.equal(botPlanLimits("ultra", {}).enabled, true);
});

test("Odin Bot quotas are configuration-driven without trusting browser state", () => {
  const limits = botPlanLimits("pro", { ODIN_BOT_PRO_MAX_ACTIVE_TASKS: "9", ODIN_BOT_PRO_MAX_AUTOMATIONS: "44" });
  assert.equal(limits.maxActiveTasks, 9);
  assert.equal(limits.maxAutomations, 44);
  assert.equal(botPlanLimits("pro", { ODIN_BOT_PRO_MAX_ACTIVE_TASKS: "not-a-number" }).maxActiveTasks, 3);
});
""",
)

write(
    "test/bot/wakeup.test.ts",
    r"""import assert from "node:assert/strict";
import test from "node:test";
import { nextAutomationWake, parseAutomationText } from "../../src/bot/wakeup.js";

test("natural daily automation becomes a durable scheduled wakeup", () => {
  const parsed = parseAutomationText("Jeden Morgen um 8 prüfe mein Projekt", "Europe/Berlin", new Date("2026-09-10T05:00:00Z"));
  assert.equal(parsed.triggerType, "schedule");
  assert.equal(parsed.display, "Every day · 08:00");
  assert.equal(parsed.nextWakeupAt, "2026-09-10T06:00:00.000Z");
});

test("interval automation enforces a non-spam floor", () => {
  const parsed = parseAutomationText("Alle 15 Minuten prüfe den Status", "UTC", new Date("2026-09-10T10:00:00Z"));
  assert.equal(parsed.nextWakeupAt, "2026-09-10T10:15:00.000Z");
  assert.throws(() => parseAutomationText("Alle 2 Minuten prüfen", "UTC"), /five minutes/u);
});

test("event instructions do not create pointless polling", () => {
  const parsed = parseAutomationText("Wenn GitHub CI fehlschlägt, repariere es", "Europe/Berlin");
  assert.equal(parsed.triggerType, "condition");
  assert.equal(parsed.trigger.source, "github");
  assert.equal(parsed.nextWakeupAt, null);
  assert.equal(nextAutomationWake(parsed.trigger), null);
});
""",
)

write(
    "scripts/bot-ui.test.mjs",
    r"""import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Odin Bot home exposes real task, schedule and inbox surfaces", async () => {
  const html = await readFile("web/bot.html", "utf8");
  const js = await readFile("web/bot.js", "utf8");
  assert.match(html, /What should I take care of\?/u);
  assert.match(html, /Active/u);
  assert.match(html, /Scheduled/u);
  assert.match(html, /Inbox/u);
  assert.match(js, /\/api\/bot\/tasks/u);
  assert.match(js, /\/api\/bot\/automations/u);
  assert.doesNotMatch(html, /demo|placeholder|fake activity/iu);
});
""",
)

write(
    "web/bot.html",
    r"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="description" content="Odin Bot — your persistent autonomous agent." />
    <title>Odin Bot</title>
    <link rel="stylesheet" href="/bot.css" />
  </head>
  <body>
    <div class="bot-shell">
      <header class="bot-topbar">
        <a class="brand" href="/app" aria-label="Back to Odin"><span>O</span> odin<span class="dot">.</span></a>
        <div class="top-actions"><span id="plan-pill">PRO</span><a href="/app">Missions</a></div>
      </header>

      <main>
        <section class="hero" aria-labelledby="bot-title">
          <p class="eyebrow">ODIN BOT</p>
          <h1 id="bot-title">Good evening.</h1>
          <p class="hero-copy">Hand over the responsibility. Odin keeps the state, wakes up when needed, and only pulls you back in when something matters.</p>
          <form id="task-form" class="command">
            <label class="sr-only" for="goal">Goal for Odin Bot</label>
            <textarea id="goal" maxlength="16000" rows="2" placeholder="What should I take care of?" required></textarea>
            <button type="submit" aria-label="Give task to Odin Bot">↑</button>
          </form>
          <div id="status" role="status" aria-live="polite"></div>
        </section>

        <section class="stream" aria-label="Odin Bot activity">
          <div class="section-head"><h2>Active</h2><span id="active-count">0</span></div>
          <div id="active" class="rows"><p class="empty">Nothing needs attention right now.</p></div>
        </section>

        <section class="stream scheduled" aria-label="Scheduled automations">
          <div class="section-head"><h2>Scheduled</h2><button id="schedule-toggle" type="button">Add</button></div>
          <form id="schedule-form" class="schedule-form" hidden>
            <input id="schedule-instruction" maxlength="4000" placeholder="Jeden Morgen um 8 prüfe mein Projekt" />
            <button type="submit">Schedule</button>
          </form>
          <div id="scheduled" class="rows"><p class="empty">No automations yet.</p></div>
        </section>

        <section class="stream" aria-label="Odin Bot inbox">
          <div class="section-head"><h2>Inbox</h2><span id="inbox-count">0</span></div>
          <div id="inbox" class="rows"><p class="empty">No approvals or alerts.</p></div>
        </section>

        <section class="stream" aria-label="Recent completed work">
          <div class="section-head"><h2>Recent</h2></div>
          <div id="recent" class="rows"><p class="empty">Completed work will appear here.</p></div>
        </section>
      </main>

      <dialog id="detail">
        <div class="detail-head"><div><p class="eyebrow">BACKGROUND TASK</p><h2 id="detail-goal">Task</h2></div><button id="detail-close" type="button" aria-label="Close">×</button></div>
        <div class="detail-status"><span id="detail-state">Queued</span><span id="detail-step"></span></div>
        <div id="events" class="events"></div>
        <details><summary>Advanced details</summary><dl id="advanced"></dl></details>
        <div class="detail-actions"><button id="stop-task" type="button">Stop task</button></div>
      </dialog>
    </div>
    <script type="module" src="/bot.js"></script>
  </body>
</html>
""",
)

write(
    "web/bot.js",
    r"""const $ = (id) => document.getElementById(id);
let snapshot = null;
let selectedTask = null;

async function api(path, options = {}) {
  const method = options.method ?? "GET";
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(method === "GET" ? {} : { "Content-Type": "application/json", "X-Odin-Request": "1" }),
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.assign(`/login?next=${encodeURIComponent("/bot")}`);
    throw new Error("Authentication required");
  }
  if (!response.ok) throw new Error(data.message ?? "Odin Bot request failed.");
  return data;
}

const terminal = new Set(["done", "cancelled", "failed", "blocked"]);
const statusLabel = (value) => ({ queued: "Queued", working: "Working", waiting: "Waiting", approval: "Needs approval", blocked: "Blocked", done: "Done", cancelled: "Stopped", failed: "Failed" })[value] ?? value;

function row(task) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-row";
  button.innerHTML = `<span class="task-copy"><strong></strong><small></small></span><span class="task-state"></span>`;
  button.querySelector("strong").textContent = task.goal;
  button.querySelector("small").textContent = task.currentStep;
  button.querySelector(".task-state").textContent = statusLabel(task.status);
  button.addEventListener("click", () => openTask(task.id));
  return button;
}

function renderRows(target, items, empty) {
  target.replaceChildren();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = empty;
    target.append(p);
    return;
  }
  items.forEach((item) => target.append(row(item)));
}

function render() {
  if (!snapshot) return;
  const tasks = snapshot.tasks ?? [];
  const active = tasks.filter((item) => !terminal.has(item.status));
  const recent = tasks.filter((item) => terminal.has(item.status)).slice(0, 8);
  $("active-count").textContent = String(active.length);
  renderRows($("active"), active, "Nothing needs attention right now.");
  renderRows($("recent"), recent, "Completed work will appear here.");

  const scheduled = $("scheduled");
  scheduled.replaceChildren();
  for (const item of snapshot.automations ?? []) {
    const node = document.createElement("div");
    node.className = "schedule-row";
    const when = item.nextWakeupAt ? new Date(item.nextWakeupAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Event driven";
    node.innerHTML = `<span><strong></strong><small></small></span><button type="button">Remove</button>`;
    node.querySelector("strong").textContent = item.name;
    node.querySelector("small").textContent = when;
    node.querySelector("button").addEventListener("click", async () => {
      await api(`/api/bot/automations/${item.id}`, { method: "DELETE", body: "{}" });
      await load();
    });
    scheduled.append(node);
  }
  if (!(snapshot.automations ?? []).length) scheduled.innerHTML = '<p class="empty">No automations yet.</p>';

  const inbox = $("inbox");
  inbox.replaceChildren();
  for (const item of snapshot.inbox ?? []) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "inbox-row";
    node.innerHTML = `<span><strong></strong><small></small></span><b></b>`;
    node.querySelector("strong").textContent = item.title;
    node.querySelector("small").textContent = item.body;
    node.querySelector("b").textContent = item.category.toUpperCase();
    if (item.taskId) node.addEventListener("click", () => openTask(item.taskId));
    inbox.append(node);
  }
  if (!(snapshot.inbox ?? []).length) inbox.innerHTML = '<p class="empty">No approvals or alerts.</p>';
  $("inbox-count").textContent = String((snapshot.inbox ?? []).filter((item) => !item.readAt).length);
  $("plan-pill").textContent = String(snapshot.limits?.plan ?? "pro").toUpperCase();
}

async function load() {
  try {
    snapshot = await api("/api/bot");
    render();
    $("status").textContent = "";
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function openTask(id) {
  const data = await api(`/api/bot/tasks/${id}`);
  selectedTask = data.task;
  $("detail-goal").textContent = selectedTask.goal;
  $("detail-state").textContent = statusLabel(selectedTask.status);
  $("detail-step").textContent = selectedTask.currentStep;
  const events = $("events");
  events.replaceChildren();
  for (const event of data.events ?? []) {
    const node = document.createElement("div");
    node.className = "event";
    const time = new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    node.innerHTML = `<time></time><span></span>`;
    node.querySelector("time").textContent = time;
    node.querySelector("span").textContent = String(event.data?.step ?? event.type);
    events.append(node);
  }
  const advanced = $("advanced");
  advanced.innerHTML = "";
  const details = {
    Agent: selectedTask.agent,
    Mode: selectedTask.mode,
    Priority: selectedTask.priority,
    "Last checkpoint": selectedTask.checkpointVersion,
    "Next wake-up": selectedTask.nextWakeupAt ? new Date(selectedTask.nextWakeupAt).toLocaleString() : "—",
    "Mission": selectedTask.turnId ?? "Not started",
  };
  for (const [name, value] of Object.entries(details)) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = String(value);
    advanced.append(dt, dd);
  }
  $("stop-task").hidden = terminal.has(selectedTask.status);
  $("detail").showModal();
}

$("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const goal = $("goal").value.trim();
  if (!goal) return;
  $("status").textContent = "Handing this to Odin…";
  try {
    const created = await api("/api/bot/tasks", {
      method: "POST",
      body: JSON.stringify({ goal, idempotencyKey: crypto.randomUUID() }),
    });
    $("goal").value = "";
    await load();
    if (created.task?.id) await openTask(created.task.id);
  } catch (error) {
    $("status").textContent = error.message;
  }
});

$("schedule-toggle").addEventListener("click", () => {
  $("schedule-form").hidden = !$("schedule-form").hidden;
  if (!$("schedule-form").hidden) $("schedule-instruction").focus();
});

$("schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const instruction = $("schedule-instruction").value.trim();
  if (!instruction) return;
  try {
    await api("/api/bot/automations", {
      method: "POST",
      body: JSON.stringify({ instruction, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    $("schedule-instruction").value = "";
    $("schedule-form").hidden = true;
    await load();
  } catch (error) {
    $("status").textContent = error.message;
  }
});

$("detail-close").addEventListener("click", () => $("detail").close());
$("stop-task").addEventListener("click", async () => {
  if (!selectedTask) return;
  await api(`/api/bot/tasks/${selectedTask.id}/control`, { method: "POST", body: JSON.stringify({ command: "cancel" }) });
  $("detail").close();
  await load();
});

await load();
setInterval(() => {
  if (document.visibilityState === "visible") void load();
}, 8000);
""",
)

write(
    "web/bot.css",
    r""":root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0a0a0b;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#202024 0,transparent 38%),#0a0a0b;min-height:100vh}.bot-shell{max-width:920px;margin:0 auto;padding:0 28px 80px}.bot-topbar{height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #232326}.brand{color:#fafafa;text-decoration:none;font-weight:650;letter-spacing:-.03em}.brand>span:first-child{display:inline-grid;place-items:center;width:28px;height:28px;margin-right:8px;border:1px solid #3a3a40;border-radius:9px}.dot{color:#9b87f5}.top-actions{display:flex;align-items:center;gap:16px;font-size:13px}.top-actions a{color:#a1a1aa;text-decoration:none}.top-actions a:hover{color:#fff}#plan-pill{font-size:10px;letter-spacing:.12em;border:1px solid #39393f;border-radius:99px;padding:5px 8px;color:#c4b5fd}.hero{padding:82px 0 58px}.eyebrow{font-size:11px;letter-spacing:.18em;color:#8b8b95;margin:0 0 16px}.hero h1{font-size:clamp(42px,7vw,68px);letter-spacing:-.055em;line-height:.98;margin:0 0 18px;font-weight:620}.hero-copy{max-width:630px;color:#8f8f98;font-size:17px;line-height:1.6;margin:0 0 34px}.command{display:flex;align-items:flex-end;gap:12px;border:1px solid #303036;background:#111113;border-radius:20px;padding:14px 14px 14px 18px;box-shadow:0 24px 70px #0006}.command:focus-within{border-color:#52525b}.command textarea{resize:none;flex:1;min-height:48px;background:transparent;border:0;outline:0;color:#fafafa;font:inherit;font-size:17px;line-height:1.4}.command textarea::placeholder{color:#62626b}.command button{width:42px;height:42px;border:0;border-radius:13px;background:#f4f4f5;color:#111;font-size:22px;cursor:pointer}.command button:hover{background:#fff}#status{min-height:22px;padding:10px 4px 0;color:#a1a1aa;font-size:13px}.stream{padding:28px 0;border-top:1px solid #232326}.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.section-head h2{font-size:14px;font-weight:580;margin:0;color:#e4e4e7}.section-head>span{font-size:12px;color:#71717a}.section-head button{border:0;background:transparent;color:#a78bfa;cursor:pointer}.rows{display:grid}.task-row,.inbox-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:20px;text-align:left;background:transparent;border:0;border-radius:12px;padding:14px 10px;color:inherit;cursor:pointer}.task-row:hover,.inbox-row:hover{background:#121215}.task-copy,.schedule-row>span,.inbox-row>span{display:grid;gap:4px;min-width:0}.task-copy strong,.schedule-row strong,.inbox-row strong{font-size:14px;font-weight:520;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.task-copy small,.schedule-row small,.inbox-row small{font-size:12px;color:#71717a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.task-state{font-size:12px;color:#a1a1aa;white-space:nowrap}.empty{margin:10px;color:#5f5f68;font-size:13px}.schedule-form{display:flex;gap:8px;padding:8px 0 14px}.schedule-form input{flex:1;border:1px solid #303036;border-radius:12px;background:#111113;padding:12px 14px;color:#fff;outline:none}.schedule-form button,.schedule-row button{border:1px solid #303036;background:#151518;color:#d4d4d8;border-radius:10px;padding:9px 12px;cursor:pointer}.schedule-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 10px}.inbox-row b{font-size:9px;letter-spacing:.1em;color:#c4b5fd}dialog{width:min(680px,calc(100% - 28px));border:1px solid #303036;border-radius:22px;background:#111113;color:#f4f4f5;padding:24px;box-shadow:0 30px 120px #000c}dialog::backdrop{background:#000b;backdrop-filter:blur(8px)}.detail-head{display:flex;justify-content:space-between;gap:20px}.detail-head h2{font-size:24px;letter-spacing:-.035em;margin:0}.detail-head>button{border:0;background:transparent;color:#a1a1aa;font-size:24px;cursor:pointer}.detail-status{display:flex;gap:12px;align-items:center;padding:20px 0;color:#a1a1aa;font-size:13px}.detail-status span:first-child{color:#d8b4fe}.events{border-top:1px solid #27272a;border-bottom:1px solid #27272a;padding:10px 0;max-height:270px;overflow:auto}.event{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:8px 4px;font-size:13px}.event time{color:#5f5f68}.event span{color:#d4d4d8}details{padding:16px 2px}summary{cursor:pointer;color:#a1a1aa;font-size:12px}dl{display:grid;grid-template-columns:140px 1fr;gap:8px 14px;font-size:12px}dt{color:#71717a}dd{margin:0;color:#d4d4d8;overflow-wrap:anywhere}.detail-actions{display:flex;justify-content:flex-end}.detail-actions button{border:1px solid #3f3f46;background:transparent;color:#d4d4d8;border-radius:10px;padding:9px 12px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:640px){.bot-shell{padding:0 16px 60px}.bot-topbar{height:60px}.hero{padding:56px 0 42px}.hero-copy{font-size:15px}.command{border-radius:17px}.task-row,.inbox-row{padding:14px 4px}.task-state{max-width:92px;overflow:hidden;text-overflow:ellipsis}.schedule-form{display:grid}.schedule-row{padding-left:4px;padding-right:4px}}
""",
)

write(
    ".github/workflows/odin-bot-scheduler.yml",
    r"""name: Odin Bot durable scheduler

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: odin-bot-durable-scheduler
  cancel-in-progress: false

jobs:
  wake:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: Wake due Odin Bot work with GitHub OIDC
        shell: bash
        run: |
          set -euo pipefail
          RESPONSE="$(curl --fail-with-body --silent --show-error \
            -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
            "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=odin-bot-worker")"
          TOKEN="$(python -c 'import json,sys; print(json.load(sys.stdin)["value"])' <<<"${RESPONSE}")"
          curl --fail-with-body --silent --show-error \
            -H "Authorization: Bearer ${TOKEN}" \
            "https://odin-agent-xi.vercel.app/api/bot/worker"
""",
)

# Hosted server wiring.
replace_once(
    "src/chat/hosted.ts",
    'import { attachDatabasePool, waitUntil } from "@vercel/functions";\n',
    'import { attachDatabasePool, waitUntil } from "@vercel/functions";\nimport { botPlanLimits } from "../bot/entitlements.js";\nimport { OdinBotWorker } from "../bot/executor.js";\nimport { BotStore } from "../bot/store.js";\nimport { verifyBotSchedulerAuthorization } from "../bot/worker-auth.js";\nimport { parseAutomationText } from "../bot/wakeup.js";\n',
)
replace_once(
    "src/chat/hosted.ts",
    '''    const { auth, pool, models } = services;\n    if (url.pathname === "/api/auth/github/finalize" && method === "POST") {\n''',
    '''    const { auth, pool, models } = services;\n    if (url.pathname === "/api/bot/worker" && method === "GET") {\n      await verifyBotSchedulerAuthorization(\n        typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,\n      );\n      const worker = new OdinBotWorker({\n        pool,\n        baseModels: models,\n        credentialEncryptionKey: process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY,\n      });\n      send(res, 200, await worker.runBatch("github-oidc-scheduler", 3));\n      return;\n    }\n    if (url.pathname === "/api/auth/github/finalize" && method === "POST") {\n''',
)
replace_once(
    "src/chat/hosted.ts",
    '''    const availableModels = [...models, ...(await byokModels(product))];\n    const store = new NeonChatStore(db);\n''',
    '''    const availableModels = [...models, ...(await byokModels(product))];\n    const store = new NeonChatStore(db);\n    const botStore = new BotStore(db);\n    const botAccess = async () => {\n      const account = await product.account();\n      const plan = effectivePlan(account);\n      const limits = botPlanLimits(plan);\n      if (!limits.enabled)\n        throw new ChatError("BOT_ENTITLEMENT_REQUIRED", "Odin Bot requires Pro or higher.", 403);\n      return { account, plan, limits };\n    };\n''',
)
insert_anchor = '''    if (url.pathname === "/api/providers" && method === "GET") {\n'''
bot_routes = '''    if (url.pathname === "/api/bot" && method === "GET") {\n      const { limits } = await botAccess();\n      send(res, 200, {\n        bot: await botStore.ensureDefaultBot(),\n        tasks: await botStore.tasks(),\n        automations: await botStore.automations(),\n        inbox: await botStore.inbox(),\n        limits,\n        runtime: {\n          durable: true,\n          browserIndependent: true,\n          scheduler: "github-oidc",\n          wakeCadenceMinutes: 5,\n        },\n      });\n      return;\n    }\n    if (url.pathname === "/api/bot/tasks" && method === "POST") {\n      await rate(db, "bot-tasks", 20, 60);\n      const { limits } = await botAccess();\n      const body = object(await jsonBody(req), [\n        "goal",\n        "mode",\n        "modelId",\n        "priority",\n        "idempotencyKey",\n      ]);\n      const mode = ["chat", "thinking", "research", "coding", "ultra"].includes(\n        String(body.mode ?? "thinking"),\n      )\n        ? (String(body.mode ?? "thinking") as keyof typeof MODE_MINIMUM_PLAN)\n        : "thinking";\n      const requiredPlan = MODE_MINIMUM_PLAN[mode];\n      if (!planAllows((await botAccess()).plan, requiredPlan))\n        throw new ChatError(\n          "ENTITLEMENT_REQUIRED",\n          `This bot task requires the ${requiredPlan} plan.`,\n          403,\n        );\n      const task = await botStore.createTask(\n        {\n          goal: typeof body.goal === "string" ? body.goal : "",\n          mode,\n          modelId: typeof body.modelId === "string" ? body.modelId : null,\n          priority: typeof body.priority === "number" ? body.priority : 50,\n          idempotencyKey:\n            typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,\n        },\n        limits,\n      );\n      const worker = new OdinBotWorker({\n        pool,\n        baseModels: models,\n        credentialEncryptionKey: process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY,\n      });\n      waitUntil(worker.runBatch(`request:${identity.id}`, 1, identity.id));\n      send(res, 202, { task });\n      return;\n    }\n    const botTaskRoute = /^\\/api\\/bot\\/tasks\\/([\\w-]+)(?:\\/(control))?$/u.exec(\n      url.pathname,\n    );\n    if (botTaskRoute) {\n      const taskId = identifier(botTaskRoute[1]);\n      await botAccess();\n      if (!botTaskRoute[2] && method === "GET") {\n        send(res, 200, { task: await botStore.task(taskId), events: await botStore.events(taskId) });\n        return;\n      }\n      if (botTaskRoute[2] === "control" && method === "POST") {\n        const body = object(await jsonBody(req), ["command"]);\n        if (body.command !== "cancel")\n          throw new ChatError("INVALID_COMMAND", "Only cancel is available in this milestone.");\n        send(res, 200, { task: await botStore.cancel(taskId) });\n        return;\n      }\n    }\n    if (url.pathname === "/api/bot/automations/parse" && method === "POST") {\n      await botAccess();\n      const body = object(await jsonBody(req), ["instruction", "timeZone"]);\n      send(\n        res,\n        200,\n        parseAutomationText(\n          typeof body.instruction === "string" ? body.instruction : "",\n          typeof body.timeZone === "string" ? body.timeZone : "UTC",\n        ),\n      );\n      return;\n    }\n    if (url.pathname === "/api/bot/automations") {\n      const { limits } = await botAccess();\n      if (method === "GET") {\n        send(res, 200, { automations: await botStore.automations() });\n        return;\n      }\n      if (method === "POST") {\n        await rate(db, "bot-automations", 10, 60);\n        const body = object(await jsonBody(req), ["instruction", "timeZone", "notificationPolicy"]);\n        const instruction = typeof body.instruction === "string" ? body.instruction : "";\n        const parsed = parseAutomationText(\n          instruction,\n          typeof body.timeZone === "string" ? body.timeZone : "UTC",\n        );\n        const notificationPolicy = ["critical", "important", "all", "digest", "silent"].includes(\n          String(body.notificationPolicy ?? "important"),\n        )\n          ? (String(body.notificationPolicy ?? "important") as\n              | "critical"\n              | "important"\n              | "all"\n              | "digest"\n              | "silent")\n          : "important";\n        send(\n          res,\n          201,\n          await botStore.createAutomation(instruction, parsed, limits, notificationPolicy),\n        );\n        return;\n      }\n    }\n    const botAutomationRoute = /^\\/api\\/bot\\/automations\\/([\\w-]+)$/u.exec(url.pathname);\n    if (botAutomationRoute && method === "DELETE") {\n      await botAccess();\n      await jsonBody(req);\n      await botStore.deleteAutomation(identifier(botAutomationRoute[1]));\n      send(res, 200, { deleted: true });\n      return;\n    }\n'''
replace_once("src/chat/hosted.ts", insert_anchor, bot_routes + insert_anchor)

replace_once(
    "src/chat/hosted.ts",
    '''        execution: "request",\n        workspace: githubWorkspaceReady\n''',
    '''        execution: "request",\n        bot: {\n          available: botPlanLimits(effectivePlan(account)).enabled,\n          durable: true,\n          path: "/bot",\n        },\n        workspace: githubWorkspaceReady\n''',
)
replace_once(
    "src/chat/hosted.ts",
    '''          "events",\n        ];\n''',
    '''          "events",\n          "bots",\n          "bot_tasks",\n          "bot_task_events",\n          "bot_automations",\n          "bot_inbox",\n        ];\n''',
)
replace_once(
    "src/chat/hosted.ts",
    '''          "rate_limits",\n          "oauth_states",\n''',
    '''          "rate_limits",\n          "bot_inbox",\n          "bot_task_events",\n          "bot_automations",\n          "bot_tasks",\n          "bots",\n          "oauth_states",\n''',
)

# Product navigation and build/test surface.
replace_once(
    "web/chat.html",
    '''        <button id="chat-view" type="button" class="nav-item selected">Missionen <span>01</span></button>\n        <button id="models-view" type="button" class="nav-item">Modelle <span id="model-count-nav">0</span></button>\n''',
    '''        <button id="chat-view" type="button" class="nav-item selected">Missionen <span>01</span></button>\n        <a href="/bot" class="nav-item">Odin Bot <span>PRO</span></a>\n        <button id="models-view" type="button" class="nav-item">Modelle <span id="model-count-nav">0</span></button>\n''',
)

replace_once(
    "package.json",
    'node --test scripts/workspace-ui.test.mjs',
    'node --test scripts/workspace-ui.test.mjs && node --test scripts/bot-ui.test.mjs',
)

replace_once(
    "vercel.json",
    '''    {\n      "source": "/app",\n      "destination": "/chat.html"\n    },\n''',
    '''    {\n      "source": "/app",\n      "destination": "/chat.html"\n    },\n    {\n      "source": "/bot",\n      "destination": "/bot.html"\n    },\n''',
)
replace_once(
    "vercel.json",
    '''    {\n      "source": "/reference",\n      "headers": [\n''',
    '''    {\n      "source": "/bot",\n      "headers": [\n        {\n          "key": "Content-Security-Policy",\n          "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"\n        },\n        {\n          "key": "X-Frame-Options",\n          "value": "DENY"\n        }\n      ]\n    },\n    {\n      "source": "/reference",\n      "headers": [\n''',
)

# Production additive migration + worker control-plane grant.
replace_once(
    "scripts/sync-vercel-production.mjs",
    'import { writeFile } from "node:fs/promises";\n',
    'import { readFile, writeFile } from "node:fs/promises";\n',
)
replace_once(
    "scripts/sync-vercel-production.mjs",
    '''  try {\n    const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [SCOPE.appRole]);\n''',
    '''  try {\n    const botMigration = await readFile(\n      new URL("../migrations/006_odin_bot_m1_m3.sql", import.meta.url),\n      "utf8",\n    );\n    await pool.query(botMigration);\n    report.checks.push("Odin Bot M1-M3 additive schema reconciled");\n\n    const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [SCOPE.appRole]);\n''',
)
replace_once(
    "scripts/sync-vercel-production.mjs",
    '''    await pool.query(`GRANT odin_runtime TO ${SCOPE.appRole} WITH INHERIT FALSE, SET TRUE`);\n    const checked = (\n''',
    '''    await pool.query(`GRANT odin_runtime TO ${SCOPE.appRole} WITH INHERIT FALSE, SET TRUE`);\n    await pool.query(`GRANT USAGE ON SCHEMA odin_control TO ${SCOPE.appRole}`);\n    await pool.query(\n      `GRANT SELECT,INSERT,UPDATE,DELETE ON odin_control.bot_wakeups TO ${SCOPE.appRole}`,\n    );\n    const checked = (\n''',
)

# Production verification understands the new split: all user tables FORCE RLS; scheduler index is non-public metadata only.
replace_once(
    "scripts/verify-neon-production.mjs",
    '    assert(tables.rows.length >= 18, "ODIN_TABLE_COUNT");\n',
    '    assert(tables.rows.length >= 23, "ODIN_TABLE_COUNT");\n',
)
replace_once(
    "scripts/verify-neon-production.mjs",
    '''    report.checks.push(\n      `${tables.rows.length} odin_api tables enforce RLS + FORCE RLS with policies`,\n    );\n\n    const runtimeRole = (\n''',
    '''    report.checks.push(\n      `${tables.rows.length} odin_api tables enforce RLS + FORCE RLS with policies`,\n    );\n    const botTables = new Set(["bots", "bot_tasks", "bot_task_events", "bot_automations", "bot_inbox"]);\n    for (const name of botTables) assert(tables.rows.some((row) => row.table_name === name), `BOT_TABLE_${name}`);\n    const control = await pool.query(\n      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace\n       WHERE n.nspname='odin_control' AND c.relname='bot_wakeups' AND c.relkind='r'`,\n    );\n    assert.equal(control.rows.length, 1, "BOT_WAKEUP_CONTROL_PLANE");\n    report.checks.push("Odin Bot user state is FORCE-RLS isolated and durable wakeups use a payload-free control index");\n\n    const runtimeRole = (\n''',
)
