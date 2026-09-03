import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvaluationRecord,
  ModelEvaluationRegistry,
  RoutingError,
} from "../../src/routing/index.js";
import { routingEvaluation } from "./helpers.js";

test("evaluation identity is stable and independent producers create immutable records", () => {
  const first = routingEvaluation("provider-a", "small", { effort: "low", quality: 7_800 });
  const second = createEvaluationRecord({
    taskClass: first.taskClass,
    samples: first.samples,
    reasoningEffort: first.reasoningEffort,
    qualityScoreBps: first.qualityScoreBps,
    provider: first.provider,
    producer: { ...first.producer },
    profileVersion: first.profileVersion,
    passRateBps: first.passRateBps,
    outputTokensPerSample: first.outputTokensPerSample,
    observedAt: first.observedAt,
    model: first.model,
    medianLatencyMs: first.medianLatencyMs,
    inputTokensPerSample: first.inputTokensPerSample,
    id: first.id,
  });

  assert.equal(first.contentHash, second.contentHash);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.producer), true);
});

test("model runtime and worker self-evaluations cannot establish routing quality", () => {
  for (const producerClass of ["model", "runtime", "worker"] as const) {
    assert.throws(
      () =>
        createEvaluationRecord({
          id: `self-${producerClass}`,
          inputTokensPerSample: 100,
          medianLatencyMs: 10,
          model: "small",
          observedAt: "2026-09-03T10:00:00.000Z",
          outputTokensPerSample: 50,
          passRateBps: 10_000,
          producer: { class: producerClass, id: "self", reference: "self-report" },
          profileVersion: "v1",
          provider: "provider-a",
          qualityScoreBps: 10_000,
          reasoningEffort: "low",
          samples: 1,
          taskClass: "coding",
        }),
      (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
    );
  }
});

test("tampered hashes malformed effort and duplicate evaluation ids fail closed", () => {
  const valid = routingEvaluation("provider-a", "small", { id: "eval-one" });
  assert.throws(
    () => new ModelEvaluationRegistry([{ ...valid, qualityScoreBps: valid.qualityScoreBps + 1 }]),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );
  assert.throws(
    () => createEvaluationRecord({ ...valid, reasoningEffort: "turbo" }),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );
  assert.throws(
    () => new ModelEvaluationRegistry([valid, valid]),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_CONFLICT",
  );
});
