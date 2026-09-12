import type { Pool } from "pg";
import { ChatEngine } from "../chat/engine.js";
import { GitHubPullRequestClient } from "../chat/github-delivery.js";
import { GitHubWorkspaceSession } from "../chat/github-workspace-session.js";
import { DEFAULT_CHAT_LIMITS } from "../chat/modes.js";
import { type ActorDatabase, NeonActorDatabase } from "../chat/neon-database.js";
import { NeonChatStore, NeonMissionStore } from "../chat/neon-store.js";
import { NeonWorkspace } from "../chat/neon-workspace.js";
import {
  CredentialVault,
  MODE_MINIMUM_PLAN,
  ProductStore,
  planAllows,
  runtimePlan,
} from "../chat/product.js";
import { QuotaStore } from "../chat/quota.js";
import { WikipediaResearchAdapter } from "../chat/research.js";
import { ChatError, type ChatMode, type ChatModel, type ProductPlan } from "../chat/types.js";
import { botRuntimeAccess } from "./autonomy.js";
import { BotControlStore } from "./control-store.js";
import { botPlanLimits } from "./entitlements.js";
import { GitHubEventBridge } from "./github-events.js";
import { BotStore, BotWakeQueue } from "./store.js";
import { type BotTeamAssignment, planBotTeam, specialistPrompt } from "./team.js";
import type { ClaimedWakeup } from "./types.js";

export interface BotWorkerOptions {
  pool: Pool;
  baseModels: readonly ChatModel[];
  credentialEncryptionKey?: string | undefined;
  publicOrigin?: string | undefined;
}

interface SpecialistRunResult {
  readonly assignment: BotTeamAssignment;
  readonly state: string;
  readonly answer: string;
  readonly conversationId: string;
  readonly turnId: string;
}

const BOT_MODEL_PRIORITY: Readonly<Record<ChatMode, readonly string[]>> = Object.freeze({
  chat: ["unorouter-gpt-5-6-luna", "gpt-oss-120b", "gpt-oss-20b"],
  thinking: [
    "unorouter-gpt-5-6-luna",
    "unorouter-claude-fable-5-1",
    "gpt-oss-120b",
    "kimi",
    "deepseek-v4-flash",
  ],
  research: ["unorouter-gpt-5-6-luna", "unorouter-claude-fable-5-1", "gpt-oss-120b", "kimi"],
  coding: [
    "unorouter-claude-opus-5",
    "unorouter-claude-fable-5-1",
    "kimi",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "mistral-medium-3-5",
    "gpt-oss-120b",
  ],
  ultra: [
    "unorouter-claude-opus-5",
    "unorouter-claude-fable-5-1",
    "kimi",
    "deepseek-v4-pro",
    "mistral-medium-3-5",
  ],
});

