import assert from "node:assert/strict";
import test from "node:test";
import {
  createReleaseEvidence,
  createReleaseGatePolicy,
  createReleaseManifest,
  type EvidenceLevel,
  evaluateReleaseGate,
  type ReleaseEvidenceInput,
  ReleaseProofError,
} from "../../src/release/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "1".repeat(40);

function policy(maxEvidenceAgeMs = 60_000) {
  return createReleaseGatePolicy({
    maxEvidenceAgeMs,
    policyId: "policy.m12c.v1",
    requirements: {
      local: [{ kind: "repo.verify", minLevel: "local" }],
      integration: [
        { kind: "repo.verify", minLevel: "local" },
        { kind: "sandbox.integration", minLevel: "integration" },
      ],
      live: [
        { kind: "repo.verify", minLevel: "local" },
        { kind: "sandbox.integration", minLevel: "integration" },
        { kind: "provider.live", minLevel: "live" },
      ],
    },
  });
}

function evidence(
  evidenceId: string,
  kind: string,
  level: EvidenceLevel,
  overrides: Partial<ReleaseEvidenceInput> = {},
) {
  return createReleaseEvidence({
    createdAt: "2026-09-03T19:20:00.000Z",
    evidenceId,
    kind,
    level,
    payloadHash: HASH_A,
    producer: "github-actions",
    releaseId: "release-m12c",
    status: "PASS",
    ...overrides,
  });
}

function manifest(claimLevel: EvidenceLevel, evidenceIds: readonly string[]) {
  return createReleaseManifest({
    claimLevel,
    commitSha: COMMIT,
    configProfileHash: HASH_A,
    configProfileId: "local-ci",
    evidenceIds,
    generatedAt: "2026-09-03T19:20:20.000Z",
    policy: policy(),
    releaseId: "release-m12c",
    suiteHash: HASH_B,
    suiteId: "npm-verify",
  });
}

test("local release claim passes only with hash-valid scoped fresh local evidence", () => {
  const local = evidence("ev-local", "repo.verify", "local");
  const release = manifest("local", [local.evidenceId]);
  const decision = evaluateReleaseGate(release, [local], policy(), "2026-09-03T19:20:30.000Z");

  assert.equal(decision.status, "PASS");
  if (decision.status === "PASS") {
    assert.equal(decision.claimLevel, "local");
    assert.deepEqual(decision.evidenceHashes, [local.evidenceHash]);
    assert.equal(decision.manifestHash, release.manifestHash);
  }
});

test("integration claim blocks when only local evidence exists", () => {
  const local = evidence("ev-local", "repo.verify", "local");
  const decision = evaluateReleaseGate(
    manifest("integration", [local.evidenceId]),
    [local],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );

  assert.deepEqual(decision.status, "BLOCK");
  if (decision.status === "BLOCK") assert.equal(decision.code, "LEVEL_INSUFFICIENT");
});

test("integration and live claims require evidence actually produced at their requested level", () => {
  const local = evidence("ev-local", "repo.verify", "local");
  const integration = evidence("ev-int", "sandbox.integration", "integration");
  const providerLive = evidence("ev-live", "provider.live", "live");

  const integrationDecision = evaluateReleaseGate(
    manifest("integration", [local.evidenceId, integration.evidenceId]),
    [local, integration],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(integrationDecision.status, "PASS");

  const liveDecision = evaluateReleaseGate(
    manifest("live", [local.evidenceId, integration.evidenceId, providerLive.evidenceId]),
    [local, integration, providerLive],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(liveDecision.status, "PASS");
});

test("tampered, failed, foreign, stale, and unreferenced evidence fail closed", () => {
  const local = evidence("ev-local", "repo.verify", "local");
  const release = manifest("local", [local.evidenceId]);

  const tampered = evaluateReleaseGate(
    release,
    [{ ...local, payloadHash: HASH_B }],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(tampered.status, "BLOCK");
  if (tampered.status === "BLOCK") assert.equal(tampered.code, "HASH_MISMATCH");

  const failed = evidence("ev-fail", "repo.verify", "local", { status: "FAIL" });
  const failedDecision = evaluateReleaseGate(
    manifest("local", [failed.evidenceId]),
    [failed],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(failedDecision.status, "BLOCK");
  if (failedDecision.status === "BLOCK") assert.equal(failedDecision.code, "FAILED_EVIDENCE");

  const foreign = evidence("ev-foreign", "repo.verify", "local", { releaseId: "other-release" });
  const foreignDecision = evaluateReleaseGate(
    manifest("local", [foreign.evidenceId]),
    [foreign],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(foreignDecision.status, "BLOCK");
  if (foreignDecision.status === "BLOCK") assert.equal(foreignDecision.code, "FOREIGN_EVIDENCE");

  const stale = evidence("ev-stale", "repo.verify", "local", {
    createdAt: "2026-09-03T19:18:00.000Z",
  });
  const staleDecision = evaluateReleaseGate(
    manifest("local", [stale.evidenceId]),
    [stale],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(staleDecision.status, "BLOCK");
  if (staleDecision.status === "BLOCK") assert.equal(staleDecision.code, "STALE_EVIDENCE");

  const extra = evidence("ev-extra", "repo.verify", "local");
  const extraDecision = evaluateReleaseGate(
    release,
    [local, extra],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(extraDecision.status, "BLOCK");
  if (extraDecision.status === "BLOCK") assert.equal(extraDecision.code, "FOREIGN_EVIDENCE");
});

test("manifest and policy hash tampering blocks before evidence can satisfy a claim", () => {
  const local = evidence("ev-local", "repo.verify", "local");
  const release = manifest("local", [local.evidenceId]);
  const tamperedManifest = { ...release, suiteHash: HASH_A };
  const manifestDecision = evaluateReleaseGate(
    tamperedManifest,
    [local],
    policy(),
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(manifestDecision.status, "BLOCK");
  if (manifestDecision.status === "BLOCK") assert.equal(manifestDecision.code, "HASH_MISMATCH");

  const gatePolicy = policy();
  const wrongPolicy = { ...gatePolicy, policyHash: HASH_A };
  const policyDecision = evaluateReleaseGate(
    release,
    [local],
    wrongPolicy,
    "2026-09-03T19:20:30.000Z",
  );
  assert.equal(policyDecision.status, "BLOCK");
  if (policyDecision.status === "BLOCK") assert.equal(policyDecision.code, "HASH_MISMATCH");
});

test("policy construction forbids stronger claim levels from dropping lower-level requirements", () => {
  assert.throws(
    () =>
      createReleaseGatePolicy({
        maxEvidenceAgeMs: 60_000,
        policyId: "bad-policy",
        requirements: {
          local: [{ kind: "repo.verify", minLevel: "local" }],
          integration: [{ kind: "sandbox.integration", minLevel: "integration" }],
          live: [{ kind: "provider.live", minLevel: "live" }],
        },
      }),
    ReleaseProofError,
  );
});
