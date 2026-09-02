import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryToolAuditSink } from "../../src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../../src/tools/policy.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import { ToolRuntimeError } from "../../src/tools/types.js";
import { grant, input, NOW, registration } from "./helpers.js";

test("retryable failures consume capability calls and append one audit record per attempt", async () => {
  let calls = 0;
  const retrying = registration(
    {
      handler: () => {
        calls += 1;
        if (calls === 1) throw new ToolRuntimeError("retryable", "temporary", true);
        return { ok: true };
      },
    },
    {
      retryPolicy: {
        maxAttempts: 2,
        retryableCategories: ["retryable"],
        timeoutMs: 100,
      },
    },
  );
  const policy = new InMemoryCapabilityPolicy([grant({ maxCalls: 2 })]);
  const audit = new InMemoryToolAuditSink();
  const runtime = new ToolRuntime(new ToolRegistry([retrying]), policy, audit, () => NOW);

  const result = await runtime.execute({
    input: input(),
    missionId: "mission-1",
    taskId: "task-1",
    tool: "test.read",
    version: "1",
  });
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
  assert.equal(policy.callsUsed("grant-1"), 2);
  assert.deepEqual(
    audit.records().map((record) => record.resultClass),
    ["failure", "success"],
  );
});

test("handler timeouts are bounded and cannot exceed retry or call ceilings", async () => {
  const hanging = registration(
    { handler: () => new Promise(() => undefined) },
    {
      retryPolicy: {
        maxAttempts: 2,
        retryableCategories: ["timeout"],
        timeoutMs: 5,
      },
    },
  );
  const policy = new InMemoryCapabilityPolicy([grant({ maxCalls: 2 })]);
  const audit = new InMemoryToolAuditSink();
  const runtime = new ToolRuntime(new ToolRegistry([hanging]), policy, audit, () => NOW);

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
      assert.equal(error.category, "timeout");
      return true;
    },
  );
  assert.equal(policy.callsUsed("grant-1"), 2);
  assert.deepEqual(
    audit.records().map((record) => record.resultClass),
    ["timeout", "timeout"],
  );
});

test("pre-cancelled requests do not reach policy-granted handlers", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const policy = new InMemoryCapabilityPolicy([grant()]);
  const audit = new InMemoryToolAuditSink();
  const runtime = new ToolRuntime(
    new ToolRegistry([
      registration({
        handler: () => {
          calls += 1;
          return { ok: true };
        },
      }),
    ]),
    policy,
    audit,
    () => NOW,
  );

  await assert.rejects(
    runtime.execute({
      input: input(),
      missionId: "mission-1",
      signal: controller.signal,
      taskId: "task-1",
      tool: "test.read",
      version: "1",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ToolRuntimeError);
      assert.equal(error.category, "cancelled");
      return true;
    },
  );
  assert.equal(calls, 0);
  assert.equal(policy.callsUsed("grant-1"), 0);
  assert.equal(audit.records()[0]?.resultClass, "cancelled");
});
