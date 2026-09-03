import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  InMemoryMemoryStore,
  MemoryConflictError,
  type MemoryKind,
  type MemoryRecordInput,
  type MemoryScope,
  type MemorySourceClass,
  type MemoryWriteCommand,
} from "../../src/memory/index.js";

const NOW = "2026-09-03T10:00:00.000Z";
const LATER = "2026-09-03T10:01:00.000Z";
const SCOPE = {
  missionId: "mission-1",
  projectId: "project-1",
  userId: "user-1",
} satisfies MemoryScope;

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function command(
  overrides: Partial<MemoryRecordInput> = {},
  commandOverrides: Partial<Omit<MemoryWriteCommand, "record">> = {},
): MemoryWriteCommand {
  const content = overrides.content ?? "The repository uses strict TypeScript.";
  return {
    expectedVersion: commandOverrides.expectedVersion ?? 0,
    idempotencyKey: commandOverrides.idempotencyKey ?? "write-1",
    record: {
      content,
      id: "memory-1",
      key: "project-language",
      kind: "project",
      provenance: {
        contentHash: hash(content),
        observedAt: NOW,
        reference: "repository:tsconfig.json",
        sourceClass: "repository",
        sourceVersion: "commit-1",
      },
      scope: SCOPE,
      sensitivity: "internal",
      tags: ["TypeScript", "Architecture"],
      ...overrides,
    },
    updatedAt: commandOverrides.updatedAt ?? NOW,
  };
}

async function writeMemory(
  store: InMemoryMemoryStore,
  id: string,
  key: string,
  content: string,
  kind: MemoryKind = "project",
  scope: MemoryScope = SCOPE,
  tags: readonly string[] = [],
  sourceClass: MemorySourceClass = "repository",
  expiresAt?: string,
): Promise<void> {
  await store.write(
    command(
      {
        content,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        id,
        key,
        kind,
        provenance: {
          contentHash: hash(content),
          observedAt: NOW,
          reference: `fixture:${id}`,
          sourceClass,
          sourceVersion: "1",
        },
        scope,
        tags,
      },
      { idempotencyKey: `write-${id}` },
    ),
  );
}

test("writes a versioned immutable copy with normalized tags and verified provenance", async () => {
  const store = new InMemoryMemoryStore();
  const input = command();
  const result = await store.write(input);

  assert.equal(result.replayed, false);
  assert.equal(result.storeRevision, 1);
  assert.equal(result.record.version, 1);
  assert.equal(result.record.status, "active");
  assert.deepEqual(result.record.tags, ["architecture", "typescript"]);
  assert.match(result.record.recordHash, /^[a-f0-9]{64}$/u);

  const mutableTags = input.record.tags as string[];
  mutableTags[0] = "changed-after-write";
  const stored = await store.get("memory-1", SCOPE);
  assert.equal(stored?.status, "active");
  if (stored?.status !== "active") throw new Error("Expected active memory fixture.");
  assert.deepEqual(stored.tags, ["architecture", "typescript"]);
});

test("optimistic versions reject competing writes while exact retries are idempotent", async () => {
  const store = new InMemoryMemoryStore();
  const initial = command();
  const first = await store.write(initial);
  const replay = await store.write(initial);

  assert.equal(replay.replayed, true);
  assert.equal(replay.storeRevision, first.storeRevision);
  assert.equal(store.revision, 1);
  await assert.rejects(
    () =>
      store.write(
        command(
          {
            content: "Competing content",
            provenance: {
              ...initial.record.provenance,
              contentHash: hash("Competing content"),
            },
          },
          { idempotencyKey: "competing-write" },
        ),
      ),
    MemoryConflictError,
  );
  await assert.rejects(
    () => store.write({ ...initial, updatedAt: LATER }),
    /Idempotency key was reused/u,
  );
});

test("updates require the exact version and preserve metadata-only revision history", async () => {
  const store = new InMemoryMemoryStore();
  await store.write(command());
  const content = "The repository uses strict TypeScript and Node 24.";
  const updated = await store.write(
    command(
      {
        content,
        provenance: {
          contentHash: hash(content),
          observedAt: LATER,
          reference: "repository:package.json",
          sourceClass: "repository",
          sourceVersion: "commit-2",
        },
      },
      { expectedVersion: 1, idempotencyKey: "write-2", updatedAt: LATER },
    ),
  );

  assert.equal(updated.record.version, 2);
  const history = await store.history("memory-1", SCOPE);
  assert.equal(history.length, 2);
  const firstRevision = history[0];
  assert.ok(firstRevision);
  assert.equal("content" in firstRevision, false);
});

