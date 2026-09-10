import type { ChatMode, ProductPlan } from "../chat/types.js";

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
