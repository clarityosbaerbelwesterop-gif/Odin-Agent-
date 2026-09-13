import { randomUUID } from "node:crypto";
import { canonicalJson } from "../durable/internal.js";
import { missionEventCodec } from "../durable/mission-codec.js";
import {
  type EventAppendItem,
  type EventStore,
  EventStoreConflictError,
  type StoredEvent,
} from "../events/store.js";
import type { MissionEventData } from "../mission/runtime.js";
import type { ModelMessage } from "../providers/types.js";
import type { ActorDatabase, DatabaseAction } from "./neon-database.js";
import type { ChatRepository } from "./repository.js";
import {
  restoreRunSkill,
  runSkillContextMessage,
  selectRunSkill,
  skillEventData,
  type SelectedRunSkill,
} from "./run-skills.js";
import { hashText, identifier, integer, safeText } from "./safety.js";
import { SkillProductStore } from "./skill-product-store.js";
import {
  type AgentCheckpoint,
  type ChatConversation,
  ChatError,
  type ChatEvent,
  type ChatTurn,
} from "./types.js";
import { compileWorkspaceContext, workspaceContextMessage } from "./workspace-context.js";

function encode(value: unknown, limit: number) {
  const data = safeText(canonicalJson(value, limit), limit);
  return [data, hashText(data)];
}

function decode<T>(row: Record<string, unknown>): T {
  if (hashText(canonicalJson(row.data, 2_000_000)) !== row.data_hash)
    throw new ChatError("INTEGRITY_FAILURE", "Stored data failed verification.", 500);
  return row.data as T;
}

const iso = (date: Date | string) => new Date(date).toISOString();
const missing = () => new ChatError("NOT_FOUND", "Conversation or task not found.", 404);

export class NeonChatStore implements ChatRepository {
  constructor(readonly db: ActorDatabase) {}

  close(): void {}

  async workspaceContext(conversationId: string, missionId: string) {
    return compileWorkspaceContext(this.db, identifier(conversationId), identifier(missionId));
  }

  async history(conversationId: string, currentTurn: string): Promise<ModelMessage[]> {
    const projectId = identifier(conversationId);
    const runId = identifier(currentTurn);
    const history = await this.db.transaction(async (c) =>
      (
        await c.query(
          "SELECT type,data,data_hash FROM odin_api.events WHERE conversation_id=$1 AND turn_id<>$2 AND type IN ('message.user','answer') ORDER BY cursor DESC LIMIT 12",
          [projectId, runId],
        )
      ).rows
        .reverse()
        .map((row) => ({
          role: row.type === "answer" ? ("assistant" as const) : ("user" as const),
          content: [
            {
              type: "text" as const,
              text: String(decode<Record<string, unknown>>(row).text).slice(0, 2000),
            },
          ],
        })),
    );

    const turn = await this.turn(runId);
    if (turn.conversationId !== projectId)
      throw new ChatError("RUN_PROJECT_MISMATCH", "Run does not belong to this Project.", 404);

    const selectedSkill = await this.resolveRunSkill(turn);
    const skillContext: ModelMessage[] = selectedSkill
      ? [
          {
            role: "system",
            content: [{ type: "text", text: runSkillContextMessage(selectedSkill) }],
          },
        ]
      : [];

    const context = await this.workspaceContext(projectId, runId);
    if (!context) return [...skillContext, ...history];
    return [
      ...skillContext,
      ...history,
      {
        role: "user",
        content: [{ type: "text", text: workspaceContextMessage(context) }],
      },
    ];
  }

  async createConversation(title: string): Promise<ChatConversation> {
    const clean = safeText(title, 160).trim() || "New conversation";
    return this.db.transaction(async (c) => {
      const count = (await c.query("SELECT count(*)::int AS n FROM odin_api.conversations"))
        .rows[0];
      if (count.n >= 1000) throw new ChatError("STORAGE_LIMIT", "Conversation limit reached.", 409);
      const row = (
        await c.query(
          "INSERT INTO odin_api.conversations(id,title) VALUES($1,$2) RETURNING id,title,created_at",
          [randomUUID(), clean],
        )
      ).rows[0];
      return { id: row.id, title: row.title, createdAt: iso(row.created_at) };
    });
  }

