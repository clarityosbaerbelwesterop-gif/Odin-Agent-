import assert from "node:assert/strict";
import test from "node:test";
import { assessBotAction, botRuntimeAccess } from "../../src/bot/autonomy.js";
import { checkFocus, isContinuationRequest, memoryContentHash } from "../../src/bot/continuity.js";
import { botSpecialists, planBotTeam, specialistPrompt } from "../../src/bot/team.js";

test("M4 specialist catalog contains the required Odin team roles", () => {
  const ids = new Set(botSpecialists().map((item) => item.id));
  for (const id of [
    "odin_general",
    "odin_coder",
    "odin_debugger",
    "odin_reviewer",
    "odin_research",
    "odin_security",
    "odin_devops",
    "odin_data",
    "odin_project",
    "odin_docs",
    "odin_ux",
    "odin_support",
    "odin_voice_support",
  ])
    assert.ok(ids.has(id as never), `missing ${id}`);
});

test("M4 simple work stays single-agent and complex coding uses controlled specialists", () => {
  const simple = planBotTeam("Summarize this short note.", "chat", 4);
  assert.equal(simple.complexity, "simple");
  assert.equal(simple.assignments.length, 1);

  const complex = planBotTeam(
    "Fix the production login bug, review RLS security, run CI and verify the Vercel deployment, then prepare the result for merge.",
    "coding",
    4,
  );
  assert.equal(complex.primary, "odin_coder");
  assert.equal(complex.complexity, "complex");
  assert.ok(complex.assignments.some((item) => item.specialistId === "odin_debugger"));
  assert.ok(
    complex.assignments.some(
      (item) => item.specialistId === "odin_security" || item.specialistId === "odin_devops",
    ),
  );
  assert.ok(complex.assignments.some((item) => item.specialistId === "odin_reviewer"));
  assert.ok(complex.assignments.length <= 4);
  assert.equal(complex.assignments.filter((item) => item.mayWriteWorkspace).length, 1);
  for (const assignment of complex.assignments.filter((item) => !item.mayWriteWorkspace)) {
    assert.match(specialistPrompt(assignment, "goal"), /read-only/u);
  }
});

test("M5 permanently gated actions cannot be authorized by autonomy level alone", () => {
  for (const level of [0, 1, 2, 3, 4] as const) {
    const result = assessBotAction(level, {
      type: "git.merge_critical_production",
      ref: "repo#61",
      reversible: false,
      externalSideEffect: true,
      risk: "critical",
    });
    assert.equal(result.decision, "approval_required");
    assert.equal(result.approvalScope, "exact_action");
  }
});

test("M5 runtime access follows persisted autonomy level", () => {
  assert.deepEqual(botRuntimeAccess(0), {
    readToolsAllowed: false,
    workspaceWritesAllowed: false,
  });
  assert.deepEqual(botRuntimeAccess(1), {
    readToolsAllowed: true,
    workspaceWritesAllowed: false,
  });
  assert.deepEqual(botRuntimeAccess(2), {
    readToolsAllowed: true,
    workspaceWritesAllowed: false,
  });
  assert.deepEqual(botRuntimeAccess(3), {
    readToolsAllowed: true,
    workspaceWritesAllowed: true,
  });
  assert.deepEqual(botRuntimeAccess(4), {
    readToolsAllowed: true,
    workspaceWritesAllowed: true,
  });
  assert.throws(() => botRuntimeAccess(5), /Autonomy level/u);
});

test("M5 level 3 only autonomously executes reversible low-risk effects", () => {
  assert.equal(
    assessBotAction(3, {
      type: "git.branch.create",
      ref: "repo:feature/test",
      reversible: true,
      externalSideEffect: true,
      risk: "low",
    }).decision,
    "allow",
  );
  assert.equal(
    assessBotAction(3, {
      type: "data.delete",
      ref: "record:1",
      reversible: false,
      externalSideEffect: true,
      risk: "high",
    }).decision,
    "approval_required",
  );
});

test("M5 action hashes bind approvals to exact action metadata", () => {
  const base = {
    type: "git.merge_critical_production",
    ref: "repo#61",
    reversible: false,
    externalSideEffect: true,
    risk: "critical" as const,
  };
  const first = assessBotAction(4, { ...base, metadata: { sha: "aaa", branch: "main" } });
  const reordered = assessBotAction(4, { ...base, metadata: { branch: "main", sha: "aaa" } });
  const changed = assessBotAction(4, { ...base, metadata: { branch: "main", sha: "bbb" } });
  assert.equal(first.actionHash, reordered.actionHash);
  assert.notEqual(first.actionHash, changed.actionHash);
});

test("M6 continuity recognizes follow-up language and focus drift", () => {
  assert.equal(isContinuationRequest("Mach bei dem Ding von gestern weiter."), true);
  assert.equal(isContinuationRequest("Build an unrelated weather app."), false);
  const aligned = checkFocus(
    "Bring Odin Bot to production with durable background tasks",
    "Continue Odin Bot background task production verification",
  );
  assert.equal(aligned.aligned, true);
  const drift = checkFocus(
    "Bring Odin Bot to production with durable background tasks",
    "Write a recipe for apple pie",
  );
  assert.equal(drift.shouldReplan, true);
});

test("M6 memory hashes are content-bound", () => {
  assert.match(memoryContentHash("project=odin"), /^[a-f0-9]{64}$/u);
  assert.notEqual(memoryContentHash("project=odin"), memoryContentHash("project=lurix"));
});
