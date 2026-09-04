import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseGatePolicy, createReleaseManifest } from "../../src/release/index.js";

const HASH = "a".repeat(64);

function policy(reversed: boolean) {
  const local = [{ kind: "repo.verify", minLevel: "local" as const }];
  const integration = [
    { kind: "repo.verify", minLevel: "local" as const },
    { kind: "sandbox.integration", minLevel: "integration" as const },
  ];
  const live = [
    { kind: "repo.verify", minLevel: "local" as const },
    { kind: "sandbox.integration", minLevel: "integration" as const },
    { kind: "provider.live", minLevel: "live" as const },
  ];
  return createReleaseGatePolicy({
    maxEvidenceAgeMs: 60_000,
    policyId: "policy.m12c.v1",
    requirements: {
      integration: reversed ? [...integration].reverse() : integration,
      live: reversed ? [...live].reverse() : live,
      local,
    },
  });
}

test("equivalent release policy and evidence ID ordering produce identical identities", () => {
  const leftPolicy = policy(false);
  const rightPolicy = policy(true);
  assert.equal(leftPolicy.policyHash, rightPolicy.policyHash);

  const common = {
    claimLevel: "local" as const,
    commitSha: "1".repeat(40),
    configProfileHash: HASH,
    configProfileId: "local-ci",
    generatedAt: "2026-09-03T19:20:20.000Z",
    releaseId: "release-m12c",
    suiteHash: HASH,
    suiteId: "npm-verify",
  };
  const left = createReleaseManifest({
    ...common,
    evidenceIds: ["ev-b", "ev-a"],
    policy: leftPolicy,
  });
  const right = createReleaseManifest({
    ...common,
    evidenceIds: ["ev-a", "ev-b"],
    policy: rightPolicy,
  });

  assert.equal(left.manifestHash, right.manifestHash);
  assert.deepEqual(left.evidenceIds, ["ev-a", "ev-b"]);
});
