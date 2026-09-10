const authBase = process.env.PRODUCTION_NEON_AUTH_URL;
if (!authBase) throw new Error("Missing explicit production Neon Auth URL.");

const base = new URL(authBase.replace(/\/$/u, ""));
if (base.protocol !== "https:" || !base.hostname.endsWith(".neon.tech"))
  throw new Error("Refusing non-Neon Auth endpoint.");

const safeError = (value) =>
  typeof value === "string"
    ? value.slice(0, 160).replace(/[A-Za-z0-9_=-]{24,}/gu, "[redacted]")
    : null;

function cookieHeader(setCookie) {
  return setCookie
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function probe(provider) {
  const start = await fetch(`${base.href}/sign-in/social`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://odin-agent-xi.vercel.app",
    },
    body: JSON.stringify({
      provider,
      callbackURL: "https://odin-agent-xi.vercel.app/app",
      errorCallbackURL: "https://odin-agent-xi.vercel.app/login?oauth=error",
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await start.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }
  const startCookies = start.headers.getSetCookie?.() ?? [];
  const initCandidate = typeof body.url === "string" ? body.url : start.headers.get("location");
  const initUrl = initCandidate ? new URL(initCandidate, base) : null;
  let providerUrl = null;
  let initStatus = null;
  if (start.ok && initUrl && initUrl.protocol === "https:" && initUrl.hostname.endsWith(".neon.tech")) {
    const init = await fetch(initUrl, {
      headers: {
        Cookie: cookieHeader(startCookies),
        Origin: "https://odin-agent-xi.vercel.app",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    initStatus = init.status;
    const location = init.headers.get("location");
    providerUrl = location ? new URL(location, initUrl) : null;
  }

  const oauthRedirect = providerUrl?.searchParams.get("redirect_uri");
  const callback = oauthRedirect ? new URL(oauthRedirect) : null;
  return {
    provider,
    startStatus: start.status,
    startOk: start.ok,
    responseKeys: Object.keys(body).sort(),
    errorCode: safeError(body.code),
    error: safeError(body.error),
    initHost: initUrl?.hostname ?? null,
    initPath: initUrl?.pathname ?? null,
    initStatus,
    providerHost: providerUrl?.hostname ?? null,
    providerPath: providerUrl?.pathname ?? null,
    providerCallbackHost: callback?.hostname ?? null,
    providerCallbackPath: callback?.pathname ?? null,
    cookieNames: startCookies
      .map((value) => value.split(";", 1)[0]?.split("=", 1)[0]?.trim())
      .filter(Boolean)
      .sort(),
  };
}

const results = await Promise.all([probe("google"), probe("github")]);
console.log(JSON.stringify(results));

const google = results.find((item) => item.provider === "google");
const github = results.find((item) => item.provider === "github");
if (!google?.startOk || google.providerHost !== "accounts.google.com")
  throw new Error("Production Neon Google social control did not reach Google OAuth.");
if (!github?.startOk || github.providerHost !== "github.com")
  throw new Error("Production Neon GitHub social provider did not reach GitHub OAuth.");
if (!github.providerCallbackHost?.endsWith(".neon.tech") || !github.providerCallbackPath)
  throw new Error("Production Neon GitHub callback contract is invalid.");
