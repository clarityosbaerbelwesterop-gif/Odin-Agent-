import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryToolAuditSink } from "../../src/tools/audit.js";
import { InMemoryCapabilityPolicy } from "../../src/tools/policy.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import {
  createRepositoryToolRegistrations,
  normalizeWorkspacePath,
  type QualityCommandRunner,
  type RepositoryWorkspace,
} from "../../src/tools/repository.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import { type CapabilityGrant, ToolRuntimeError } from "../../src/tools/types.js";
import { NOW } from "./helpers.js";

test("workspace path guards reject traversal and absolute path forms", () => {
  assert.equal(normalizeWorkspacePath("src/./index.ts"), "src/index.ts");
  assert.equal(normalizeWorkspacePath(".", true), ".");
  for (const value of ["../secret", "src/../secret", "/etc/passwd", "C:/secret", "src\\secret"]) {
    assert.throws(
      () => normalizeWorkspacePath(value),
      (error: unknown) => {
        assert.ok(error instanceof ToolRuntimeError);
        assert.equal(error.category, "invalid_input");
        return true;
      },
    );
  }
});

test("repository tools forward only normalized scoped operations", async () => {
  const calls: string[] = [];
  const workspace: RepositoryWorkspace = {
    async patch({ path, expectedSha, content }) {
      calls.push(`patch:${path}:${expectedSha}:${content}`);
      return { sha: "next-sha" };
    },
    async read({ path, maxBytes }) {
      calls.push(`read:${path}:${maxBytes}`);
      return { content: "hello", sha: "read-sha", truncated: false };
    },
    async search({ query, path, maxResults }) {
      calls.push(`search:${path}:${query}:${maxResults}`);
      return [{ line: 3, path: "src/index.ts", preview: "hello" }];
    },
  };
  const quality: QualityCommandRunner = {
    commands: () => [{ id: "verify", label: "Repository verification" }],
    async run(commandId) {
      calls.push(`quality:${commandId}`);
      return { exitCode: 0, output: "ok" };
    },
  };
  const registry = new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace }));
  const policy = new InMemoryCapabilityPolicy(repositoryGrants());
  const runtime = new ToolRuntime(registry, policy, new InMemoryToolAuditSink(), () => NOW);

  const search = await runtime.execute({
    input: { maxResults: 5, path: ".", query: "hello" },
    missionId: "mission-1",
    taskId: "task-1",
    tool: "repo.search",
    version: "1",
  });
  assert.equal(Array.isArray((search.output as { matches?: unknown }).matches), true);

  const read = await runtime.execute({
    input: { maxBytes: 1000, path: "src/./index.ts" },
    missionId: "mission-1",
    taskId: "task-1",
    tool: "repo.read",
    version: "1",
  });
  assert.equal((read.output as { content?: unknown }).content, "hello");

  const patch = await runtime.execute({
    idempotencyKey: "patch-1",
    input: { content: "next", expectedSha: "old-sha", path: "src/index.ts" },
    missionId: "mission-1",
    taskId: "task-1",
    tool: "repo.patch",
    version: "1",
  });
  assert.equal((patch.output as { sha?: unknown }).sha, "next-sha");

  const qualityResult = await runtime.execute({
    idempotencyKey: "quality-1",
    input: { commandId: "verify" },
    missionId: "mission-1",
    taskId: "task-1",
    tool: "repo.quality",
    version: "1",
  });
  assert.equal((qualityResult.output as { exitCode?: unknown }).exitCode, 0);
  assert.deepEqual(calls, [
    "search:.:hello:5",
    "read:src/index.ts:1000",
    "patch:src/index.ts:old-sha:next",
    "quality:verify",
  ]);
});

test("repository tools reject traversal and unknown quality command IDs before adapters", async () => {
  let adapterCalls = 0;
  const workspace: RepositoryWorkspace = {
    async patch() {
      adapterCalls += 1;
      return { sha: "sha" };
    },
    async read() {
      adapterCalls += 1;
      return { content: "", truncated: false };
    },
    async search() {
      adapterCalls += 1;
      return [];
    },
  };
  const quality: QualityCommandRunner = {
    commands: () => [{ id: "verify", label: "Repository verification" }],
    async run() {
      adapterCalls += 1;
      return { exitCode: 0, output: "ok" };
    },
  };
  const runtime = new ToolRuntime(
    new ToolRegistry(createRepositoryToolRegistrations({ quality, workspace })),
    new InMemoryCapabilityPolicy(repositoryGrants()),
    new InMemoryToolAuditSink(),
    () => NOW,
  );

  await assert.rejects(
    runtime.execute({
      input: { maxBytes: 100, path: "../secret" },
      missionId: "mission-1",
      taskId: "task-1",
      tool: "repo.read",
      version: "1",
    }),
    /traversal/,
  );
  await assert.rejects(
    runtime.execute({
      idempotencyKey: "quality-bad",
      input: { commandId: "rm-rf" },
      missionId: "mission-1",
      taskId: "task-1",
      tool: "repo.quality",
      version: "1",
    }),
    /Unknown quality command ID/,
  );
  assert.equal(adapterCalls, 0);
});

function repositoryGrants(): readonly CapabilityGrant[] {
  return [
    {
      expiresAt: "2026-09-02T13:00:00.000Z",
      grantId: "search-grant",
      maxCalls: 5,
      missionId: "mission-1",
      operation: "search",
      resourcePrefix: ".",
      taskId: "task-1",
      tool: "repo.search",
    },
    {
      expiresAt: "2026-09-02T13:00:00.000Z",
      grantId: "read-grant",
      maxCalls: 5,
      missionId: "mission-1",
      operation: "read",
      resourcePrefix: "src",
      taskId: "task-1",
      tool: "repo.read",
    },
    {
      expiresAt: "2026-09-02T13:00:00.000Z",
      grantId: "patch-grant",
      maxCalls: 5,
      missionId: "mission-1",
      operation: "write",
      resourcePrefix: "src",
      taskId: "task-1",
      tool: "repo.patch",
    },
    {
      expiresAt: "2026-09-02T13:00:00.000Z",
      grantId: "quality-grant",
      maxCalls: 5,
      missionId: "mission-1",
      operation: "execute",
      resourcePrefix: "quality/verify",
      taskId: "task-1",
      tool: "repo.quality",
    },
  ];
}
