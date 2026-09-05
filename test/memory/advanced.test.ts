import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AdvancedMemoryEngine,
  AdvancedMemoryError,
  InMemoryMemoryStore,
} from "../../src/memory/index.js";

const T0 = "2026-09-01T08:00:00.000Z";
const T1 = "2026-09-02T08:00:00.000Z";
const T2 = "2026-09-05T08:00:00.000Z";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeProject(
  store: InMemoryMemoryStore,
  input: {
    content: string;
    id: string;
    key: string;
    observedAt: string;
    sourceVersion: string;
    updatedAt: string;
  },
) {
  return store.write({
    expectedVersion: 0,
    idempotencyKey: `write-${input.id}`,
    record: {
      content: input.content,
      id: input.id,
      key: input.key,
      kind: "project",
      provenance: {
        contentHash: hash(input.content),
        observedAt: input.observedAt,
        reference: `fixture:${input.id}`,
        sourceClass: "repository",
        sourceVersion: input.sourceVersion,
      },
      scope: { projectId: "project-1", userId: "user-1" },
      sensitivity: "internal",
      tags: ["architecture"],
    },
    updatedAt: input.updatedAt,
  });
}

async function writeEpisode(
  store: InMemoryMemoryStore,
  id: string,
  content: string,
  updatedAt: string,
) {
  return store.write({
    expectedVersion: 0,
    idempotencyKey: `write-${id}`,
    record: {
      content,
      id,
      key: id,
      kind: "episodic",
      provenance: {
        contentHash: hash(content),
        observedAt: updatedAt,
        reference: `fixture:${id}`,
        sourceClass: "tool",
        sourceVersion: "fixture-v1",
      },
      scope: { projectId: "project-1", userId: "user-1" },
      sensitivity: "internal",
      tags: ["episode"],
    },
    updatedAt,
  });
}

test("M24 current repository observations outrank stale project-memory conclusions", async () => {
  const store = new InMemoryMemoryStore();
  await writeProject(store, {
    content: "The runtime uses legacy route A.",
    id: "project-route-old",
    key: "runtime-route",
    observedAt: T0,
    sourceVersion: "commit-a",
    updatedAt: T0,
  });
  await writeEpisode(store, "episode-1", "A coding repair completed successfully.", T1);
  const engine = new AdvancedMemoryEngine(store, () => T2);

  const result = await engine.retrieve({
    currentSources: [
      {
        contentHash: hash("The runtime uses current route B."),
        key: "runtime-route",
        observedAt: T2,
        sourceVersion: "commit-b",
      },
    ],
    evaluatedAt: T2,
    limit: 10,
    projectId: "project-1",
    text: "",
    userId: "user-1",
  });

  assert.deepEqual(
    result.selected.map((item) => item.record.id),
    ["episode-1"],
  );
  assert.deepEqual(result.stale, [
    {
      reason: "current_source_newer",
      recordHash: (
        await store.get("project-route-old", { projectId: "project-1", userId: "user-1" })
      )?.recordHash,
      recordId: "project-route-old",
    },
  ]);
  assert.equal(result.conflicts.length, 0);
  assert.match(result.resultHash, /^[a-f0-9]{64}$/u);
});

test("M24 conflicting equally fresh project conclusions block silent selection", async () => {
  const store = new InMemoryMemoryStore();
  await writeProject(store, {
    content: "Use strategy A.",
    id: "strategy-a",
    key: "build-strategy",
    observedAt: T1,
    sourceVersion: "v2",
    updatedAt: T1,
  });
  await writeProject(store, {
    content: "Use strategy B.",
    id: "strategy-b",
    key: "build-strategy",
    observedAt: T1,
    sourceVersion: "v2",
    updatedAt: T1,
  });
  const engine = new AdvancedMemoryEngine(store, () => T2);
  const result = await engine.retrieve({
    currentSources: [],
    evaluatedAt: T2,
    limit: 10,
    projectId: "project-1",
    text: "",
    userId: "user-1",
  });

  assert.equal(result.selected.length, 0);
  assert.deepEqual(
    result.conflicts.map((group) => group.recordIds),
    [["strategy-a", "strategy-b"]],
  );
});

