import assert from "node:assert/strict";
import test from "node:test";
import { EmpiricalModelRouter, RoutingError } from "../../src/routing/index.js";
import { routeRequest, routingEvaluation, routingProfile } from "./helpers.js";

test("routing blocks when the only quality evidence is stale", () => {
  assert.throws(
    () =>
      new EmpiricalModelRouter().route(routeRequest(), {
        evaluations: [
          routingEvaluation("provider-a", "small", {
            id: "stale-only",
            observedAt: "2026-07-01T00:00:00.000Z",
            quality: 10_000,
          }),
        ],
        profiles: [routingProfile("provider-a", "small")],
      }),
    (error: unknown) => error instanceof RoutingError && error.code === "NO_ELIGIBLE_MODEL",
  );
});

test("future evaluation evidence fails closed before routing", () => {
  assert.throws(
    () =>
      new EmpiricalModelRouter().route(routeRequest(), {
        evaluations: [
          routingEvaluation("provider-a", "small", {
            id: "future-eval",
            observedAt: "2026-09-04T00:00:00.000Z",
            quality: 10_000,
          }),
        ],
        profiles: [routingProfile("provider-a", "small")],
      }),
    (error: unknown) => error instanceof RoutingError && error.code === "EVALUATION_INVALID",
  );
});

test("unknown or mismatched pricing cannot bypass the route cost ceiling", () => {
  assert.throws(
    () =>
      new EmpiricalModelRouter().route(routeRequest(), {
        evaluations: [routingEvaluation("provider-a", "small", { id: "currency-mismatch" })],
        profiles: [
          routingProfile("provider-a", "small", {
            pricing: { currency: "EUR", inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
          }),
        ],
      }),
    (error: unknown) => error instanceof RoutingError && error.code === "NO_ELIGIBLE_MODEL",
  );
});
