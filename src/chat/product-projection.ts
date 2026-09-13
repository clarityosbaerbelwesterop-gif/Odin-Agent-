import type { MissionSnapshot, MissionState, TaskStatus } from "../mission/runtime.js";
import type { ChatEvent } from "./types.js";

export type CompanionState =
  | "IDLE"
  | "UNDERSTANDING"
  | "PLANNING"
  | "WORKING"
  | "VERIFYING"
  | "REPAIRING"
  | "BLOCKED"
  | "SUCCESS";

export interface ProductPlanStep {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "active" | "done" | "failed";
  readonly definitionOfDone: readonly string[];
}

const COMPANION_STATE: Readonly<Record<MissionState, CompanionState>> = {
  CREATED: "UNDERSTANDING",
  UNDERSTANDING: "UNDERSTANDING",
  RETRIEVING: "UNDERSTANDING",
  PLANNING: "PLANNING",
  RISK_CHECK: "PLANNING",
  EXECUTING: "WORKING",
  OBSERVING: "WORKING",
  VERIFYING: "VERIFYING",
  DIAGNOSING: "REPAIRING",
  REPAIRING: "REPAIRING",
  CHECKPOINTING: "VERIFYING",
  FINAL_AUDIT: "VERIFYING",
  PAUSING: "BLOCKED",
  PAUSED: "BLOCKED",
  RESUMING: "WORKING",
  CANCELLING: "BLOCKED",
  COMPLETED: "SUCCESS",
  CANCELLED: "BLOCKED",
  BLOCKED: "BLOCKED",
  FAILED: "BLOCKED",
};

const PLAN_STATUS: Readonly<Record<TaskStatus, ProductPlanStep["status"]>> = {
  PENDING: "pending",
  RUNNING: "active",
  VERIFIED: "done",
  FAILED: "failed",
  CANCELLED: "failed",
};

export function companionState(state?: MissionState): CompanionState {
  return state ? COMPANION_STATE[state] : "IDLE";
}

/** A client projection over the canonical M2 task graph; it creates no planning authority. */
export function productPlan(snapshot: MissionSnapshot): readonly ProductPlanStep[] {
  return snapshot.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: PLAN_STATUS[snapshot.taskStatuses[task.id] ?? "PENDING"],
    definitionOfDone: task.definitionOfDone,
  }));
}

/** Human-readable copy derived from a durable event. Raw event type/data stay authoritative. */
export function activityLabel(event: Pick<ChatEvent, "type" | "data">): string | null {
  const data = event.data;
  if (event.type === "activity" && typeof data.message === "string") return data.message;
  if (event.type === "tool.start")
    return typeof data.name === "string" ? `Using ${data.name}` : "Using a connected tool";
  if (event.type === "tool.end")
    return data.status === "failed" ? "A tool reported a problem" : "Tool work finished";
  if (event.type === "file.changed")
    return typeof data.path === "string" ? `Updated ${data.path}` : "Updated a workspace file";
  if (event.type === "quality")
    return `Quality check ${data.passed === true ? "passed" : "needs attention"}`;
  if (event.type === "verification")
    return data.outcome === "PASS"
      ? "Verification passed"
      : "Verification found a problem. Odin is repairing it.";
  if (event.type === "answer") return "Result delivered";
  if (event.type === "state" && typeof data.state === "string")
    return `Run moved to ${data.state.toLowerCase().replaceAll("_", " ")}`;
  if (event.type === "error") return "The run needs attention";
  if (event.type === "workspace.item.created")
    return typeof data.title === "string" ? `Created ${data.title}` : "Created a workspace item";
  if (event.type === "workspace.document.updated")
    return typeof data.title === "string" ? `Updated ${data.title}` : "Updated a document";
  if (event.type === "workspace.artifact.created")
    return typeof data.title === "string"
      ? `Saved ${data.title} from a Run`
      : "Saved a Run result as an artifact";
  if (event.type === "workspace.file.imported")
    return typeof data.title === "string" ? `Imported ${data.title}` : "Imported a workspace file";
  if (event.type === "workspace.context.added") return "Added an item to project context";
  if (event.type === "workspace.context.removed") return "Removed an item from project context";
  if (event.type === "workspace.preview.opened") return "Opened a workspace preview";
  return null;
}
