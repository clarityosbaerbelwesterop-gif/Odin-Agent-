import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type ContextCandidate,
  type ContextCompileRequest,
  EfficientContextCompiler,
} from "../../src/context/index.js";
import {
  MultiFileCodingCoordinator,
  MultiFileCodingError,
  type MultiFileChange,
  type MultiFileQualityRunner,
  type MultiFileRestorationVerifier,
  type MultiFileWorkspace,
  type RuntimePreimage,
  type StagedFileChange,
  reconcileMultiFileProposals,
} from "../../src/runtime/multi-file.js";
import { IndependentVerificationEngine } from "../../src/verification/engine.js";
import type { VerificationAuthority, VerificationGateResult, VerificationRequest } from "../../src/verification/types.js";

const NOW = "2026-09-05T06:00:00.000Z";
const BEFORE = "2026-09-05T05:59:59.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidate(id: string, priority: "P0" | "P1" | "P2" | "P4", content: string): ContextCandidate {
  const sourceByPriority = {
    P0: "system",
    P1: "mission",
    P2: "task",
    P4: "observation",
  } as const;
  return {
    content,
    id,
    priority,
    relevance: 100,
    semanticKey: id,
    sensitivity: "internal",
    source: {
      class: sourceByPriority[priority],
      contentHash: hash(content),
      observedAt: NOW,
      reference: `fixture:${id}`,
      version: "1",
    },
  };
}

function contextRequest(observation: string): ContextCompileRequest {
  const stable = "trusted stable context ".repeat(80);
  return {
    budget: {
      maxItemTokens: 2_000,
      perPriority: { P0: 2_000, P1: 2_000, P2: 2_000, P3: 2_000, P4: 2_000, P5: 2_000, P6: 2_000 },
      totalTokens: 8_000,
    },
    candidates: [
      candidate("system", "P0", stable),
      candidate("mission", "P1", stable),
      candidate("task", "P2", stable),
      candidate("observation", "P4", observation),
    ],
    missionId: "mission-m19",
    policyVersion: "m19-context-policy",
    taskId: "task-m19",
  };
}

function efficientContext() {
  const compiler = new EfficientContextCompiler();
  const first = compiler.compile({
    context: contextRequest("initial evidence"),
    modelProfileHash: HASH_A,
    stablePrefixHash: HASH_B,
    verificationRequirementHash: HASH_C,
  });
  return compiler.compile({
    context: contextRequest("changed evidence"),
    modelProfileHash: HASH_A,
    previousResultHash: first.full.resultHash,
    stablePrefixHash: HASH_B,
    verificationRequirementHash: HASH_C,
  });
}

class MemoryWorkspace implements MultiFileWorkspace {
  readonly files: Map<string, string>;
  readonly commits: string[][] = [];
  readonly restores: string[][] = [];
  failCommitAfter: number | null = null;
  canonicalOverride: ((path: string) => string) | null = null;

  constructor(files: Readonly<Record<string, string>>) {
    this.files = new Map(Object.entries(files));
  }

  canonicalize(path: string): string {
    return this.canonicalOverride?.(path) ?? path;
  }

  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  validateStaged(changes: readonly StagedFileChange[]): void {
    assert.ok(changes.length > 0);
  }

  async commit(changes: readonly StagedFileChange[], signal?: AbortSignal) {
    const applied: string[] = [];
    for (const change of changes) {
      if (signal?.aborted === true) throw new Error("commit aborted");
      if (change.operation === "DELETE") this.files.delete(change.path);
      else this.files.set(change.path, change.content ?? "");
      applied.push(change.path);
      if (this.failCommitAfter !== null && applied.length === this.failCommitAfter) {
        throw new Error("fixture partial apply");
      }
    }
    this.commits.push(applied);
    return { committedAt: NOW, commitHash: hash(JSON.stringify(applied)) };
  }

