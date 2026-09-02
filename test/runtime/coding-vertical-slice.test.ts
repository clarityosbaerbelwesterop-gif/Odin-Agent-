import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemoryEventStore } from "../../src/events/store.js";
import { restoreMissionCheckpoint } from "../../src/mission/checkpoint.js";
import {
  MissionDomainError,
  type MissionEventData,
  MissionRuntime,
} from "../../src/mission/runtime.js";
import { CodingOrchestrator } from "../../src/runtime/coding.js";
import { InMemoryToolAuditSink } from "../../src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../../src/tools/policy.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { createRepositoryToolRegistrations } from "../../src/tools/repository.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import type { CapabilityGrant } from "../../src/tools/types.js";
import {
  FIXED_NOW,
  FixtureQualityRunner,
  FixtureWorkspace,
  fixtureFiles,
  modelResponse,
  ScriptedProvider,
  TARGET_PATH,
} from "./coding-fixtures.js";

const WRONG_CONTENT = "export function add(a: number, b: number): number {\n  return a - b;\n}\n";
const REPAIRED_CONTENT =
  "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
const SECOND_WRONG_CONTENT =
  "export function add(a: number, b: number): number {\n  return b;\n}\n";

const BUDGETS = {
  attempts: 30,
  costMicros: 0,
  inputTokens: 10_000,
  outputTokens: 10_000,
  toolCalls: 30,
} as const;

function plan(expectedSha: string, qualityCommandId = "verify") {
  return modelResponse(
    {
      change: { content: WRONG_CONTENT, expectedSha, path: TARGET_PATH },
      qualityCommandId,
      task: {
        definitionOfDone: ["add returns the sum of both arguments"],
        dependsOn: [],
        id: "change-math",
        priority: 10,
        title: "Fix add implementation",
      },
    },
    40,
    20,
  );
}

function repair(expectedSha: string, content = REPAIRED_CONTENT) {
  return modelResponse({ content, expectedSha, path: TARGET_PATH }, 30, 10);
}

function buildTools(
  workspace: FixtureWorkspace,
  quality: FixtureQualityRunner,
  audit: InMemoryToolAuditSink,
  policy = new InMemoryCapabilityPolicy(),
) {
  const registry = new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace }));
  return {
    grants: policy,
    tools: new ToolRuntime(registry, policy, audit, () => FIXED_NOW),
  };
}

function orchestrator(input: {
  provider: ScriptedProvider;
  mission: MissionRuntime;
  workspace: FixtureWorkspace;
  quality: FixtureQualityRunner;
  audit: InMemoryToolAuditSink;
  grants?: InMemoryCapabilityPolicy;
}) {
  const toolStack = buildTools(input.workspace, input.quality, input.audit, input.grants);
  return new CodingOrchestrator({
    audit: input.audit,
    clock: () => FIXED_NOW,
    grants: toolStack.grants,
    mission: input.mission,
    model: "fixture-model",
    provider: input.provider,
    quality: input.quality,
    tools: toolStack.tools,
  });
}

function textHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("M4 connects discovery, strict planning, scoped patch, failed gate, repair, and evidence", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const provider = new ScriptedProvider([
    plan(workspace.sha(TARGET_PATH)),
    repair(textHash(WRONG_CONTENT)),
  ]);
  const runtime = new MissionRuntime(store, () => FIXED_NOW);
  const coding = orchestrator({ audit, mission: runtime, provider, quality, workspace });

  const result = await coding.start({
    budgetLimits: BUDGETS,
    missionId: "m4-happy",
    objective: "Fix add function",
  });

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.report.state, "COMPLETED");
  assert.equal(result.report.taskStatuses["change-math"], "VERIFIED");
  assert.equal(result.report.taskStatuses.__m4_quality__, "VERIFIED");
  assert.deepEqual(result.report.changedFiles, [TARGET_PATH]);
  assert.equal(result.report.quality.commandId, "verify");
  assert.equal(result.report.quality.finalExitCode, 0);
  assert.match(
    result.report.quality.firstFailureSignature ?? "",
    /^quality:verify:exit:1:sha256:/u,
  );
  assert.deepEqual(result.report.modelUsage, { inputTokens: 70, outputTokens: 30 });
  assert.ok(result.report.toolCalls >= 8);
  assert.ok(result.report.attempts >= result.report.toolCalls + 2);
  assert.ok(result.report.auditReferences.length >= result.report.toolCalls);
  assert.equal(workspace.content(TARGET_PATH), REPAIRED_CONTENT);
  assert.equal(workspace.patches.length, 2);
  assert.deepEqual(quality.seenCommandIds, ["verify", "verify"]);

  assert.equal(provider.requests.length, 2);
  for (const request of provider.requests) {
    assert.equal(request.responseFormat?.type, "json_schema");
    if (request.responseFormat?.type === "json_schema") {
      assert.equal(request.responseFormat.strict, true);
    }
  }
  const planRequest = provider.requests[0]?.messages[1];
  assert.equal(planRequest?.role, "user");
  if (planRequest?.role === "user") {
    const text = planRequest.content[0];
    assert.equal(text?.type, "text");
    if (text?.type === "text") {
      assert.equal(text.text.includes("dist/generated.js"), false);
      assert.equal(text.text.includes("node_modules/pkg/index.js"), false);
      assert.equal(text.text.includes(TARGET_PATH), true);
    }
  }
});

