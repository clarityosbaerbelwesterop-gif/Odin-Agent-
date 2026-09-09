import assert from "node:assert/strict";
import test from "node:test";
import {
  effectivePlan,
  hasPlan,
  MODE_MIN_PLAN,
  PLAN_RANK,
  requiredPlanFor,
  type Plan,
  type ProductAccount,
} from "../../src/chat/product.js";

function account(plan: Plan, subscriptionStatus = plan === "free" ? "free" : "active"): ProductAccount {
  return { plan, subscriptionStatus, cancelAtPeriodEnd: false, defaultModel: null };
}

test("S plan rank is strictly free < pro < developer < ultra", () => {
  assert.deepEqual(PLAN_RANK, { free: 0, pro: 1, developer: 2, ultra: 3 });
});

test("S mode minimum plans match the product contract", () => {
  assert.deepEqual(MODE_MIN_PLAN, {
    chat: "free",
    thinking: "pro",
    research: "pro",
    coding: "developer",
    ultra: "ultra",
  });
});

test("S mode and model requirements compose using the stricter plan", () => {
  assert.equal(requiredPlanFor("chat", "developer"), "developer");
  assert.equal(requiredPlanFor("thinking", "free"), "pro");
  assert.equal(requiredPlanFor("coding", "pro"), "developer");
  assert.equal(requiredPlanFor("coding", "ultra"), "ultra");
  assert.equal(requiredPlanFor("ultra", "free"), "ultra");
});

test("S inactive paid subscription statuses fail closed to Free", () => {
  for (const status of ["canceled", "past_due", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
    const value = account("ultra", status);
    assert.equal(effectivePlan(value), "free", status);
    assert.equal(hasPlan(value, "pro"), false, status);
  }
});

test("S active and trialing paid subscriptions preserve their tier", () => {
  assert.equal(effectivePlan(account("pro", "active")), "pro");
  assert.equal(effectivePlan(account("developer", "trialing")), "developer");
  assert.equal(effectivePlan(account("ultra", "active")), "ultra");
  assert.equal(hasPlan(account("developer", "active"), "developer"), true);
  assert.equal(hasPlan(account("developer", "active"), "ultra"), false);
});
