import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type ActiveMemoryRecord,
  type MemoryBrainPulse,
  type MemoryProductSignal,
  projectMemoryBrain,
} from "../../src/memory/index.js";

const projectId = "project-a";
const evaluatedAt = "2026-09-13T08:00:00.000Z";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function memory(
  id: string,
  key: string,
  content: string,
  options: Partial<{
    kind: ActiveMemoryRecord["kind"];
    sourceClass: ActiveMemoryRecord["provenance"]["sourceClass"];
    reference: string;
    updatedAt: string;
    observedAt: string;
    expiresAt: string;
    sensitivity: ActiveMemoryRecord["sensitivity"];
    tags: readonly string[];
  }> = {},
): ActiveMemoryRecord {
  const updatedAt = options.updatedAt ?? "2026-09-12T08:00:00.000Z";
  const record = {
    id,
    key,
    kind: options.kind ?? "project",
    scope: { userId: "user-a", projectId },
    content,
    tags: options.tags ?? ["odin"],
    sensitivity: options.sensitivity ?? "internal",
    provenance: {
      sourceClass: options.sourceClass ?? "repository",
      reference: options.reference ?? `odin://project/${projectId}/workspace/source-a`,
      sourceVersion: "1",
      observedAt: options.observedAt ?? updatedAt,
      contentHash: sha(content),
    },
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
    status: "active" as const,
    version: 1,
    updatedAt,
  };
  return { ...record, recordHash: sha(JSON.stringify(record)) };
}

function signal(id: string, patch: Partial<MemoryProductSignal> = {}): MemoryProductSignal {
  return {
    id,
    usageCount: patch.usageCount ?? 0,
    lastUsedAt: patch.lastUsedAt ?? null,
    pinned: patch.pinned ?? false,
    archivedAt: patch.archivedAt ?? null,
  };
}

test("PRODUCT M3 graph is a deterministic projection over canonical Memory records", () => {
  const records = [
    memory("m-explicit", "mobile-first", "The product is mobile first.", {
      sourceClass: "explicit_user",
      reference: "odin://user/memory",
      tags: ["product", "mobile"],
    }),
    memory("m-repo", "auth", "Authentication uses Neon Auth.", {
      tags: ["security", "auth"],
    }),
  ];
  const first = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records,
    signals: [signal("m-explicit", { pinned: true, usageCount: 4 })],
  });
  const second = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records: [...records].reverse(),
    signals: [signal("m-explicit", { pinned: true, usageCount: 4 })],
  });
  assert.equal(first.projectionHash, second.projectionHash);
  assert.equal(first.nodes.filter((node) => node.nodeClass === "MEMORY").length, 2);
  assert.ok(
    (first.nodes.find((node) => node.id === "m-explicit")?.importance ?? 0) >
      (first.nodes.find((node) => node.id === "m-repo")?.importance ?? 0),
  );
  assert.equal(first.nodes.find((node) => node.id === "m-explicit")?.sourceClass, "explicit_user");
});

test("PRODUCT M3 shows stale and conflict states instead of silently choosing ambiguous memory", () => {
  const records = [
    memory("m-stale", "pricing", "Price is 19", { updatedAt: "2026-09-10T08:00:00.000Z" }),
    memory("m-conflict-a", "region", "EU", { observedAt: "2026-09-12T08:00:00.000Z" }),
    memory("m-conflict-b", "region", "US", { observedAt: "2026-09-12T08:00:00.000Z" }),
  ];
  const graph = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records,
    staleIds: ["m-stale"],
    conflicts: [
      {
        key: "region",
        recordHashes: [records[1]?.recordHash ?? "", records[2]?.recordHash ?? ""],
        recordIds: ["m-conflict-a", "m-conflict-b"],
      },
    ],
  });
  assert.equal(graph.nodes.find((node) => node.id === "m-stale")?.status, "STALE");
  assert.equal(graph.nodes.find((node) => node.id === "m-conflict-a")?.status, "CONFLICTED");
  assert.equal(graph.counts.CONFLICTED, 2);
});

test("PRODUCT M3 marks low-risk old fragments as noise without deleting them", () => {
  const old = memory("m-old", "temporary-note", "An old fragment", {
    kind: "episodic",
    sourceClass: "model_summary",
    updatedAt: "2026-06-01T08:00:00.000Z",
    observedAt: "2026-06-01T08:00:00.000Z",
  });
  const graph = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records: [old],
    signals: [signal(old.id)],
  });
  assert.equal(graph.nodes.find((node) => node.id === old.id)?.status, "NOISE_CANDIDATE");
  assert.equal(graph.nodes.find((node) => node.id === old.id)?.recordHash, old.recordHash);
});

