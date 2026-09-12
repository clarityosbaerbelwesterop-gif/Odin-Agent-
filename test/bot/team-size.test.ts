import assert from "node:assert/strict";
import test from "node:test";
import { planBotTeam, specialistPrompt } from "../../src/bot/team.js";

test("long coding missions keep persisted team plans below the database budget", () => {
  const goal = `${"Build the complete production system with tests, security, deploy and merge. ".repeat(240)}END`;
  assert.ok(goal.length > 15_000);

  const plan = planBotTeam(goal, "coding", 4);
  const encoded = Buffer.byteLength(JSON.stringify(plan), "utf8");

  assert.ok(encoded < 50_000, `team plan must stay below 50 KB, got ${encoded}`);
  assert.ok(plan.assignments.every((assignment) => assignment.objective.length < 500));
  assert.ok(
    plan.assignments.every((assignment) => !assignment.objective.includes(goal.slice(0, 100))),
  );
});

test("specialist prompts still receive the complete primary objective", () => {
  const goal = `${"A".repeat(15_900)}TAIL_MARKER`;
  const plan = planBotTeam(goal, "coding", 4);
  const primary = plan.assignments.find((assignment) => assignment.phase === "primary");
  assert.ok(primary);

  const prompt = specialistPrompt(primary, goal);
  assert.ok(prompt.includes("TAIL_MARKER"));
  assert.ok(prompt.includes(`PRIMARY OBJECTIVE: ${goal}`));
});
