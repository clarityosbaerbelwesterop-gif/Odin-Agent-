import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

async function loginClient({
  config = { provider: "neon", oauth: { github: { available: false } } },
} = {}) {
  const html = await readFile("web/login.html", "utf8");
  const dom = new JSDOM(html, {
    url: "https://odin.example/login?returnTo=%2Fapp%3Fmode%3Dcoding",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const requests = [];
  const window = dom.window;
  window.fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/api/config")
      return new Response(JSON.stringify({ message: "Sign in to access Odin." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    if (path === "/api/auth/config")
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  window.eval(await readFile("web/login.js", "utf8"));
  await new Promise((resolve) => setImmediate(resolve));
  return {
    window,
    requests,
    get: (id) => window.document.getElementById(id),
    close: () => window.close(),
  };
}

test("dedicated login renders GitHub first without pretending an unavailable provider works", async () => {
  const client = await loginClient();
  try {
    assert.match(client.get("github-signin").textContent, /Continue with GitHub/u);
    assert.match(client.get("github-note").textContent, /noch nicht freigeschaltet/u);
    client.get("github-signin").click();
    assert.match(client.get("auth-status").textContent, /OAuth-Konfiguration/u);
    assert.equal(client.requests.filter((item) => item.path === "/api/auth/github").length, 0);
  } finally {
    client.close();
  }
});

test("registration, verification and password recovery are explicit states", async () => {
  const client = await loginClient();
  try {
    client.get("switch-mode").click();
    assert.equal(client.get("login-title").textContent, "Odin Account erstellen");
    assert.equal(client.get("name-field").hidden, false);
    assert.equal(client.get("auth-password").minLength, 14);

    client.get("switch-mode").click();
    client.get("forgot-password").click();
    assert.equal(client.get("login-title").textContent, "Zugang wiederherstellen");
    assert.equal(client.get("password-field").hidden, true);
  } finally {
    client.close();
  }
});

test("email login calls the existing same-origin Neon broker", async () => {
  const client = await loginClient();
  try {
    client.get("auth-email").value = "person@example.com";
    client.get("auth-password").value = "correct-password";
    client
      .get("auth-form")
      .dispatchEvent(new client.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    const request = client.requests.find((item) => item.path === "/api/auth/login");
    assert.ok(request);
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(request.options.body), {
      email: "person@example.com",
      password: "correct-password",
    });
  } finally {
    client.close();
  }
});

test("login surface contains no demo or placeholder copy", async () => {
  const html = await readFile("web/login.html", "utf8");
  assert.doesNotMatch(html, /\b(?:demo|placeholder|coming soon|not implemented)\b/iu);
  assert.match(html, /id="github-signin"/u);
  assert.match(html, /id="auth-form"/u);
});
