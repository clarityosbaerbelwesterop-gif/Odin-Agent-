import assert from "node:assert/strict";
import test from "node:test";
import { botPlanLimits } from "../../src/bot/entitlements.js";

test("Odin Bot is server-entitled for Pro and above, never Free", () => {
  assert.equal(botPlanLimits("free", {}).enabled, false);
  assert.equal(botPlanLimits("pro", {}).enabled, true);
  assert.equal(botPlanLimits("developer", {}).enabled, true);
  assert.equal(botPlanLimits("ultra", {}).enabled, true);
});

test("Odin Bot quotas are configuration-driven without trusting browser state", () => {
  const limits = botPlanLimits("pro", {
    ODIN_BOT_PRO_MAX_ACTIVE_TASKS: "9",
    ODIN_BOT_PRO_MAX_AUTOMATIONS: "44",
  });
  assert.equal(limits.maxActiveTasks, 9);
  assert.equal(limits.maxAutomations, 44);
  assert.equal(
    botPlanLimits("pro", { ODIN_BOT_PRO_MAX_ACTIVE_TASKS: "not-a-number" }).maxActiveTasks,
    3,
  );
});
