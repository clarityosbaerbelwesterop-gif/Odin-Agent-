import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  EvidenceLearningCurator,
  type LearningAttestationRequest,
  type LearningEvidenceAuthority,
  LearningError,
  type LearningProposal,
  type LearningRecordResult,
  type VerifiedLearningAttestation,
} from "../../src/learning/index.js";
import { InMemoryMemoryStore } from "../../src/memory/index.js";

const USER = "user-1";
const PROJECT = "project-1";
const BASE = "2026-09-04T06:00:00.000Z";
const DAY_1 = "2026-09-05T06:00:00.000Z";
const DAY_2 = "2026-09-06T06:00:00.000Z";
const DAY_100 = "2026-12-13T06:00:00.000Z";
const DAY_101 = "2026-12-14T06:00:00.000Z";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function identity(request: LearningAttestationRequest): string {
  return `${request.userId}:${request.projectId}:${request.missionId}:${request.taskId}`;
}

class FixtureAuthority implements LearningEvidenceAuthority {
  readonly attestations = new Map<string, VerifiedLearningAttestation | null>();

  set(attestation: VerifiedLearningAttestation | null): void {
    if (attestation === null) return;
    this.attestations.set(identity(attestation), attestation);
  }

  deny(request: LearningAttestationRequest): void {
    this.attestations.set(identity(request), null);
  }

  async attestVerifiedTask(
    request: LearningAttestationRequest,
  ): Promise<VerifiedLearningAttestation | null> {
    return structuredClone(this.attestations.get(identity(request)) ?? null);
  }
}

function attestation(
  missionId: string,
  taskId: string,
  evaluatedAt: string = BASE,
  overrides: Partial<VerifiedLearningAttestation> = {},
): VerifiedLearningAttestation {
  return {
    evaluatedAt,
    evidenceRefs: [`evidence:${missionId}:${taskId}`],
    missionId,
    projectId: PROJECT,
    taskId,
    userId: USER,
    verdict: "PASS",
    verificationResultHash: hash(`verification:${missionId}:${taskId}`),
    ...overrides,
  };
}

function proposal(
  missionId: string,
  taskId: string,
  observedAt: string = BASE,
  overrides: Partial<LearningProposal> = {},
): LearningProposal {
  return {
    idempotencyKey: `learn-${missionId}-${taskId}`,
    key: "typescript repair workflow",
    lesson: "Inspect the smallest failing quality gate before proposing a repair.",
    missionId,
    observedAt,
    projectId: PROJECT,
    sensitivity: "internal",
    sourceReference: `mission:${missionId}:task:${taskId}`,
    tags: ["quality", "repair"],
    taskId,
    userId: USER,
    ...overrides,
  };
}

async function addSupport(
  curator: EvidenceLearningCurator,
  authority: FixtureAuthority,
  missionId: string,
  taskId: string,
  observedAt: string = BASE,
  overrides: Partial<LearningProposal> = {},
): Promise<LearningRecordResult> {
  const input = proposal(missionId, taskId, observedAt, overrides);
  const proof = attestation(missionId, taskId, observedAt, {
    projectId: input.projectId,
    userId: input.userId,
  });
  authority.set(proof);
  return curator.recordVerifiedLesson(input);
}

test("three distinct verified tasks establish a lesson before semantic-memory commit", async () => {
  const authority = new FixtureAuthority();
  const memory = new InMemoryMemoryStore();
  const curator = new EvidenceLearningCurator(authority, memory);

  const first = await addSupport(curator, authority, "mission-1", "task-1", BASE);
  assert.equal(first.record.status, "CANDIDATE");
  assert.equal(first.record.tier, "WARM");
  assert.equal(first.record.supportCount, 1);
  await assert.rejects(
    () => curator.commitEstablishedToMemory(first.record.id, BASE),
    /three distinct verified tasks/u,
  );

  const second = await addSupport(curator, authority, "mission-2", "task-2", DAY_1);
  assert.equal(second.record.supportCount, 2);
  assert.equal(second.record.status, "CANDIDATE");

  const third = await addSupport(curator, authority, "mission-3", "task-3", DAY_2);
  assert.equal(third.record.status, "ESTABLISHED");
  assert.equal(third.record.tier, "HOT");
  assert.equal(third.record.supportCount, 3);

  const committed = await curator.commitEstablishedToMemory(third.record.id, DAY_2);
  assert.equal(committed.memory.replayed, false);
  assert.equal(committed.memory.record.status, "active");
  if (committed.memory.record.status !== "active") throw new Error("Expected active memory.");
  assert.equal(committed.memory.record.kind, "semantic");
  assert.equal(committed.memory.record.content, third.record.lesson);
  assert.equal(committed.memory.record.provenance.sourceClass, "verified_learning");
  assert.equal(committed.memory.record.provenance.contentHash, hash(third.record.lesson));
  assert.equal(committed.memory.record.scope.missionId, undefined);
  assert.deepEqual(committed.memory.record.tags, ["m13-learning", "quality", "repair"]);

  const replay = await curator.commitEstablishedToMemory(third.record.id, DAY_2);
  assert.equal(replay.memory.replayed, true);
  assert.equal(memory.revision, 1);
});

