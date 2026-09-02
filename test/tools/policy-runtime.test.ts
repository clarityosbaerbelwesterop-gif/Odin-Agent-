import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryToolAuditSink } from "../../src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../../src/tools/policy.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import { ToolRuntimeError } from "../../src/tools/types.js";
import { grant, input, NOW, registration } from "./helpers.js";

test("capability policy denies missing scope and enforces call ceilings", async () => {
  const policy = new InMemoryCapabilityPolicy([grant({ maxCalls: 1 })]);
  const runtime = new ToolRuntime(
    new ToolRegistry([registration()]),
    policy,
    new InMemoryToolAuditSink(),
    () => NOW,
  );

  await runtime.execute({
    input: input(),
    missionId: "mission-1",
    taskId: "task-1",
    tool: "test.read",
    version: "1",
  });
  assert.equal(policy.callsUsed("grant-1"), 1);
  await assert.rejects(
    runtime.execute({
      input: input(),
      missionId: "mission-1",
      taskId: "task-1",
      tool: "test.read",
      version: "1",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ToolRuntimeError);
      assert.equal(error.category, "denied");
      return true;
    },
  );

  const outside = new ToolRuntime(
    new ToolRegistry([registration()]),
    new InMemoryCapabilityPolicy([grant()]),
    new InMemoryToolAuditSink(),
    () => NOW,
  );
  await assert.rejects(
    outside.execute({
      input: input("test/outside.ts"),
      missionId: "mission-1",
      taskId: "task-1",
      tool: "test.read",
      version: "1",
    }),
    /No scoped capability grant/,
  );
});

test("high-impact tools require matching unexpired approval evidence", async () => {
  const highRisk = registration({}, { riskClass: "high" });
  const runtime = new ToolRuntime(
    new ToolRegistry([highRisk]),
    new InMemoryCapabilityPolicy([grant()]),
    new InMemoryToolAuditSink(),
    () => NOW,
  );
  const request = {
    input: input(),
    missionId: "mission-1",
    taskId: "task-1",
    tool: "test.read",
    version: "1",
  } as const;

  await assert.rejects(runtime.execute(request), (error: unknown) => {
    assert.ok(error instanceof ToolRuntimeError);
    assert.equal(error.category, "require_approval");
    return true;
  });

  const result = await runtime.execute({
    ...request,
    approval: {
      approvalId: "approval-1",
      expiresAt: "2026-09-02T12:30:00.000Z",
      missionId: "mission-1",
      taskId: "task-1",
      tool: "test.read",
    },
  });
  assert.equal(result.replayed, false);
});

test("side-effecting tools replay safely and reject conflicting idempotency input", async () => {
  let calls = 0;
  const writeRegistration = registration(
    {
      handler: async () => {
        calls += 1;
        return { calls };
      },
    },
    {
      name: "test.write",
      operation: "write",
      riskClass: "medium",
      sideEffecting: true,
      summary: "Write test resource",
    },
  );
  const audit = new InMemoryToolAuditSink();
  const runtime = new ToolRuntime(
    new ToolRegistry([writeRegistration]),
    new InMemoryCapabilityPolicy([
      grant({ grantId: "write-grant", operation: "write", tool: "test.write" }),
    ]),
    audit,
    () => NOW,
  );
  const request = {
    idempotencyKey: "write-1",
    input: input(),
    missionId: "mission-1",
    taskId: "task-1",
    tool: "test.write",
    version: "1",
  } as const;

  const first = await runtime.execute(request);
  const replay = await runtime.execute(request);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.output, first.output);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(audit.records()).includes("src/index.ts"), false);

  await assert.rejects(
    runtime.execute({ ...request, input: input("src/other.ts") }),
    (error: unknown) => {
      assert.ok(error instanceof ToolRuntimeError);
      assert.equal(error.category, "conflict");
      return true;
    },
  );
});

test("concurrent identical writes serialize behind the idempotency key", async () => {
  let calls = 0;
  let release = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writeRegistration = registration(
    {
      handler: async () => {
        calls += 1;
        await gate;
        return { calls };
      },
    },
    {
      name: "test.write",
      operation: "write",
      sideEffecting: true,
      summary: "Write test resource",
    },
  );
  const runtime = new ToolRuntime(
    new ToolRegistry([writeRegistration]),
    new InMemoryCapabilityPolicy([
      grant({ grantId: "parallel-grant", operation: "write", tool: "test.write" }),
    ]),
    new InMemoryToolAuditSink(),
    () => NOW,
  );
  const request = {
    idempotencyKey: "parallel-1",
    input: input(),
    missionId: "mission-1",
    taskId: "task-1",
    tool: "test.write",
    version: "1",
  } as const;

  const first = runtime.execute(request);
  const second = runtime.execute(request);
  await Promise.resolve();
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal([left.replayed, right.replayed].filter(Boolean).length, 1);
});
