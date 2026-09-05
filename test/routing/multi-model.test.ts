import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createRouteFailure,
  FailureAwareModelRouter,
  type RouteFailure,
  RoutingError,
} from "../../src/routing/index.js";
import { routeRequest, routingEvaluation, routingProfile } from "./helpers.js";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function matrix() {
  const identities = [
    ["nvidia", "kimi-fixture"],
    ["openai", "gpt-fixture"],
    ["anthropic", "claude-fixture"],
    ["glm", "glm-fixture"],
    ["openrouter", "router-fixture"],
  ] as const;
  return {
    evaluations: identities.map(([provider, model], index) =>
      routingEvaluation(provider, model, {
        id: `m21-${provider}`,
        latencyMs: 200 + index * 100,
        quality: 7_500 + index * 400,
      }),
    ),
    profiles: identities.map(([provider, model], index) =>
      routingProfile(provider, model, {
        pricing: {
          inputPerMillionTokens: 0.1 + index,
          outputPerMillionTokens: 0.2 + index,
        },
      }),
    ),
  };
}

function failure(
  id: string,
  provider: string,
  model: string,
  options: Partial<{
    observedAt: string;
    category: RouteFailure["category"];
    signature: string;
  }> = {},
): RouteFailure {
  return createRouteFailure({
    category: options.category ?? "timeout",
    failureSignature: options.signature ?? sha(`${provider}/${model}/failure`),
    id,
    model,
    observedAt: options.observedAt ?? "2026-09-03T11:55:00.000Z",
    profileVersion: "v1",
    provider,
    reasoningEffort: "low",
    taskClass: "coding",
  });
}

test("M21 routes across five provider identities only after empirical quality gates", () => {
  const inputs = matrix();
  const result = new FailureAwareModelRouter().route(routeRequest(), inputs, []);
  assert.equal(result.routing.primary.provider, "nvidia");
  assert.equal(result.routing.primary.model, "kimi-fixture");
  assert.equal(result.routing.primary.qualityScoreBps, 7_500);
  assert.ok(result.routing.escalations.length >= 4);
});

test("repeated exact-route failure excludes that route and deterministically reroutes", () => {
  const inputs = matrix();
  const failures = [
    failure("f-1", "nvidia", "kimi-fixture"),
    failure("f-2", "nvidia", "kimi-fixture"),
  ];
  const result = new FailureAwareModelRouter().route(routeRequest(), inputs, failures);
  assert.notEqual(result.routing.primary.provider, "nvidia");
  assert.deepEqual(result.excludedRouteKeys, ["nvidia/kimi-fixture/v1/coding/low"]);
  assert.equal(result.consideredFailureHashes.length, 2);
});

test("one immediate authority or capability failure excludes an exact route", () => {
  const inputs = matrix();
  for (const category of ["authentication", "capability_mismatch", "policy_denied"] as const) {
    const result = new FailureAwareModelRouter().route(routeRequest(), inputs, [
      failure(`f-${category}`, "nvidia", "kimi-fixture", { category }),
    ]);
    assert.notEqual(result.routing.primary.provider, "nvidia");
  }
});

test("stale failure history is ignored while future failure evidence fails closed", () => {
  const inputs = matrix();
  const stale = new FailureAwareModelRouter().route(routeRequest(), inputs, [
    failure("old-1", "nvidia", "kimi-fixture", { observedAt: "2026-09-03T10:00:00.000Z" }),
    failure("old-2", "nvidia", "kimi-fixture", { observedAt: "2026-09-03T10:00:01.000Z" }),
  ]);
  assert.equal(stale.routing.primary.provider, "nvidia");
  assert.equal(stale.consideredFailureHashes.length, 0);

  assert.throws(
    () =>
      new FailureAwareModelRouter().route(routeRequest(), inputs, [
        failure("future", "nvidia", "kimi-fixture", {
          observedAt: "2026-09-03T12:00:01.000Z",
        }),
      ]),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );
});

test("tampered and foreign-shaped failure evidence cannot affect routing", () => {
  const inputs = matrix();
  const valid = failure("tamper", "nvidia", "kimi-fixture");
  assert.throws(
    () =>
      new FailureAwareModelRouter().route(routeRequest(), inputs, [
        { ...valid, category: "quality" },
      ]),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );
  assert.throws(
    () =>
      new FailureAwareModelRouter().route(routeRequest(), inputs, [
        { ...valid, unexpected: true } as RouteFailure,
      ]),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );
});

test("when bounded recent failures remove every quality-eligible route M21 blocks", () => {
  const one = {
    evaluations: [routingEvaluation("nvidia", "only", { id: "only-eval", quality: 8_000 })],
    profiles: [routingProfile("nvidia", "only")],
  };
  assert.throws(
    () =>
      new FailureAwareModelRouter({ repeatedFailureCeiling: 1 }).route(routeRequest(), one, [
        failure("only-failure", "nvidia", "only"),
      ]),
    (error: unknown) =>
      error instanceof RoutingError &&
      error.code === "NO_ELIGIBLE_MODEL" &&
      error.reasons.includes("nvidia/only/v1/coding/low"),
  );
});

test("M21 decision identity is deterministic across profile evaluation and failure order", () => {
  const inputs = matrix();
  const failures = [
    failure("d-1", "nvidia", "kimi-fixture"),
    failure("d-2", "nvidia", "kimi-fixture"),
  ];
  const router = new FailureAwareModelRouter();
  const first = router.route(routeRequest(), inputs, failures);
  const second = router.route(
    routeRequest(),
    {
      evaluations: [...inputs.evaluations].reverse(),
      profiles: [...inputs.profiles].reverse(),
    },
    [...failures].reverse(),
  );
  assert.deepEqual(first, second);
});