  async restore(preimages: readonly RuntimePreimage[]) {
    const restored: string[] = [];
    for (const preimage of preimages) {
      if (preimage.content === null) this.files.delete(preimage.path);
      else this.files.set(preimage.path, preimage.content);
      restored.push(preimage.path);
    }
    this.restores.push(restored);
    return { restoredAt: NOW, restorationHash: hash(JSON.stringify(restored)) };
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.files.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
}

class ExpectedQuality implements MultiFileQualityRunner {
  readonly #workspace: MemoryWorkspace;
  readonly #expected: Readonly<Record<string, string>>;
  readonly #forceFail: boolean;
  readonly #observedAt: string;

  constructor(workspace: MemoryWorkspace, expected: Readonly<Record<string, string>>, options: { forceFail?: boolean; observedAt?: string } = {}) {
    this.#workspace = workspace;
    this.#expected = expected;
    this.#forceFail = options.forceFail ?? false;
    this.#observedAt = options.observedAt ?? NOW;
  }

  async run() {
    const actual = JSON.stringify(this.#workspace.snapshot());
    const expected = JSON.stringify(Object.fromEntries(Object.entries(this.#expected).sort(([left], [right]) => left.localeCompare(right))));
    return {
      contentHash: hash(actual),
      id: "m19-quality-fixture",
      observedAt: this.#observedAt,
      status: !this.#forceFail && actual === expected ? ("PASS" as const) : ("FAIL" as const),
    };
  }
}

class ExactRestorationVerifier implements MultiFileRestorationVerifier {
  readonly #workspace: MemoryWorkspace;

  constructor(workspace: MemoryWorkspace) {
    this.#workspace = workspace;
  }

  async verify(input: { readonly preimages: readonly RuntimePreimage[] }) {
    const restored = input.preimages.every((entry) => this.#workspace.read(entry.path) === entry.content);
    return {
      evidenceHash: hash(JSON.stringify(input.preimages)),
      observedAt: NOW,
      status: restored ? ("PASS" as const) : ("FAIL" as const),
    };
  }
}

class BlockingVerification implements VerificationAuthority {
  readonly #inner = new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 });

  verify(request: VerificationRequest): VerificationGateResult {
    const result = this.#inner.verify({
      ...request,
      evidence: request.evidence.map((evidence) => ({ ...evidence, observedAt: BEFORE })),
    });
    assert.notEqual(result.outcome, "PASS");
    return result;
  }
}

function fixture(count: number) {
  const files: Record<string, string> = {};
  const expected: Record<string, string> = {};
  const changes: MultiFileChange[] = [];
  for (let index = 0; index < count; index += 1) {
    const path = `src/file-${String(index).padStart(3, "0")}.ts`;
    const before = `export const value${index} = 0;\n`;
    const after = `export const value${index} = 1;\n`;
    files[path] = before;
    expected[path] = after;
    changes.push({
      content: after,
      dependsOn: index === 0 ? [] : [`change-${index - 1}`],
      id: `change-${index}`,
      operation: "REPLACE",
      owner: `specialist-${index}`,
      path,
      postimageHash: hash(after),
      preimageHash: hash(before),
      verificationMethod: "quality_gate",
    });
  }
  return { changes, expected, files };
}

function coordinator(workspace: MemoryWorkspace, expected: Readonly<Record<string, string>>, options: { forceQualityFail?: boolean; verification?: VerificationAuthority } = {}) {
  return new MultiFileCodingCoordinator({
    clock: () => NOW,
    quality: new ExpectedQuality(workspace, expected, { forceFail: options.forceQualityFail }),
    restoration: new ExactRestorationVerifier(workspace),
    verification: options.verification ?? new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 }),
    workspace,
  });
}

function changeSet(changes: readonly MultiFileChange[], contextResultHash: string) {
  return {
    changes,
    contextResultHash,
    missionId: "mission-m19",
    taskId: "task-m19",
  } as const;
}

test("M19 completes a verified dependency-aware ten-file refactor with M18 context binding", async () => {
  const data = fixture(10);
  const workspace = new MemoryWorkspace(data.files);
  const context = efficientContext();
  const result = await coordinator(workspace, data.expected).execute({
    changeSet: changeSet(data.changes, context.resultHash),
    context,
  });

  assert.equal(result.status, "COMPLETED");
  assert.ok(result.contextSavingsBps > 0);
  assert.equal(result.orderedChangeIds.length, 10);
  assert.deepEqual(workspace.snapshot(), data.expected);
  assert.equal(workspace.restores.length, 0);
  assert.match(result.verificationResultHash ?? "", /^[a-f0-9]{64}$/u);
});

test("M19 accepts the 100-file boundary and rejects 101 files before mutation", async () => {
  const boundary = fixture(100);
  const workspace = new MemoryWorkspace(boundary.files);
  const context = efficientContext();
  const result = await coordinator(workspace, boundary.expected).execute({
    changeSet: changeSet(boundary.changes, context.resultHash),
    context,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.orderedChangeIds.length, 100);

  const tooMany = fixture(101);
  const rejectedWorkspace = new MemoryWorkspace(tooMany.files);
  await assert.rejects(
    coordinator(rejectedWorkspace, tooMany.expected).execute({
      changeSet: changeSet(tooMany.changes, context.resultHash),
      context,
    }),
    (error: unknown) => error instanceof MultiFileCodingError && error.code === "INVALID_CHANGE_SET",
  );
  assert.equal(rejectedWorkspace.commits.length, 0);
});

test("cycles overlapping targets forbidden paths and noncanonical paths fail before mutation", async () => {
  const data = fixture(2);
  const context = efficientContext();

  const cyclic = data.changes.map((change, index) => ({
    ...change,
    dependsOn: [index === 0 ? data.changes[1]?.id ?? "change-1" : data.changes[0]?.id ?? "change-0"],
  }));
  const cycleWorkspace = new MemoryWorkspace(data.files);
  await assert.rejects(
    coordinator(cycleWorkspace, data.expected).execute({ changeSet: changeSet(cyclic, context.resultHash), context }),
    MultiFileCodingError,
  );
  assert.equal(cycleWorkspace.commits.length, 0);

  const forbidden = [{ ...data.changes[0]!, path: ".github/workflows/evil.yml" }];
  const forbiddenWorkspace = new MemoryWorkspace({ ".github/workflows/evil.yml": data.files[data.changes[0]!.path]! });
  await assert.rejects(
    coordinator(forbiddenWorkspace, {}).execute({ changeSet: changeSet(forbidden, context.resultHash), context }),
    (error: unknown) => error instanceof MultiFileCodingError && error.code === "UNSAFE_PATH",
  );

  const canonicalWorkspace = new MemoryWorkspace(data.files);
  canonicalWorkspace.canonicalOverride = (path) => (path === data.changes[0]!.path ? "../outside.ts" : path);
  await assert.rejects(
    coordinator(canonicalWorkspace, data.expected).execute({
      changeSet: changeSet([data.changes[0]!], context.resultHash),
      context,
    }),
    (error: unknown) => error instanceof MultiFileCodingError && error.code === "UNSAFE_PATH",
  );

  assert.throws(
    () =>
      reconcileMultiFileProposals([
        { specialistId: "a", changes: [{ ...data.changes[0]!, owner: "a", path: "src/group" }] },
        { specialistId: "b", changes: [{ ...data.changes[1]!, owner: "b", path: "src/group/child.ts" }] },
      ]),
    MultiFileCodingError,
  );
});

test("stale preimages and tampered postimages fail closed before commit", async () => {
  const data = fixture(2);
  const workspace = new MemoryWorkspace(data.files);
  const context = efficientContext();
  await assert.rejects(
    coordinator(workspace, data.expected).execute({
      changeSet: changeSet([{ ...data.changes[0]!, preimageHash: "f".repeat(64) }], context.resultHash),
      context,
    }),
    (error: unknown) => error instanceof MultiFileCodingError && error.code === "STALE_PREIMAGE",
  );
  assert.equal(workspace.commits.length, 0);

  const tampered = { ...data.changes[0]!, postimageHash: "e".repeat(64) };
  await assert.rejects(
    coordinator(workspace, data.expected).execute({ changeSet: changeSet([tampered], context.resultHash), context }),
    MultiFileCodingError,
  );
  assert.equal(workspace.commits.length, 0);
});

test("partial application is restored to exact runtime preimages and independently verified", async () => {
  const data = fixture(10);
  const workspace = new MemoryWorkspace(data.files);
  const original = workspace.snapshot();
  workspace.failCommitAfter = 3;
  const context = efficientContext();
  const result = await coordinator(workspace, data.expected).execute({
    changeSet: changeSet(data.changes, context.resultHash),
    context,
  });

  assert.equal(result.status, "ROLLED_BACK");
  assert.deepEqual(workspace.snapshot(), original);
  assert.equal(workspace.restores.length, 1);
  assert.match(result.rollbackVerificationHash ?? "", /^[a-f0-9]{64}$/u);
});

test("quality or M5 verification failure rolls the complete tree back instead of accepting partial success", async () => {
  const data = fixture(10);
  const context = efficientContext();

  const qualityWorkspace = new MemoryWorkspace(data.files);
  const qualityOriginal = qualityWorkspace.snapshot();
  const qualityResult = await coordinator(qualityWorkspace, data.expected, { forceQualityFail: true }).execute({
    changeSet: changeSet(data.changes, context.resultHash),
    context,
  });
  assert.equal(qualityResult.status, "ROLLED_BACK");
  assert.deepEqual(qualityWorkspace.snapshot(), qualityOriginal);

  const verificationWorkspace = new MemoryWorkspace(data.files);
  const verificationOriginal = verificationWorkspace.snapshot();
  const verificationResult = await coordinator(verificationWorkspace, data.expected, {
    verification: new BlockingVerification(),
  }).execute({
    changeSet: changeSet(data.changes, context.resultHash),
    context,
  });
  assert.equal(verificationResult.status, "ROLLED_BACK");
  assert.deepEqual(verificationWorkspace.snapshot(), verificationOriginal);
});

test("pre-commit cancellation leaves the repository untouched", async () => {
  const data = fixture(10);
  const workspace = new MemoryWorkspace(data.files);
  const original = workspace.snapshot();
  const context = efficientContext();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    coordinator(workspace, data.expected).execute({
      changeSet: changeSet(data.changes, context.resultHash),
      context,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof MultiFileCodingError && error.code === "CANCELLED",
  );
  assert.deepEqual(workspace.snapshot(), original);
  assert.equal(workspace.commits.length, 0);
});

test("specialist reconciliation is deterministic and blocks conflicting ownership", () => {
  const data = fixture(3);
  const proposals = data.changes.map((change, index) => ({
    changes: [{ ...change, owner: `specialist-${index}` }],
    specialistId: `specialist-${index}`,
  }));
  const forward = reconcileMultiFileProposals(proposals);
  const reverse = reconcileMultiFileProposals([...proposals].reverse());
  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 3);

  assert.throws(
    () =>
      reconcileMultiFileProposals([
        { specialistId: "specialist-a", changes: [{ ...data.changes[0]!, owner: "specialist-b" }] },
      ]),
    MultiFileCodingError,
  );
});

test("M18 context identity cannot be swapped under a staged M19 plan", async () => {
  const data = fixture(1);
  const workspace = new MemoryWorkspace(data.files);
  const context = efficientContext();
  await assert.rejects(
    coordinator(workspace, data.expected).execute({
      changeSet: changeSet(data.changes, "d".repeat(64)),
      context,
    }),
    MultiFileCodingError,
  );
  assert.equal(workspace.commits.length, 0);
});
