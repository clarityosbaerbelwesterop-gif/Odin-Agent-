import assert from "node:assert/strict";
import test from "node:test";
import { resolveNeonAuthUrl } from "../../src/chat/deployment.js";

const productionDatabase =
  "postgresql://user:secret@ep-restless-cake-b1d8u9ge-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const productionAuth =
  "https://ep-restless-cake-b1d8u9ge.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth";

test("explicit Neon Auth URL takes precedence", () => {
  assert.equal(
    resolveNeonAuthUrl(productionDatabase, {
      VERCEL_ENV: "production",
      NEON_AUTH_BASE_URL: "https://auth.example.test/neondb/auth",
    }),
    "https://auth.example.test/neondb/auth",
  );
});

test("known production database resolves to its verified public Neon Auth endpoint", () => {
  assert.equal(
    resolveNeonAuthUrl(productionDatabase, { VERCEL_ENV: "production" }),
    productionAuth,
  );
});

test("known production database also resolves from an unpooled host", () => {
  assert.equal(
    resolveNeonAuthUrl(
      "postgresql://user:secret@ep-restless-cake-b1d8u9ge.c-5.eu-central-1.aws.neon.tech/neondb",
      { VERCEL_ENV: "production" },
    ),
    productionAuth,
  );
});

test("unknown production databases remain fail-closed", () => {
  assert.equal(
    resolveNeonAuthUrl(
      "postgresql://user:secret@ep-unknown.c-5.eu-central-1.aws.neon.tech/neondb",
      { VERCEL_ENV: "production" },
    ),
    undefined,
  );
});

test("known mapping is not used outside Vercel preview or production", () => {
  assert.equal(resolveNeonAuthUrl(productionDatabase, { VERCEL_ENV: "development" }), undefined);
});

test("malformed or non-PostgreSQL connection strings remain fail-closed", () => {
  assert.equal(resolveNeonAuthUrl("not a url", { VERCEL_ENV: "production" }), undefined);
  assert.equal(
    resolveNeonAuthUrl("https://ep-restless-cake-b1d8u9ge.c-5.eu-central-1.aws.neon.tech/neondb", {
      VERCEL_ENV: "production",
    }),
    undefined,
  );
});
