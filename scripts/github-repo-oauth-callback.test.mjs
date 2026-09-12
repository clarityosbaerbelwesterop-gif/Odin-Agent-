import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("repository OAuth callback preserves session across GitHub top-level navigation", async () => {
  const auth = await readFile("src/chat/neon-auth.ts", "utf8");
  const bridge = await readFile("api/github-callback.mjs", "utf8");
  const config = JSON.parse(await readFile("vercel.json", "utf8"));

  assert.match(auth, /SameSite=Lax/u);
  assert.doesNotMatch(auth, /SameSite=Strict/u);
  assert.match(bridge, /\(req\.method \?\? "GET"\) !== "GET"/u);
  assert.match(bridge, /delete req\.headers\["sec-fetch-site"\]/u);
  assert.match(bridge, /delete req\.headers\.origin/u);
  assert.match(bridge, /searchParams\.set\("odin_path", "github\/callback"\)/u);

  const callbackIndex = config.rewrites.findIndex((item) => item.source === "/api/github/callback");
  const catchAllIndex = config.rewrites.findIndex((item) => item.source === "/api/:path*");
  assert(callbackIndex >= 0, "dedicated GitHub callback rewrite is required");
  assert(catchAllIndex >= 0 && callbackIndex < catchAllIndex, "callback rewrite must precede catch-all API routing");
  assert.equal(config.rewrites[callbackIndex].destination, "/api/github-callback");
  assert.equal(config.functions["api/github-callback.mjs"].maxDuration, 60);
});
