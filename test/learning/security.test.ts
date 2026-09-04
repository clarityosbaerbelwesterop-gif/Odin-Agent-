import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  EvidenceLearningCurator,
  type LearningAttestationRequest,
  type LearningEvidenceAuthority,
  LearningError,
  type VerifiedLearningAttestation,
} from "../../src/learning/index.js";
import { InMemoryMemoryStore } from "../../src/memory/index.js";

const NOW = "2026-09-04T06:40:00.000Z";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function proposal() {
  return {
    idempotencyKey: "binding-1",
    key: "minimal repair",
    lesson: "Read the smallest failing gate before changing code.",
    missionId: "mission-binding",
    observedAt: NOW,
    projectId: "project-1",
    sensitivity: "internal" as const,
    sourceReference: "mission:mission-binding:task:task-binding",
    tags: ["repair"],
    taskId: "task-binding",
    userId: "user-1",
  };
}

class TamperingAuthority implements LearningEvidenceAuthority {
  readonly #tamper: "key" | "lesson";

  constructor(tamper: "key" | "lesson") {
    this.#tamper = tamper;
  }

  async attestVerifiedTask(
    request: LearningAttestationRequest,
  ): Promise<VerifiedLearningAttestation> {
    return {
      ...request,
      evaluatedAt: NOW,
      evidenceRefs: ["verification:evidence:binding"],
      learningKeyHash:
        this.#tamper === "key" ? sha256("different-key") : request.learningKeyHash,
      lessonContentHash:
        this.#tamper === "lesson" ? sha256("different-lesson") : request.lessonContentHash,
      verdict: "PASS",
      verificationResultHash: sha256("verification-result"),
    };
  }
}

test("a real PASS cannot authorize a different lesson or semantic key", async () => {
  for (const tamper of ["lesson", "key"] as const) {
    const curator = new EvidenceLearningCurator(
      new TamperingAuthority(tamper),
      new InMemoryMemoryStore(),
    );
    await assert.rejects(
      () => curator.recordVerifiedLesson(proposal()),
      (error: unknown) =>
        error instanceof LearningError &&
        error.code === "DENIED" &&
        /content binding/u.test(error.message),
    );
  }
});

test("verified-learning semantic memory is invisible unless retrieval explicitly opts in", async () => {
  const memory = new InMemoryMemoryStore();
  const content = "Use the verified smallest-gate repair pattern.";
  await memory.write({
    expectedVersion: 0,
    idempotencyKey: "verified-learning-write",
    record: {
      content,
      id: "learn-opt-in",
      key: "learned:repair",
      kind: "semantic",
      provenance: {
        contentHash: sha256(content),
        observedAt: NOW,
        reference: "learning:record:evidence",
        sourceClass: "verified_learning",
        sourceVersion: sha256("evidence-digest"),
      },
      scope: { projectId: "project-1", userId: "user-1" },
      sensitivity: "internal",
      tags: ["m13-learning", "repair"],
    },
    updatedAt: NOW,
  });

  const broad = await memory.retrieve({
    evaluatedAt: NOW,
    kinds: ["semantic"],
    limit: 10,
    projectId: "project-1",
    text: "repair pattern",
    userId: "user-1",
  });
  assert.deepEqual(broad, []);

  const explicit = await memory.retrieve({
    evaluatedAt: NOW,
    kinds: ["semantic"],
    limit: 10,
    projectId: "project-1",
    tags: ["m13-learning"],
    text: "repair pattern",
    userId: "user-1",
  });
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0]?.record.id, "learn-opt-in");
  assert.equal(explicit[0]?.record.provenance.sourceClass, "verified_learning");
});