test("M24 newer project memory supersedes older memory deterministically", async () => {
  const store = new InMemoryMemoryStore();
  await writeProject(store, {
    content: "Old architecture conclusion.",
    id: "architecture-old",
    key: "architecture",
    observedAt: T0,
    sourceVersion: "v1",
    updatedAt: T0,
  });
  await writeProject(store, {
    content: "New architecture conclusion.",
    id: "architecture-new",
    key: "architecture",
    observedAt: T1,
    sourceVersion: "v2",
    updatedAt: T1,
  });
  const engine = new AdvancedMemoryEngine(store, () => T2);
  const result = await engine.retrieve({
    currentSources: [],
    evaluatedAt: T2,
    limit: 10,
    projectId: "project-1",
    text: "",
    userId: "user-1",
  });
  assert.deepEqual(
    result.selected.map((item) => item.record.id),
    ["architecture-new"],
  );
  assert.equal(result.stale[0]?.reason, "newer_project_memory");
});

test("M24 retention planning and exact tombstone preserve M6 deletion semantics", async () => {
  const store = new InMemoryMemoryStore();
  const old = await writeEpisode(store, "old-episode", "Old bounded event.", T0);
  await writeEpisode(store, "new-episode", "Fresh bounded event.", T2);
  const engine = new AdvancedMemoryEngine(store, () => T2);
  const plan = await engine.planRetention({
    evaluatedAt: T2,
    policy: {
      episodicMaxAgeMs: 2 * 24 * 60 * 60 * 1000,
      projectMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
    },
    projectId: "project-1",
    userId: "user-1",
  });
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.id),
    ["old-episode"],
  );
  assert.match(plan.planHash, /^[a-f0-9]{64}$/u);

  const deleted = await engine.tombstone({
    expectedVersion: old.record.version,
    id: "old-episode",
    idempotencyKey: "delete-old-episode",
    projectId: "project-1",
    userId: "user-1",
  });
  assert.equal(deleted.record.status, "tombstoned");
  assert.equal(deleted.record.content, null);
});

test("M24 compression is source-hash-bound and commits only lower-authority project memory", async () => {
  const store = new InMemoryMemoryStore();
  await writeEpisode(store, "episode-a", "First verified repair observation.", T1);
  await writeEpisode(store, "episode-b", "Second verified repair observation.", T1);
  const engine = new AdvancedMemoryEngine(store, () => T2);
  const proposal = await engine.proposeCompression({
    key: "repair-summary",
    projectId: "project-1",
    sensitivity: "internal",
    sourceRecordIds: ["episode-b", "episode-a"],
    summary: "Two repair observations were preserved as a lower-authority summary.",
    userId: "user-1",
  });
  assert.deepEqual(
    proposal.sourceRecords.map((source) => source.id),
    ["episode-a", "episode-b"],
  );

  const committed = await engine.commitCompression(proposal, "compress-repairs");
  assert.equal(committed.record.status, "active");
  if (committed.record.status !== "active") assert.fail("Expected active compressed memory.");
  assert.equal(committed.record.kind, "project");
  assert.equal(committed.record.provenance.sourceClass, "model_summary");
  assert.deepEqual(committed.record.tags, ["m24-compressed"]);

  await engine.tombstone({
    expectedVersion: 1,
    id: "episode-a",
    idempotencyKey: "delete-source-a",
    projectId: "project-1",
    userId: "user-1",
  });
  await assert.rejects(
    () => engine.commitCompression(proposal, "compress-repairs-after-change"),
    (error: unknown) => error instanceof AdvancedMemoryError && error.code === "CONFLICT",
  );
});

test("M24 exact scope and malformed current-source evidence fail closed", async () => {
  const store = new InMemoryMemoryStore();
  await writeEpisode(store, "episode-1", "Scoped event.", T1);
  const engine = new AdvancedMemoryEngine(store, () => T2);
  const foreign = await engine.retrieve({
    currentSources: [],
    evaluatedAt: T2,
    limit: 10,
    projectId: "foreign-project",
    text: "",
    userId: "user-1",
  });
  assert.equal(foreign.selected.length, 0);

  await assert.rejects(
    () =>
      engine.retrieve({
        currentSources: [
          {
            contentHash: "not-a-hash",
            key: "architecture",
            observedAt: T2,
            sourceVersion: "v2",
          },
        ],
        evaluatedAt: T2,
        limit: 10,
        projectId: "project-1",
        text: "",
        userId: "user-1",
      }),
    AdvancedMemoryError,
  );
});
