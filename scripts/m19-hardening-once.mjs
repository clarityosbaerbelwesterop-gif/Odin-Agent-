import { readFile, writeFile } from "node:fs/promises";

const SOURCE = "src/runtime/multi-file.ts";
const TEST = "test/runtime/multi-file.test.ts";

function replaceExact(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return text.replace(from, to);
}

let source = await readFile(SOURCE, "utf8");
source = replaceExact(
  source,
  'import { classifyFailure, ReliabilityController, type FailureRecoveryAuthority } from "../reliability/index.js";\nimport type { VerificationAuthority, VerificationGateResult } from "../verification/types.js";',
  'import { classifyFailure, ReliabilityController, type FailureRecoveryAuthority } from "../reliability/index.js";\nimport type { VerificationAuthority, VerificationGateResult, VerificationRequest } from "../verification/types.js";',
  "verification imports",
);

const oldPostCommit = `    const quality = await this.#quality.run({
      changeSetHash: normalized.changeSetHash,
      missionId: normalized.changeSet.missionId,
      signal: input.signal,
      taskId: normalized.changeSet.taskId,
    });
    validateQualityEvidence(quality);
    const evaluatedAt = this.#clock();
    assertCanonicalTime(evaluatedAt, "evaluatedAt");
    const gate = this.#verification.verify(
      verificationRequest(normalized.changeSet, normalized.changeSetHash, commit.committedAt, quality, evaluatedAt),
    );`;
const newPostCommit = `    let quality: MultiFileQualityEvidence;
    let gate: VerificationGateResult;
    try {
      quality = await this.#quality.run({
        changeSetHash: normalized.changeSetHash,
        missionId: normalized.changeSet.missionId,
        signal: input.signal,
        taskId: normalized.changeSet.taskId,
      });
      validateQualityEvidence(quality);
      const evaluatedAt = this.#clock();
      assertCanonicalTime(evaluatedAt, "evaluatedAt");
      gate = this.#verification.verify(
        verificationRequest(
          normalized.changeSet,
          normalized.changeSetHash,
          commit.committedAt,
          quality,
          evaluatedAt,
        ),
      );
    } catch {
      return this.#rollbackAfterFailure({
        changeSet: normalized.changeSet,
        changeSetHash: normalized.changeSetHash,
        context: input.context,
        orderedChangeIds: normalized.ordered.map((change) => change.id),
        preimages,
        snapshotHash,
        reasonCode: "post_commit_verification_error",
        source: "verification",
        verificationResultHash: null,
      });
    }`;
source = replaceExact(source, oldPostCommit, newPostCommit, "post-commit verification rollback");

source = source.replaceAll("        signal: input.signal,\n", "");
source = source.replace(
  "    readonly signal?: AbortSignal;\n    readonly originalError?: unknown;",
  "    readonly originalError?: unknown;",
);

const oldRestore = `    await this.#workspace.restore(input.preimages, input.signal);
    const restoration = await this.#restoration.verify({
      missionId: input.changeSet.missionId,
      preimages: input.preimages,
      snapshotHash: input.snapshotHash,
      taskId: input.changeSet.taskId,
    });
    validateRestoration(restoration);`;
const newRestore = `    try {
      // Rollback is a safety action and must not inherit an already-aborted task signal.
      await this.#workspace.restore(input.preimages);
    } catch {
      throw new MultiFileCodingError("ROLLBACK_FAILED", "Runtime preimage restoration failed.");
    }
    let restoration: RestorationVerification;
    try {
      restoration = await this.#restoration.verify({
        missionId: input.changeSet.missionId,
        preimages: input.preimages,
        snapshotHash: input.snapshotHash,
        taskId: input.changeSet.taskId,
      });
      validateRestoration(restoration);
    } catch {
      throw new MultiFileCodingError(
        "ROLLBACK_FAILED",
        "Independent restoration verification could not complete.",
      );
    }`;
source = replaceExact(source, oldRestore, newRestore, "non-cancellable rollback");
source = replaceExact(
  source,
  "    normalized.push(Object.freeze({ ...change, dependsOn: [...change.dependsOn] }));",
  "    normalized.push(Object.freeze({ ...change, dependsOn: [...change.dependsOn].sort() }));",
  "dependency normalization",
);
source = replaceExact(
  source,
  "    changes: normalized,\n    contextResultHash: value.contextResultHash,",
  "    changes: [...normalized].sort(compareChange),\n    contextResultHash: value.contextResultHash,",
  "deterministic change-set identity",
);
source = replaceExact(
  source,
  "  evaluatedAt: string,\n) {",
  "  evaluatedAt: string,\n): VerificationRequest {",
  "verification request type",
);
await writeFile(SOURCE, source, "utf8");

