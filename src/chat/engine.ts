import { randomUUID } from "node:crypto";
import type { EventStore } from "../events/store.js";
import type { MissionEventData } from "../mission/runtime.js";
import { MissionRuntime, type MissionState } from "../mission/runtime.js";
import type { QualityCommandRunner, RepositoryWorkspace } from "../tools/repository.js";
import { runChatAgent } from "./agent.js";
import { DEFAULT_CHAT_LIMITS, MODE_POLICIES, parseMode } from "./modes.js";
import type { ChatRepository } from "./repository.js";
import { hashText, identifier, integer, publicError, safeText } from "./safety.js";
import {
  type ChatChange,
  ChatError,
  type ChatLimits,
  type ChatModel,
  type ChatTurn,
  type ChatTurnView,
  type ResearchAdapter,
} from "./types.js";
import { LocalChatWorkspace } from "./workspace.js";

const TERMINAL = new Set<MissionState>(["COMPLETED", "CANCELLED", "FAILED", "BLOCKED"]);
const NO_QUALITY: QualityCommandRunner = {
  commands: () => [],
  run: async () => {
    throw new ChatError("QUALITY_UNAVAILABLE", "No quality command is configured.", 409);
  },
};

export interface ChatEngineOptions {
  store: ChatRepository;
  events: EventStore<MissionEventData>;
  models: readonly ChatModel[];
  limits?: ChatLimits;
  workspaceRoot?: string;
  allowWorkspaceWrites?: boolean;
  quality?: QualityCommandRunner;
  research?: ResearchAdapter;
  workspace?: (onChange: (change: ChatChange) => Promise<void>) => RepositoryWorkspace;
  autoRun?: boolean;
  signal?: AbortSignal;
  /** A short database transaction for state mutations; never wraps a provider or tool call. */
  atomic?: <T>(action: () => Promise<T>) => Promise<T>;
}

