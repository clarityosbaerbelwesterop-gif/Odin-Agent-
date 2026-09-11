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
    assert.match(client.get("github-note").textContent, /nicht verfügbar/u);
    client.get("github-signin").click();
    assert.match(client.get("auth-status").textContent, /nicht verfügbar/u);
    assert.equal(client.requests.filter((item) => item.path === "/api/auth/github").length, 0);
  } finally {
    client.close();
  }
});

test("login hides registration and verification-only fields", async () => {
  const client = await loginClient();
  try {
    assert.equal(client.get("name-field").hidden, true);
    assert.equal(client.get("name-field").style.display, "none");
    assert.equal(client.get("code-field").hidden, true);
    assert.equal(client.get("code-field").style.display, "none");
    assert.equal(client.get("password-field").hidden, false);
    assert.equal(client.get("password-field").style.display, "");
  } finally {
    client.close();
  }
});

test("registration sends a verification code automatically and enters verification state", async () => {
  const client = await loginClient();
  try {
    client.get("switch-mode").click();
    assert.equal(client.get("login-title").textContent, "Odin Account erstellen");
    assert.equal(client.get("name-field").hidden, false);
    assert.equal(client.get("name-field").style.display, "");
    assert.equal(client.get("code-field").style.display, "none");
    assert.equal(client.get("auth-password").minLength, 14);

    client.get("auth-email").value = "person@example.com";
    client.get("auth-name").value = "Person";
    client.get("auth-password").value = "correct-password";
    client
      .get("auth-form")
      .dispatchEvent(new client.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(client.requests.find((item) => item.path === "/api/auth/signup"));
    assert.ok(client.requests.find((item) => item.path === "/api/auth/logout"));
    assert.ok(client.requests.find((item) => item.path === "/api/auth/sendCode"));
    assert.equal(client.get("login-title").textContent, "Konto verifizieren");
    assert.equal(client.get("code-field").hidden, false);
    assert.equal(client.get("code-field").style.display, "");
    assert.equal(client.get("password-field").style.display, "none");
    assert.match(
      client.get("auth-status").textContent,
      /Bestätigungscode wurde per E-Mail gesendet/u,
    );
  } finally {
    client.close();
  }
});

test("password recovery is an explicit state", async () => {
  const client = await loginClient();
  try {
    client.get("forgot-password").click();
    assert.equal(client.get("login-title").textContent, "Zugang wiederherstellen");
    assert.equal(client.get("password-field").hidden, true);
    assert.equal(client.get("password-field").style.display, "none");
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

test("GitHub identity path accepts the GitHub authorize redirect and finalizes a signed Neon JWT", async () => {
  const source = await readFile("web/login.js", "utf8");
  assert.match(source, /\/sign-in\/social/u);
  assert.match(source, /target\.hostname === "github\.com"/u);
  assert.match(source, /target\.pathname === "\/login\/oauth\/authorize"/u);
  assert.match(source, /disableRedirect: true/u);
  assert.match(source, /EMAIL_UNVERIFIED/u);
  assert.match(source, /\/api\/auth\/logout/u);
  assert.match(source, /neon_auth_session_verifier/u);
  assert.match(source, /neonAuth\("\/token"/u);
  assert.match(source, /\/api\/auth\/github\/finalize/u);
  assert.doesNotMatch(source, /data\?\.session\?\.token/u);
  const chatSource = await readFile("web/chat.js", "utf8");
  assert.match(chatSource, /\/login\?signedOut=1/u);
});

test("login surface contains no demo or placeholder copy", async () => {
  const html = await readFile("web/login.html", "utf8");
  assert.doesNotMatch(html, /\b(?:demo|placeholder|coming soon|not implemented)\b/iu);
  assert.match(html, /id="github-signin"/u);
  assert.match(html, /id="auth-form"/u);
});

test("hosted UI routes unverified sessions back through the real login surface", async () => {
  const chatSource = await readFile("web/chat.js", "utf8");
  const botSource = await readFile("web/bot.js", "utf8");
  assert.match(chatSource, /EMAIL_UNVERIFIED/u);
  assert.match(chatSource, /searchParams\.set\("returnTo", returnTo\)/u);
  assert.match(botSource, /EMAIL_UNVERIFIED/u);
  assert.match(botSource, /searchParams\.set\("returnTo", "\/bot"\)/u);
});

test("login CSP permits only the configured Neon Auth origin for OAuth transport", async () => {
  const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
  const rule = vercel.headers.find((item) => item.source === "/login");
  const csp = rule.headers.find((item) => item.key === "Content-Security-Policy").value;
  assert.match(
    csp,
    /https:\/\/ep-restless-cake-b1d8u9ge\.neonauth\.c-5\.eu-central-1\.aws\.neon\.tech/u,
  );
});