test("duplicate task support cannot inflate confidence and exact replay is idempotent", async () => {
  const authority = new FixtureAuthority();
  const curator = new EvidenceLearningCurator(authority, new InMemoryMemoryStore());
  authority.set(attestation("mission-1", "task-1"));
  const input = proposal("mission-1", "task-1");

  const first = await curator.recordVerifiedLesson(input);
  const replay = await curator.recordVerifiedLesson(input);
  const duplicateTask = await curator.recordVerifiedLesson({
    ...input,
    idempotencyKey: "different-idempotency-key",
  });

  assert.equal(first.record.supportCount, 1);
  assert.equal(replay.replayed, true);
  assert.equal(duplicateTask.supportAdded, false);
  assert.equal(duplicateTask.record.supportCount, 1);
  assert.equal(duplicateTask.record.status, "CANDIDATE");
});

test("idempotency conflict fails closed", async () => {
  const authority = new FixtureAuthority();
  const curator = new EvidenceLearningCurator(authority, new InMemoryMemoryStore());
  authority.set(attestation("mission-1", "task-1"));
  const input = proposal("mission-1", "task-1");
  await curator.recordVerifiedLesson(input);

  await assert.rejects(
    () =>
      curator.recordVerifiedLesson({
        ...input,
        lesson: "A different lesson under the same replay key.",
      }),
    (error: unknown) => error instanceof LearningError && error.code === "CONFLICT",
  );
});

test("missing, foreign, non-PASS, stale, and malformed evidence are denied", async () => {
  const authority = new FixtureAuthority();
  const curator = new EvidenceLearningCurator(authority, new InMemoryMemoryStore());

  await assert.rejects(
    () => curator.recordVerifiedLesson(proposal("missing", "task")),
    /requires independent PASS evidence/u,
  );

  const foreign = proposal("foreign", "task");
  authority.attestations.set(
    identity(foreign),
    attestation("foreign", "task", BASE, { projectId: "project-foreign" }),
  );
  await assert.rejects(() => curator.recordVerifiedLesson(foreign), /scope or verdict did not match/u);

  const failed = {
    ...attestation("failed", "task"),
    verdict: "FAIL",
  } as unknown as VerifiedLearningAttestation;
  authority.attestations.set(identity(proposal("failed", "task")), failed);
  await assert.rejects(
    () => curator.recordVerifiedLesson(proposal("failed", "task")),
    /scope or verdict did not match/u,
  );

  authority.set(attestation("stale", "task", BASE));
  await assert.rejects(
    () => curator.recordVerifiedLesson(proposal("stale", "task", DAY_1)),
    /cannot predate/u,
  );

  authority.set(
    attestation("bad-hash", "task", BASE, {
      verificationResultHash: "not-a-hash",
    }),
  );
  await assert.rejects(
    () => curator.recordVerifiedLesson(proposal("bad-hash", "task")),
    /SHA-256/u,
  );
});

test("conflicting lessons under the same scoped key block nudges and memory promotion", async () => {
  const authority = new FixtureAuthority();
  const curator = new EvidenceLearningCurator(authority, new InMemoryMemoryStore());

  const first = await addSupport(curator, authority, "a-1", "task", BASE);
  await addSupport(curator, authority, "a-2", "task", DAY_1);
  await addSupport(curator, authority, "a-3", "task", DAY_2);
  const conflicting = await addSupport(curator, authority, "b-1", "task", DAY_2, {
    lesson: "Always run every quality gate before looking at the first failure.",
  });

  assert.equal(curator.get(first.record.id)?.status, "CONFLICTED");
  assert.equal(conflicting.record.status, "CONFLICTED");
  assert.deepEqual(
    curator.compileNudges({
      evaluatedAt: DAY_2,
      limit: 10,
      maxCharacters: 4_000,
      projectId: PROJECT,
      tags: ["quality"],
      text: "repair",
      userId: USER,
    }),
    [],
  );
  await assert.rejects(
    () => curator.commitEstablishedToMemory(first.record.id, DAY_2),
    /Only a non-conflicted lesson/u,
  );
});

