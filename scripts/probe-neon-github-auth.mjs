const authBase = process.env.NEON_AUTH_URL ?? process.env.NEON_AUTH_BASE_URL;
if (!authBase) throw new Error("Missing Neon Auth URL mapping.");

const base = new URL(authBase.replace(/\/$/u, ""));
if (base.protocol !== "https:" || !base.hostname.endsWith(".neon.tech"))
  throw new Error("Refusing non-Neon Auth endpoint.");

const safeError = (value) =>
  typeof value === "string"
    ? value.slice(0, 160).replace(/[A-Za-z0-9_=-]{24,}/gu, "[redacted]")
    : null;

async function probe(provider) {
  const response = await fetch(`${base.href}/sign-in/social`, {
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

  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }
  const candidate = typeof body.url === "string" ? body.url : response.headers.get("location");
  const target = candidate ? new URL(candidate, base) : null;
  const oauthRedirect = target?.searchParams.get("redirect_uri");
  const callback = oauthRedirect ? new URL(oauthRedirect) : null;
  const cookieNames = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";", 1)[0]?.split("=", 1)[0]?.trim())
    .filter(Boolean)
    .sort();
  return {
    provider,
    status: response.status,
    ok: response.ok,
    responseKeys: Object.keys(body).sort(),
    errorCode: safeError(body.code),
    error: safeError(body.error),
    redirectHost: target?.hostname ?? null,
    redirectPath: target?.pathname ?? null,
    providerCallbackHost: callback?.hostname ?? null,
    providerCallbackPath: callback?.pathname ?? null,
    cookieNames,
  };
}

const results = await Promise.all([probe("google"), probe("github")]);
console.log(JSON.stringify(results));

const google = results.find((item) => item.provider === "google");
const github = results.find((item) => item.provider === "github");
if (!google?.ok || google.redirectHost !== "accounts.google.com")
  throw new Error("Neon shared Google social control did not produce a valid provider redirect.");
if (!github?.ok || github.redirectHost !== "github.com")
  throw new Error("Neon custom GitHub social provider is not active in the runtime.");
