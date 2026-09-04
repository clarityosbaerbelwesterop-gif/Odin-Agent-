import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackupManifest,
  createRestoreVerification,
  verifyBackupRestore,
} from "../../src/release/index.js";

const STATE_HASH = "a".repeat(64);
const ARTIFACT_HASH = "b".repeat(64);

function backup() {
  return createBackupManifest({
    artifactHash: ARTIFACT_HASH,
    artifactRef: "artifact://local-backup/m12c.sqlite",
    backupId: "backup-m12c",
    createdAt: "2026-09-03T19:20:00.000Z",
    level: "local",
    schemaVersion: 1,
    sourceAdapter: "sqlite-local",
    sourceStateHash: STATE_HASH,
  });
}

test("local backup restore proof passes only when restored state matches source state", () => {
  const manifest = backup();
  const verification = createRestoreVerification({
    backupId: manifest.backupId,
    level: "local",
    producer: "recovery-fixture",
    restoredStateHash: STATE_HASH,
    verifiedAt: "2026-09-03T19:21:00.000Z",
  });

  const decision = verifyBackupRestore(manifest, verification);
  assert.equal(decision.status, "PASS");
  if (decision.status === "PASS") {
    assert.equal(decision.manifestHash, manifest.manifestHash);
    assert.equal(decision.verificationHash, verification.verificationHash);
  }
});

test("tampered backup manifests and mismatched restored state block", () => {
  const manifest = backup();
  const verification = createRestoreVerification({
    backupId: manifest.backupId,
    level: "local",
    producer: "recovery-fixture",
    restoredStateHash: STATE_HASH,
    verifiedAt: "2026-09-03T19:21:00.000Z",
  });

  assert.equal(
    verifyBackupRestore({ ...manifest, artifactHash: "c".repeat(64) }, verification).status,
    "BLOCK",
  );
  assert.equal(
    verifyBackupRestore(
      manifest,
      createRestoreVerification({
        backupId: manifest.backupId,
        level: "local",
        producer: "recovery-fixture",
        restoredStateHash: "d".repeat(64),
        verifiedAt: "2026-09-03T19:21:00.000Z",
      }),
    ).status,
    "BLOCK",
  );
});

test("restore evidence cannot be weaker than the backup evidence level or belong to another backup", () => {
  const integrationManifest = createBackupManifest({
    artifactHash: ARTIFACT_HASH,
    artifactRef: "artifact://integration-backup/m12c.sqlite",
    backupId: "backup-integration",
    createdAt: "2026-09-03T19:20:00.000Z",
    level: "integration",
    schemaVersion: 1,
    sourceAdapter: "sqlite-integration",
    sourceStateHash: STATE_HASH,
  });
  const weak = createRestoreVerification({
    backupId: integrationManifest.backupId,
    level: "local",
    producer: "recovery-fixture",
    restoredStateHash: STATE_HASH,
    verifiedAt: "2026-09-03T19:21:00.000Z",
  });
  assert.equal(verifyBackupRestore(integrationManifest, weak).status, "BLOCK");

  const foreign = createRestoreVerification({
    backupId: "other-backup",
    level: "integration",
    producer: "recovery-fixture",
    restoredStateHash: STATE_HASH,
    verifiedAt: "2026-09-03T19:21:00.000Z",
  });
  assert.equal(verifyBackupRestore(integrationManifest, foreign).status, "BLOCK");
});

test("backup artifact references reject secret-like query material", () => {
  assert.throws(() =>
    createBackupManifest({
      artifactHash: ARTIFACT_HASH,
      artifactRef: "artifact://backup?token=do-not-store",
      backupId: "backup-secret-ref",
      createdAt: "2026-09-03T19:20:00.000Z",
      level: "local",
      schemaVersion: 1,
      sourceAdapter: "sqlite-local",
      sourceStateHash: STATE_HASH,
    }),
  );
});