test("concurrent updates serialize and timestamps cannot move backwards", async () => {
  const store = new InMemoryMemoryStore();
  await store.write(command());
  const competing = ["First update", "Second update"].map((content, index) =>
    store.write(
      command(
        {
          content,
          provenance: {
            contentHash: hash(content),
            observedAt: LATER,
            reference: `fixture:concurrent-${index}`,
            sourceClass: "tool",
            sourceVersion: "2",
          },
        },
        { expectedVersion: 1, idempotencyKey: `concurrent-${index}`, updatedAt: LATER },
      ),
    ),
  );
  const outcomes = await Promise.allSettled(competing);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(store.revision, 2);
  await assert.rejects(
    () =>
      store.tombstone({
        expectedVersion: 2,
        id: "memory-1",
        idempotencyKey: "backdated-delete",
        scope: SCOPE,
        updatedAt: NOW,
      }),
    /must not move backwards/u,
  );
});

test("scope isolation prevents cross-user reads, retrieval, and delete existence probes", async () => {
  const store = new InMemoryMemoryStore();
  await store.write(command());
  const foreignScope = { ...SCOPE, userId: "user-2" };

  assert.equal(await store.get("memory-1", foreignScope), undefined);
  assert.deepEqual(await store.history("memory-1", foreignScope), []);
  assert.deepEqual(
    await store.retrieve({
      evaluatedAt: NOW,
      kinds: ["project"],
      limit: 10,
      projectId: SCOPE.projectId,
      text: "typescript",
      userId: foreignScope.userId,
    }),
    [],
  );
  await assert.rejects(
    () =>
      store.tombstone({
        expectedVersion: 1,
        id: "memory-1",
        idempotencyKey: "delete-foreign",
        scope: foreignScope,
        updatedAt: LATER,
      }),
    /scope or optimistic version/u,
  );
});

test("working memory is mission-bound and user preferences require explicit consent provenance", async () => {
  const store = new InMemoryMemoryStore();
  const content = "Prefer concise status updates.";

  await assert.rejects(
    () =>
      store.write(
        command({
          kind: "working",
          scope: { projectId: "project-1", userId: "user-1" },
        }),
      ),
    /requires a mission scope/u,
  );
  await assert.rejects(
    () =>
      store.write(
        command({
          content,
          kind: "user_preference",
          provenance: {
            contentHash: hash(content),
            observedAt: NOW,
            reference: "model:summary",
            sourceClass: "model_summary",
            sourceVersion: "1",
          },
        }),
      ),
    /explicit user provenance/u,
  );

  await writeMemory(
    store,
    "preference-1",
    "status-style",
    content,
    "user_preference",
    SCOPE,
    ["communication"],
    "explicit_user",
  );
  assert.equal((await store.get("preference-1", SCOPE))?.status, "active");
});

test("tombstones remove raw content, remain auditable, and replay safely", async () => {
  const store = new InMemoryMemoryStore();
  const originalWrite = command();
  await store.write(originalWrite);
  const deletion = {
    expectedVersion: 1,
    id: "memory-1",
    idempotencyKey: "delete-1",
    scope: SCOPE,
    updatedAt: LATER,
  } as const;
  const first = await store.tombstone(deletion);
  const replay = await store.tombstone(deletion);

  assert.equal(first.record.status, "tombstoned");
  assert.equal(first.record.content, null);
  assert.equal(replay.replayed, true);
  assert.equal(store.revision, 2);
  assert.equal((await store.history("memory-1", SCOPE))[1]?.action, "tombstoned");
  assert.deepEqual(Object.keys(first.record).sort(), [
    "content",
    "id",
    "previousContentHash",
    "recordHash",
    "scope",
    "status",
    "updatedAt",
    "version",
  ]);
  await assert.rejects(() => store.write(originalWrite), MemoryConflictError);
  const replacement = "Attempted resurrection";
  await assert.rejects(
    () =>
      store.write(
        command(
          {
            content: replacement,
            provenance: {
              contentHash: hash(replacement),
              observedAt: LATER,
              reference: "fixture:resurrection",
              sourceClass: "tool",
              sourceVersion: "3",
            },
          },
          { expectedVersion: 2, idempotencyKey: "resurrection", updatedAt: LATER },
        ),
      ),
    /cannot be restored/u,
  );
  assert.deepEqual(
    await store.retrieve({
      evaluatedAt: LATER,
      kinds: ["project"],
      limit: 10,
      projectId: SCOPE.projectId,
      text: "typescript",
      userId: SCOPE.userId,
    }),
    [],
  );
});

