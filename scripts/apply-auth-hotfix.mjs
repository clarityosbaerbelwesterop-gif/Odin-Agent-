import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${path}: expected patch anchor was not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${path}: patch anchor is ambiguous`);
  await writeFile(path, source.replace(before, after), "utf8");
}

await replaceOnce(
  "web/login.js",
  `async function restoreSession() {\n  try {\n    await request("/api/config");\n    window.location.replace(safeReturnTo());\n    return true;\n  } catch (error) {\n    if (error.status !== 401 && error.status !== 403) status(error.message, "error");\n    return false;\n  }\n}`,
  `async function clearIncompleteSession() {\n  try {\n    await request("/api/auth/logout", {});\n  } catch {\n    // A stale incomplete session must never prevent the login surface from recovering.\n  }\n}\n\nasync function restoreSession() {\n  try {\n    await request("/api/config");\n    window.location.replace(safeReturnTo());\n    return true;\n  } catch (error) {\n    if (error.code === "EMAIL_UNVERIFIED") {\n      await clearIncompleteSession();\n      applyMode("verify");\n      status("Deine E-Mail ist noch nicht bestätigt. Fordere einen neuen Code an.", "error");\n    } else if (error.status !== 401) {\n      status(error.message, "error");\n    }\n    return false;\n  }\n}`,
);

await replaceOnce(
  "web/login.js",
  `    if (!explicitSignOut && (await restoreGitHubSession(params.has(VERIFIER_PARAM)))) return;`,
  `    if (\n      !explicitSignOut &&\n      params.has(VERIFIER_PARAM) &&\n      (await restoreGitHubSession(true))\n    )\n      return;`,
);

await replaceOnce(
  "web/login.js",
  `        errorCallbackURL: errorCallback.href,\n      }),`,
  `        errorCallbackURL: errorCallback.href,\n        disableRedirect: true,\n      }),`,
);

await replaceOnce(
  "web/login.js",
  `    if (mode === "signup") {\n      $("auth-password").value = "";\n      applyMode("verify");\n      try {\n        await request("/api/auth/sendCode", { email });`,
  `    if (mode === "signup") {\n      $("auth-password").value = "";\n      await clearIncompleteSession();\n      applyMode("verify");\n      try {\n        await request("/api/auth/sendCode", { email });`,
);

await replaceOnce(
  "web/chat.js",
  `    const error = new Error(data.message ?? "Request failed");\n    error.status = response.status;\n    if (response.status === 401) {\n      resetSession();\n      if (authProvider === "local") {\n        if (!$("login").open) $("login").showModal();\n      } else {\n        const returnTo = \`${"${window.location.pathname}${window.location.search}"}\`;\n        window.location.assign(\`/login?returnTo=${"${encodeURIComponent(returnTo)}"}\`);\n      }\n    }\n    throw error;`,
  `    const error = new Error(data.message ?? "Request failed");\n    error.status = response.status;\n    error.code = data.code;\n    const authenticationRequired =\n      response.status === 401 ||\n      (response.status === 403 && data.code === "EMAIL_UNVERIFIED");\n    if (authenticationRequired) {\n      resetSession();\n      if (authProvider === "local") {\n        if (!$("login").open) $("login").showModal();\n      } else {\n        const returnTo = \`${"${window.location.pathname}${window.location.search}"}\`;\n        const login = new URL("/login", window.location.origin);\n        login.searchParams.set("returnTo", returnTo);\n        if (data.code === "EMAIL_UNVERIFIED") login.searchParams.set("verify", "1");\n        window.location.assign(\`${"${login.pathname}${login.search}"}\`);\n      }\n    }\n    throw error;`,
);

await replaceOnce(
  "web/chat.js",
  `  .catch((error) => {\n    $("connection").textContent =\n      error.status === 401 ? "Sign in required" : "Connection unavailable";\n    updateControls();\n    if (error.status !== 401) errorBanner(error);\n  });`,
  `  .catch((error) => {\n    const authenticationRequired =\n      error.status === 401 || error.code === "EMAIL_UNVERIFIED";\n    $("connection").textContent = authenticationRequired\n      ? "Sign in required"\n      : "Connection unavailable";\n    updateControls();\n    if (!authenticationRequired) errorBanner(error);\n  });`,
);

await replaceOnce(
  "web/bot.js",
  `  if (response.status === 401) {\n    location.assign(\`/login?next=${"${encodeURIComponent(\"/bot\")}"}\`);\n    throw new Error("Authentication required");\n  }\n  if (!response.ok) throw new Error(data.message ?? "Odin Bot request failed.");`,
  `  const authenticationRequired =\n    response.status === 401 ||\n    (response.status === 403 && data.code === "EMAIL_UNVERIFIED");\n  if (authenticationRequired) {\n    const login = new URL("/login", location.origin);\n    login.searchParams.set("returnTo", "/bot");\n    if (data.code === "EMAIL_UNVERIFIED") login.searchParams.set("verify", "1");\n    location.assign(\`${"${login.pathname}${login.search}"}\`);\n    const error = new Error("Authentication required");\n    error.code = data.code;\n    throw error;\n  }\n  if (!response.ok) throw new Error(data.message ?? "Odin Bot request failed.");`,
);

const vercelPath = "vercel.json";
const vercel = JSON.parse(await readFile(vercelPath, "utf8"));
const authOrigin = "https://ep-restless-cake-b1d8u9ge.neonauth.c-5.eu-central-1.aws.neon.tech";
for (const rule of vercel.headers ?? []) {
  if (!["/login", "/(.*).html"].includes(rule.source)) continue;
  const csp = (rule.headers ?? []).find((header) => header.key === "Content-Security-Policy");
  assert.ok(csp, `${rule.source}: CSP header missing`);
  if (!csp.value.includes(authOrigin)) {
    csp.value = csp.value.replace("connect-src 'self'", `connect-src 'self' ${authOrigin}`);
  }
}
await writeFile(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`, "utf8");

await replaceOnce(
  "scripts/login.test.mjs",
  `    assert.ok(client.requests.find((item) => item.path === "/api/auth/signup"));\n    assert.ok(client.requests.find((item) => item.path === "/api/auth/sendCode"));`,
  `    assert.ok(client.requests.find((item) => item.path === "/api/auth/signup"));\n    assert.ok(client.requests.find((item) => item.path === "/api/auth/logout"));\n    assert.ok(client.requests.find((item) => item.path === "/api/auth/sendCode"));`,
);

await replaceOnce(
  "scripts/login.test.mjs",
  `  assert.match(source, /target\\.pathname === "\\/login\\/oauth\\/authorize"/u);`,
  `  assert.match(source, /target\\.pathname === "\\/login\\/oauth\\/authorize"/u);\n  assert.match(source, /disableRedirect: true/u);\n  assert.match(source, /EMAIL_UNVERIFIED/u);\n  assert.match(source, /\\/api\\/auth\\/logout/u);`,
);

const loginTestPath = "scripts/login.test.mjs";
let loginTests = await readFile(loginTestPath, "utf8");
loginTests += `\n\ntest("hosted UI routes unverified sessions back through the real login surface", async () => {\n  const chatSource = await readFile("web/chat.js", "utf8");\n  const botSource = await readFile("web/bot.js", "utf8");\n  assert.match(chatSource, /EMAIL_UNVERIFIED/u);\n  assert.match(chatSource, /searchParams\\.set\\("returnTo", returnTo\\)/u);\n  assert.match(botSource, /EMAIL_UNVERIFIED/u);\n  assert.match(botSource, /searchParams\\.set\\("returnTo", "\\/bot"\\)/u);\n});\n\ntest("login CSP permits only the configured Neon Auth origin for OAuth transport", async () => {\n  const vercel = JSON.parse(await readFile("vercel.json", "utf8"));\n  const rule = vercel.headers.find((item) => item.source === "/login");\n  const csp = rule.headers.find((item) => item.key === "Content-Security-Policy").value;\n  assert.match(csp, /https:\\/\\/ep-restless-cake-b1d8u9ge\\.neonauth\\.c-5\\.eu-central-1\\.aws\\.neon\\.tech/u);\n});\n`;
await writeFile(loginTestPath, loginTests, "utf8");

console.log("Auth hotfix applied.");
