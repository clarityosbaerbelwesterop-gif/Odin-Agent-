import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  type ContextBudget,
  ContextBudgetError,
  type ContextCandidate,
  ContextCompilationCache,
  type ContextCompileRequest,
  type ContextPriority,
  type ContextSourceClass,
  DeterministicContextCompiler,
} from "../../src/context/index.js";

const NOW = "2026-09-03T12:00:00.000Z";
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

function candidate(
  id: string,
  priority: ContextPriority,
  content = `${priority} content for ${id}`,
  overrides: Partial<ContextCandidate> = {},
): ContextCandidate {
  return {
    content,
    id,
    priority,
    relevance: 50,
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

function budget(overrides: Partial<ContextBudget> = {}): ContextBudget {
  return {
    maxItemTokens: 1_000,
    perPriority: { P0: 1_000, P1: 1_000, P2: 1_000, P3: 1_000, P4: 1_000, P5: 1_000, P6: 1_000 },
    totalTokens: 7_000,
    ...overrides,
  };
}

function request(
  extras: readonly ContextCandidate[] = [],
  overrides: Partial<ContextCompileRequest> = {},
): ContextCompileRequest {
  return {
    budget: budget(),
    candidates: [
      candidate("system", "P0"),
      candidate("mission", "P1"),
      candidate("task", "P2"),
      ...extras,
    ],
    missionId: "mission-1",
    policyVersion: "context-policy-1",
    taskId: "task-1",
    ...overrides,
  };
}

function withoutCacheHit<T extends { readonly cacheHit: boolean }>(value: T): Omit<T, "cacheHit"> {
  const { cacheHit, ...rest } = structuredClone(value);
  void cacheHit;
  return rest;
}

test("compiles trusted context in P0-P6 order with auditable token and source metadata", () => {
  const compiler = new DeterministicContextCompiler();
  const result = compiler.compile(
    request([
      candidate("history", "P6"),
      candidate("memory", "P5"),
      candidate("observation", "P4"),
      candidate("repository", "P3"),
    ]),
  );

  assert.deepEqual(result.selectedIds, [
    "system",
    "mission",
    "task",
    "repository",
    "observation",
    "memory",
    "history",
  ]);
  assert.deepEqual(
    result.sections.map((section) => section.priority),
    ["P0", "P1", "P2", "P3", "P4", "P5", "P6"],
  );
  assert.equal(
    result.estimatedTokens,
    result.sections.reduce((sum, section) => sum + section.estimatedTokens, 0),
  );
  assert.equal(result.tokenEstimateMethod, "utf8-bytes-divided-by-3-plus-overhead-v1");
  assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/u);
  assert.match(result.resultHash, /^[a-f0-9]{64}$/u);
});

test("input order cannot change selection, accounting, or result identity", () => {
  const extras = [candidate("repository", "P3"), candidate("memory", "P5")];
  const compiler = new DeterministicContextCompiler();
  const first = compiler.compile(request(extras));
  const reordered = request(extras, {
    candidates: [...request(extras).candidates].reverse(),
  });
  const second = compiler.compile(reordered);

  assert.equal(second.cacheHit, true);
  assert.deepEqual(withoutCacheHit(second), withoutCacheHit(first));
});

test("current trusted sources win semantic collisions over retrieved memory and history", () => {
  const repository = candidate("repository", "P3", "Current package version", {
    semanticKey: "package-version",
  });
  const memory = candidate("memory-old", "P5", "Old package version", {
    relevance: 100,
    semanticKey: "package-version",
  });
  const history = candidate("history-old", "P6", "Older package version", {
    semanticKey: "package-version",
  });
  const result = new DeterministicContextCompiler().compile(request([memory, history, repository]));

  assert.ok(result.selectedIds.includes("repository"));
  assert.equal(result.selectedIds.includes("memory-old"), false);
  assert.equal(result.selectedIds.includes("history-old"), false);
  assert.deepEqual(result.dropped, [
    { id: "history-old", reason: "duplicate" },
    { id: "memory-old", reason: "duplicate" },
  ]);
});

test("lower-priority context is discarded before required or current repository context", () => {
  const required = [
    candidate("system", "P0", "abc"),
    candidate("mission", "P1", "abc"),
    candidate("task", "P2", "abc"),
  ];
  const repository = candidate("repository", "P3", "abc");
  const observation = candidate("observation", "P4", "abc");
  const result = new DeterministicContextCompiler().compile(
    request([], {
      budget: budget({
        perPriority: { P0: 36, P1: 36, P2: 36, P3: 36, P4: 36, P5: 36, P6: 36 },
        totalTokens: 36,
      }),
      candidates: [...required, observation, repository],
    }),
  );

  assert.deepEqual(result.selectedIds, ["system", "mission", "task", "repository"]);
  assert.deepEqual(result.dropped, [{ id: "observation", reason: "total_budget" }]);
});

test("required P0-P2 context fails closed instead of being truncated", () => {
  const compiler = new DeterministicContextCompiler();
  assert.throws(
    () => compiler.compile(request([], { budget: budget({ maxItemTokens: 10 }) })),
    ContextBudgetError,
  );
  assert.throws(
    () =>
      compiler.compile(
        request([], {
          candidates: [candidate("system", "P0"), candidate("task", "P2")],
        }),
      ),
    /P1 is missing/u,
  );
});

test("optional item, section, and total limits produce explicit drop reasons", () => {
  const long = candidate("long", "P3", "x".repeat(90));
  const sectionA = candidate("section-a", "P4", "abc");
  const sectionB = candidate("section-b", "P4", "abc");
  const result = new DeterministicContextCompiler().compile(
    request([long, sectionA, sectionB], {
      budget: budget({
        maxItemTokens: 20,
        perPriority: { P0: 100, P1: 100, P2: 100, P3: 100, P4: 9, P5: 100, P6: 100 },
        totalTokens: 100,
      }),
    }),
  );

  assert.deepEqual(result.dropped, [
    { id: "long", reason: "item_limit" },
    { id: "section-b", reason: "section_budget" },
  ]);
});

test("source/priority mismatches, forged hashes, bad timestamps, and duplicate IDs fail closed", () => {
  const compiler = new DeterministicContextCompiler();
  const repository = candidate("repository", "P3");
  assert.throws(
    () => compiler.compile(request([{ ...repository, priority: "P5" }])),
    /must use P3/u,
  );
  assert.throws(
    () =>
      compiler.compile(
        request([{ ...repository, source: { ...repository.source, contentHash: "a".repeat(64) } }]),
      ),
    /does not match/u,
  );
  assert.throws(
    () =>
      compiler.compile(
        request([
          { ...repository, source: { ...repository.source, observedAt: "2026-09-03T12:00:00Z" } },
        ]),
      ),
    /canonical/u,
  );
  assert.throws(
    () => compiler.compile(request([candidate("system", "P3")])),
    /Duplicate context candidate ID/u,
  );
});

test("cache hits require identical content, source metadata, policy, and budget", () => {
  const cache = new ContextCompilationCache();
  const compiler = new DeterministicContextCompiler(cache);
  const repository = candidate("repository", "P3", "version one");
  compiler.compile(request([repository]));
  assert.equal(compiler.compile(request([repository])).cacheHit, true);
  assert.equal(cache.size, 1);

  const changedContent = "version two";
  const changed = {
    ...repository,
    content: changedContent,
    source: { ...repository.source, contentHash: hash(changedContent), version: "2" },
  };
  assert.equal(compiler.compile(request([changed])).cacheHit, false);
  assert.equal(cache.size, 1, "a changed source invalidates its old cached compilation");
  assert.equal(
    compiler.compile(request([changed], { policyVersion: "context-policy-2" })).cacheHit,
    false,
  );
  assert.equal(
    compiler.compile(request([changed], { budget: budget({ totalTokens: 6_999 }) })).cacheHit,
    false,
  );
});

test("sensitive candidates are compiled but never cached", () => {
  const cache = new ContextCompilationCache();
  const compiler = new DeterministicContextCompiler(cache);
  const sensitive = candidate("secret", "P3", "sensitive repository data", {
    sensitivity: "sensitive",
  });

  assert.equal(compiler.compile(request([sensitive])).cacheHit, false);
  assert.equal(compiler.compile(request([sensitive])).cacheHit, false);
  assert.equal(cache.size, 0);
  assert.equal(cache.hits, 0);
});

test("cache capacity and explicit source invalidation are bounded and observable", () => {
  const cache = new ContextCompilationCache(1);
  const compiler = new DeterministicContextCompiler(cache);
  compiler.compile(request([candidate("repository-a", "P3")], { taskId: "task-a" }));
  compiler.compile(request([candidate("repository-b", "P3")], { taskId: "task-b" }));

  assert.equal(cache.size, 1);
  assert.equal(compiler.invalidateSource("repository-b"), 1);
  assert.equal(cache.size, 0);
  assert.equal(compiler.invalidateSource("repository-b"), 0);
});

test("caller mutation cannot alter a cached context result", () => {
  const compiler = new DeterministicContextCompiler();
  const first = compiler.compile(request([candidate("repository", "P3")]));
  const mutableIds = first.selectedIds as string[];
  mutableIds[0] = "tampered";
  const replay = compiler.compile(request([candidate("repository", "P3")]));

  assert.equal(replay.cacheHit, true);
  assert.equal(replay.selectedIds[0], "system");
});
