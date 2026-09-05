import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AutonomyIntegrityError,
  createSoakObservation,
  evaluateSoak,
  SOAK_PROFILES,
  type SoakObservation,
  type SoakObservationBody,
  type SoakProfile,
} from "../../src/autonomy/index.js";

const HOUR_MS = 60 * 60 * 1_000;

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function append(events: SoakObservation[], body: SoakObservationBody): void {
  events.push(createSoakObservation(events.at(-1) ?? null, body));
}

function passingSoak(profile: SoakProfile): readonly SoakObservation[] {
  const events: SoakObservation[] = [];
  const hours = profile.durationMs / HOUR_MS;
  for (let hour = 1; hour <= hours; hour += 1) {
    const atMs = hour * HOUR_MS;
    const checkpointHash = sha(`${profile.id}:checkpoint:${hour}`);
    append(events, { atMs, checkpointHash, kind: "checkpoint" });
    append(events, { atMs, budgetUnits: 100, kind: "budget_consumed" });
    if (hour % 4 === 0) {
      append(events, { atMs, checkpointHash, kind: "restart" });
    }
    if (hour % 6 === 0) {
      const jobId = `job-${hour}`;
      append(events, { atMs, generation: 2, jobId, kind: "lease_reclaimed" });
      append(events, { atMs, generation: 2, jobId, kind: "job_settled", settlement: "SUCCEEDED" });
    }
  }
  return events;
}

for (const profile of Object.values(SOAK_PROFILES)) {
  test(`${profile.id} covers its logical duration with bounded recovery evidence`, () => {
    const report = evaluateSoak(profile, passingSoak(profile));
    assert.equal(report.profileId, profile.id);
    assert.equal(report.coveredDurationMs, profile.durationMs);
    assert.equal(report.checkpointCount, profile.minCheckpoints);
    assert.equal(report.terminalState, "PASS");
    assert.match(report.reportHash, /^[a-f0-9]{64}$/u);
  });
}

test("equivalent synthetic soak evidence produces one deterministic report identity", () => {
  const profile = SOAK_PROFILES["soak-12h-v1"];
  assert.equal(
    evaluateSoak(profile, passingSoak(profile)).reportHash,
    evaluateSoak(profile, passingSoak(profile)).reportHash,
  );
});

test("tampered event hashes and restart checkpoints fail closed", () => {
  const profile = SOAK_PROFILES["soak-6h-v1"];
  const events = [...passingSoak(profile)];
  const first = events[0];
  assert.ok(first !== undefined);
  events[0] = { ...first, eventHash: sha("tampered") };
  assert.throws(() => evaluateSoak(profile, events), AutonomyIntegrityError);

  const restartEvents: SoakObservation[] = [];
  append(restartEvents, { atMs: HOUR_MS, checkpointHash: sha("checkpoint"), kind: "checkpoint" });
  append(restartEvents, { atMs: HOUR_MS, checkpointHash: sha("foreign"), kind: "restart" });
  assert.throws(() => evaluateSoak(profile, restartEvents), /latest trusted checkpoint/u);
});

test("stale fenced settlement cannot win after a higher-generation reclaim", () => {
  const profile = SOAK_PROFILES["soak-6h-v1"];
  const events: SoakObservation[] = [];
  append(events, { atMs: HOUR_MS, checkpointHash: sha("c1"), kind: "checkpoint" });
  append(events, { atMs: HOUR_MS, generation: 2, jobId: "job-a", kind: "lease_reclaimed" });
  append(events, { atMs: HOUR_MS, generation: 3, jobId: "job-a", kind: "lease_reclaimed" });
  append(events, {
    atMs: HOUR_MS,
    generation: 2,
    jobId: "job-a",
    kind: "job_settled",
    settlement: "SUCCEEDED",
  });
  assert.throws(() => evaluateSoak(profile, events), /Stale or foreign/u);
});

test("cancellation remains terminal against a late worker success", () => {
  const profile = SOAK_PROFILES["soak-6h-v1"];
  const events: SoakObservation[] = [];
  append(events, { atMs: HOUR_MS, checkpointHash: sha("c1"), kind: "checkpoint" });
  append(events, { atMs: HOUR_MS, generation: 2, jobId: "job-cancel", kind: "lease_reclaimed" });
  append(events, { atMs: HOUR_MS, jobId: "job-cancel", kind: "cancel_requested" });
  append(events, {
    atMs: HOUR_MS,
    generation: 2,
    jobId: "job-cancel",
    kind: "job_settled",
    settlement: "SUCCEEDED",
  });
  assert.throws(() => evaluateSoak(profile, events), /Late success/u);
});

test("equivalent failure signatures block before an unbounded retry loop", () => {
  const profile = SOAK_PROFILES["soak-6h-v1"];
  const events: SoakObservation[] = [];
  const signature = sha("same-failure");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    append(events, { atMs: HOUR_MS + attempt, failureSignature: signature, kind: "retry_failed" });
  }
  assert.throws(() => evaluateSoak(profile, events), /anti-loop ceiling/u);
});

test("synthetic clock rollback and forged profile ceilings are rejected", () => {
  const profile = SOAK_PROFILES["soak-6h-v1"];
  const events: SoakObservation[] = [];
  append(events, { atMs: HOUR_MS, kind: "heartbeat" });
  append(events, { atMs: HOUR_MS - 1, kind: "heartbeat" });
  assert.throws(() => evaluateSoak(profile, events), /clock moved backwards/u);

  assert.throws(
    () =>
      evaluateSoak(
        { ...profile, maxBudgetUnits: profile.maxBudgetUnits + 1 },
        passingSoak(profile),
      ),
    /runtime-owned versioned profile/u,
  );
});

test("soak observations reject unknown and event-inappropriate fields before hashing", () => {
  assert.throws(
    () =>
      createSoakObservation(null, {
        atMs: HOUR_MS,
        kind: "heartbeat",
        jobId: "smuggled-job",
      } as SoakObservationBody),
    /unknown, missing, or misplaced fields/u,
  );
  assert.throws(
    () =>
      createSoakObservation(null, {
        atMs: HOUR_MS,
        checkpointHash: sha("checkpoint"),
        kind: "checkpoint",
        unexpected: true,
      } as unknown as SoakObservationBody),
    /unknown, missing, or misplaced fields/u,
  );
});

test("hash-valid replay envelopes still reject extra semantic metadata", () => {
  const profile = SOAK_PROFILES["soak-6h-v1"];
  const events = [...passingSoak(profile)];
  const first = events[0];
  assert.ok(first !== undefined);
  const forged = { ...first, jobId: "smuggled-job" } as SoakObservation;
  events[0] = forged;
  assert.throws(() => evaluateSoak(profile, events), /unknown, missing, or misplaced fields/u);
});
