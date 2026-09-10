from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1))


hosted = "src/chat/hosted.ts"
replace_once(
    hosted,
    '''let services: ReturnType<typeof createServices> | undefined;\nfunction createServices() {\n  const connection =\n    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;\n  const authUrl = resolveNeonAuthUrl(connection, process.env);\n''',
    '''let services: ReturnType<typeof createServices> | undefined;\nfunction configuredNeonAuthBase(): string | undefined {\n  const connection =\n    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;\n  const value = resolveNeonAuthUrl(connection, process.env);\n  if (!value) return undefined;\n  try {\n    const url = new URL(value.replace(/\\/$/u, ""));\n    if (\n      url.protocol !== "https:" ||\n      !url.hostname.endsWith(".neon.tech") ||\n      url.username ||\n      url.password ||\n      url.search ||\n      url.hash\n    )\n      return undefined;\n    return url.href.replace(/\\/$/u, "");\n  } catch {\n    return undefined;\n  }\n}\nfunction createServices() {\n  const connection =\n    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;\n  const authUrl = configuredNeonAuthBase();\n''',
)
replace_once(
    hosted,
    '''export async function hostedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {\n  const security =\n    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";\n''',
    '''export async function hostedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {\n  const authBase = configuredNeonAuthBase();\n  const authOrigin = authBase ? new URL(authBase).origin : "";\n  const security = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'${authOrigin ? ` ${authOrigin}` : ""}; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;\n''',
)
replace_once(
    hosted,
    '''    if (url.pathname === "/api/auth/config") {\n      send(res, 200, {\n        provider: "neon",\n        emailVerificationRequired: true,\n        oauth: {\n          github: { available: false },\n        },\n      });\n      return;\n    }\n    services ??= createServices();\n    const { auth, pool, models } = services;\n''',
    '''    if (url.pathname === "/api/auth/config") {\n      const githubAvailable = Boolean(\n        authBase && process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET,\n      );\n      send(res, 200, {\n        provider: "neon",\n        emailVerificationRequired: true,\n        oauth: {\n          github: {\n            available: githubAvailable,\n            ...(githubAvailable && authBase ? { authBase } : {}),\n          },\n        },\n      });\n      return;\n    }\n    services ??= createServices();\n    const { auth, pool, models } = services;\n    if (url.pathname === "/api/auth/github/finalize" && method === "POST") {\n      const address =\n        String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0] ?? "unknown";\n      const limiter = new NeonActorDatabase(pool, { id: "odin-internal-auth-throttle" });\n      await rate(limiter, hashText(address), 10, 60);\n      const body = object(await jsonBody(req), ["token"]);\n      if (typeof body.token !== "string" || body.token.length < 32 || body.token.length > 16000)\n        throw new ChatError("INVALID_AUTH_TOKEN", "Invalid identity token.", 400);\n      const identity = await auth.verifyToken(body.token);\n      if (!identity.emailVerified)\n        throw new ChatError(\n          "EMAIL_UNVERIFIED",\n          "Verify your email before opening the workspace.",\n          403,\n        );\n      res.setHeader("Set-Cookie", auth.oauthJwtCookie(body.token));\n      send(res, 200, { ok: true });\n      return;\n    }\n''',
)
replace_once(
    hosted,
    '''    if (url.pathname === "/api/session" && method === "DELETE") {\n      const response = await auth.upstream(\n        "sign-out",\n        "POST",\n        origin,\n        req.headers.cookie ?? "",\n        {},\n      );\n      if (!response.ok) throw new ChatError("AUTH_FAILED", "Sign-out failed.", 502);\n      res.setHeader("Set-Cookie", auth.cookies(response));\n      send(res, 200, { authenticated: false });\n      return;\n    }\n''',
    '''    if (url.pathname === "/api/session" && method === "DELETE") {\n      const cookieHeader = req.headers.cookie ?? "";\n      if (auth.oauthJwt(cookieHeader)) {\n        res.setHeader("Set-Cookie", auth.clearOauthJwtCookie());\n        send(res, 200, { authenticated: false });\n        return;\n      }\n      const response = await auth.upstream("sign-out", "POST", origin, cookieHeader, {});\n      if (!response.ok) throw new ChatError("AUTH_FAILED", "Sign-out failed.", 502);\n      res.setHeader("Set-Cookie", auth.cookies(response));\n      send(res, 200, { authenticated: false });\n      return;\n    }\n''',
)

replace_once(
    "web/login.js",
    '''  const token = response.headers.get("set-auth-jwt") ?? data?.session?.token;\n  if (typeof token !== "string" || !token) {\n    if (verifier) throw new Error("Neon hat keine gültige Login-Session zurückgegeben.");\n    return false;\n  }\n  await request("/api/auth/github/finalize", { token });\n''',
    '''  let token = response.headers.get("set-auth-jwt");\n  if (!token) {\n    const tokenResponse = await neonAuth("/token", { method: "GET" });\n    const tokenData = tokenResponse.ok ? await tokenResponse.json().catch(() => ({})) : {};\n    token = tokenData?.token;\n  }\n  if (typeof token !== "string" || !token) {\n    if (verifier) throw new Error("Neon hat keine gültige Login-Session zurückgegeben.");\n    return false;\n  }\n  await request("/api/auth/github/finalize", { token });\n''',
)

