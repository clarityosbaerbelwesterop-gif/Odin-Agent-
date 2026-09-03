import assert from "node:assert/strict";
import { test } from "node:test";
import { IndependentVerificationEngine } from "../../src/verification/engine.js";
import type {
  AdversarialReviewer,
  AdversarialReviewResult,
  VerificationEvidence,
  VerificationFindingCode,
  VerificationRequest,
} from "../../src/verification/types.js";

const NOW = "2026-09-02T20:00:00.000Z";
const EARLIER = "2026-09-02T19:55:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function engine(maxEvidenceAgeMs = 60_000): IndependentVerificationEngine {
  return new IndependentVerificationEngine({ maxEvidenceAgeMs });
}

function validRequest(): VerificationRequest {
  return {
    bindings: [{ claimId: "claim-tests", evidenceIds: ["evidence-tests"] }],
    claims: [
      {
        definitionOfDone: "The registered tests pass.",
        id: "claim-tests",
        missionId: "mission-1",
        requiredAfter: NOW,
        requiredEvidenceKinds: ["test"],
        taskId: "task-1",
      },
    ],
    evaluatedAt: NOW,
    evidence: [
      {
        contentHash: HASH_A,
        id: "evidence-tests",
        kind: "test",
        missionId: "mission-1",
        observedAt: NOW,
        producer: { class: "independent_tool", id: "test-runner@1" },
        status: "PASS",
        subject: "npm-test",
        taskId: "task-1",
      },
    ],
    missionId: "mission-1",
  };
}

function codes(
  result: ReturnType<IndependentVerificationEngine["verify"]>,
  source: "review" | "verification" = "verification",
): VerificationFindingCode[] {
  return result[source].findings.map((finding) => finding.code);
}

function firstClaim(request: VerificationRequest): VerificationRequest["claims"][number] {
  const claim = request.claims[0];
  if (claim === undefined) throw new Error("Fixture claim is missing.");
  return claim;
}

function firstEvidence(request: VerificationRequest): VerificationEvidence {
  const evidence = request.evidence[0];
  if (evidence === undefined) throw new Error("Fixture evidence is missing.");
  return evidence;
}

