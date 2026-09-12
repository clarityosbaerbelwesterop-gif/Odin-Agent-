import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  CredentialVault,
  effectivePlan,
  MODE_MINIMUM_PLAN,
  ODIN_STRIPE_PRICES,
  PLAN_RANK,
  planAllows,
  preStripeTestMode,
  provider,
  runtimePlan,
  stripePricePlan,
  subscriptionPriceId,
  verifyStripeSignature,
} from "../../src/chat/product.js";

test("S-U plans rank all four tiers and modes fail closed at their minimum plan", () => {
  assert.deepEqual(PLAN_RANK, { free: 0, pro: 1, developer: 2, ultra: 3 });
  assert.deepEqual(MODE_MINIMUM_PLAN, {
    chat: "free",
    thinking: "pro",
    research: "pro",
    coding: "developer",
    ultra: "ultra",
  });
  assert.equal(planAllows("pro", "developer"), false);
  assert.equal(planAllows("developer", "ultra"), false);
  assert.equal(planAllows("developer", "developer"), true);
});

test("S-U effective paid entitlement requires an approved Stripe status", () => {
  for (const status of ["active", "trialing"])
    assert.equal(effectivePlan({ plan: "developer", subscriptionStatus: status }), "developer");
  for (const status of [
    "canceled",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
    "incomplete_expired",
    "unknown",
  ])
    assert.equal(effectivePlan({ plan: "ultra", subscriptionStatus: status }), "free");
});

test("pre-Stripe test mode exposes the complete product only until billing is configured", () => {
  const freeAccount = { plan: "free" as const, subscriptionStatus: "unknown" };
  assert.equal(preStripeTestMode({}), true);
  assert.equal(runtimePlan(freeAccount, {}), "ultra");

  const stripeConfigured = { STRIPE_SECRET_KEY: "sk_test_fixture" } as NodeJS.ProcessEnv;
  assert.equal(preStripeTestMode(stripeConfigured), false);
  assert.equal(runtimePlan(freeAccount, stripeConfigured), "free");

  const explicitTestLane = {
    STRIPE_SECRET_KEY: "sk_test_fixture",
    ODIN_PRESTRIPE_TEST_MODE: "true",
  } as NodeJS.ProcessEnv;
  assert.equal(preStripeTestMode(explicitTestLane), true);
  assert.equal(runtimePlan(freeAccount, explicitTestLane), "ultra");
});

test("S-U Stripe mapping accepts only exact configured Odin prices", () => {
  const env = {
    STRIPE_PRO_PRICE_ID: ODIN_STRIPE_PRICES.pro,
    STRIPE_DEVELOPER_PRICE_ID: ODIN_STRIPE_PRICES.developer,
    STRIPE_ULTRA_PRICE_ID: ODIN_STRIPE_PRICES.ultra,
  } as NodeJS.ProcessEnv;
  assert.equal(stripePricePlan(ODIN_STRIPE_PRICES.pro, env), "pro");
  assert.equal(stripePricePlan(ODIN_STRIPE_PRICES.developer, env), "developer");
  assert.equal(stripePricePlan(ODIN_STRIPE_PRICES.ultra, env), "ultra");
  assert.equal(stripePricePlan("price_from_another_product", env), "free");
  assert.equal(
    subscriptionPriceId({ items: { data: [{ price: { id: ODIN_STRIPE_PRICES.developer } }] } }),
    ODIN_STRIPE_PRICES.developer,
  );
  assert.equal(subscriptionPriceId({ items: { data: [] } }), undefined);
  assert.equal(
    subscriptionPriceId({ items: { data: [{ price: { id: "one" } }, { price: { id: "two" } }] } }),
    undefined,
  );
});

test("P-R credential vault encrypts authenticated data and exposes only a safe fingerprint", () => {
  const vault = new CredentialVault(Buffer.alloc(32, 7).toString("base64url"));
  const key = "provider-test-key-that-must-not-leak";
  const stored = vault.seal(key);
  assert.equal(stored.ciphertext.includes(key), false);
  assert.match(stored.fingerprint, /^[a-f0-9]{8}$/u);
  assert.equal(vault.open(stored.ciphertext), key);
  const changed = `${stored.ciphertext.startsWith("A") ? "B" : "A"}${stored.ciphertext.slice(1)}`;
  assert.throws(() => vault.open(changed), /could not be decrypted/u);
});

test("P-R provider identifiers are allowlisted", () => {
  assert.equal(provider("google"), "google");
  assert.throws(() => provider("attacker"), /Unsupported provider/u);
});

test("P-R Stripe webhook verification rejects tampering and stale delivery", () => {
  const body = Buffer.from('{"id":"evt_1"}');
  const timestamp = 2_000_000_000;
  const secret = "whsec_test_only";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest("hex");
  assert.doesNotThrow(() =>
    verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, timestamp),
  );
  assert.throws(
    () =>
      verifyStripeSignature(
        Buffer.from("tampered"),
        `t=${timestamp},v1=${signature}`,
        secret,
        timestamp,
      ),
    /Invalid Stripe signature/u,
  );
  assert.throws(
    () => verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, timestamp + 301),
    /stale/u,
  );
});
