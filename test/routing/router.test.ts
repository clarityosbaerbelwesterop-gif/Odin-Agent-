import assert from "node:assert/strict";
import test from "node:test";
import { EmpiricalModelRouter, RoutingError } from "../../src/routing/index.js";
import { routeRequest, routingEvaluation, routingProfile } from "./helpers.js";

function standardInputs(cheapQuality = 7_600) {
  return {
    evaluations: [
      routingEvaluation("provider-a", "cheap", {
        id: "eval-cheap",
        latencyMs: 300,
        quality: cheapQuality,
      }),
      routingEvaluation("provider-b", "strong", {
        id: "eval-strong",
        latencyMs: 900,
        quality: 9_200,
      }),
    ],
    profiles: [
      routingProfile("provider-a", "cheap", {
        pricing: { inputPerMillionTokens: 0.1, outputPerMillionTokens: 0.2 },
      }),
      routingProfile("provider-b", "strong", {
        pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
      }),
    ],
  };
}

test("cheapest model wins only after satisfying the empirical quality floor", () => {
  const route = new EmpiricalModelRouter().route(routeRequest(), standardInputs());
  assert.equal(route.primary.model, "cheap");
  assert.equal(route.effectiveQualityFloorBps, 7_000);
  const escalation = route.escalations[0];
  assert.ok(escalation !== undefined);
  assert.equal(escalation.model, "strong");
  assert.ok(route.primary.estimatedCostMicros < escalation.estimatedCostMicros);
});

test("stronger model wins when cheap evidence is below floor and quality is never downgraded", () => {
  const route = new EmpiricalModelRouter().route(routeRequest(), standardInputs(6_900));
  assert.equal(route.primary.model, "strong");
  assert.equal(route.primary.qualityScoreBps, 9_200);
  assert.equal(route.escalations.length, 0);

  assert.throws(
    () =>
      new EmpiricalModelRouter().route(
        routeRequest({ baseQualityFloorBps: 9_500 }),
        standardInputs(),
      ),
    (error: unknown) => error instanceof RoutingError && error.code === "NO_ELIGIBLE_MODEL",
  );
});

test("capability mismatch and stale evidence are eliminated before price can win", () => {
  const cheap = routingProfile("provider-a", "cheap", {
    capabilities: { imageInput: false },
    pricing: { inputPerMillionTokens: 0.1, outputPerMillionTokens: 0.2 },
  });
  const strong = routingProfile("provider-b", "strong");
  const route = new EmpiricalModelRouter().route(
    routeRequest({ requirements: { ...routeRequest().requirements, imageInput: true } }),
    {
      evaluations: [
        routingEvaluation("provider-a", "cheap", { id: "cap-cheap", quality: 9_900 }),
        routingEvaluation("provider-b", "strong", { id: "cap-strong", quality: 9_000 }),
      ],
      profiles: [cheap, strong],
    },
  );
  assert.equal(route.primary.model, "strong");

  const staleRoute = new EmpiricalModelRouter().route(routeRequest(), {
    evaluations: [
      routingEvaluation("provider-a", "cheap", {
        id: "stale-cheap",
        observedAt: "2026-07-01T00:00:00.000Z",
        quality: 10_000,
      }),
      routingEvaluation("provider-b", "strong", { id: "fresh-strong", quality: 8_500 }),
    ],
    profiles: [cheap, strong],
  });
  assert.equal(staleRoute.primary.model, "strong");
});

test("risk and uncertainty raise the effective quality floor instead of lowering it", () => {
  const router = new EmpiricalModelRouter();
  const low = router.route(routeRequest({ baseQualityFloorBps: 6_000 }), standardInputs());
  assert.equal(low.effectiveQualityFloorBps, 6_500);
  assert.equal(low.primary.model, "cheap");

  const elevated = router.route(
    routeRequest({ baseQualityFloorBps: 7_000, risk: "high", uncertaintyBps: 5_000 }),
    standardInputs(),
  );
  assert.equal(elevated.effectiveQualityFloorBps, 8_250);
  assert.equal(elevated.primary.model, "strong");
});

test("cost ceiling can force a cheaper eligible route or block without lowering quality", () => {
  const route = new EmpiricalModelRouter().route(
    routeRequest({ budget: { ...routeRequest().budget, maxEstimatedCostMicros: 2_000 } }),
    standardInputs(),
  );
  assert.equal(route.primary.model, "cheap");

  assert.throws(
    () =>
      new EmpiricalModelRouter().route(
        routeRequest({
          baseQualityFloorBps: 9_000,
          budget: { ...routeRequest().budget, maxEstimatedCostMicros: 2_000 },
        }),
        standardInputs(),
      ),
    (error: unknown) => error instanceof RoutingError && error.code === "NO_ELIGIBLE_MODEL",
  );
});

test("routing order and decision hash are deterministic across input reordering", () => {
  const router = new EmpiricalModelRouter();
  const inputs = standardInputs();
  const first = router.route(routeRequest(), inputs);
  const second = router.route(routeRequest(), {
    evaluations: [...inputs.evaluations].reverse(),
    profiles: [...inputs.profiles].reverse(),
  });
  assert.deepEqual(first, second);
  assert.equal(first.decisionHash, second.decisionHash);
});

test("evaluation evidence is bound to exact profile version and supported reasoning effort", () => {
  assert.throws(
    () =>
      new EmpiricalModelRouter().route(routeRequest(), {
        evaluations: [
          routingEvaluation("provider-a", "cheap", {
            effort: "high",
            id: "unsupported-effort",
            quality: 9_000,
          }),
        ],
        profiles: [
          routingProfile("provider-a", "cheap", { capabilities: { reasoningEfforts: ["low"] } }),
        ],
      }),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );

  assert.throws(
    () =>
      new EmpiricalModelRouter().route(routeRequest(), {
        evaluations: [
          routingEvaluation("provider-a", "cheap", {
            id: "foreign-version",
            quality: 9_000,
            version: "v2",
          }),
        ],
        profiles: [routingProfile("provider-a", "cheap", { version: "v1" })],
      }),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );
});

test("cache identity binds context evidence model profile and reasoning policy; sensitive work disables it", () => {
  const router = new EmpiricalModelRouter();
  const first = router.route(routeRequest(), standardInputs());
  const contextChanged = router.route(
    routeRequest({ cache: { ...routeRequest().cache, contextHash: "c".repeat(64) } }),
    standardInputs(),
  );
  const policyChanged = router.route(
    routeRequest({ budget: { ...routeRequest().budget, maxModelCalls: 5 } }),
    standardInputs(),
  );
  assert.notEqual(first.cache.key, contextChanged.cache.key);
  assert.notEqual(first.cache.key, policyChanged.cache.key);
  assert.notEqual(first.decisionHash, policyChanged.decisionHash);

  const sensitive = router.route(
    routeRequest({ cache: { ...routeRequest().cache, sensitive: true } }),
    standardInputs(),
  );
  assert.equal(sensitive.cache.readAllowed, false);
  assert.equal(sensitive.cache.writeAllowed, false);
  assert.equal(sensitive.cache.key, undefined);
});
