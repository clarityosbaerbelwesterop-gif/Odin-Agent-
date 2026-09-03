import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createBackupManifest,
  createRecoveryProof,
  createRecoveryReleaseEvidence,
  createReleaseEvidence,
  createReleaseGatePolicy,
  createReleaseManifest,
  createRestoreVerification,
  evaluateReleaseGate,
  type RecoveryScenarioKind,
  verifyBackupRestore,
} from "../../src/release/index.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const CREATED_AT = "2026-09-03T19:30:00.000Z";
const GENERATED_AT = "2026-09-03T19:30:20.000Z";
const NOW = "2026-09-03T19:30:30.000Z";
const RELEASE_ID = "release-m12c-local";

function scenario(name: RecoveryScenarioKind) {
  return {
    evidenceHash: hash(`scenario:${name}`),
    iterations: 32,
    maxConcurrency: 8,
    scenario: name,
    status: "PASS" as const,
  };
}

function gatePolicy() {
  return createReleaseGatePolicy({
    maxEvidenceAgeMs: 60_000,
    policyId: "policy.m12c.release.v1",
    requirements: {
      local: [
        { kind: "backup.restore", minLevel: "local" },
        { kind: "load.recovery", minLevel: "local" },
        { kind: "repo.verify", minLevel: "local" },
      ],
      integration: [
        { kind: "backup.restore", minLevel: "local" },
        { kind: "load.recovery", minLevel: "local" },
        { kind: "repo.verify", minLevel: "local" },
        { kind: "sandbox.integration", minLevel: "integration" },
      ],
      live: [
        { kind: "backup.restore", minLevel: "local" },
        { kind: "load.recovery", minLevel: "local" },
        { kind: "repo.verify", minLevel: "local" },
        { kind: "sandbox.integration", minLevel: "integration" },
        { kind: "provider.live", minLevel: "live" },
      ],
    },
  });
}

test("local verify recovery and restore evidence passes local gate but cannot unlock integration or live", () => {
  const repoVerify = createReleaseEvidence({
    createdAt: CREATED_AT,
    evidenceId: "ev-repo-verify",
    kind: "repo.verify",
    level: "local",
    payloadHash: hash("npm-run-verify"),
    producer: "github-actions",
    releaseId: RELEASE_ID,
    status: "PASS",
  });

  const recovery = createRecoveryProof({
    createdAt: CREATED_AT,
    level: "local",
    proofId: "recovery-proof-local",
    scenarios: [
      scenario("backup_restore"),
      scenario("cancellation_race"),
      scenario("durable_reopen"),
      scenario("output_pressure"),
      scenario("sandbox_replay"),
    ],
    suiteHash: hash("m12c-recovery-suite"),
    suiteId: "m12c-recovery-suite",
  });
  const recoveryEvidence = createRecoveryReleaseEvidence({
    evidenceId: "ev-recovery",
    producer: "github-actions",
    proof: recovery,
    releaseId: RELEASE_ID,
  });

  const backup = createBackupManifest({
    artifactHash: hash("backup-artifact"),
    artifactRef: "artifact://local/m12c-backup.sqlite",
    backupId: "backup-local-release",
    createdAt: CREATED_AT,
    level: "local",
    schemaVersion: 1,
    sourceAdapter: "sqlite-local",
    sourceStateHash: hash("canonical-state"),
  });
  const restore = createRestoreVerification({
    backupId: backup.backupId,
    level: "local",
    producer: "recovery-fixture",
    restoredStateHash: backup.sourceStateHash,
    verifiedAt: "2026-09-03T19:30:10.000Z",
  });
  const restoreDecision = verifyBackupRestore(backup, restore);
  assert.equal(restoreDecision.status, "PASS");
  const restoreEvidence = createReleaseEvidence({
    createdAt: "2026-09-03T19:30:10.000Z",
    evidenceId: "ev-backup-restore",
    kind: "backup.restore",
    level: "local",
    payloadHash: restore.verificationHash,
    producer: "recovery-fixture",
    releaseId: RELEASE_ID,
    status: restoreDecision.status,
  });

  const evidence = [repoVerify, recoveryEvidence, restoreEvidence];
  const evidenceIds = evidence.map((item) => item.evidenceId);
  const policy = gatePolicy();
  const common = {
    commitSha: "1".repeat(40),
    configProfileHash: hash("local-ci-profile"),
    configProfileId: "local-ci",
    evidenceIds,
    generatedAt: GENERATED_AT,
    policy,
    releaseId: RELEASE_ID,
    suiteHash: hash("npm-verify-suite"),
    suiteId: "npm-verify",
  };

  const localDecision = evaluateReleaseGate(
    createReleaseManifest({ ...common, claimLevel: "local" }),
    evidence,
    policy,
    NOW,
  );
  assert.equal(localDecision.status, "PASS");

  const integrationDecision = evaluateReleaseGate(
    createReleaseManifest({ ...common, claimLevel: "integration" }),
    evidence,
    policy,
    NOW,
  );
  assert.equal(integrationDecision.status, "BLOCK");
  if (integrationDecision.status === "BLOCK") {
    assert.equal(integrationDecision.code, "LEVEL_INSUFFICIENT");
  }

  const liveDecision = evaluateReleaseGate(
    createReleaseManifest({ ...common, claimLevel: "live" }),
    evidence,
    policy,
    NOW,
  );
  assert.equal(liveDecision.status, "BLOCK");
  if (liveDecision.status === "BLOCK") assert.equal(liveDecision.code, "LEVEL_INSUFFICIENT");
});
