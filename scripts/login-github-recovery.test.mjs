import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const AUTH_BASE =
  "https://ep-restless-cake-b1d8u9ge.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth";

async function recoveryClient() {
  const html = await readFile("web/login.html", "utf8");
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: "https://odin.example/login?returnTo=%2Fapp%3Fmode%3Dcoding&oauth=error&error=account_not_linked",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const requests = [];
  const { window } = dom;
  window.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === "/api/auth/verify")
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url === "/api/auth/config")
      return new Response(
        JSON.stringify({
          provider: "neon",
          oauth: { github: { available: true, authBase: AUTH_BASE } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (url === `${AUTH_BASE}/sign-in/social`)
      return new Response(
        JSON.stringify({ url: "https://github.com/login/oauth/authorize?client_id=odin-test" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    return new Response(JSON.stringify({ message: "unexpected request" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  };
  window.eval(await readFile("web/login-github-recovery.js", "utf8"));
  return { window, requests, close: () => window.close() };
}

test("recoverable GitHub account-link failure verifies email then restarts OAuth", async () => {
  const client = await recoveryClient();
  try {
    assert.equal(client.window.sessionStorage.getItem("odin.auth.github-recovery"), "1");
    const codeField = client.window.document.getElementById("code-field");
    codeField.hidden = false;
    codeField.style.display = "";
    client.window.document.getElementById("auth-email").value = "person@example.com";
    client.window.document.getElementById("auth-code").value = "123456";

    client.window.document
      .getElementById("auth-form")
      .dispatchEvent(new client.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const verify = client.requests.find((request) => request.url === "/api/auth/verify");
    assert.ok(verify);
    assert.deepEqual(JSON.parse(verify.options.body), {
      email: "person@example.com",
      otp: "123456",
    });
    assert.ok(client.requests.find((request) => request.url === "/api/auth/config"));
    const social = client.requests.find(
      (request) => request.url === `${AUTH_BASE}/sign-in/social`,
    );
    assert.ok(social);
    assert.deepEqual(JSON.parse(social.options.body), {
      provider: "github",
      callbackURL: "https://odin.example/login?returnTo=%2Fapp%3Fmode%3Dcoding",
      errorCallbackURL:
        "https://odin.example/login?returnTo=%2Fapp%3Fmode%3Dcoding&oauth=error",
      disableRedirect: true,
    });
    assert.equal(client.window.sessionStorage.getItem("odin.auth.github-recovery"), null);
  } finally {
    client.close();
  }
});

test("GitHub recovery accepts only the configured Neon auth host and GitHub authorize target", async () => {
  const source = await readFile("web/login-github-recovery.js", "utf8");
  assert.match(source, /hostname\.endsWith\("\.neon\.tech"\)/u);
  assert.match(source, /target\.hostname === "github\.com"/u);
  assert.match(source, /target\.pathname === "\/login\/oauth\/authorize"/u);
  assert.match(source, /account_not_linked/u);
  assert.match(source, /email_not_verified/u);
  assert.doesNotMatch(source, /client_secret|accessToken|refreshToken/u);
});
