import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type ContextCandidate,
  type ContextCompileRequest,
  type ContextPriority,
  type ContextSourceClass,
  canExitEarly,
  compactToolResult,
  EfficientContextCompiler,
  evaluateContextEfficiency,
  selectAdaptiveReasoningDepth,
} from "../../src/context/index.js";

const NOW = "2026-09-04T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const SOURCE_BY_PRIORITY: Readonly<Record<ContextPriority, ContextSourceClass>> = {
  P0: "system",
  P1: "mission",
  P2: "task",
  P3: "repository",
  P4: "observation",
  P5: "memory",
  P6: "history",
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidate(
  id: string,
  priority: ContextPriority,
  content: string,
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
      class: SOURCE_BY_PRIORITY[priority],
      contentHash: hash(content),
      observedAt: NOW,
      reference: `fixture:${id}`,
      version: "1",
    },
    ...overrides,
  };
}

function context(observation = "initial observation"): ContextCompileRequest {
  const stable = "stable invariant ".repeat(80);
  return {
    budget: {
      maxItemTokens: 2_000,
      perPriority: {
        P0: 2_000,
        P1: 2_000,
        P2: 2_000,
        P3: 2_000,
        P4: 2_000,
        P5: 2_000,
        P6: 2_000,
      },
      totalTokens: 10_000,
    },
    candidates: [
      candidate("system", "P0", stable),
      candidate("mission", "P1", stable),
      candidate("task", "P2", stable),
      candidate("repository", "P3", stable),
      candidate("observation", "P4", observation),
    ],
    missionId: "mission-m18",
    policyVersion: "context-policy-m18",
    taskId: "task-m18",
  };
}

function efficientRequest(contextValue = context()) {
  return {
    context: contextValue,
    modelProfileHash: HASH_A,
    stablePrefixHash: HASH_B,
    verificationRequirementHash: HASH_C,
  };
}

test("known identically bound context emits only changed delta while preserving effective P0-P2", () => {
  const compiler = new EfficientContextCompiler();
  const first = compiler.compile(efficientRequest());
  assert.equal(first.deltaEstimatedTokens, first.effectiveEstimatedTokens);
  assert.deepEqual(first.reusedIds, []);

  const second = compiler.compile({
    ...efficientRequest(context("new compact observation")),
    previousResultHash: first.full.resultHash,
  });
  assert.deepEqual(second.reusedIds, ["mission", "repository", "system", "task"]);
  assert.deepEqual(
    second.deltaSections.map((section) => section.priority),
    ["P4"],
  );
  assert.deepEqual(second.removedIds, []);
  assert.ok(second.savingsBps >= 5_000);
  assert.deepEqual(
    second.full.sections.slice(0, 3).map((section) => section.priority),
    ["P0", "P1", "P2"],
  );
});

test("delta identifies removed context so stale items cannot survive reuse", () => {
  const compiler = new EfficientContextCompiler();
  const first = compiler.compile(efficientRequest());
  const reduced = context();
  const second = compiler.compile({
    ...efficientRequest({
      ...reduced,
      candidates: reduced.candidates.filter((entry) => entry.id !== "observation"),
    }),
    previousResultHash: first.full.resultHash,
  });
  assert.deepEqual(second.removedIds, ["observation"]);
  assert.equal(second.full.selectedIds.includes("observation"), false);
});

test("unknown baseline and changed policy model or verification binding fall back to full context", () => {
  const compiler = new EfficientContextCompiler();
  const first = compiler.compile(efficientRequest());
  for (const request of [
    { ...efficientRequest(), previousResultHash: "d".repeat(64), stablePrefixHash: HASH_B },
    { ...efficientRequest(), previousResultHash: first.full.resultHash, modelProfileHash: HASH_B },
    {
      ...efficientRequest(),
      previousResultHash: first.full.resultHash,
      verificationRequirementHash: HASH_A,
    },
  ]) {
    const result = compiler.compile(request);
    assert.equal(result.deltaEstimatedTokens, result.effectiveEstimatedTokens);
    assert.deepEqual(result.reusedIds, []);
  }
});

test("source content changes invalidate semantic reuse and sensitive context is never retained", () => {
  const compiler = new EfficientContextCompiler();
  const first = compiler.compile(efficientRequest());
  const changed = context();
  const repository = candidate("repository", "P3", "changed repository source");
  const second = compiler.compile({
    ...efficientRequest({
      ...changed,
      candidates: [...changed.candidates.slice(0, 3), repository],
    }),
    previousResultHash: first.full.resultHash,
  });
  assert.equal(second.reusedIds.includes("repository"), false);

  const sensitiveContext = context();
  const sensitive = compiler.compile(
    efficientRequest({
      ...sensitiveContext,
      candidates: sensitiveContext.candidates.map((entry) =>
        entry.id === "task" ? { ...entry, sensitivity: "sensitive" as const } : entry,
      ),
    }),
  );
  const replay = compiler.compile({
    ...efficientRequest(),
    previousResultHash: sensitive.full.resultHash,
  });
  assert.deepEqual(replay.reusedIds, []);
});

