import assert from "node:assert/strict";
import test from "node:test";
import { activityLabel, companionState } from "../../src/chat/product-projection.js";
import type { MissionState } from "../../src/mission/runtime.js";

test("companion projects every canonical mission state without becoming state authority", () => {
  const states: readonly MissionState[] = [
    "CREATED",
    "UNDERSTANDING",
    "RETRIEVING",
    "PLANNING",
    "RISK_CHECK",
    "EXECUTING",
    "OBSERVING",
    "VERIFYING",
    "DIAGNOSING",
    "REPAIRING",
    "CHECKPOINTING",
    "FINAL_AUDIT",
    "PAUSING",
    "PAUSED",
    "RESUMING",
    "CANCELLING",
    "COMPLETED",
    "CANCELLED",
    "BLOCKED",
    "FAILED",
  ];
  assert.equal(
    states.every((state) => companionState(state).length > 0),
    true,
  );
  assert.equal(companionState("PLANNING"), "PLANNING");
  assert.equal(companionState("DIAGNOSING"), "REPAIRING");
  assert.equal(companionState("COMPLETED"), "SUCCESS");
  assert.equal(companionState(), "IDLE");
});

test("activity copy is derived from durable events and retains unknown events as raw-only", () => {
  assert.equal(
    activityLabel({ type: "tool.start", data: { name: "repo_read" } }),
    "Using repo_read",
  );
  assert.equal(
    activityLabel({ type: "verification", data: { outcome: "REPAIR_REQUIRED" } }),
    "Verification found a problem. Odin is repairing it.",
  );
  assert.equal(activityLabel({ type: "future.event", data: {} }), null);
});
