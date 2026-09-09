import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { CredentialVault, provider, verifyStripeSignature } from "../../src/chat/product.js";

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