replace_once(
    "scripts/sync-vercel-production.mjs",
    '''  let authUrl = safeSecret("NEON_AUTH_URL");\n  if (!authUrl) {\n    const auth = await api("neon", `branches/${SCOPE.neonBranch}/auth`);\n    authUrl = auth.base_url ?? auth.auth?.base_url ?? "";\n  }\n  assert(authUrl.startsWith("https://") && authUrl.includes(".neonauth."), "NEON_AUTH_URL");\n''',
    '''  const auth = await api("neon", `branches/${SCOPE.neonBranch}/auth`);\n  const authUrl = auth.base_url ?? auth.auth?.base_url ?? "";\n  assert(authUrl.startsWith("https://") && authUrl.includes(".neonauth."), "NEON_AUTH_URL");\n''',
)

production_workflow = Path(".github/workflows/configure-vercel-production.yml")
production_lines = production_workflow.read_text().splitlines()
filtered_lines = [line for line in production_lines if "NEON_AUTH_URL:" not in line]
if len(production_lines) - len(filtered_lines) != 1:
    raise SystemExit("configure-vercel-production.yml: expected exactly one NEON_AUTH_URL mapping")
production_workflow.write_text("\n".join(filtered_lines) + "\n")

replace_once(
    "test/chat/hosted.test.ts",
    '''  process.env.ODIN_PUBLIC_ORIGIN = "https://odin.example";\n  const server = createServer(hostedHandler);\n''',
    '''  process.env.ODIN_PUBLIC_ORIGIN = "https://odin.example";\n  process.env.GITHUB_OAUTH_CLIENT_ID = "fixture-client";\n  process.env.GITHUB_OAUTH_CLIENT_SECRET = "fixture-secret";\n  const server = createServer(hostedHandler);\n''',
)
replace_once(
    "test/chat/hosted.test.ts",
    '''    assert.deepEqual(await config.json(), {\n      provider: "neon",\n      emailVerificationRequired: true,\n      oauth: { github: { available: false } },\n    });\n''',
    '''    assert.deepEqual(await config.json(), {\n      provider: "neon",\n      emailVerificationRequired: true,\n      oauth: {\n        github: {\n          available: true,\n          authBase: "https://ep-fixture.neonauth.eu-central-1.aws.neon.tech/neondb/auth",\n        },\n      },\n    });\n    assert.match(\n      config.headers.get("content-security-policy") ?? "",\n      /connect-src 'self' https:\/\/ep-fixture\.neonauth\.eu-central-1\.aws\.neon\.tech/u,\n    );\n''',
)

neon_test = Path("test/chat/neon-auth.test.ts")
text = neon_test.read_text()
anchor = '''test("Auth broker forwards only session cookies and never follows arbitrary upstream routes", async () => {\n'''
addition = '''test("OAuth JWT bridge accepts only a signed verified Neon identity and expires locally", async () => {\n  const auth = new NeonAuth(base, fetch, keys);\n  const jwt = await token();\n  const cookie = auth.oauthJwtCookie(jwt);\n  assert.match(cookie, /^__Host-odin-neon-jwt=/u);\n  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=840$/u);\n  assert.equal(auth.oauthJwt(cookie), jwt);\n  assert.equal((await auth.session(cookie, "https://odin.example")).id, "user-a");\n  assert.equal(\n    auth.clearOauthJwtCookie(),\n    "__Host-odin-neon-jwt=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",\n  );\n  const unverified = await token({ emailVerified: false });\n  await assert.rejects(\n    auth.session(auth.oauthJwtCookie(unverified), "https://odin.example"),\n    /Verify your email/u,\n  );\n});\n\n'''
if text.count(anchor) != 1:
    raise SystemExit("neon-auth test anchor mismatch")
neon_test.write_text(text.replace(anchor, addition + anchor, 1))

replace_once(
    "scripts/login.test.mjs",
    '''    assert.match(client.get("github-note").textContent, /noch nicht freigeschaltet/u);\n    client.get("github-signin").click();\n    assert.match(client.get("auth-status").textContent, /OAuth-Konfiguration/u);\n''',
    '''    assert.match(client.get("github-note").textContent, /nicht verfügbar/u);\n    client.get("github-signin").click();\n    assert.match(client.get("auth-status").textContent, /nicht verfügbar/u);\n''',
)
login_test = Path("scripts/login.test.mjs")
text = login_test.read_text()
anchor = '''test("login surface contains no demo or placeholder copy", async () => {\n'''
addition = '''test("GitHub identity path exchanges Neon session state for a signed JWT before Odin finalization", async () => {\n  const source = await readFile("web/login.js", "utf8");\n  assert.match(source, /\\/sign-in\\/social/u);\n  assert.match(source, /neon_auth_session_verifier/u);\n  assert.match(source, /neonAuth\\("\\/token"/u);\n  assert.match(source, /\\/api\\/auth\\/github\\/finalize/u);\n  assert.doesNotMatch(source, /data\\?\\.session\\?\\.token/u);\n});\n\n'''
if text.count(anchor) != 1:
    raise SystemExit("login test anchor mismatch")
login_test.write_text(text.replace(anchor, addition + anchor, 1))

for path in [
    ".github/workflows/p0-neon-github-auth-probe.yml",
    "scripts/probe-neon-github-auth.mjs",
    ".github/workflows/p0-finalize-branch.yml",
    ".github/workflows/p0-finalize-v2.yml",
    "scripts/p0-finalize-patch.py",
]:
    Path(path).unlink(missing_ok=True)