export class ChatEngine {
  readonly store: ChatRepository;
  readonly #mission: MissionRuntime;
  readonly #options: ChatEngineOptions;
  readonly #limits: ChatLimits;
  readonly #models: Map<string, ChatModel>;
  readonly #active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  #workQueue = Promise.resolve();
  #mutationQueue = Promise.resolve();
  #closed = false;
  constructor(options: ChatEngineOptions) {
    this.#options = options;
    this.store = options.store;
    this.#mission = new MissionRuntime(options.events);
    this.#limits = options.limits ?? DEFAULT_CHAT_LIMITS;
    integer(this.#limits.maxCalls, 1, 100);
    integer(this.#limits.maxToolCalls, 1, 200);
    integer(this.#limits.maxInputTokens, 1000, 1_000_000);
    integer(this.#limits.maxOutputTokens, 64, 200_000);
    integer(this.#limits.maxTurnMs, 1000, 24 * 60 * 60_000);
    this.#models = new Map();
    for (const model of options.models) {
      identifier(model.id);
      safeText(model.label, 200);
      if (this.#models.has(model.id))
        throw new ChatError("DUPLICATE_MODEL", "Configured model identifiers must be unique.");
      model.provider.capabilities(model.model);
      this.#models.set(model.id, model);
    }
  }
  capabilities() {
    return {
      models: [...this.#models.values()].map((model) => ({
        id: model.id,
        label: model.label,
        provider: model.provider.id,
        model: model.model,
        profile: model.provider.capabilities(model.model),
      })),
      modes: Object.entries(MODE_POLICIES).map(([id, policy]) => ({
        id,
        label: policy.label,
        description: policy.description,
      })),
      workspace:
        this.#options.workspaceRoot || this.#options.workspace
          ? { connected: true, writable: this.#options.allowWorkspaceWrites === true }
          : null,
      research: this.#options.research?.name ?? null,
      quality: this.#options.quality?.commands() ?? [],
      limits: this.#limits,
    };
  }
  async initialize(): Promise<void> {
    for (const turn of await this.store.turns()) {
      let snapshot = await this.#mission.load(turn.id);
      if (TERMINAL.has(snapshot.state) || snapshot.state === "PAUSED") continue;
      if (snapshot.state === "CANCELLING") await this.#transition(turn, "CANCELLED");
      else {
        if (snapshot.state === "RESUMING" && snapshot.resumeState)
          await this.#transition(turn, snapshot.resumeState);
        snapshot = await this.#mission.load(turn.id);
        if (snapshot.state !== "PAUSING") await this.#transition(turn, "PAUSING");
        await this.#transition(turn, "PAUSED");
        await this.store.emit(turn, "activity", {
          phase: "recovery",
          message: "Server restarted. The task is paused; inspect progress and resume explicitly.",
        });
      }
    }
  }
  async view(turnId: string): Promise<ChatTurnView> {
    const turn = await this.store.turn(turnId);
    const snapshot = await this.#mission.load(turnId);
    return {
      ...turn,
      state: snapshot.state,
      version: snapshot.version,
      usage: (await this.store.checkpoint(turn.id))?.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };
  }
  async conversation(id: string) {
    const conversation = await this.store.conversation(id);
    return {
      conversation,
      turns: await Promise.all((await this.store.turns(id)).map((turn) => this.view(turn.id))),
    };
  }
  async submit(input: {
    conversationId: string;
    text: string;
    mode: unknown;
    modelId: string;
    requestId: string;
  }): Promise<ChatTurnView> {
    if (this.#closed) throw new ChatError("SHUTTING_DOWN", "The server is shutting down.", 503);
    const conversationId = identifier(input.conversationId);
    await this.store.conversation(conversationId);
    const text = safeText(input.text, 16_000).trim();
    if (!text) throw new ChatError("EMPTY_MESSAGE", "Write a message before sending.");
    const mode = parseMode(input.mode);
    const modelId = identifier(input.modelId);
    if (!this.#models.has(modelId))
      throw new ChatError(
        "MODEL_UNAVAILABLE",
        "No provider is configured for the selected model.",
        409,
      );
    const key = identifier(input.requestId);
    const requestHash = hashText(JSON.stringify({ text, mode, modelId }));
    const turn = await this.#atomic(async () => {
      const replay = await this.store.replay(conversationId, key, requestHash);
      if (replay) return replay;
      for (const existing of await this.store.turns(conversationId)) {
        const snapshot = await this.#mission.load(existing.id);
        if (!TERMINAL.has(snapshot.state))
          throw new ChatError(
            "TASK_ACTIVE",
            "A task is active. Send a steering instruction or finish it first.",
            409,
          );
      }
      const created: ChatTurn = {
        id: randomUUID(),
        conversationId,
        modelId,
        mode,
        objective: text,
        createdAt: new Date().toISOString(),
      };
      await this.#mission.create(
        {
          id: created.id,
          objective: text,
          focus: mode === "ultra" ? "critical" : mode === "chat" ? "routine" : "complex",
          tasks: [
            {
              id: "work",
              title: MODE_POLICIES[mode].label,
              definitionOfDone: [
                "Deliver the response and verify the applicable delivery or workspace quality contract.",
              ],
            },
          ],
          budgetLimits: {
            attempts: this.#limits.maxCalls + this.#limits.maxToolCalls,
            inputTokens: this.#limits.maxInputTokens,
            outputTokens: this.#limits.maxOutputTokens,
            toolCalls: this.#limits.maxToolCalls,
            costMicros: 0,
          },
        },
        `chat:${key}`,
      );
      await this.store.addTurn(created, key, requestHash);
      await this.store.emit(created, "message.user", { text, mode });
      await this.#publishState(created);
      if (this.#options.autoRun !== false) this.#schedule(created);
      return created;
    });
    return this.view(turn.id);
  }
  async steer(turnId: string, text: string): Promise<void> {
    const turn = await this.store.turn(turnId);
    const cleaned = safeText(text, 8000).trim();
    if (!cleaned) throw new ChatError("EMPTY_MESSAGE", "Write an instruction first.");
    await this.#atomic(async () => {
      const snapshot = await this.#mission.load(turnId);
      if (TERMINAL.has(snapshot.state))
        throw new ChatError("TASK_FINISHED", "Send a new follow-up for a finished task.", 409);
      await this.store.emit(turn, "steering", { text: cleaned });
    });
  }
  async control(turnId: string, command: string, expectedVersion: number): Promise<ChatTurnView> {
    const turn = await this.store.turn(turnId);
    integer(expectedVersion, 1, Number.MAX_SAFE_INTEGER);
    if (!["pause", "resume", "cancel"].includes(command))
      throw new ChatError("INVALID_COMMAND", "Unsupported task control.");
    await this.#atomic(async () => {
      const snapshot = await this.#mission.load(turnId);
      if (snapshot.version !== expectedVersion)
        throw new ChatError(
          "STALE_VERSION",
          "Task changed; refresh its state before retrying.",
          409,
        );
      if (command === "resume") {
        if (snapshot.state !== "PAUSED" || !snapshot.resumeState)
          throw new ChatError("INVALID_STATE", "Only a paused task can resume.", 409);
        await this.#transition(turn, "RESUMING");
        await this.#transition(turn, snapshot.resumeState);
      } else {
        if (TERMINAL.has(snapshot.state) || (command === "pause" && snapshot.state === "PAUSED"))
          throw new ChatError(
            "INVALID_STATE",
            "This control is unavailable in the current task state.",
            409,
          );
        this.#active.get(turnId)?.controller.abort(new Error(command));
        await this.#transition(turn, command === "pause" ? "PAUSING" : "CANCELLING");
        await this.#transition(turn, command === "pause" ? "PAUSED" : "CANCELLED");
      }
    });
    // Wait outside the mutation lock so the interrupted worker can settle safely.
    if (command === "resume") {
      await this.#active.get(turnId)?.done;
      if (this.#options.autoRun !== false) this.#schedule(turn);
    }
    return this.view(turnId);
  }
  async idle(): Promise<void> {
    await this.#workQueue;
  }
  async execute(turnId: string): Promise<void> {
    const turn = await this.store.turn(turnId);
    this.#schedule(turn);
    await this.idle();
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const active of this.#active.values()) active.controller.abort(new Error("shutdown"));
    await this.#workQueue;
    await this.initialize();
  }
  #schedule(turn: ChatTurn): void {
    if (this.#active.has(turn.id)) return;
    const controller = new AbortController();
    const done = this.#workQueue
      .catch(() => {})
      .then(async () => {
        const snapshot = await this.#mission.load(turn.id);
        if (snapshot.state === "PAUSED" || TERMINAL.has(snapshot.state) || this.#closed) return;
        await this.#run(turn, controller);
      })
      .finally(() => {
        this.#active.delete(turn.id);
      });
    // Attach a rejection handler for background scheduling; execute()/idle() still observe errors.
    void done.catch(() => {});
    this.#active.set(turn.id, { controller, done });
    this.#workQueue = done;
  }
  async #run(turn: ChatTurn, controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(this.#limits.maxTurnMs),
      ...(this.#options.signal ? [this.#options.signal] : []),
    ]);
    const changes: ChatChange[] = [];
    const publish = async (type: string, data: Record<string, unknown>) =>
      await this.store.emit(turn, type, data);
    try {
      await this.#atomic(async () => {
        const snapshot = await this.#mission.load(turn.id);
        if (snapshot.state === "CREATED") {
          for (const state of [
            "UNDERSTANDING",
            "RETRIEVING",
            "PLANNING",
            "RISK_CHECK",
            "EXECUTING",
          ] as const)
            await this.#transition(turn, state);
          const current = await this.#mission.load(turn.id);
          await this.#mission.setTaskStatus(
            turn.id,
            current.version,
            "work",
            "RUNNING",
            randomUUID(),
          );
        }
      });
      const changed = async (change: ChatChange) => {
        const index = changes.findIndex((prior) => prior.path === change.path);
        const prior = changes[index];
        const final = { ...change, before: prior ? prior.before : change.before };
        if (index >= 0) changes[index] = final;
        else changes.push(final);
        await publish("file.changed", { ...final });
      };
      const workspace = this.#options.workspaceRoot
        ? await LocalChatWorkspace.create(
            this.#options.workspaceRoot,
            this.#options.allowWorkspaceWrites === true,
            changed,
          )
        : this.#options.workspace?.(changed);
      const model = this.#models.get(turn.modelId);
      if (!model)
        throw new ChatError(
          "MODEL_UNAVAILABLE",
          "The task's configured model is unavailable.",
          409,
        );
      while (true) {
        const result = await runChatAgent({
          turn,
          model,
          store: this.store,
          limits: this.#limits,
          signal,
          changes,
          ...(workspace ? { workspace } : {}),
          quality: this.#options.quality ?? NO_QUALITY,
          ...(this.#options.research ? { research: this.#options.research } : {}),
          publish,
          snapshot: () => this.#mission.load(turn.id),
          reserve: (inputTokens, outputTokens, toolCalls) =>
            this.#atomic(async () => {
              signal.throwIfAborted();
              const snapshot = await this.#mission.load(turn.id);
              if (snapshot.state !== "EXECUTING")
                throw new ChatError("INVALID_STATE", "The task is no longer executing.", 409);
              await this.#mission.debitBudget(
                turn.id,
                snapshot.version,
                { attempts: 1, inputTokens, outputTokens, toolCalls, costMicros: 0 },
                randomUUID(),
              );
            }),
        });
        signal.throwIfAborted();
        const committed = await this.#atomic(async () => {
          signal.throwIfAborted();
          let cursor = result.checkpoint.steeringCursor;
          while (true) {
            const events = await this.store.events(turn.conversationId, cursor, 1000);
            if (events.some((event) => event.turnId === turn.id && event.type === "steering"))
              return false;
            if (events.length < 1000) break;
            cursor = events.at(-1)?.cursor ?? cursor;
          }
          let snapshot = await this.#mission.load(turn.id);
          if (snapshot.state !== "EXECUTING")
            throw new ChatError("INVALID_STATE", "The task is no longer executing.", 409);
          await this.#mission.setTaskStatus(
            turn.id,
            snapshot.version,
            "work",
            result.verified ? "VERIFIED" : "FAILED",
            randomUUID(),
          );
          snapshot = await this.#mission.load(turn.id);
          if (snapshot.state === "EXECUTING")
            for (const next of ["OBSERVING", "VERIFYING"] as const)
              await this.#transition(turn, next);
          await publish("answer", {
            text: result.text,
            verification: result.verified ? "DELIVERY_CHECKED" : "UNVERIFIED",
          });
          if (result.verified)
            for (const next of ["CHECKPOINTING", "FINAL_AUDIT", "COMPLETED"] as const)
              await this.#transition(turn, next);
          else await this.#transition(turn, "BLOCKED");
          return true;
        });
        if (committed) break;
      }
    } catch (error) {
      await this.#atomic(async () => {
        const snapshot = await this.#mission.load(turn.id);
        if (snapshot.state === "PAUSED" || TERMINAL.has(snapshot.state)) return;
        if (this.#closed || signal.aborted) {
          await this.#transition(turn, "PAUSING");
          await this.#transition(turn, "PAUSED");
          await publish("activity", {
            phase: "paused",
            message:
              "Execution stopped safely. In-flight usage may be unavailable; inspect the workspace before continuing.",
          });
        } else {
          await publish("error", publicError(error));
          await this.#transition(turn, "BLOCKED");
        }
      });
    }
  }
  async #transition(turn: ChatTurn, state: MissionState): Promise<void> {
    const snapshot = await this.#mission.load(turn.id);
    await this.#mission.transition(turn.id, snapshot.version, state, randomUUID());
    await this.#publishState(turn);
  }
  async #publishState(turn: ChatTurn): Promise<void> {
    await this.store.emit(turn, "state", { ...(await this.view(turn.id)) });
  }
  async #atomic<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.#mutationQueue;
    let release = () => {};
    this.#mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await (this.#options.atomic ? this.#options.atomic(action) : action());
    } finally {
      release();
    }
  }
}
