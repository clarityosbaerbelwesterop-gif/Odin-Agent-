const authBase = process.env.NEON_AUTH_URL ?? process.env.NEON_AUTH_BASE_URL;
if (!authBase) throw new Error("Missing Neon Auth URL mapping.");

const base = new URL(authBase.replace(/\/$/u, ""));
if (base.protocol !== "https:" || !base.hostname.endsWith(".neon.tech"))
  throw new Error("Refusing non-Neon Auth endpoint.");

const response = await fetch(`${base.href}/sign-in/social`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://odin-agent-xi.vercel.app",
  },
  body: JSON.stringify({
    provider: "github",
    callbackURL: "https://odin-agent-xi.vercel.app/app",
    errorCallbackURL: "https://odin-agent-xi.vercel.app/login?oauth=error",
    disableRedirect: true,
  }),
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
});

const raw = await response.text();
let body = {};
try {
  body = raw ? JSON.parse(raw) : {};
} catch {
  body = {};
}

const candidate = typeof body.url === "string" ? body.url : response.headers.get("location");
const target = candidate ? new URL(candidate, base) : null;
const setCookie = response.headers.getSetCookie?.() ?? [];
const cookieNames = setCookie
  .map((value) => value.split(";", 1)[0]?.split("=", 1)[0]?.trim())
  .filter(Boolean)
  .sort();

console.log(
  JSON.stringify({
    status: response.status,
    ok: response.ok,
    responseKeys: Object.keys(body).sort(),
    redirectHost: target?.hostname ?? null,
    redirectPath: target?.pathname ?? null,
    cookieNames,
  }),
);

if (!response.ok) throw new Error(`Neon GitHub social sign-in probe failed with HTTP ${response.status}.`);
if (!target || target.protocol !== "https:" || target.hostname !== "github.com")
  throw new Error("Neon GitHub social sign-in did not return the expected GitHub HTTPS redirect.");
if (!cookieNames.length) throw new Error("Neon GitHub social sign-in did not set OAuth state cookies.");
