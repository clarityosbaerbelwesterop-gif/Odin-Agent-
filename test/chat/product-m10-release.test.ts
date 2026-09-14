import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ODIN_STRIPE_PRICES } from "../../src/chat/product.js";
import { productReleaseReadiness } from "../../src/chat/release-readiness.js";

function readyEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    ODIN_PUBLIC_ORIGIN: "https://odin.example/",
    ODIN_DATABASE_URL: "postgresql://fixture.invalid/odin",
    NEON_AUTH_BASE_URL: "https://auth.example.neon.tech",
    ODIN_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64url"),
    STRIPE_SECRET_KEY: "sk_live_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_PRO_PRICE_ID: ODIN_STRIPE_PRICES.pro,
    STRIPE_DEVELOPER_PRICE_ID: ODIN_STRIPE_PRICES.developer,
    STRIPE_ULTRA_PRICE_ID: ODIN_STRIPE_PRICES.ultra,
    GITHUB_REPO_OAUTH_CLIENT_ID: "fixture-client",
    GITHUB_REPO_OAUTH_CLIENT_SECRET: "fixture-secret",
  };
}

test("PRODUCT M10 release readiness is a bounded secret-free projection", () => {
  const readiness = productReleaseReadiness(readyEnvironment(), 3);
  assert.equal(readiness.environment, "production");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.checks.length, 9);
  assert.ok(readiness.checks.every((check) => check.status === "ready"));
  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /sk_live_fixture|whsec_fixture|fixture-secret/u);
});

test("PRODUCT M10 production readiness blocks on each missing release dependency", () => {
  const baseline = readyEnvironment();
  const cases = [
    ["ODIN_PUBLIC_ORIGIN", "public-origin"],
    ["ODIN_DATABASE_URL", "database"],
    ["NEON_AUTH_BASE_URL", "auth"],
    ["ODIN_CREDENTIAL_ENCRYPTION_KEY", "credential-vault"],
    ["STRIPE_SECRET_KEY", "billing-secret"],
    ["STRIPE_WEBHOOK_SECRET", "billing-webhook"],
    ["STRIPE_PRO_PRICE_ID", "billing-prices"],
    ["GITHUB_REPO_OAUTH_CLIENT_ID", "github-repository-oauth"],
  ] as const;

  for (const [key, checkId] of cases) {
    const env = { ...baseline };
    delete env[key];
    const readiness = productReleaseReadiness(env, 3);
    assert.equal(readiness.ready, false, key);
    assert.equal(
      readiness.checks.find((check) => check.id === checkId)?.status,
      "blocked",
      key,
    );
  }

  const noModels = productReleaseReadiness(baseline, 0);
  assert.equal(noModels.ready, false);
  assert.equal(noModels.checks.find((check) => check.id === "models")?.status, "blocked");
});

test("PRODUCT M10 release projection rejects malformed public origin, vault key and substituted prices", () => {
  const env = readyEnvironment();
  env.ODIN_PUBLIC_ORIGIN = "http://odin.example/?token=x";
  env.ODIN_CREDENTIAL_ENCRYPTION_KEY = "short";
  env.STRIPE_ULTRA_PRICE_ID = "price_other_product";
  const readiness = productReleaseReadiness(env, 1);

  assert.equal(readiness.ready, false);
  for (const id of ["public-origin", "credential-vault", "billing-prices"])
    assert.equal(readiness.checks.find((check) => check.id === id)?.status, "blocked");
});

test("PRODUCT M10 PWA caches only public shell assets and never authenticated/API state", async () => {
  const [manifest, worker] = await Promise.all([
    readFile("web/manifest.webmanifest", "utf8"),
    readFile("web/service-worker.js", "utf8"),
  ]);
  const parsed = JSON.parse(manifest) as { start_url?: string; scope?: string; display?: string };
  assert.equal(parsed.start_url, "/");
  assert.equal(parsed.scope, "/");
  assert.equal(parsed.display, "standalone");
  assert.match(worker, /PUBLIC_SHELL/u);
  assert.match(worker, /request\.method !== "GET"/u);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/u);
  assert.match(worker, /url\.pathname\.startsWith\("\/login"\)/u);
  assert.match(worker, /url\.pathname\.startsWith\("\/app"\)/u);
  assert.doesNotMatch(worker, /localStorage|sessionStorage|indexedDB/u);
});

test("PRODUCT M10 deployment emits transport hardening and a PWA manifest route", async () => {
  const [vercel, landing] = await Promise.all([
    readFile("vercel.json", "utf8"),
    readFile("web/landing.html", "utf8"),
  ]);
  assert.match(vercel, /Strict-Transport-Security/u);
  assert.match(vercel, /X-DNS-Prefetch-Control/u);
  assert.match(vercel, /Cross-Origin-Opener-Policy/u);
  assert.match(landing, /rel="manifest" href="\/manifest\.webmanifest"/u);
  assert.match(landing, /src="\/pwa\.js"/u);
});