test("valid independently produced evidence passes verification and adversarial review", () => {
  const request = validRequest();
  const before = structuredClone(request);
  const result = engine().verify(request);

  assert.equal(result.outcome, "PASS");
  assert.equal(result.verification.verdict, "PASS");
  assert.deepEqual(result.verification.satisfiedClaimIds, ["claim-tests"]);
  assert.equal(result.review.verdict, "ACCEPT");
  assert.match(result.resultHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(request, before, "verification must not mutate supplied evidence");
});

test("missing evidence fails closed", () => {
  const request = validRequest();
  const result = engine().verify({ ...request, bindings: [], evidence: [] });

  assert.equal(result.outcome, "BLOCK");
  assert.ok(codes(result).includes("claim_missing_evidence"));
  assert.deepEqual(result.verification.satisfiedClaimIds, []);
});

test("stale evidence fails the configured freshness bound", () => {
  const request = validRequest();
  const result = engine().verify({
    ...request,
    claims: request.claims.map((claim) => ({ ...claim, requiredAfter: EARLIER })),
    evidence: request.evidence.map((evidence) => ({ ...evidence, observedAt: EARLIER })),
  });

  assert.equal(result.outcome, "BLOCK");
  assert.ok(codes(result).includes("evidence_stale"));
});

test("foreign mission and task evidence cannot satisfy a claim", () => {
  const request = validRequest();
  const result = engine().verify({
    ...request,
    evidence: request.evidence.map((evidence) => ({
      ...evidence,
      missionId: "mission-foreign",
      taskId: "task-foreign",
    })),
  });

  assert.equal(result.outcome, "BLOCK");
  assert.ok(codes(result).includes("evidence_foreign_scope"));
});

test("contradictory pass and fail evidence blocks both verification and review", () => {
  const request = validRequest();
  const failedEvidence: VerificationEvidence = {
    ...firstEvidence(request),
    contentHash: HASH_B,
    id: "evidence-tests-failed",
    status: "FAIL",
  };
  const result = engine().verify({
    ...request,
    evidence: [...request.evidence, failedEvidence],
  });

  assert.equal(result.outcome, "BLOCK");
  assert.ok(codes(result).includes("evidence_conflict"));
  assert.ok(codes(result, "review").includes("evidence_conflict"));
  assert.equal(result.review.verdict, "BLOCK");
});

test("reusing one evidence ID across different task claims is detected", () => {
  const request = validRequest();
  const result = engine().verify({
    ...request,
    bindings: [...request.bindings, { claimId: "claim-second", evidenceIds: ["evidence-tests"] }],
    claims: [
      ...request.claims,
      {
        definitionOfDone: "A separate task is verified.",
        id: "claim-second",
        missionId: request.missionId,
        requiredAfter: NOW,
        requiredEvidenceKinds: ["test"],
        taskId: "task-2",
      },
    ],
  });

  assert.equal(result.outcome, "BLOCK");
  assert.ok(codes(result, "review").includes("evidence_reused"));
});

test("self-authored evidence produces a bounded targeted repair request", () => {
  const request = validRequest();
  const result = engine().verify({
    ...request,
    evidence: request.evidence.map((evidence) => ({
      ...evidence,
      producer: { class: "runtime" as const, id: "coding-runtime" },
    })),
  });

  assert.equal(result.verification.verdict, "PASS");
  assert.equal(result.outcome, "REPAIR_REQUIRED");
  assert.equal(result.review.verdict, "REPAIR_REQUIRED");
  assert.deepEqual(result.review.repairRequest?.claimIds, ["claim-tests"]);
  assert.deepEqual(result.review.repairRequest?.reasonCodes, ["evidence_self_authored"]);
  assert.ok((result.review.repairRequest?.instruction.length ?? 0) <= 500);
});

test("malformed reviewer output is converted into a blocking typed result", () => {
  class InvalidReviewer implements AdversarialReviewer {
    review(): AdversarialReviewResult {
      return {
        findings: [],
        missionId: "mission-1",
        resultHash: HASH_A,
        verificationResultHash: HASH_A,
        verdict: "ACCEPT",
      };
    }
  }

  const result = new IndependentVerificationEngine({
    maxEvidenceAgeMs: 60_000,
    reviewer: new InvalidReviewer(),
  }).verify(validRequest());

  assert.equal(result.outcome, "BLOCK");
  assert.equal(result.review.verdict, "BLOCK");
  assert.deepEqual(codes(result, "review"), ["review_invalid"]);
});

test("normalized replay is deterministic even when independent inputs are reordered", () => {
  const request = validRequest();
  const secondClaim = {
    ...firstClaim(request),
    definitionOfDone: "The build passes.",
    id: "claim-build",
    requiredEvidenceKinds: ["quality_gate" as const],
  };
  const secondEvidence: VerificationEvidence = {
    ...firstEvidence(request),
    contentHash: HASH_B,
    id: "evidence-build",
    kind: "quality_gate",
    subject: "npm-build",
  };
  const first: VerificationRequest = {
    ...request,
    bindings: [...request.bindings, { claimId: secondClaim.id, evidenceIds: [secondEvidence.id] }],
    claims: [...request.claims, secondClaim],
    evidence: [...request.evidence, secondEvidence],
  };
  const second: VerificationRequest = {
    ...first,
    bindings: [...first.bindings].reverse(),
    claims: [...first.claims].reverse(),
    evidence: [...first.evidence].reverse(),
  };

  assert.deepEqual(engine().verify(first), engine().verify(second));
});

test("unknown evidence kinds and impossible or non-canonical timestamps fail closed", () => {
  const request = validRequest();
  const malformed = {
    ...request,
    claims: request.claims.map((claim) => ({
      ...claim,
      requiredEvidenceKinds: ["invented_kind"],
    })),
    evidence: request.evidence.map((evidence) => ({
      ...evidence,
      kind: "invented_kind",
      observedAt: "2026-02-30T20:00:00.000Z",
    })),
  } as unknown as VerificationRequest;
  const result = engine().verify(malformed);

  assert.equal(result.outcome, "BLOCK");
  assert.ok(codes(result).includes("claim_invalid"));
  assert.ok(codes(result).includes("evidence_invalid"));
});

test("duplicate evidence IDs fail independently of input order", () => {
  const request = validRequest();
  const duplicate = { ...firstEvidence(request), contentHash: HASH_B };
  const forward = engine().verify({ ...request, evidence: [...request.evidence, duplicate] });
  const reverse = engine().verify({ ...request, evidence: [duplicate, ...request.evidence] });

  assert.equal(forward.outcome, "BLOCK");
  assert.ok(codes(forward).includes("evidence_duplicate"));
  assert.deepEqual(forward, reverse);
});

test("unbounded or structurally malformed collections are rejected before review", () => {
  const request = validRequest();
  assert.throws(
    () => engine().verify({ ...request, claims: Array(257).fill(firstClaim(request)) }),
    /at most 256/u,
  );
  assert.throws(
    () => engine().verify({ ...request, evidence: [null] } as unknown as VerificationRequest),
    /structure is malformed/u,
  );
});