export function selectBotModel(
  models: readonly ChatModel[],
  plan: ProductPlan,
  mode: ChatMode,
  requestedId?: string | null,
): ChatModel | undefined {
  const available = models.filter((model) => planAllows(plan, model.plan ?? "free"));
  if (requestedId) return available.find((model) => model.id === requestedId);
  for (const id of BOT_MODEL_PRIORITY[mode]) {
    const match = available.find((model) => model.id === id);
    if (match) return match;
  }
  return available[0];
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
        // A durable execution quantum ending is normal continuation, not a failure attempt.
        // Requeue it with a fresh failure budget so multi-quantum missions do not fail merely
        // because a serverless execution window ended safely.
        if (error instanceof ChatError && error.code === "BOT_RESUME_REQUIRED") {
          await this.queue.retry(wake, 5);
          await this.options.pool.query(
            `UPDATE odin_control.bot_wakeups SET attempts=0
             WHERE owner_id=$1 AND id=$2 AND lease_owner IS NULL AND lease_token IS NULL`,
            [wake.ownerId, wake.id],
          );
          completed.push({ kind: wake.kind, targetId: wake.targetId, result: "waiting" });
          continue;
        }
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
    const limits = botPlanLimits(runtimePlan(account));
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
    const control = new BotControlStore(db);
    let task = await bot.task(wake.targetId);
    if (["done", "cancelled", "failed", "blocked"].includes(task.status)) return task.status;

    const product = new ProductStore(db, new CredentialVault(this.options.credentialEncryptionKey));
    const account = await product.account();
    const plan = runtimePlan(account);
    const quota = new QuotaStore(db, plan);
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
    const selected = selectBotModel(availableModels, plan, task.mode, task.modelId);
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

    const continuation = await control.resolveContinuation(task.goal, task.id);
    const objective = continuation?.objective || task.goal;
    const continuityContext =
      continuation && continuation.taskId !== task.id
        ? `Continuation of task ${continuation.taskId}. Stored primary objective: ${continuation.objective}`
        : "";
    const botIdentity = await bot.ensureDefaultBot();
    const runtimeAccess = botRuntimeAccess(botIdentity.autonomyLevel);
    const readToolsAllowed = runtimeAccess.readToolsAllowed;
    const taskWorkspaceWritesRequested =
      task.mode === "coding" && task.permissions.workspaceWrites === true;
    const workspaceWritesAllowed =
      runtimeAccess.workspaceWritesAllowed && taskWorkspaceWritesRequested;
    const teamPlan = planBotTeam(objective, task.mode, limits.maxParallelTasks);
    await control.ensureFocus(
      task.id,
      objective,
      structuredClone(teamPlan) as unknown as Record<string, unknown>,
    );
    await emitBotEvent(db, task.id, "team.planned", {
      planHash: teamPlan.planHash,
      primary: teamPlan.primary,
      modelId: selected.id,
      provider: selected.provider.id,
      assignments: teamPlan.assignments.map((assignment) => ({
        specialistId: assignment.specialistId,
        phase: assignment.phase,
        mayWriteWorkspace: assignment.mayWriteWorkspace,
        effectiveMayWriteWorkspace: assignment.mayWriteWorkspace && workspaceWritesAllowed,
      })),
      autonomyLevel: botIdentity.autonomyLevel,
      readToolsAllowed,
      taskWorkspaceWritesRequested,
      workspaceWritesAllowed,
    });

    let conversationId = task.conversationId;
    let turnId = task.turnId;
    const checkpointWorkBranch =
      typeof task.checkpoint.workBranch === "string" ? task.checkpoint.workBranch : undefined;
    const checkpointWrites = Array.isArray(task.checkpoint.workspaceChanges)
      ? task.checkpoint.workspaceChanges.flatMap((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const item = value as Record<string, unknown>;
          return typeof item.path === "string" && typeof item.sha === "string"
            ? [{ path: item.path, sha: item.sha }]
            : [];
        })
      : [];
    let primaryGitHubSession: GitHubWorkspaceSession | undefined;
    const makeEngine = (id: string, requestedWorkspaceWrites: boolean) => {
      const allowWorkspaceWrites = requestedWorkspaceWrites && workspaceWritesAllowed;
      const restore =
        requestedWorkspaceWrites && checkpointWorkBranch
          ? { branch: checkpointWorkBranch, writes: checkpointWrites }
          : undefined;
      const githubSession =
        readToolsAllowed && githubReady
          ? new GitHubWorkspaceSession(
              githubToken as string,
              githubConnection.repository as string,
              githubConnection.defaultBranch as string,
              undefined,
              restore,
            )
          : undefined;
      if (requestedWorkspaceWrites && githubSession) primaryGitHubSession = githubSession;
      const quality = readToolsAllowed
        ? (githubSession ?? new NeonWorkspace(db, id, async () => {}))
        : undefined;
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
        allowWorkspaceWrites,
        ...(quality
          ? {
              quality,
              workspace: (changed) =>
                githubSession
                  ? githubSession.workspace(changed)
                  : new NeonWorkspace(db, id, changed),
            }
          : {}),
        ...(readToolsAllowed ? { research: new WikipediaResearchAdapter("de") } : {}),
        quota,
      });
    };

    const preflightAssignments = teamPlan.assignments.filter(
      (assignment) => assignment.phase === "preflight",
    );
    const preflightResults =
      !conversationId && preflightAssignments.length > 0
        ? await Promise.all(
            preflightAssignments.map((assignment) =>
              this.runReadOnlySpecialist(
                db,
                bot,
                task.id,
                assignment,
                objective,
                continuityContext,
                selected.id,
                makeEngine,
              ),
            ),
          )
        : [];
    const preflightContext = [
      continuityContext,
      ...preflightResults
        .filter((result) => result.state === "COMPLETED" && result.answer)
        .map((result) => `${result.assignment.specialistId}: ${result.answer}`),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12000);

    const primary = teamPlan.assignments.find((assignment) => assignment.phase === "primary");
    if (!primary)
      throw new ChatError("BOT_TEAM_INVALID", "Odin Bot team plan has no primary agent.", 500);

    if (!conversationId || !turnId) {
      const chatStore = new NeonChatStore(db);
      const conversation = await chatStore.createConversation(
        `Odin Bot · ${task.goal.slice(0, 100)}`,
      );
      conversationId = conversation.id;
      const engine = makeEngine(conversation.id, primary.mayWriteWorkspace);
      const turn = await engine.submit({
        conversationId: conversation.id,
        text: specialistPrompt(primary, objective, preflightContext),
        mode: primary.mode,
        modelId: selected.id,
        requestId: task.id,
      });
      turnId = turn.id;
      await bot.linkMission(task.id, conversationId, turnId);
      task = await bot.task(task.id);
    }

    await bot.updateTask(
      task.id,
      "working",
      `Executing with ${primary.specialistId}`,
      "runtime.started",
      { turnId, teamPlanHash: teamPlan.planHash },
    );
    const engine = makeEngine(conversationId, primary.mayWriteWorkspace);
    const beforeExecution = await engine.view(turnId);
    if (beforeExecution.state === "PAUSED") {
      await engine.control(turnId, "resume", beforeExecution.version);
      await emitBotEvent(db, task.id, "runtime.resumed", {
        turnId,
        fromState: beforeExecution.state,
      });
    }
    await engine.execute(turnId);
    const view = await engine.view(turnId);
    const chatStore = new NeonChatStore(db);
    const agentCheckpoint = await chatStore.checkpoint(turnId);
    const mainAnswer = await answerForTurn(chatStore, conversationId, turnId);
    const focusCheckpoint = await control.checkpointFocus(task.id, {
      currentObjective: objective,
      completedSteps:
        view.state === "COMPLETED" ? ["Primary agent completed and verified its mission"] : [],
      openBlockers: view.state === "BLOCKED" ? ["Primary mission entered BLOCKED state"] : [],
    });
    const workBranch = primaryGitHubSession?.branchName() ?? checkpointWorkBranch ?? null;
    const workspaceChanges =
      agentCheckpoint?.changes.map(({ path, sha }) => ({ path, sha })) ?? checkpointWrites;
    await bot.saveCheckpoint(task.id, {
      missionState: view.state,
      missionVersion: view.version,
      usage: view.usage,
      teamPlan,
      focusRevision: focusCheckpoint.focus.revision,
      focusDriftCount: focusCheckpoint.focus.driftCount,
      workBranch,
      workspaceChanges,
      specialists: preflightResults.map((result) => ({
        id: result.assignment.specialistId,
        state: result.state,
        turnId: result.turnId,
      })),
    });
    if (focusCheckpoint.shouldReplan) {
      await emitBotEvent(db, task.id, "focus.replan_required", {
        revision: focusCheckpoint.focus.revision,
      });
      throw new ChatError(
        "BOT_FOCUS_DRIFT",
        "Focus drift was detected; a fresh plan is required.",
        503,
      );
    }

    if (view.state === "COMPLETED") {
      const reviewer = teamPlan.assignments.find((assignment) => assignment.phase === "review");
      if (reviewer) {
        const review = await this.runReadOnlySpecialist(
          db,
          bot,
          task.id,
          reviewer,
          objective,
          [preflightContext, `PRIMARY RESULT:\n${mainAnswer}`]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 12000),
          selected.id,
          makeEngine,
        );
        if (review.state !== "COMPLETED") {
          throw new ChatError(
            "BOT_REVIEW_INCOMPLETE",
            "Independent reviewer did not complete successfully.",
            503,
          );
        }
        const verdict = reviewVerdict(review.answer);
        await emitBotEvent(db, task.id, "team.review.completed", {
          specialistId: reviewer.specialistId,
          verdict,
          turnId: review.turnId,
        });
        if (verdict === "BLOCK") {
          await bot.updateTask(
            task.id,
            "blocked",
            "Independent review found a release blocker",
            "team.review.blocked",
            {
              reviewerTurnId: review.turnId,
            },
          );
          await bot.addInbox(
            task.id,
            "important",
            "Odin Bot review found a blocker",
            review.answer.slice(0, 1800),
            { taskId: task.id, reviewerTurnId: review.turnId },
          );
          return "blocked";
        }
      }
      if (task.mode === "coding" && githubReady && workspaceWritesAllowed) {
        const completedWorkBranch = primaryGitHubSession?.branchName() ?? checkpointWorkBranch;
        if (completedWorkBranch) {
          const delivery = await new GitHubPullRequestClient(
            githubToken as string,
            githubConnection.repository as string,
            githubConnection.defaultBranch as string,
          ).ensurePullRequest({
            branch: completedWorkBranch,
            title: `Odin Bot: ${task.goal.replace(/\s+/gu, " ").slice(0, 180)}`,
            body: `Odin Bot completed task ${task.id} and passed its configured verification plus independent review.\n\nMerge remains a separate user-controlled action.`,
          });
          await bot.mergeCheckpoint(task.id, {
            delivery: {
              kind: "github_pull_request",
              repository: githubConnection.repository,
              branch: completedWorkBranch,
              baseBranch: githubConnection.defaultBranch,
              pullNumber: delivery.number,
              url: delivery.url,
              state: delivery.state,
              checks: "passed",
            },
          });
          await emitBotEvent(db, task.id, "delivery.pull_request.ready", {
            repository: githubConnection.repository,
            branch: completedWorkBranch,
            pullNumber: delivery.number,
            url: delivery.url,
          });
          await bot.addInbox(
            task.id,
            "information",
            "Pull request ready for review",
            "Odin finished the coding task, passed verification, and opened a pull request. Merge remains under your control.",
            {
              taskId: task.id,
              repository: githubConnection.repository,
              pullNumber: delivery.number,
              url: delivery.url,
            },
            `delivery:${task.id}:${delivery.number}`,
          );
          if (this.options.publicOrigin) {
            try {
              await new GitHubEventBridge(this.options.pool, this.options.publicOrigin).ensureHook(
                wake.ownerId,
                githubToken as string,
                githubConnection.repository as string,
              );
            } catch {
              await bot.addInbox(
                task.id,
                "important",
                "GitHub event tracking needs permission",
                "The pull request is ready, but Odin could not subscribe to repository events. Reconnect GitHub or verify webhook permissions to receive proactive lifecycle updates.",
                { taskId: task.id, pullNumber: delivery.number },
                `delivery:${task.id}:${delivery.number}:hook`,
              );
            }
          }
        }
      }
      await control.remember(botIdentity.id, {
        kind: "previous_mission",
        key: `mission:${task.id}`,
        content: JSON.stringify({
          objective,
          taskId: task.id,
          conversationId,
          turnId,
          teamPlanHash: teamPlan.planHash,
        }),
        sourceClass: "mission",
        sourceRef: `bot-task:${task.id}`,
        sourceTimestamp: new Date().toISOString(),
        scope: { taskId: task.id },
        confidence: 1,
        sensitivity: "internal",
      });
      await bot.updateTask(
        task.id,
        "done",
        "Completed and independently checked",
        "runtime.completed",
        {
          turnId,
          teamPlanHash: teamPlan.planHash,
        },
      );
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
      { turnId, state: view.state, workBranch },
    );
    throw new ChatError(
      "BOT_RESUME_REQUIRED",
      "The mission needs another durable execution quantum.",
      503,
    );
  }

  private async runReadOnlySpecialist(
    db: ActorDatabase,
    bot: BotStore,
    taskId: string,
    assignment: BotTeamAssignment,
    objective: string,
    context: string,
    modelId: string,
    makeEngine: (id: string, allowWorkspaceWrites: boolean) => ChatEngine,
  ): Promise<SpecialistRunResult> {
    await bot.updateTask(
      taskId,
      "working",
      `Consulting ${assignment.specialistId}`,
      "team.specialist.started",
      { specialistId: assignment.specialistId, phase: assignment.phase },
    );
    const store = new NeonChatStore(db);
    const conversation = await store.createConversation(`Odin Bot · ${assignment.specialistId}`);
    const engine = makeEngine(conversation.id, false);
    const turn = await engine.submit({
      conversationId: conversation.id,
      text: specialistPrompt(assignment, objective, context),
      mode: assignment.mode,
      modelId,
      requestId: `${taskId}:${assignment.specialistId}:${assignment.phase}`,
    });
    await engine.execute(turn.id);
    const view = await engine.view(turn.id);
    const answer = await answerForTurn(store, conversation.id, turn.id);
    await emitBotEvent(db, taskId, "team.specialist.completed", {
      specialistId: assignment.specialistId,
      phase: assignment.phase,
      state: view.state,
      turnId: turn.id,
    });
    return {
      assignment,
      state: view.state,
      answer,
      conversationId: conversation.id,
      turnId: turn.id,
    };
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

async function answerForTurn(
  store: NeonChatStore,
  conversationId: string,
  turnId: string,
): Promise<string> {
  const events = await store.events(conversationId, 0, 1000);
  const answer = events.filter((event) => event.turnId === turnId && event.type === "answer").at(-1)
    ?.data.text;
  return typeof answer === "string" ? answer.slice(0, 12000) : "";
}

async function emitBotEvent(
  db: ActorDatabase,
  taskId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  await db.transaction(async (client) => {
    await client.query("INSERT INTO odin_api.bot_task_events(task_id,type,data) VALUES($1,$2,$3)", [
      taskId,
      type,
      data,
    ]);
  });
}

function reviewVerdict(answer: string): "PASS" | "BLOCK" {
  const firstLine = answer.trim().split(/\r?\n/u, 1)[0]?.trim().toUpperCase() ?? "";
  return firstLine === "VERDICT: PASS" ? "PASS" : "BLOCK";
}
