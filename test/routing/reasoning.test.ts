import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveReasoningController,
  EmpiricalModelRouter,
  RoutingError,
} from "../../src/routing/index.js";
import { routeRequest, routingEvaluation, routingProfile } from "./helpers.js";

function routeForReasoning() {
  const base = routeRequest();
  return new EmpiricalModelRouter().route(
    routeRequest({
      budget: { ...base.budget, maxModelCalls: 10 },
      risk: "high",
      uncertaintyBps: 7_500,
    }),
    {
      evaluations: [
        routingEvaluation("provider-a", "base", {
          id: "reason-base",
          quality: 8_500,
        }),
        routingEvaluation("provider-b", "strong", {
          id: "reason-strong",
          quality: 9_500,
        }),
      ],
      profiles: [
        routingProfile("provider-a", "base", {
          pricing: { inputPerMillionTokens: 0.5, outputPerMillionTokens: 1 },
        }),
        routingProfile("provider-b", "strong", {
          pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
        }),
      ],
    },
  );
}

test("reasoning plan obeys branch critique repair call and parallel ceilings", () => {
  const route = routeForReasoning();
  assert.ok(route.reasoning.branchCount <= 4);
  assert.ok(route.reasoning.critiquePasses <= 2);
  assert.ok(route.reasoning.repairAttempts <= 2);
  assert.ok(route.reasoning.parallelism <= 3);
  assert.ok(
    route.reasoning.branchCount + route.reasoning.critiquePasses + route.reasoning.repairAttempts <=
      route.reasoning.maxModelCalls,
  );
  assert.equal(
    new Set(route.reasoning.branches.map((branch) => branch.id)).size,
    route.reasoning.branchCount,
  );
});

test("only independent non-contradictory PASS can accept the current result", () => {
  const route = routeForReasoning();
  const controller = new AdaptiveReasoningController();
  const state = {
    critiquePassesUsed: 0,
    escalationIndex: 0,
    modelCallsUsed: route.reasoning.branchCount,
    repairsUsed: 0,
  };
  const accepted = controller.next(route, state, {
    contradictory: false,
    evidenceHash: "d".repeat(64),
    independent: true,
    verdict: "PASS",
  });
  assert.equal(accepted.action, "ACCEPT");

  const selfAuthored = controller.next(route, state, {
    contradictory: false,
    independent: false,
    verdict: "PASS",
  });
  assert.notEqual(selfAuthored.action, "ACCEPT");
  assert.equal(selfAuthored.action, "CRITIQUE");
});

test("verification failure repairs first then escalates and ultimately blocks at the ceilings", () => {
  const route = routeForReasoning();
  const controller = new AdaptiveReasoningController();
  const failed = {
    contradictory: false,
    evidenceHash: "e".repeat(64),
    independent: true,
    verdict: "FAIL" as const,
  };
  const repair = controller.next(
    route,
    {
      critiquePassesUsed: 0,
      escalationIndex: 0,
      modelCallsUsed: route.reasoning.branchCount,
      repairsUsed: 0,
    },
    failed,
  );
  assert.equal(repair.action, "REPAIR");

  const escalate = controller.next(
    route,
    {
      critiquePassesUsed: route.reasoning.critiquePasses,
      escalationIndex: 0,
      modelCallsUsed: route.reasoning.branchCount + route.reasoning.repairAttempts,
      repairsUsed: route.reasoning.repairAttempts,
    },
    failed,
  );
  assert.equal(escalate.action, "ESCALATE");
  assert.equal(escalate.nextEscalationIndex, 0);

  const block = controller.next(
    route,
    {
      critiquePassesUsed: route.reasoning.critiquePasses,
      escalationIndex: route.escalations.length,
      modelCallsUsed: route.reasoning.maxModelCalls,
      repairsUsed: route.reasoning.repairAttempts,
    },
    failed,
  );
  assert.equal(block.action, "BLOCK");
});

test("contradictory evidence never accepts and malformed independent evidence fails closed", () => {
  const route = routeForReasoning();
  const controller = new AdaptiveReasoningController();
  const state = {
    critiquePassesUsed: 0,
    escalationIndex: 0,
    modelCallsUsed: route.reasoning.branchCount,
    repairsUsed: 0,
  };
  const contradiction = controller.next(route, state, {
    contradictory: true,
    evidenceHash: "f".repeat(64),
    independent: true,
    verdict: "PASS",
  });
  assert.notEqual(contradiction.action, "ACCEPT");

  assert.throws(
    () =>
      controller.next(route, state, {
        contradictory: false,
        independent: true,
        verdict: "FAIL",
      }),
    (error: unknown) => error instanceof RoutingError && error.code === "INVALID_INPUT",
  );
});

test("reasoning decisions are deterministic and attempt state cannot exceed route ceilings", () => {
  const route = routeForReasoning();
  const controller = new AdaptiveReasoningController();
  const state = {
    critiquePassesUsed: 0,
    escalationIndex: 0,
    modelCallsUsed: route.reasoning.branchCount,
    repairsUsed: 0,
  };
  const signal = { contradictory: false, independent: false, verdict: "NONE" as const };
  assert.deepEqual(controller.next(route, state, signal), controller.next(route, state, signal));
  assert.throws(
    () =>
      controller.next(
        route,
        { ...state, modelCallsUsed: route.reasoning.maxModelCalls + 1 },
        signal,
      ),
    (error: unknown) => error instanceof RoutingError && error.code === "BUDGET_EXCEEDED",
  );
});
