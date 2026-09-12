import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("login page loads bounded GitHub OAuth recovery", async () => {
  const [html, recovery] = await Promise.all([
    readFile("web/login.html", "utf8"),
    readFile("web/login-github-recovery.js", "utf8"),
  ]);
  assert.match(html, /login-github-recovery\.js/u);
  assert.match(recovery, /STATE_RETRY_KEY/u);
  assert.match(recovery, /code === "state_mismatch"/u);
  assert.match(recovery, /stateRetryUsed\(\)/u);
  assert.match(recovery, /setStateRetryUsed\(true\)/u);
  assert.match(recovery, /account_not_linked/u);
  assert.match(recovery, /hostname\.endsWith\("\.neon\.tech"\)/u);
  assert.match(recovery, /target\.hostname === "github\.com"/u);
});