  async conversations(): Promise<ChatConversation[]> {
    return this.db.transaction(async (c) =>
      (
        await c.query(
          "SELECT id,title,created_at FROM odin_api.conversations ORDER BY created_at DESC,id LIMIT 1000",
        )
      ).rows.map((r) => ({ id: r.id, title: r.title, createdAt: iso(r.created_at) })),
    );
  }

  async conversation(id: string): Promise<ChatConversation> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query("SELECT id,title,created_at FROM odin_api.conversations WHERE id=$1", [
          identifier(id),
        ])
      ).rows[0];
      if (!row) throw missing();
      return { id: row.id, title: row.title, createdAt: iso(row.created_at) };
    });
  }

  async replay(conversationId: string, key: string, requestHash: string): Promise<ChatTurn | null> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query(
          "SELECT data,data_hash,request_hash FROM odin_api.turns WHERE conversation_id=$1 AND request_key=$2",
          [identifier(conversationId), identifier(key)],
        )
      ).rows[0];
      if (!row) return null;
      if (row.request_hash !== requestHash)
        throw new ChatError(
          "IDEMPOTENCY_CONFLICT",
          "Request key already belongs to different content.",
          409,
        );
      return decode<ChatTurn>(row);
    });
  }

  async addTurn(turn: ChatTurn, key: string, requestHash: string): Promise<void> {
    const [data, hash] = encode(turn, 2_000_000);
    await this.db.transaction(async (c) => {
      const count = (
        await c.query("SELECT count(*)::int AS n FROM odin_api.turns WHERE conversation_id=$1", [
          turn.conversationId,
        ])
      ).rows[0];
      if (count.n >= 1000) throw new ChatError("STORAGE_LIMIT", "Start a new conversation.", 409);
      await c.query(
        "INSERT INTO odin_api.turns(id,conversation_id,request_key,request_hash,data,data_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [turn.id, turn.conversationId, identifier(key), requestHash, data, hash],
      );
    });
  }

  async turn(id: string): Promise<ChatTurn> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query("SELECT data,data_hash FROM odin_api.turns WHERE id=$1", [identifier(id)])
      ).rows[0];
      if (!row) throw missing();
      return decode<ChatTurn>(row);
    });
  }

  async turns(conversationId?: string): Promise<ChatTurn[]> {
    return this.db.transaction(async (c) =>
      (
        await c.query(
          `SELECT data,data_hash FROM odin_api.turns ${conversationId === undefined ? "" : "WHERE conversation_id=$1"} ORDER BY created_at,id LIMIT 10000`,
          conversationId === undefined ? [] : [identifier(conversationId)],
        )
      ).rows.map((r) => decode<ChatTurn>(r)),
    );
  }

  async emit(turn: ChatTurn, type: string, value: Record<string, unknown>): Promise<ChatEvent> {
    const [data, hash] = encode(value, 300000);
    return this.db.transaction(async (c) => {
      const row = (
        await c.query(
          "INSERT INTO odin_api.events(conversation_id,turn_id,type,data,data_hash) VALUES($1,$2,$3,$4,$5) RETURNING cursor,created_at",
          [turn.conversationId, turn.id, type, data, hash],
        )
      ).rows[0];
      const event: ChatEvent = {
        cursor: Number(row.cursor),
        conversationId: turn.conversationId,
        turnId: turn.id,
        type,
        data: value,
        createdAt: iso(row.created_at),
      };
      if (type === "answer") await this.recordSkillResult(c, turn, event, value);
      return event;
    });
  }

  async events(conversationId: string, after = 0, limit = 200): Promise<ChatEvent[]> {
    await this.conversation(conversationId);
    integer(after, 0, Number.MAX_SAFE_INTEGER);
    integer(limit, 1, 1000);
    return this.db.transaction(async (c) =>
      (
        await c.query(
          "SELECT cursor,turn_id,type,data,data_hash,created_at FROM odin_api.events WHERE conversation_id=$1 AND cursor>$2 ORDER BY cursor LIMIT $3",
          [conversationId, after, limit],
        )
      ).rows.map((r) => ({
        cursor: Number(r.cursor),
        conversationId,
        turnId: r.turn_id,
        type: r.type,
        data: decode<Record<string, unknown>>(r),
        createdAt: iso(r.created_at),
      })),
    );
  }

  async checkpoint(turnId: string): Promise<AgentCheckpoint | null> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query("SELECT data,data_hash FROM odin_api.checkpoints WHERE turn_id=$1", [
          identifier(turnId),
        ])
      ).rows[0];
      return row ? decode<AgentCheckpoint>(row) : null;
    });
  }

  async save(turnId: string, state: AgentCheckpoint): Promise<void> {
    const [data, hash] = encode(state, 2000000);
    await this.db.transaction(async (c) => {
      await c.query(
        "INSERT INTO odin_api.checkpoints(turn_id,data,data_hash) VALUES($1,$2,$3) ON CONFLICT(owner_id,turn_id) DO UPDATE SET data=excluded.data,data_hash=excluded.data_hash",
        [identifier(turnId), data, hash],
      );
    });
  }

  private async resolveRunSkill(turn: ChatTurn): Promise<SelectedRunSkill | null> {
    const pinned = await this.db.transaction(async (c) =>
      (
        await c.query(
          `SELECT type,data,data_hash
             FROM odin_api.events
            WHERE conversation_id=$1 AND turn_id=$2
              AND type IN ('skill.selected','skill.loaded')
            ORDER BY cursor DESC
            LIMIT 1`,
          [turn.conversationId, turn.id],
        )
      ).rows[0] as Record<string, unknown> | undefined,
    );
    if (pinned) {
      const restored = restoreRunSkill(decode<Record<string, unknown>>(pinned));
      if (restored.projectId !== turn.conversationId || restored.runId !== turn.id)
        throw new ChatError("SKILL_INTEGRITY", "Pinned Skill does not match this Run.", 409);
      if (pinned.type === "skill.selected")
        await this.emit(turn, "skill.loaded", { ...skillEventData(restored), contextBound: true });
      return restored;
    }

    const resolution = await selectRunSkill(new SkillProductStore(this.db), turn);
    if (resolution.kind === "none") return null;
    if (resolution.kind === "blocked") {
      const data = {
        runId: resolution.runId,
        projectId: resolution.projectId,
        taskId: "work",
        skillId: resolution.skillId,
        skillName: resolution.skillName,
        version: resolution.version,
        contentHash: resolution.contentHash,
        taskClass: resolution.taskClass,
        reason: resolution.reason,
        missingConnections: [...resolution.missingConnections],
      };
      if (resolution.reason === "connection_required") {
        await this.emit(turn, "skill.connection_required", data);
        throw new ChatError(
          "SKILL_CONNECTION_REQUIRED",
          `Required Skill connection is unavailable: ${resolution.missingConnections.join(", ")}.`,
          409,
        );
      }
      await this.emit(turn, "skill.verification_failed", data);
      throw new ChatError(
        "SKILL_INTEGRITY",
        "Installed Skill revision no longer matches the verified M10 package.",
        409,
      );
    }

    await this.emit(turn, "skill.selected", skillEventData(resolution));
    await this.emit(turn, "skill.loaded", { ...skillEventData(resolution), contextBound: true });
    return resolution;
  }

  private async recordSkillResult(
    client: Parameters<DatabaseAction<void>>[0],
    turn: ChatTurn,
    answer: ChatEvent,
    answerValue: Record<string, unknown>,
  ): Promise<void> {
    const loaded = (
      await client.query(
        `SELECT data,data_hash
           FROM odin_api.events
          WHERE conversation_id=$1 AND turn_id=$2 AND type='skill.loaded'
          ORDER BY cursor DESC
          LIMIT 1`,
        [turn.conversationId, turn.id],
      )
    ).rows[0];
    if (!loaded) return;
    const alreadyRecorded = (
      await client.query(
        `SELECT 1
           FROM odin_api.events
          WHERE conversation_id=$1 AND turn_id=$2 AND type='skill.result'
            AND data->>'answerCursor'=$3
          LIMIT 1`,
        [turn.conversationId, turn.id, String(answer.cursor)],
      )
    ).rows.length;
    if (alreadyRecorded) return;

    const skill = restoreRunSkill(decode<Record<string, unknown>>(loaded));
    if (skill.projectId !== turn.conversationId || skill.runId !== turn.id)
      throw new ChatError("SKILL_INTEGRITY", "Loaded Skill does not match this Run.", 409);
    const verification =
      answerValue.verification === "DELIVERY_CHECKED" ? "DELIVERY_CHECKED" : "UNVERIFIED";
    const result = {
      ...skillEventData(skill),
      status: verification === "DELIVERY_CHECKED" ? "VERIFIED" : "UNVERIFIED",
      verification,
      evidenceRefs: [`event:${answer.cursor}`],
      artifactRefs: [],
      answerCursor: answer.cursor,
    };
    const [resultData, resultHash] = encode(result, 300000);
    await client.query(
      "INSERT INTO odin_api.events(conversation_id,turn_id,type,data,data_hash) VALUES($1,$2,'skill.result',$3,$4)",
      [turn.conversationId, turn.id, resultData, resultHash],
    );
  }
}