test("PRODUCT M3 preserves high-value or used memory from automatic noise classification", () => {
  const old = memory("m-old", "explicit-decision", "Keep the existing API.", {
    kind: "episodic",
    sourceClass: "explicit_user",
    updatedAt: "2026-06-01T08:00:00.000Z",
    observedAt: "2026-06-01T08:00:00.000Z",
  });
  const pinned = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records: [old],
    signals: [signal(old.id, { pinned: true })],
  });
  const used = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records: [old],
    signals: [signal(old.id, { usageCount: 2 })],
  });
  assert.notEqual(pinned.nodes.find((node) => node.id === old.id)?.status, "NOISE_CANDIDATE");
  assert.notEqual(used.nodes.find((node) => node.id === old.id)?.status, "NOISE_CANDIDATE");
});

test("PRODUCT M3 projects exact duplicates as superseded with retained provenance", () => {
  const first = memory("m-1", "decision", "Keep the API", {
    updatedAt: "2026-09-10T08:00:00.000Z",
    observedAt: "2026-09-10T08:00:00.000Z",
    reference: "odin://project/project-a/workspace/one",
  });
  const second = memory("m-2", "decision", "Keep the API", {
    updatedAt: "2026-09-12T08:00:00.000Z",
    observedAt: "2026-09-12T08:00:00.000Z",
    reference: "odin://project/project-a/workspace/two",
  });
  const graph = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records: [first, second],
  });
  assert.equal(graph.nodes.find((node) => node.id === first.id)?.status, "SUPERSEDED");
  assert.equal(graph.nodes.find((node) => node.id === second.id)?.mergedCount, 2);
  assert.ok(graph.edges.some((item) => item.relation === "supersedes"));
  assert.equal(graph.nodes.find((node) => node.id === first.id)?.sourceReference, first.provenance.reference);
});

test("PRODUCT M3 Brain Pulse marks only real selected Memory and Workspace references", () => {
  const record = memory("m-live", "architecture", "Use one authority.");
  const pulse: MemoryBrainPulse = {
    turnId: "turn-a",
    selectedMemoryIds: [record.id],
    selectedWorkspaceReferences: [record.provenance.reference],
    contextResultHash: "a".repeat(64),
    at: evaluatedAt,
    dropped: [],
  };
  const graph = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records: [record],
    pulse,
    sources: [
      {
        reference: record.provenance.reference,
        title: "Architecture",
        nodeClass: "DOCUMENT",
      },
    ],
  });
  assert.equal(graph.nodes.find((node) => node.id === record.id)?.activeInContext, true);
  assert.equal(graph.nodes.find((node) => node.nodeClass === "DOCUMENT")?.activeInContext, true);
  assert.equal(graph.pulse?.contextResultHash, pulse.contextResultHash);
});

test("PRODUCT M3 graph redacts sensitive summaries while keeping safe provenance metadata", () => {
  const sensitive = memory("m-sensitive", "credential-boundary", "private internal detail", {
    sensitivity: "sensitive",
    sourceClass: "explicit_user",
    reference: "odin://user/memory",
  });
  const graph = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records: [sensitive],
  });
  const node = graph.nodes.find((item) => item.id === sensitive.id);
  assert.match(node?.summary ?? "", /hidden/u);
  assert.doesNotMatch(node?.summary ?? "", /private internal detail/u);
  assert.equal(node?.sensitivity, "sensitive");
  assert.equal(node?.sourceClass, "explicit_user");
});

test("PRODUCT M3 graph remains bounded and filterable", () => {
  const records = Array.from({ length: 180 }, (_, index) =>
    memory(`m-${index}`, `topic-${index}`, `content ${index}`, {
      kind: index % 2 ? "semantic" : "project",
      sourceClass: index % 3 ? "repository" : "tool",
      tags: [`tag-${index % 4}`],
    }),
  );
  const graph = projectMemoryBrain({
    projectId,
    projectTitle: "Odin",
    evaluatedAt,
    records,
    maxMemoryNodes: 80,
    filters: { kinds: ["semantic"] },
  });
  assert.equal(graph.nodes.filter((node) => node.nodeClass === "MEMORY").length, 80);
  assert.equal(graph.truncated, true);
  assert.ok(graph.edges.length <= 320);
});