test("retrieval is bounded, lexical, tag-aware, deterministic, and filters expiry", async () => {
  const store = new InMemoryMemoryStore();
  await writeMemory(store, "a", "database", "PostgreSQL migration rules", "project", SCOPE, [
    "sql",
  ]);
  await writeMemory(store, "b", "database-sql", "Unrelated note", "semantic", SCOPE, ["sql"]);
  await writeMemory(
    store,
    "expired",
    "database",
    "PostgreSQL old note",
    "episodic",
    SCOPE,
    ["sql"],
    "repository",
    "2026-09-03T09:59:59.999Z",
  );

  const result = await store.retrieve({
    evaluatedAt: NOW,
    kinds: ["project", "semantic", "episodic"],
    limit: 2,
    projectId: SCOPE.projectId,
    tags: ["SQL"],
    text: "database postgres",
    userId: SCOPE.userId,
  });

  assert.deepEqual(
    result.map((item) => item.record.id),
    ["a", "b"],
  );
  const first = result[0];
  const second = result[1];
  assert.ok(first && second);
  assert.ok(first.score > second.score);
  assert.equal(
    result.some((item) => item.record.id === "expired"),
    false,
  );
});

test("working retrieval requires and enforces an exact mission scope", async () => {
  const store = new InMemoryMemoryStore();
  await writeMemory(store, "working-a", "next", "Run tests", "working");
  await writeMemory(store, "working-b", "next", "Deploy", "working", {
    ...SCOPE,
    missionId: "mission-2",
  });

  await assert.rejects(
    () =>
      store.retrieve({
        evaluatedAt: NOW,
        kinds: ["working"],
        limit: 10,
        projectId: SCOPE.projectId,
        text: "next",
        userId: SCOPE.userId,
      }),
    /requires a mission scope/u,
  );
  const result = await store.retrieve({
    evaluatedAt: NOW,
    kinds: ["working"],
    limit: 10,
    missionId: SCOPE.missionId,
    projectId: SCOPE.projectId,
    text: "next",
    userId: SCOPE.userId,
  });
  assert.deepEqual(
    result.map((item) => item.record.id),
    ["working-a"],
  );
});

test("malformed timestamps, hashes, duplicate tags, and future provenance fail closed", async () => {
  const store = new InMemoryMemoryStore();
  await assert.rejects(
    () =>
      store.write(command({ provenance: { ...command().record.provenance, contentHash: "bad" } })),
    /SHA-256/u,
  );
  await assert.rejects(() => store.write(command({ tags: ["SQL", "sql"] })), /unique/u);
  await assert.rejects(
    () => store.write({ ...command(), updatedAt: "2026-09-03T10:00:00Z" }),
    /canonical/u,
  );
  await assert.rejects(
    () =>
      store.write(command({ provenance: { ...command().record.provenance, observedAt: LATER } })),
    /cannot be observed after/u,
  );
});

test("subscribers receive committed revisions and cannot break writes", async () => {
  const store = new InMemoryMemoryStore();
  const revisions: number[] = [];
  store.subscribe(() => {
    throw new Error("observer failure");
  });
  const unsubscribe = store.subscribe((change) => revisions.push(change.storeRevision));
  await store.write(command());
  unsubscribe();
  await store.tombstone({
    expectedVersion: 1,
    id: "memory-1",
    idempotencyKey: "delete-1",
    scope: SCOPE,
    updatedAt: LATER,
  });

  assert.deepEqual(revisions, [1]);
  assert.equal(store.revision, 2);
});