/** Postgres persists the original M2 event stream, without a second mission state machine. */
export class NeonMissionStore implements EventStore<MissionEventData> {
  constructor(readonly db: ActorDatabase) {}

  async load(id: string): Promise<readonly StoredEvent<MissionEventData>[]> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query("SELECT events FROM odin_api.mission_streams WHERE id=$1", [identifier(id)])
      ).rows[0];
      return validateEvents(row?.events ?? [], id);
    });
  }

  async append(
    id: string,
    expected: number,
    key: string,
    items: readonly EventAppendItem<MissionEventData>[],
  ): Promise<readonly StoredEvent<MissionEventData>[]> {
    identifier(id);
    integer(expected, 0, 100000);
    if (!key || key.length > 500 || items.length < 1 || items.length > 1000)
      throw new ChatError("INVALID_EVENT", "Invalid event append.");
    const fingerprint = hashText(canonicalJson({ expected, items }, 2000000));
    return this.db.transaction(async (c) => {
      await c.query("INSERT INTO odin_api.mission_streams(id) VALUES($1) ON CONFLICT DO NOTHING", [
        id,
      ]);
      const row = (
        await c.query(
          "SELECT version,events,replays FROM odin_api.mission_streams WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) throw missing();
      const replay = row.replays[key];
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw new EventStoreConflictError("Idempotency conflict.");
        return validateEvents(row.events, id).slice(replay.start, replay.end);
      }
      if (row.version !== expected) throw new EventStoreConflictError("Mission version changed.");
      const added = items.map((item, i) => ({
        missionId: id,
        sequence: expected + i + 1,
        aggregateVersion: expected + i + 1,
        idempotencyKey: key,
        occurredAt: iso(item.occurredAt),
        data: missionEventCodec.decode(item.data),
      }));
      const events = [...validateEvents(row.events, id), ...added];
      const replays = {
        ...row.replays,
        [key]: { fingerprint, start: expected, end: events.length },
      };
      await c.query(
        "UPDATE odin_api.mission_streams SET version=$2,events=$3,replays=$4 WHERE id=$1",
        [id, events.length, canonicalJson(events, 8000000), canonicalJson(replays, 4000000)],
      );
      return added;
    });
  }
}

function validateEvents(raw: unknown, id: string): StoredEvent<MissionEventData>[] {
  if (!Array.isArray(raw)) throw new ChatError("INTEGRITY_FAILURE", "Invalid mission stream.", 500);
  return raw.map((item, i) => {
    if (item.missionId !== id || item.sequence !== i + 1 || item.aggregateVersion !== i + 1)
      throw new ChatError("INTEGRITY_FAILURE", "Mission sequence mismatch.", 500);
    return { ...item, data: missionEventCodec.decode(item.data) };
  });
}