let test = await readFile(TEST, "utf8");
test = replaceExact(
  test,
  `function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}`,
  `function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function required<T>(value: T | undefined, label: string): T {
  assert.ok(value !== undefined, label);
  return value;
}`,
  "required helper",
);
test = test.replaceAll('data.changes[0]!', 'required(data.changes[0], "fixture change 0")');
test = test.replaceAll('data.changes[1]!', 'required(data.changes[1], "fixture change 1")');
test = test.replace(
  'data.files[required(data.changes[0], "fixture change 0").path]!',
  'required(data.files[required(data.changes[0], "fixture change 0").path], "fixture file 0")',
);
test = replaceExact(
  test,
  `  async restore(preimages: readonly RuntimePreimage[]) {
    const restored: string[] = [];`,
  `  async restore(preimages: readonly RuntimePreimage[], signal?: AbortSignal) {
    if (signal?.aborted === true) throw new Error("rollback inherited aborted task signal");
    const restored: string[] = [];`,
  "restore signal guard",
);
test = replaceExact(
  test,
  `  failCommitAfter: number | null = null;
  canonicalOverride: ((path: string) => string) | null = null;`,
  `  failCommitAfter: number | null = null;
  abortOnCommitFailure: AbortController | null = null;
  canonicalOverride: ((path: string) => string) | null = null;`,
  "abort controller fixture",
);
test = replaceExact(
  test,
  `      if (this.failCommitAfter !== null && applied.length === this.failCommitAfter) {
        throw new Error("fixture partial apply");
      }`,
  `      if (this.failCommitAfter !== null && applied.length === this.failCommitAfter) {
        this.abortOnCommitFailure?.abort();
        throw new Error("fixture partial apply");
      }`,
  "abort during partial commit",
);

const appendBefore = `test("M18 context identity cannot be swapped under a staged M19 plan", async () => {`;
const extraTests = `test("rollback ignores an aborted task signal after a partial mutation", async () => {
  const data = fixture(10);
  const workspace = new MemoryWorkspace(data.files);
  const original = workspace.snapshot();
  const controller = new AbortController();
  workspace.failCommitAfter = 2;
  workspace.abortOnCommitFailure = controller;
  const context = efficientContext();
  const result = await coordinator(workspace, data.expected).execute({
    changeSet: changeSet(data.changes, context.resultHash),
    context,
    signal: controller.signal,
  });
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.status, "ROLLED_BACK");
  assert.deepEqual(workspace.snapshot(), original);
});

test("thrown quality and verification failures after commit restore exact preimages", async () => {
  const data = fixture(10);
  const context = efficientContext();

  for (const mode of ["quality", "verification"] as const) {
    const workspace = new MemoryWorkspace(data.files);
    const original = workspace.snapshot();
    const quality: MultiFileQualityRunner =
      mode === "quality"
        ? { run: async () => { throw new Error("private quality failure detail"); } }
        : new ExpectedQuality(workspace, data.expected);
    const verification: VerificationAuthority =
      mode === "verification"
        ? { verify: () => { throw new Error("private verifier failure detail"); } }
        : new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 });
    const runtime = new MultiFileCodingCoordinator({
      clock: () => NOW,
      quality,
      restoration: new ExactRestorationVerifier(workspace),
      verification,
      workspace,
    });
    const result = await runtime.execute({
      changeSet: changeSet(data.changes, context.resultHash),
      context,
    });
    assert.equal(result.status, "ROLLED_BACK");
    assert.deepEqual(workspace.snapshot(), original);
  }
});

test("equivalent input ordering produces one deterministic change-set identity", async () => {
  const data = fixture(10);
  const context = efficientContext();
  const firstWorkspace = new MemoryWorkspace(data.files);
  const secondWorkspace = new MemoryWorkspace(data.files);
  const first = await coordinator(firstWorkspace, data.expected).execute({
    changeSet: changeSet(data.changes, context.resultHash),
    context,
  });
  const second = await coordinator(secondWorkspace, data.expected).execute({
    changeSet: changeSet([...data.changes].reverse(), context.resultHash),
    context,
  });
  assert.equal(first.changeSetHash, second.changeSetHash);
  assert.deepEqual(first.orderedChangeIds, second.orderedChangeIds);
});

`;
test = replaceExact(test, appendBefore, `${extraTests}${appendBefore}`, "hardening regressions");
await writeFile(TEST, test, "utf8");