test("bounded nudges remain scoped and expose confidence plus evidence instead of authority", async () => {
  const authority = new FixtureAuthority();
  const curator = new EvidenceLearningCurator(authority, new InMemoryMemoryStore());
  await addSupport(curator, authority, "m-1", "t-1", BASE);
  await addSupport(curator, authority, "m-2", "t-2", DAY_1);
  await addSupport(curator, authority, "m-3", "t-3", DAY_2);
  const foreign = await addSupport(curator, authority, "foreign", "task", DAY_2, {
    idempotencyKey: "foreign",
    key: "foreign lesson",
    lesson: "Foreign project content.",
    projectId: "project-2",
    sourceReference: "foreign:source",
    tags: ["foreign"],
  });

  assert.equal(foreign.record.projectId, "project-2");
  assert.equal(curator.list({ projectId: PROJECT, userId: USER }).length, 1);
  assert.equal(curator.list({ projectId: "project-2", userId: USER }).length, 1);

  const nudges = curator.compileNudges({
    evaluatedAt: DAY_2,
    limit: 1,
    maxCharacters: 512,
    projectId: PROJECT,
    tags: ["REPAIR"],
    text: "typescript quality repair",
    userId: USER,
  });

  assert.equal(nudges.length, 1);
  const nudge = nudges[0];
  assert.ok(nudge);
  assert.equal(nudge.confidence, "ESTABLISHED");
  assert.equal(nudge.supportCount, 3);
  assert.equal(nudge.tier, "HOT");
  assert.match(nudge.contentHash, /^[a-f0-9]{64}$/u);
  assert.match(nudge.evidenceDigest, /^[a-f0-9]{64}$/u);
  assert.ok(nudge.evidenceRefs.length > 0);
  assert.equal("capability" in nudge, false);
  assert.equal("tool" in nudge, false);
});

test("learning records also isolate users under the same project", async () => {
  const authority = new FixtureAuthority();
  const curator = new EvidenceLearningCurator(authority, new InMemoryMemoryStore());
  await addSupport(curator, authority, "user-a", "task", BASE);
  await addSupport(curator, authority, "user-b", "task", BASE, {
    idempotencyKey: "user-b",
    userId: "user-2",
  });

  assert.equal(curator.list({ projectId: PROJECT, userId: USER }).length, 1);
  assert.equal(curator.list({ projectId: PROJECT, userId: "user-2" }).length, 1);
  assert.deepEqual(
    curator.compileNudges({
      evaluatedAt: DAY_1,
      limit: 10,
      maxCharacters: 4_000,
      projectId: PROJECT,
      text: "repair",
      userId: "user-3",
    }),
    [],
  );
});

test("maintenance cools stale learning and archives unsupported conflicts without deleting memory", async () => {
  const authority = new FixtureAuthority();
  const memory = new InMemoryMemoryStore();
  const curator = new EvidenceLearningCurator(authority, memory);

  const strong = await addSupport(curator, authority, "strong-1", "task", BASE);
  await addSupport(curator, authority, "strong-2", "task", DAY_1);
  await addSupport(curator, authority, "strong-3", "task", DAY_2);
  await addSupport(curator, authority, "weak-1", "task", BASE, {
    lesson: "Conflicting stale alternative.",
  });
  assert.equal(curator.get(strong.record.id)?.status, "CONFLICTED");

  const maintenance = curator.runMaintenance({
    archiveAfterDays: 90,
    coldAfterDays: 30,
    evaluatedAt: DAY_100,
    projectId: PROJECT,
    userId: USER,
  });
  assert.ok(maintenance.archivedIds.length >= 1);
  assert.ok(maintenance.reestablishedIds.includes(strong.record.id));
  assert.equal(curator.get(strong.record.id)?.status, "ESTABLISHED");
  assert.equal(curator.get(strong.record.id)?.tier, "COLD");

  const committed = await curator.commitEstablishedToMemory(strong.record.id, DAY_100);
  assert.equal(committed.memory.record.status, "active");
  curator.runMaintenance({
    archiveAfterDays: 90,
    coldAfterDays: 30,
    evaluatedAt: DAY_101,
    projectId: PROJECT,
    userId: USER,
  });
  const stored = await memory.get(committed.learning.memoryId ?? "missing", {
    projectId: PROJECT,
    userId: USER,
  });
  assert.equal(stored?.status, "active");
});

test("automatic learning rejects sensitive content, unknown fields, and malformed maintenance bounds", async () => {
  const authority = new FixtureAuthority();
  const curator = new EvidenceLearningCurator(authority, new InMemoryMemoryStore());
  authority.set(attestation("m", "t"));

  await assert.rejects(
    () =>
      curator.recordVerifiedLesson({
        ...proposal("m", "t"),
        sensitivity: "sensitive",
      }),
    /cannot automatically persist sensitive/u,
  );
  await assert.rejects(
    () =>
      curator.recordVerifiedLesson({
        ...proposal("m", "t"),
        unexpectedAuthority: true,
      }),
    /unknown fields/u,
  );
  assert.throws(
    () =>
      curator.runMaintenance({
        archiveAfterDays: 30,
        coldAfterDays: 30,
        evaluatedAt: DAY_100,
        projectId: PROJECT,
        userId: USER,
      }),
    /must exceed/u,
  );
});
