import type { ProductPlan } from "../chat/types.js";
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

function configured(
  env: NodeJS.ProcessEnv,
  plan: ProductPlan,
  field: string,
  fallback: number,
): number {
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
