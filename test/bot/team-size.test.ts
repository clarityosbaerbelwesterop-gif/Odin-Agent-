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

test("primary specialist preserves the complete near-limit objective without overflowing chat input", () => {
  const goal = `${"A".repeat(15_980)}TAIL_MARKER`;
  assert.ok(goal.length <= 16_000);
  const plan = planBotTeam(goal, "coding", 4);
  const primary = plan.assignments.find((assignment) => assignment.phase === "primary");
  assert.ok(primary);

  const prompt = specialistPrompt(primary, goal, "supplemental context that cannot displace the goal");
  assert.equal(prompt, goal);
  assert.ok(prompt.includes("TAIL_MARKER"));
  assert.ok(prompt.length <= 16_000);
});

test("supplemental specialists stay within chat input bounds while retaining permission rules", () => {
  const goal = `${"Build and verify security, UI, deployment and repository behavior. ".repeat(260)}END`;
  const plan = planBotTeam(goal, "coding", 4);
  const preflight = plan.assignments.find((assignment) => assignment.phase === "preflight");
  const reviewer = plan.assignments.find((assignment) => assignment.phase === "review");
  assert.ok(preflight);
  assert.ok(reviewer);

  const context = "PRIMARY RESULT: ".concat("verified output ".repeat(1200));
  const preflightPrompt = specialistPrompt(preflight, goal, context);
  const reviewPrompt = specialistPrompt(reviewer, goal, context);

  assert.ok(preflightPrompt.length <= 16_000);
  assert.match(preflightPrompt, /read-only/u);
  assert.ok(reviewPrompt.length <= 16_000);
  assert.match(reviewPrompt, /VERDICT: PASS/u);
  assert.match(reviewPrompt, /PRIMARY RESULT/u);
});