test("tool outputs compact structurally and retain evidence plus full-output hash", () => {
  const compact = compactToolResult({
    evidenceReference: "audit:tool-1",
    maxSummaryBytes: 128,
    output: { matches: Array.from({ length: 100 }, (_, index) => ({ path: `src/${index}.ts` })) },
    tool: "repo.search",
  });
  assert.equal(compact.truncated, true);
  assert.ok(compact.compactBytes <= 128);
  assert.match(compact.outputHash, /^[a-f0-9]{64}$/u);
  assert.equal(compact.evidenceReference, "audit:tool-1");

  const redacted = compactToolResult({
    evidenceReference: "audit:tool-2",
    maxSummaryBytes: 128,
    output: { authorization: "Bearer definitely-secret-value" },
    tool: "http.read",
  });
  assert.equal(redacted.redacted, true);
  assert.equal(redacted.summary.includes("definitely-secret-value"), false);
});

test("early exit requires one independent non-contradictory M5-compatible pass", () => {
  const passing = {
    contradictory: false,
    evidenceHash: HASH_A,
    independent: true,
    outcome: "PASS" as const,
    reviewVerdict: "ACCEPT" as const,
    verificationVerdict: "PASS" as const,
  };
  assert.equal(canExitEarly(passing), true);
  assert.equal(canExitEarly({ ...passing, independent: false }), false);
  assert.equal(canExitEarly({ ...passing, contradictory: true }), false);
  assert.equal(canExitEarly({ ...passing, outcome: "REPAIR_REQUIRED" }), false);
  assert.throws(
    () =>
      canExitEarly({
        ...passing,
        outcome: "UNKNOWN",
      } as unknown as Parameters<typeof canExitEarly>[0]),
    TypeError,
  );
});

test("reasoning depth adapts to risk uncertainty failures evidence and remaining calls", () => {
  assert.equal(
    selectAdaptiveReasoningDepth({
      independentPass: false,
      previousFailures: 0,
      remainingModelCalls: 2,
      risk: "low",
      uncertaintyBps: 500,
    }),
    "DIRECT",
  );
  assert.equal(
    selectAdaptiveReasoningDepth({
      independentPass: false,
      previousFailures: 1,
      remainingModelCalls: 2,
      risk: "medium",
      uncertaintyBps: 500,
    }),
    "DEEP",
  );
  assert.equal(
    selectAdaptiveReasoningDepth({
      independentPass: true,
      previousFailures: 2,
      remainingModelCalls: 2,
      risk: "critical",
      uncertaintyBps: 9_000,
    }),
    "DIRECT",
  );
});

test("held-out paired fixture reports at least 50 percent token reduction with verifier parity", () => {
  const measuredCase = (
    id: string,
    outcome: "BLOCK" | "PASS" | "REPAIR_REQUIRED",
    observation: string,
  ) => {
    const compiler = new EfficientContextCompiler();
    const baseline = compiler.compile(efficientRequest());
    const candidate = compiler.compile({
      ...efficientRequest(context(observation)),
      previousResultHash: baseline.full.resultHash,
    });
    return {
      baselineOutcome: outcome,
      baselineTokens: candidate.effectiveEstimatedTokens,
      candidateOutcome: outcome,
      candidateTokens: candidate.deltaEstimatedTokens,
      id,
    } as const;
  };
  const cases = [
    measuredCase("coding-repair", "PASS", "repair evidence changed"),
    measuredCase("provider-recovery", "REPAIR_REQUIRED", "provider evidence changed"),
    measuredCase("security-block", "BLOCK", "security evidence changed"),
  ];
  const report = evaluateContextEfficiency(cases);
  assert.equal(report.passed, true);
  assert.equal(report.verifierParity, true);
  assert.ok(report.savingsBps >= 5_000);
  assert.deepEqual(report, evaluateContextEfficiency([...cases].reverse()));
  assert.throws(
    () =>
      evaluateContextEfficiency([
        {
          baselineOutcome: "UNKNOWN",
          baselineTokens: 1,
          candidateOutcome: "UNKNOWN",
          candidateTokens: 1,
          id: "bad-1",
        },
        {
          baselineOutcome: "PASS",
          baselineTokens: 1,
          candidateOutcome: "PASS",
          candidateTokens: 1,
          id: "bad-2",
        },
        {
          baselineOutcome: "PASS",
          baselineTokens: 1,
          candidateOutcome: "PASS",
          candidateTokens: 1,
          id: "bad-3",
        },
      ] as Parameters<typeof evaluateContextEfficiency>[0]),
    TypeError,
  );
});
