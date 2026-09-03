import assert from "node:assert/strict";
import test from "node:test";
import {
  EmpiricalModelRouter,
  evaluateRoutingFixture,
  RoutingError,
} from "../../src/routing/index.js";
import { routeRequest, routingEvaluation, routingProfile } from "./helpers.js";

function fixtureCases() {
  const cheap = routingProfile("provider-a", "small", {
    pricing: { inputPerMillionTokens: 0.1, outputPerMillionTokens: 0.2 },
  });
  const strong = routingProfile("provider-b", "strong", {
    pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
  });
  return [
    {
      id: "coding-cheap-succeeds",
      inputs: {
        evaluations: [
          routingEvaluation("provider-a", "small", { id: "fixture-cheap", quality: 7_800 }),
          routingEvaluation("provider-b", "strong", { id: "fixture-strong", quality: 9_300 }),
        ],
        profiles: [cheap, strong],
      },
      request: routeRequest({ taskId: "fixture-one" }),
    },
    {
      id: "high-floor-needs-strong",
      inputs: {
        evaluations: [
          routingEvaluation("provider-a", "small", { id: "fixture-cheap-2", quality: 7_800 }),
          routingEvaluation("provider-b", "strong", { id: "fixture-strong-2", quality: 9_300 }),
        ],
        profiles: [cheap, strong],
      },
      request: routeRequest({ baseQualityFloorBps: 9_000, taskId: "fixture-two" }),
    },
    {
      id: "impossible-floor-blocks",
      inputs: {
        evaluations: [
          routingEvaluation("provider-a", "small", { id: "fixture-cheap-3", quality: 7_800 }),
          routingEvaluation("provider-b", "strong", { id: "fixture-strong-3", quality: 9_300 }),
        ],
        profiles: [cheap, strong],
      },
      request: routeRequest({ baseQualityFloorBps: 9_900, taskId: "fixture-three" }),
    },
  ];
}

test("offline fixture compares small and stronger profiles without provider calls", () => {
  const router = new EmpiricalModelRouter();
  const summary = evaluateRoutingFixture(router, fixtureCases());
  assert.equal(summary.cases, 3);
  assert.equal(summary.routed, 2);
  assert.equal(summary.blocked, 1);
  assert.deepEqual(
    summary.outcomes.map(({ id, status, model }) => [id, status, model ?? null]),
    [
      ["coding-cheap-succeeds", "ROUTED", "small"],
      ["high-floor-needs-strong", "ROUTED", "strong"],
      ["impossible-floor-blocks", "BLOCKED", null],
    ],
  );
});

test("offline fixture result is deterministic across case ordering", () => {
  const router = new EmpiricalModelRouter();
  const cases = fixtureCases();
  assert.deepEqual(
    evaluateRoutingFixture(router, cases),
    evaluateRoutingFixture(router, [...cases].reverse()),
  );
});

test("offline fixture rejects duplicate case identities", () => {
  const router = new EmpiricalModelRouter();
  const [first] = fixtureCases();
  assert.ok(first !== undefined);
  assert.throws(
    () => evaluateRoutingFixture(router, [first, first]),
    (error: unknown) => error instanceof RoutingError && error.code === "INVALID_INPUT",
  );
});
