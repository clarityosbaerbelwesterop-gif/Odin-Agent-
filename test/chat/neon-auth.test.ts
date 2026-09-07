import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { NeonAuth } from "../../src/chat/neon-auth.js";

const base = "https://ep-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth";
const origin = new URL(base).origin;
const pair = await generateKeyPair("EdDSA");
const jwk = await exportJWK(pair.publicKey);
jwk.kid = "fixture-key";
const keys = createLocalJWKSet({ keys: [jwk] });
const now = Math.floor(Date.now() / 1000);
async function token(claims: Record<string, unknown> = {}, differentKey = false) {
  return new SignJWT({
    sub: "user-a",
    email: "a@example.invalid",
    emailVerified: true,
    role: "authenticated",
    iat: now,
    exp: now + 900,
    iss: origin,
    aud: origin,
    ...claims,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "fixture-key" })
    .sign(differentKey ? (await generateKeyPair("EdDSA")).privateKey : pair.privateKey);
}

test("Neon JWT verification binds signature, algorithm, issuer, audience, lifetime and user role", async () => {
  const auth = new NeonAuth(base, fetch, keys);
  assert.equal((await auth.verifyToken(await token())).id, "user-a");
  for (const claims of [
    { iss: "https://another-branch.neon.tech" },
    { aud: "https://another-app.test" },
    { exp: now - 60 },
    { iat: now - 3600, exp: now + 900 },
    { role: "anonymous" },
    { role: "admin" },
    { banned: true },
    { sub: "" },
  ])
    await assert.rejects(auth.verifyToken(await token(claims)), /Sign in/u);
  await assert.rejects(auth.verifyToken(await token({}, true)), /Sign in/u);
  await assert.rejects(auth.verifyToken("eyJhbGciOiJub25lIn0.e30."), /Sign in/u);
  await assert.rejects(auth.verifyToken("x".repeat(16001)), /Sign in/u);
  assert.throws(() => new NeonAuth("https://evil.example/auth"), /Configure/u);
});
test("Neon sessions require current server session, verified email and matching signed user identity", async () => {
  const jwt = await token();
  let state: "active" | "revoked" | "different" | "expired" = "active";
  const requests: RequestInit[] = [];
  const transport: typeof fetch = async (_url, init) => {
    requests.push(init ?? {});
    return new Response(
      JSON.stringify(
        state === "revoked"
          ? null
          : {
              user: { id: state === "different" ? "user-b" : "user-a" },
              session: {
                userId: state === "different" ? "user-b" : "user-a",
                expiresAt:
                  state === "expired" ? "invalid" : new Date(Date.now() + 60000).toISOString(),
              },
            },
      ),
      { headers: { "set-auth-jwt": jwt } },
    );
  };
  const auth = new NeonAuth(base, transport, keys);
  assert.equal(
    (
      await auth.session(
        "__Secure-neonauth.session_token=fixture; unrelated=private",
        "https://odin.example",
      )
    ).id,
    "user-a",
  );
  assert.equal(
    (requests[0]?.headers as Record<string, string> | undefined)?.Cookie,
    "__Secure-neonauth.session_token=fixture",
  );
  for (const value of ["revoked", "different", "expired"] as const) {
    state = value;
    await assert.rejects(
      auth.session("__Secure-neonauth.session_token=fixture", "https://odin.example"),
    );
  }
  await assert.rejects(auth.session("unrelated=private", "https://odin.example"));
  const unverified = await token({ emailVerified: false });
  const verifyRequired = new NeonAuth(
    base,
    async () =>
      new Response(
        JSON.stringify({
          user: { id: "user-a" },
          session: { userId: "user-a", expiresAt: new Date(Date.now() + 60000).toISOString() },
        }),
        { headers: { "set-auth-jwt": unverified } },
      ),
    keys,
  );
  await assert.rejects(
    verifyRequired.session("__Secure-neonauth.session_token=fixture", "https://odin.example"),
    /Verify your email/u,
  );
});
test("Auth broker forwards only session cookies and never follows arbitrary upstream routes", async () => {
  const auth = new NeonAuth(base, fetch, keys);
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "__Secure-neonauth.session_token=fixture; Domain=.neon.tech; Path=/auth; Max-Age=999999999",
  );
  headers.append("set-cookie", "unrelated=secret; Path=/");
  const cookies = auth.cookies(new Response("{}", { headers }));
  assert.deepEqual(cookies, [
    "__Secure-neonauth.session_token=fixture; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800",
  ]);
  await assert.rejects(
    auth.upstream("../admin/delete-user", "POST", "https://odin.example"),
    /Unsupported/u,
  );
});
