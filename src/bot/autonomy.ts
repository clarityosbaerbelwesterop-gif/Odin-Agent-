import { createHash, randomUUID } from "node:crypto";

export type BotAutonomyLevel = 0 | 1 | 2 | 3 | 4;
export type BotActionRisk = "low" | "medium" | "high" | "critical";
export type BotActionDecision = "allow" | "prepare" | "approval_required" | "deny";

export interface BotActionRequest {
  readonly type: string;
  readonly ref: string;
  readonly reversible: boolean;
  readonly externalSideEffect: boolean;
  readonly risk: BotActionRisk;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface BotActionAssessment {
  readonly decision: BotActionDecision;
  readonly reason: string;
  readonly actionHash: string;
  readonly approvalScope: "none" | "exact_action";
}

const ALWAYS_APPROVAL = new Set([
  "money.spend",
  "subscription.create",
  "data.delete_permanent",
  "content.publish_private",
  "secrets.production_change",
  "security.control_disable",
  "git.merge_critical_production",
]);

const NEVER_AUTONOMOUS = new Set(["permission.escalate", "policy.disable", "approval.self_issue"]);

export function assessBotAction(
  level: BotAutonomyLevel,
  action: BotActionRequest,
): BotActionAssessment {
  validateLevel(level);
  validateAction(action);
  const actionHash = hashAction(action);

  if (NEVER_AUTONOMOUS.has(action.type)) {
    return {
      decision: "deny",
      reason: "This action may not be self-authorized by Odin Bot.",
      actionHash,
      approvalScope: "none",
    };
  }
  if (ALWAYS_APPROVAL.has(action.type) || action.risk === "critical") {
    return {
      decision: "approval_required",
      reason: "This high-impact action always requires approval bound to the exact action.",
      actionHash,
      approvalScope: "exact_action",
    };
  }
  if (level === 0) {
    return {
      decision: "deny",
      reason: "Advice-only autonomy does not execute or prepare tool actions.",
      actionHash,
      approvalScope: "none",
    };
  }
  if (level === 1) {
    return {
      decision: action.externalSideEffect ? "deny" : "allow",
      reason: action.externalSideEffect
        ? "Read autonomy cannot produce external side effects."
        : "Read-only action is allowed.",
      actionHash,
      approvalScope: "none",
    };
  }
  if (level === 2) {
    return {
      decision: action.externalSideEffect ? "prepare" : "allow",
      reason: action.externalSideEffect
        ? "Prepare the action but do not execute it."
        : "Read-only action is allowed.",
      actionHash,
      approvalScope: "none",
    };
  }
  if (level === 3) {
    if (action.externalSideEffect && (!action.reversible || action.risk === "high")) {
      return {
        decision: "approval_required",
        reason:
          "Level 3 only executes reversible low/medium-risk external actions without approval.",
        actionHash,
        approvalScope: "exact_action",
      };
    }
    return {
      decision: "allow",
      reason: "Action fits the granted reversible scope.",
      actionHash,
      approvalScope: "none",
    };
  }

  if (!action.reversible && action.externalSideEffect) {
    return {
      decision: "approval_required",
      reason: "Irreversible external actions remain approval-gated even at Level 4.",
      actionHash,
      approvalScope: "exact_action",
    };
  }
  return {
    decision: "allow",
    reason:
      "Action fits the explicitly granted Level 4 scope and is not a permanently gated action.",
    actionHash,
    approvalScope: "none",
  };
}

export function botRuntimeAccess(level: number): {
  readonly readToolsAllowed: boolean;
  readonly workspaceWritesAllowed: boolean;
} {
  validateLevel(level);
  return {
    readToolsAllowed: level >= 1,
    workspaceWritesAllowed: level >= 3,
  };
}

export function hashAction(action: BotActionRequest): string {
  const canonical = JSON.stringify({
    type: action.type,
    ref: action.ref,
    reversible: action.reversible,
    externalSideEffect: action.externalSideEffect,
    risk: action.risk,
    metadata: canonicalObject(action.metadata ?? {}),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function approvalId(): string {
  return randomUUID();
}

function validateLevel(level: number): asserts level is BotAutonomyLevel {
  if (!Number.isInteger(level) || level < 0 || level > 4)
    throw new TypeError("Autonomy level must be an integer from 0 to 4.");
}

function validateAction(action: BotActionRequest): void {
  if (!/^[a-z0-9_.-]{1,80}$/u.test(action.type)) throw new TypeError("Action type is invalid.");
  if (!action.ref.trim() || action.ref.length > 1000)
    throw new TypeError("Action reference is invalid.");
  if (!["low", "medium", "high", "critical"].includes(action.risk))
    throw new TypeError("Action risk is invalid.");
}

function canonicalObject(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]),
  );
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return canonicalObject(value as Record<string, unknown>);
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  return String(value);
}
