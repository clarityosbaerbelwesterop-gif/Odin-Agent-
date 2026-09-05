import { readFile, writeFile } from "node:fs/promises";

const SOURCE = "src/runtime/multi-file.ts";
const TEST = "test/runtime/multi-file.test.ts";

function replaceExact(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing M19 final-hardening anchor: ${label}`);
  return text.replace(from, to);
}

let source = await readFile(SOURCE, "utf8");
source = replaceExact(
  source,
  `export interface RestorationVerification {
  readonly status: "FAIL" | "PASS";
  readonly observedAt: string;
  readonly evidenceHash: string;
}`,
  `export interface RestorationVerification {
  readonly status: "FAIL" | "PASS";
  readonly observedAt: string;
  readonly evidenceHash: string;
  readonly snapshotHash: string;
}`,
  "restoration snapshot binding",
);
source = replaceExact(
  source,
  `    if (recovery.action !== "ROLLBACK") {
      throw new MultiFileCodingError(
        "ROLLBACK_FAILED",
        "Reliability policy did not authorize restoration of reversible multi-file writes.",
      );
    }

    try {`,
  `    const rollbackAuthorized = recovery.action === "ROLLBACK";

    try {`,
  "restore before policy failure",
);
source = replaceExact(
  source,
  `      validateRestoration(restoration);`,
  `      validateRestoration(restoration, input.snapshotHash);`,
  "restoration validation binding",
);
source = replaceExact(
  source,
  `    if (restoration.status !== "PASS") {
      throw new MultiFileCodingError(
        "ROLLBACK_FAILED",
        "Independent restoration verification failed.",
      );
    }
    if (input.originalError instanceof MultiFileCodingError) throw input.originalError;`,
  `    if (restoration.status !== "PASS") {
      throw new MultiFileCodingError(
        "ROLLBACK_FAILED",
        "Independent restoration verification failed.",
      );
    }
    if (!rollbackAuthorized) {
      throw new MultiFileCodingError(
        "ROLLBACK_FAILED",
        "Repository was restored, but reliability policy did not attest the expected rollback action.",
      );
    }
    if (input.originalError instanceof MultiFileCodingError) throw input.originalError;`,
  "post-restore policy attestation",
);
source = replaceExact(
  source,
  `function validateRestoration(value: RestorationVerification): void {
  assertHash(value.evidenceHash, "restoration evidenceHash");
  assertCanonicalTime(value.observedAt, "restoration observedAt");
  if (value.status !== "PASS" && value.status !== "FAIL") {
    throw new MultiFileCodingError("ROLLBACK_FAILED", "Restoration verification status is invalid.");
  }
}`,
  `function validateRestoration(value: RestorationVerification, expectedSnapshotHash: string): void {
  assertHash(value.evidenceHash, "restoration evidenceHash");
  assertHash(value.snapshotHash, "restoration snapshotHash");
  assertCanonicalTime(value.observedAt, "restoration observedAt");
  if (value.snapshotHash !== expectedSnapshotHash) {
    throw new MultiFileCodingError(
      "ROLLBACK_FAILED",
      "Restoration verification is bound to a different runtime preimage snapshot.",
    );
  }
  if (value.status !== "PASS" && value.status !== "FAIL") {
    throw new MultiFileCodingError("ROLLBACK_FAILED", "Restoration verification status is invalid.");
  }
}`,
  "validate restoration snapshot",
);
await writeFile(SOURCE, source, "utf8");

let test = await readFile(TEST, "utf8");
test = replaceExact(
  test,
  `  async verify(input: { readonly preimages: readonly RuntimePreimage[] }) {`,
  `  async verify(input: {
    readonly preimages: readonly RuntimePreimage[];
    readonly snapshotHash: string;
  }) {`,
  "test verifier input",
);
test = replaceExact(
  test,
  `      observedAt: NOW,
      status: restored ? ("PASS" as const) : ("FAIL" as const),`,
  `      observedAt: NOW,
      snapshotHash: input.snapshotHash,
      status: restored ? ("PASS" as const) : ("FAIL" as const),`,
  "test verifier snapshot result",
);

const anchor = `test("M18 context identity cannot be swapped under a staged M19 plan", async () => {`;
const additions = `test("restoration executes even when an injected recovery authority refuses rollback", async () => {
  const data = fixture(10);
  const workspace = new MemoryWorkspace(data.files);
  const original = workspace.snapshot();
  workspace.failCommitAfter = 2;
  const context = efficientContext();
  const runtime = new MultiFileCodingCoordinator({
    clock: () => NOW,
    quality: new ExpectedQuality(workspace, data.expected),
    reliability: {
      decide: (request) => ({
        action: "CHECKPOINT_AND_BLOCK" as const,
        decisionHash: hash(JSON.stringify({ failure: request.failure.signature, action: "CHECKPOINT_AND_BLOCK" })),
        failureSignature: request.failure.signature,
        reasonCode: "fixture_refusal",
      }),
    },
    restoration: new ExactRestorationVerifier(workspace),
    verification: new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 }),
    workspace,
  });
  await assert.rejects(
    runtime.execute({ changeSet: changeSet(data.changes, context.resultHash), context }),
    (error: unknown) => error instanceof MultiFileCodingError && error.code === "ROLLBACK_FAILED",
  );
  assert.deepEqual(workspace.snapshot(), original);
});

test("forged restoration evidence for another preimage snapshot fails closed", async () => {
  const data = fixture(10);
  const workspace = new MemoryWorkspace(data.files);
  const original = workspace.snapshot();
  workspace.failCommitAfter = 2;
  const context = efficientContext();
  const runtime = new MultiFileCodingCoordinator({
    clock: () => NOW,
    quality: new ExpectedQuality(workspace, data.expected),
    restoration: {
      verify: async () => ({
        evidenceHash: hash("forged restoration evidence"),
        observedAt: NOW,
        snapshotHash: "f".repeat(64),
        status: "PASS" as const,
      }),
    },
    verification: new IndependentVerificationEngine({ maxEvidenceAgeMs: 60_000 }),
    workspace,
  });
  await assert.rejects(
    runtime.execute({ changeSet: changeSet(data.changes, context.resultHash), context }),
    (error: unknown) => error instanceof MultiFileCodingError && error.code === "ROLLBACK_FAILED",
  );
  assert.deepEqual(workspace.snapshot(), original);
});

`;
test = replaceExact(test, anchor, `${additions}${anchor}`, "final hardening tests");
await writeFile(TEST, test, "utf8");