test("M4 restart replays mission state and resumes from DIAGNOSING with fresh runtime objects", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const firstProvider = new ScriptedProvider([plan(workspace.sha(TARGET_PATH))]);
  const firstRuntime = new MissionRuntime(store, () => FIXED_NOW);
  const firstCoding = orchestrator({
    audit,
    mission: firstRuntime,
    provider: firstProvider,
    quality,
    workspace,
  });

  const interrupted = await firstCoding.start(
    { budgetLimits: BUDGETS, missionId: "m4-resume", objective: "Fix add function" },
    { interruptAfterFirstFailure: true },
  );
  assert.equal(interrupted.status, "interrupted");
  if (interrupted.status !== "interrupted") return;
  assert.equal(interrupted.mission.state, "DIAGNOSING");
  assert.equal(restoreMissionCheckpoint(interrupted.checkpoint, "m4-resume").state, "DIAGNOSING");
  assert.equal(workspace.patches.length, 1);

  const resumedProvider = new ScriptedProvider([repair(textHash(WRONG_CONTENT))]);
  const freshRuntime = new MissionRuntime(store, () => FIXED_NOW);
  const freshCoding = orchestrator({
    audit,
    mission: freshRuntime,
    provider: resumedProvider,
    quality,
    workspace,
  });
  const report = await freshCoding.resume("m4-resume");

  assert.equal(report.state, "COMPLETED");
  assert.deepEqual(report.modelUsage, { inputTokens: 70, outputTokens: 30 });
  assert.deepEqual(report.changedFiles, [TARGET_PATH]);
  assert.equal(report.quality.firstFailureSignature, interrupted.failureSignature);
  assert.equal(workspace.content(TARGET_PATH), REPAIRED_CONTENT);
  assert.equal(workspace.patches.length, 2);
  assert.deepEqual(quality.seenCommandIds, ["verify", "verify"]);
  assert.equal(resumedProvider.requests.length, 1);
  assert.ok(report.auditReferences.length >= 1);
});

test("malformed provider plan is rejected before any repository write", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const provider = new ScriptedProvider([
    modelResponse(
      {
        change: {
          content: WRONG_CONTENT,
          expectedSha: workspace.sha(TARGET_PATH),
          path: TARGET_PATH,
        },
        task: {
          definitionOfDone: ["valid looking task but incomplete root plan"],
          dependsOn: [],
          id: "change-math",
          priority: 10,
          title: "Fix add implementation",
        },
      },
      10,
      5,
    ),
  ]);
  const coding = orchestrator({
    audit,
    mission: new MissionRuntime(store, () => FIXED_NOW),
    provider,
    quality,
    workspace,
  });

  await assert.rejects(
    coding.start({ budgetLimits: BUDGETS, missionId: "m4-invalid", objective: "Fix add function" }),
  );
  assert.equal(workspace.patches.length, 0);
  assert.deepEqual(quality.seenCommandIds, []);
  assert.deepEqual(await store.load("m4-invalid"), []);
});

test("model-provided arbitrary command text cannot become a quality execution", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const provider = new ScriptedProvider([plan(workspace.sha(TARGET_PATH), "verify && rm -rf /")]);
  const coding = orchestrator({
    audit,
    mission: new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW),
    provider,
    quality,
    workspace,
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m4-command-deny",
      objective: "Fix add function",
    }),
    /unregistered quality command/u,
  );
  assert.equal(workspace.patches.length, 0);
  assert.deepEqual(quality.seenCommandIds, []);
});

test("a still-failing required quality gate transitions the mission to FAILED, never COMPLETED", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const store = new InMemoryEventStore<MissionEventData>();
  const provider = new ScriptedProvider([
    plan(workspace.sha(TARGET_PATH)),
    repair(textHash(WRONG_CONTENT), SECOND_WRONG_CONTENT),
  ]);
  const runtime = new MissionRuntime(store, () => FIXED_NOW);
  const coding = orchestrator({ audit, mission: runtime, provider, quality, workspace });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m4-fail-closed",
      objective: "Fix add function",
    }),
    (error: unknown) => {
      assert.ok(error instanceof MissionDomainError);
      assert.match(error.message, /quality gate is still failing/u);
      return true;
    },
  );
  assert.equal((await runtime.load("m4-fail-closed")).state, "FAILED");
  assert.equal(workspace.patches.length, 2);
  assert.deepEqual(quality.seenCommandIds, ["verify", "verify"]);
});

test("missing capability registration denies bootstrap discovery before adapters are mutated", async () => {
  const workspace = new FixtureWorkspace(fixtureFiles());
  const quality = new FixtureQualityRunner(workspace);
  const audit = new InMemoryToolAuditSink();
  const policy = new InMemoryCapabilityPolicy();
  const registry = new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace }));
  const tools = new ToolRuntime(registry, policy, audit, () => FIXED_NOW);
  const noOpGrantSink = { register(_grant: CapabilityGrant): void {} };
  const coding = new CodingOrchestrator({
    audit,
    clock: () => FIXED_NOW,
    grants: noOpGrantSink,
    mission: new MissionRuntime(new InMemoryEventStore<MissionEventData>(), () => FIXED_NOW),
    model: "fixture-model",
    provider: new ScriptedProvider([]),
    quality,
    tools,
  });

  await assert.rejects(
    coding.start({
      budgetLimits: BUDGETS,
      missionId: "m4-policy-deny",
      objective: "Fix add function",
    }),
    /No scoped capability grant/u,
  );
  assert.equal(workspace.patches.length, 0);
  assert.deepEqual(quality.seenCommandIds, []);
});
