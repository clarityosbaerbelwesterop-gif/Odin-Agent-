import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  type ContextBudget,
  type ContextCandidate,
  ContextCompilationCache,
  ContextEngine,
  type ContextEngineRequest,
  type ContextPriority,
  type ContextSourceClass,
  DeterministicContextCompiler,
} from "../../src/context/index.js";
import {
  InMemoryMemoryStore,
  type MemoryKind,
  type MemoryScope,
  type MemorySensitivity,
} from "../../src/memory/index.js";

const NOW = "2026-09-03T14:00:00.000Z";
const LATER = "2026-09-03T14:01:00.000Z";
const SCOPE = {
  missionId: "mission-1",
  projectId: "project-1",
  userId: "user-1",
} satisfies MemoryScope;
const PRIORITY_SOURCE: Readonly<Record<ContextPriority, ContextSourceClass>> = {
  P0: "system",
  P1: "mission",
  P2: "task",
  P3: "repository",
  P4: "observation",
  P5: "memory",
  P6: "history",
};

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function contextCandidate(
  id: string,
  priority: ContextPriority,
  content = `${priority} content for ${id}`,
  overrides: Partial<ContextCandidate> = {},
): ContextCandidate {
  return {
    content,
    id,
    priority,
    relevance: 80,
    semanticKey: id,
    sensitivity: "internal",
    source: {
      class: PRIORITY_SOURCE[priority],
      contentHash: hash(content),
      observedAt: NOW,
      reference: `fixture:${id}`,
      version: "1",
    },
    ...overrides,
  };
}

function contextBudget(): ContextBudget {
  return {
    maxItemTokens: 1_000,
    perPriority: { P0: 1_000, P1: 1_000, P2: 1_000, P3: 1_000, P4: 1_000, P5: 1_000, P6: 1_000 },
    totalTokens: 7_000,
  };
}

function engineRequest(overrides: Partial<ContextEngineRequest> = {}): ContextEngineRequest {
  return {
    budget: contextBudget(),
    memory: {
      evaluatedAt: NOW,
      kinds: ["project", "semantic", "working"],
      limit: 10,
      projectId: SCOPE.projectId,
      text: "package tests",
      userId: SCOPE.userId,
    },
    missionId: SCOPE.missionId,
    policyVersion: "policy-1",
    taskId: "task-1",
    trustedCandidates: [
      contextCandidate("system", "P0"),
      contextCandidate("mission", "P1"),
      contextCandidate("task", "P2"),
    ],
    ...overrides,
  };
}

async function writeMemory(
  store: InMemoryMemoryStore,
  id: string,
  key: string,
  content: string,
  options: {
    readonly kind?: MemoryKind;
    readonly scope?: MemoryScope;
    readonly sensitivity?: MemorySensitivity;
    readonly tags?: readonly string[];
  } = {},
): Promise<void> {
  await store.write({
    expectedVersion: 0,
    idempotencyKey: `write-${id}`,
    record: {
      content,
      id,
      key,
      kind: options.kind ?? "project",
      provenance: {
        contentHash: hash(content),
        observedAt: NOW,
        reference: `fixture:${id}`,
        sourceClass: "repository",
        sourceVersion: "1",
      },
      scope: options.scope ?? SCOPE,
      sensitivity: options.sensitivity ?? "internal",
      tags: options.tags ?? [],
    },
    updatedAt: NOW,
  });
}

function selectedContent(result: Awaited<ReturnType<ContextEngine["compile"]>>): string[] {
  return result.sections.flatMap((section) => section.items.map((item) => item.content));
}

test("vertical slice retrieves scoped memory, compiles context, and lets current sources win", async () => {
  const store = new InMemoryMemoryStore();
  await writeMemory(store, "old-package", "package-version", "Old package version", {
    tags: ["package"],
  });
  await writeMemory(store, "test-command", "test-command", "Use npm test for verification", {
    tags: ["tests"],
  });
  const repository = contextCandidate("repository-package", "P3", "Current package version", {
    semanticKey: "package-version",
  });
  const engine = new ContextEngine(store);
  const result = await engine.compile(
    engineRequest({ trustedCandidates: [...engineRequest().trustedCandidates, repository] }),
  );

  assert.ok(result.selectedIds.includes("repository-package"));
  assert.ok(selectedContent(result).includes("Use npm test for verification"));
  assert.equal(selectedContent(result).includes("Old package version"), false);
  assert.equal(
    result.dropped.some((item) => item.reason === "duplicate"),
    true,
  );
  engine.dispose();
});

test("memory changes invalidate compiled contexts before the next task", async () => {
  const store = new InMemoryMemoryStore();
  await writeMemory(store, "test-command", "test-command", "Use npm test for verification", {
    tags: ["tests"],
  });
  const cache = new ContextCompilationCache();
  const compiler = new DeterministicContextCompiler(cache);
  const engine = new ContextEngine(store, compiler);
  const first = await engine.compile(engineRequest());
  const replay = await engine.compile(engineRequest());

  assert.equal(first.cacheHit, false);
  assert.equal(replay.cacheHit, true);
  assert.equal(cache.size, 1);
  await store.tombstone({
    expectedVersion: 1,
    id: "test-command",
    idempotencyKey: "delete-test-command",
    scope: SCOPE,
    updatedAt: LATER,
  });
  assert.equal(cache.size, 0);
  const afterDelete = await engine.compile(
    engineRequest({ memory: { ...engineRequest().memory, evaluatedAt: LATER } }),
  );
  assert.equal(selectedContent(afterDelete).includes("Use npm test for verification"), false);
  engine.dispose();
});

test("memory retrieval cannot cross user scope through the context facade", async () => {
  const store = new InMemoryMemoryStore();
  await writeMemory(store, "foreign", "secret-note", "Foreign package secret", {
    scope: { ...SCOPE, userId: "user-2" },
    tags: ["package"],
  });
  const engine = new ContextEngine(store);
  const result = await engine.compile(engineRequest());

  assert.equal(selectedContent(result).includes("Foreign package secret"), false);
  engine.dispose();
});

test("sensitive retrieved memory prevents compilation caching", async () => {
  const store = new InMemoryMemoryStore();
  await writeMemory(store, "sensitive", "package-secret", "Sensitive package credential", {
    sensitivity: "sensitive",
    tags: ["package"],
  });
  const cache = new ContextCompilationCache();
  const engine = new ContextEngine(store, new DeterministicContextCompiler(cache));

  assert.equal((await engine.compile(engineRequest())).cacheHit, false);
  assert.equal((await engine.compile(engineRequest())).cacheHit, false);
  assert.equal(cache.size, 0);
  engine.dispose();
});

test("callers cannot smuggle memory or history into a stronger context channel", async () => {
  const store = new InMemoryMemoryStore();
  const engine = new ContextEngine(store);
  await assert.rejects(
    () =>
      engine.compile(
        engineRequest({
          trustedCandidates: [
            ...engineRequest().trustedCandidates,
            contextCandidate("memory", "P5"),
          ],
        }),
      ),
    /not permitted/u,
  );
  await assert.rejects(
    () =>
      engine.compile(engineRequest({ historyCandidates: [contextCandidate("repository", "P3")] })),
    /not permitted/u,
  );
  engine.dispose();
});
