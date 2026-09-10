import { randomUUID } from "node:crypto";
import type { ActorDatabase } from "../chat/neon-database.js";
import { ChatError } from "../chat/types.js";
import {
  approvalId,
  assessBotAction,
  type BotActionRequest,
  type BotAutonomyLevel,
} from "./autonomy.js";
import {
  type BotFocusState,
  type BotMemoryInput,
  checkFocus,
  defaultDefinitionOfDone,
  isContinuationRequest,
  memoryContentHash,
  validateMemoryInput,
} from "./continuity.js";

export interface BotApproval {
  readonly id: string;
  readonly taskId: string;
  readonly actionType: string;
  readonly actionRef: string;
  readonly actionHash: string;
  readonly risk: "low" | "medium" | "high" | "critical";
  readonly reason: string;
  readonly status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  readonly expiresAt: string;
  readonly decidedAt: string | null;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface BotMemoryRecord extends BotMemoryInput {
  readonly id: string;
  readonly botId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

export class BotControlStore {
  constructor(readonly db: ActorDatabase) {}

  async setBotAutonomy(botId: string, level: BotAutonomyLevel): Promise<number> {
    if (!Number.isInteger(level) || level < 0 || level > 4)
      throw new ChatError("INVALID_AUTONOMY", "Choose autonomy level 0 through 4.");
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          "UPDATE odin_api.bots SET autonomy_level=$2,updated_at=now() WHERE id=$1 RETURNING autonomy_level",
          [botId, level],
        )
      ).rows[0];
      if (!row) throw new ChatError("BOT_NOT_FOUND", "Odin Bot not found.", 404);
      return Number(row.autonomy_level);
    });
  }

  async requestApproval(
    taskId: string,
    level: BotAutonomyLevel,
    action: BotActionRequest,
    ttlMinutes = 30,
  ): Promise<BotApproval | null> {
    const assessment = assessBotAction(level, action);
    if (assessment.decision !== "approval_required") return null;
    const ttl = Math.max(5, Math.min(1440, Math.trunc(ttlMinutes)));
    return this.db.transaction(async (client) => {
      const owned = await client.query("SELECT id FROM odin_api.bot_tasks WHERE id=$1", [taskId]);
      if (!owned.rowCount) throw new ChatError("BOT_TASK_NOT_FOUND", "Bot task not found.", 404);
      const id = approvalId();
      const row = (
        await client.query(
          `INSERT INTO odin_api.bot_approvals(id,task_id,action_type,action_ref,action_hash,risk,reason,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,now()+$8*interval '1 minute')
           ON CONFLICT(owner_id,task_id,action_hash) WHERE status IN ('pending','approved')
           DO UPDATE SET reason=excluded.reason RETURNING *`,
          [
            id,
            taskId,
            action.type,
            action.ref,
            assessment.actionHash,
            action.risk,
            assessment.reason,
            ttl,
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO odin_api.bot_inbox(id,task_id,category,title,body,action)
         SELECT $1,$2,'approval','Approval needed',$3,$4
         WHERE NOT EXISTS (
           SELECT 1 FROM odin_api.bot_inbox WHERE task_id=$2 AND action->>'approvalId'=$5 AND read_at IS NULL
         )`,
        [
          randomUUID(),
          taskId,
          `${action.type}: ${action.ref}`.slice(0, 2000),
          { approvalId: row.id, actionHash: assessment.actionHash },
          row.id,
        ],
      );
      return mapApproval(row);
    });
  }

  async approvals(): Promise<BotApproval[]> {
    return this.db
      .transaction(
        async (client) =>
          (
            await client.query(
              `UPDATE odin_api.bot_approvals SET status='expired'
           WHERE status='pending' AND expires_at<=now()
           RETURNING id`,
            )
          ).rowCount,
      )
      .then(async () =>
        this.db.transaction(async (client) =>
          (
            await client.query(
              "SELECT * FROM odin_api.bot_approvals ORDER BY created_at DESC LIMIT 200",
            )
          ).rows.map(mapApproval),
        ),
      );
  }

  async decideApproval(
    id: string,
    decision: "approve" | "reject",
    expectedActionHash?: string,
  ): Promise<BotApproval> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query("SELECT * FROM odin_api.bot_approvals WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!row) throw new ChatError("APPROVAL_NOT_FOUND", "Approval not found.", 404);
      if (row.status !== "pending" || Date.parse(row.expires_at) <= Date.now()) {
        if (row.status === "pending")
          await client.query("UPDATE odin_api.bot_approvals SET status='expired' WHERE id=$1", [
            id,
          ]);
        throw new ChatError("APPROVAL_NOT_PENDING", "This approval is no longer pending.", 409);
      }
      if (expectedActionHash && row.action_hash !== expectedActionHash)
        throw new ChatError(
          "APPROVAL_SCOPE_MISMATCH",
          "Approval no longer matches the exact action.",
          409,
        );
      const next = decision === "approve" ? "approved" : "rejected";
      const updated = (
        await client.query(
          "UPDATE odin_api.bot_approvals SET status=$2,decided_at=now() WHERE id=$1 RETURNING *",
          [id, next],
        )
      ).rows[0];
      await client.query(
        "UPDATE odin_api.bot_inbox SET read_at=COALESCE(read_at,now()) WHERE action->>'approvalId'=$1",
        [id],
      );
      return mapApproval(updated);
    });
  }

  async consumeApproval(taskId: string, action: BotActionRequest): Promise<boolean> {
    const actionHash = assessBotAction(4, action).actionHash;
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT id FROM odin_api.bot_approvals
           WHERE task_id=$1 AND action_hash=$2 AND status='approved' AND expires_at>now()
           ORDER BY decided_at DESC FOR UPDATE LIMIT 1`,
          [taskId, actionHash],
        )
      ).rows[0];
      if (!row) return false;
      await client.query(
        "UPDATE odin_api.bot_approvals SET status='consumed',consumed_at=now() WHERE id=$1",
        [row.id],
      );
      return true;
    });
  }

  async remember(botId: string, input: BotMemoryInput): Promise<BotMemoryRecord> {
    validateMemoryInput(input);
    const hash = memoryContentHash(input.content);
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO odin_api.bot_memories(
             id,bot_id,kind,memory_key,content,content_hash,source_class,source_ref,source_timestamp,scope,confidence,sensitivity,expires_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT(owner_id,bot_id,memory_key) DO UPDATE SET
             kind=excluded.kind,content=excluded.content,content_hash=excluded.content_hash,
             source_class=excluded.source_class,source_ref=excluded.source_ref,source_timestamp=excluded.source_timestamp,
             scope=excluded.scope,confidence=excluded.confidence,sensitivity=excluded.sensitivity,expires_at=excluded.expires_at,
             version=odin_api.bot_memories.version+1,updated_at=now()
           RETURNING *`,
          [
            randomUUID(),
            botId,
            input.kind,
            input.key,
            input.content,
            hash,
            input.sourceClass,
            input.sourceRef,
            input.sourceTimestamp,
            input.scope ?? {},
            input.confidence,
            input.sensitivity,
            input.expiresAt ?? null,
          ],
        )
      ).rows[0];
      return mapMemory(row);
    });
  }

  async memories(botId: string, limit = 100): Promise<BotMemoryRecord[]> {
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
    return this.db.transaction(async (client) =>
      (
        await client.query(
          `SELECT * FROM odin_api.bot_memories
           WHERE bot_id=$1 AND (expires_at IS NULL OR expires_at>now())
           ORDER BY updated_at DESC LIMIT $2`,
          [botId, bounded],
        )
      ).rows.map(mapMemory),
    );
  }

  async ensureFocus(
    taskId: string,
    objective: string,
    teamPlan: Readonly<Record<string, unknown>> = {},
  ): Promise<BotFocusState> {
    const clean = objective.trim();
    if (!clean || clean.length > 16000)
      throw new ChatError("INVALID_FOCUS", "Focus objective is invalid.");
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO odin_api.bot_focus(task_id,primary_objective,definition_of_done,team_plan)
           VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,task_id) DO UPDATE SET
             team_plan=CASE WHEN odin_api.bot_focus.team_plan='{}'::jsonb THEN excluded.team_plan ELSE odin_api.bot_focus.team_plan END
           RETURNING *`,
          [taskId, clean, defaultDefinitionOfDone(clean), teamPlan],
        )
      ).rows[0];
      return mapFocus(row);
    });
  }

  async focus(taskId: string): Promise<BotFocusState> {
    return this.db.transaction(async (client) => {
      const row = (
        await client.query("SELECT * FROM odin_api.bot_focus WHERE task_id=$1", [taskId])
      ).rows[0];
      if (!row) throw new ChatError("FOCUS_NOT_FOUND", "Task focus state not found.", 404);
      return mapFocus(row);
    });
  }

  async checkpointFocus(
    taskId: string,
    input: {
      currentObjective: string;
      currentPlan?: readonly string[];
      completedSteps?: readonly string[];
      openBlockers?: readonly string[];
    },
  ): Promise<{ focus: BotFocusState; shouldReplan: boolean }> {
    return this.db.transaction(async (client) => {
      const current = (
        await client.query("SELECT * FROM odin_api.bot_focus WHERE task_id=$1 FOR UPDATE", [taskId])
      ).rows[0];
      if (!current) throw new ChatError("FOCUS_NOT_FOUND", "Task focus state not found.", 404);
      const assessment = checkFocus(current.primary_objective, input.currentObjective);
      const row = (
        await client.query(
          `UPDATE odin_api.bot_focus SET
           current_plan=COALESCE($2,current_plan),completed_steps=COALESCE($3,completed_steps),open_blockers=COALESCE($4,open_blockers),
           drift_count=drift_count+CASE WHEN $5 THEN 1 ELSE 0 END,revision=revision+1,updated_at=now()
           WHERE task_id=$1 RETURNING *`,
          [
            taskId,
            input.currentPlan ?? null,
            input.completedSteps ?? null,
            input.openBlockers ?? null,
            assessment.shouldReplan,
          ],
        )
      ).rows[0];
      return { focus: mapFocus(row), shouldReplan: assessment.shouldReplan };
    });
  }

  async resolveContinuation(
    goal: string,
    excludeTaskId?: string,
  ): Promise<{ taskId: string; objective: string } | null> {
    if (!isContinuationRequest(goal)) return null;
    return this.db.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT t.id,f.primary_objective FROM odin_api.bot_tasks t
           LEFT JOIN odin_api.bot_focus f ON f.owner_id=t.owner_id AND f.task_id=t.id
           WHERE ($1::uuid IS NULL OR t.id<>$1)
           ORDER BY CASE WHEN t.status IN ('working','waiting','approval','queued') THEN 0 ELSE 1 END,t.updated_at DESC LIMIT 1`,
          [excludeTaskId ?? null],
        )
      ).rows[0];
      return row ? { taskId: row.id, objective: row.primary_objective ?? "" } : null;
    });
  }
}

function mapApproval(row: Record<string, unknown>): BotApproval {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    actionType: String(row.action_type),
    actionRef: String(row.action_ref),
    actionHash: String(row.action_hash),
    risk: row.risk as BotApproval["risk"],
    reason: String(row.reason),
    status: row.status as BotApproval["status"],
    expiresAt: iso(row.expires_at as string) as string,
    decidedAt: iso(row.decided_at as string | null),
    consumedAt: iso(row.consumed_at as string | null),
    createdAt: iso(row.created_at as string) as string,
  };
}

function mapMemory(row: Record<string, unknown>): BotMemoryRecord {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    kind: row.kind as BotMemoryRecord["kind"],
    key: String(row.memory_key),
    content: String(row.content),
    contentHash: String(row.content_hash),
    sourceClass: row.source_class as BotMemoryRecord["sourceClass"],
    sourceRef: String(row.source_ref),
    sourceTimestamp: iso(row.source_timestamp as string) as string,
    scope: (row.scope ?? {}) as Record<string, unknown>,
    confidence: Number(row.confidence),
    sensitivity: row.sensitivity as BotMemoryRecord["sensitivity"],
    expiresAt: iso(row.expires_at as string | null),
    version: Number(row.version),
    createdAt: iso(row.created_at as string) as string,
    updatedAt: iso(row.updated_at as string) as string,
  };
}

function mapFocus(row: Record<string, unknown>): BotFocusState {
  return {
    taskId: String(row.task_id),
    primaryObjective: String(row.primary_objective),
    definitionOfDone: (row.definition_of_done ?? []) as string[],
    constraints: (row.constraints ?? []) as string[],
    currentPlan: (row.current_plan ?? []) as string[],
    completedSteps: (row.completed_steps ?? []) as string[],
    openBlockers: (row.open_blockers ?? []) as string[],
    teamPlan: (row.team_plan ?? {}) as Record<string, unknown>,
    driftCount: Number(row.drift_count),
    revision: Number(row.revision),
    updatedAt: iso(row.updated_at as string) as string,
  };
}
