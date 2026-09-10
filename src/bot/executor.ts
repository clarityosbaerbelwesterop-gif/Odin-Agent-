import type { Pool } from "pg";
import { ChatEngine } from "../chat/engine.js";
import { GitHubWorkspace } from "../chat/github-workspace.js";
import { DEFAULT_CHAT_LIMITS } from "../chat/modes.js";
import { NeonActorDatabase } from "../chat/neon-database.js";
import { NeonChatStore, NeonMissionStore } from "../chat/neon-store.js";
import { NeonWorkspace } from "../chat/neon-workspace.js";
import {
  CredentialVault,
  effectivePlan,
  MODE_MINIMUM_PLAN,
  ProductStore,
  planAllows,
} from "../chat/product.js";
import { WikipediaResearchAdapter } from "../chat/research.js";
import { ChatError, type ChatModel } from "../chat/types.js";
import { botPlanLimits } from "./entitlements.js";
import { BotStore, BotWakeQueue } from "./store.js";
import type { ClaimedWakeup } from "./types.js";

export interface BotWorkerOptions {
  pool: Pool;
  baseModels: readonly ChatModel[];
  credentialEncryptionKey?: string | undefined;
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
        const result =
          wake.kind === "automation" ? await this.runAutomation(wake) : await this.runTask(wake);
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
    await store.fireAutomation(
      automation.id,
      automation.nextWakeupAt ?? new Date().toISOString(),
      limits,
    );
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
      await bot.updateTask(task.id, "blocked", "Pro entitlement required", "task.blocked", {
        code: "BOT_ENTITLEMENT_REQUIRED",
      });
      return "blocked";
    }
    const requiredPlan = MODE_MINIMUM_PLAN[task.mode];
    if (!planAllows(plan, requiredPlan)) {
      await bot.updateTask(task.id, "blocked", `Plan ${requiredPlan} required`, "task.blocked", {
        code: "MODE_ENTITLEMENT_REQUIRED",
      });
      return "blocked";
    }

    const availableModels = this.options.baseModels.filter((model) =>
      planAllows(plan, model.plan ?? "free"),
    );
    const selected = task.modelId
      ? availableModels.find((model) => model.id === task.modelId)
      : availableModels[0];
    if (!selected) {
      await bot.updateTask(task.id, "blocked", "No server model is available", "task.blocked", {
        code: "MODEL_UNAVAILABLE",
      });
      return "blocked";
    }

    const githubConnection = await product.github();
    const githubToken = githubConnection.connected ? await product.githubToken() : undefined;
    const githubReady = Boolean(
      githubConnection.connected &&
        githubConnection.repository &&
        githubConnection.defaultBranch &&
        githubToken,
    );
    if (task.mode === "coding" && !githubReady) {
      await bot.updateTask(task.id, "blocked", "GitHub workspace required", "task.blocked", {
        code: "GITHUB_WORKSPACE_REQUIRED",
      });
      return "blocked";
    }

    let conversationId = task.conversationId;
    let turnId = task.turnId;
    const makeEngine = (id: string) => {
      const quality = githubReady
        ? new GitHubWorkspace(
            githubToken as string,
            githubConnection.repository as string,
            githubConnection.defaultBranch as string,
            async () => {},
          )
        : new NeonWorkspace(db, id, async () => {});
      return new ChatEngine({
        store: new NeonChatStore(db),
        events: new NeonMissionStore(db),
        models: availableModels,
        autoRun: false,
        atomic: (action) =>
          db.transaction(async (client) => {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
              `bot:${wake.ownerId}:${id}`,
            ]);
            return action();
          }),
        limits: {
          ...DEFAULT_CHAT_LIMITS,
          maxTurnMs: Math.min(240_000, limits.maxTaskMinutes * 60_000),
        },
        allowWorkspaceWrites: true,
        quality,
        workspace: (changed) =>
          githubReady
            ? new GitHubWorkspace(
                githubToken as string,
                githubConnection.repository as string,
                githubConnection.defaultBranch as string,
                changed,
              )
            : new NeonWorkspace(db, id, changed),
        research: new WikipediaResearchAdapter("de"),
      });
    };

    if (!conversationId || !turnId) {
      const chatStore = new NeonChatStore(db);
      const conversation = await chatStore.createConversation(
        `Odin Bot · ${task.goal.slice(0, 100)}`,
      );
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

    await bot.updateTask(task.id, "working", "Executing durable mission", "runtime.started", {
      turnId,
    });
    const engine = makeEngine(conversationId);
    await engine.execute(turnId);
    const view = await engine.view(turnId);
    await bot.saveCheckpoint(task.id, {
      missionState: view.state,
      missionVersion: view.version,
      usage: view.usage,
    });
    if (view.state === "COMPLETED") {
      await bot.updateTask(task.id, "done", "Completed", "runtime.completed", { turnId });
      return "done";
    }
    if (view.state === "BLOCKED") {
      await bot.updateTask(task.id, "blocked", "Mission blocked", "runtime.blocked", { turnId });
      return "blocked";
    }
    if (view.state === "FAILED") {
      throw new ChatError(
        "BOT_MISSION_FAILED",
        "The mission failed after verification and repair.",
        500,
      );
    }
    await bot.updateTask(
      task.id,
      "waiting",
      `Checkpointed at ${view.state}`,
      "runtime.checkpointed",
      { turnId, state: view.state },
    );
    throw new ChatError(
      "BOT_RESUME_REQUIRED",
      "The mission needs another durable execution quantum.",
      503,
    );
  }

  private async markRetry(wake: ClaimedWakeup, error: unknown): Promise<void> {
    if (wake.kind !== "task") return;
    const db = new NeonActorDatabase(this.options.pool, { id: wake.ownerId });
    const bot = new BotStore(db);
    const code = error instanceof ChatError ? error.code : "TRANSIENT_FAILURE";
    await bot.updateTask(wake.targetId, "waiting", "Retry scheduled", "runtime.retry", {
      code,
      attempt: wake.attempt,
    });
  }

  private async markPermanentFailure(wake: ClaimedWakeup, error: unknown): Promise<void> {
    if (wake.kind !== "task") return;
    const db = new NeonActorDatabase(this.options.pool, { id: wake.ownerId });
    const bot = new BotStore(db);
    const code = error instanceof ChatError ? error.code : "WORKER_FAILURE";
    await bot.updateTask(
      wake.targetId,
      "failed",
      "Blocked after repeated failures",
      "runtime.failed",
      { code, attempts: wake.attempt },
    );
    await bot.addInbox(
      wake.targetId,
      "important",
      "Odin Bot needs attention",
      "A background task could not recover after repeated attempts.",
      { taskId: wake.targetId },
    );
  }
}
