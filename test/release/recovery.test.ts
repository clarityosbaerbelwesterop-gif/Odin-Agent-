import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createRecoveryProof,
  createRecoveryReleaseEvidence,
  type RecoveryScenarioKind,
  type RecoveryScenarioResult,
  ReleaseProofError,
} from "../../src/release/index.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scenario(
  name: RecoveryScenarioKind,
  status: "PASS" | "FAIL" = "PASS",
): RecoveryScenarioResult {
  return {
    evidenceHash: hash(`fixture:${name}:${status}`),
    iterations: 32,
    maxConcurrency: 8,
    scenario: name,
    status,
  };
}

function scenarios(): RecoveryScenarioResult[] {
  return [
    scenario("sandbox_replay"),
    scenario("output_pressure"),
    scenario("durable_reopen"),
    scenario("cancellation_race"),
    scenario("backup_restore"),
  ];
}

test("recovery proof is deterministic across scenario order and converts to scoped release evidence", () => {
  const common = {
    createdAt: "2026-09-03T19:30:00.000Z",
    level: "local" as const,
    proofId: "recovery-m12c",
    suiteHash: hash("npm-verify-m12c"),
    suiteId: "m12c-recovery-suite",
  };
  const left = createRecoveryProof({ ...common, scenarios: scenarios() });
  const right = createRecoveryProof({ ...common, scenarios: scenarios().reverse() });

  assert.equal(left.proofHash, right.proofHash);
  assert.equal(left.status, "PASS");
  assert.deepEqual(
    left.scenarios.map((item) => item.scenario),
    ["backup_restore", "cancellation_race", "durable_reopen", "output_pressure", "sandbox_replay"],
  );

  const evidence = createRecoveryReleaseEvidence({
    evidenceId: "ev-recovery",
    producer: "github-actions",
    proof: left,
    releaseId: "release-m12c",
  });
  assert.equal(evidence.kind, "load.recovery");
  assert.equal(evidence.level, "local");
  assert.equal(evidence.payloadHash, left.proofHash);
  assert.equal(evidence.status, "PASS");
});

test("failed recovery scenario yields failed release evidence instead of a false pass", () => {
  const failed = createRecoveryProof({
    createdAt: "2026-09-03T19:30:00.000Z",
    level: "local",
    proofId: "recovery-failed",
    scenarios: scenarios().map((item) =>
      item.scenario === "durable_reopen" ? scenario("durable_reopen", "FAIL") : item,
    ),
    suiteHash: hash("npm-verify-m12c"),
    suiteId: "m12c-recovery-suite",
  });

  assert.equal(failed.status, "FAIL");
  assert.equal(
    createRecoveryReleaseEvidence({
      evidenceId: "ev-recovery-fail",
      producer: "github-actions",
      proof: failed,
      releaseId: "release-m12c",
    }).status,
    "FAIL",
  );
});

test("missing, duplicated, malformed, and tampered recovery scenario evidence fails closed", () => {
  assert.throws(
    () =>
      createRecoveryProof({
        createdAt: "2026-09-03T19:30:00.000Z",
        level: "local",
        proofId: "missing",
        scenarios: scenarios().slice(1),
        suiteHash: hash("suite"),
        suiteId: "suite",
      }),
    ReleaseProofError,
  );

  const duplicated = scenarios();
  duplicated[0] = scenario("backup_restore");
  assert.throws(
    () =>
      createRecoveryProof({
        createdAt: "2026-09-03T19:30:00.000Z",
        level: "local",
        proofId: "duplicate",
        scenarios: duplicated,
        suiteHash: hash("suite"),
        suiteId: "suite",
      }),
    ReleaseProofError,
  );

  const proof = createRecoveryProof({
    createdAt: "2026-09-03T19:30:00.000Z",
    level: "local",
    proofId: "tamper",
    scenarios: scenarios(),
    suiteHash: hash("suite"),
    suiteId: "suite",
  });
  assert.throws(
    () =>
      createRecoveryReleaseEvidence({
        evidenceId: "ev-tampered",
        producer: "github-actions",
        proof: { ...proof, proofHash: "f".repeat(64) },
        releaseId: "release-m12c",
      }),
    ReleaseProofError,
  );
});
