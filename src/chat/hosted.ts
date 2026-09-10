import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { attachDatabasePool } from "@vercel/functions";
import { AnthropicProvider } from "../providers/anthropic.js";
import { CapabilityRegistry, makeCapabilities } from "../providers/capabilities.js";
import { NvidiaProvider } from "../providers/nvidia.js";
import { OpenAIProvider } from "../providers/openai.js";
import { OpenAICompatibleProvider } from "../providers/openai-compatible.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import { readBenchmarks } from "./benchmarks.js";
import { resolveNeonAuthUrl } from "./deployment.js";
import { ChatEngine } from "./engine.js";
import { GitHubWorkspace } from "./github-workspace.js";
import { DEFAULT_CHAT_LIMITS } from "./modes.js";
import { NeonAuth } from "./neon-auth.js";
import { createNeonPool, NeonActorDatabase } from "./neon-database.js";
import { NeonChatStore, NeonMissionStore } from "./neon-store.js";
import { NeonWorkspace } from "./neon-workspace.js";
import { PREVIEW_CSP } from "./preview.js";
import {
  CredentialVault,
  configuredStripePrice,
  effectivePlan,
  MODE_MINIMUM_PLAN,
  ProductStore,
  planAllows,
  provider,
  stripePricePlan,
  subscriptionPriceId,
  verifyStripeSignature,
} from "./product.js";
import { WikipediaResearchAdapter } from "./research.js";
import { hashText, identifier, integer, object, publicError } from "./safety.js";
import { ChatError, type ChatModel } from "./types.js";

let services: ReturnType<typeof createServices> | undefined;
function createServices() {
  const connection =
    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const authUrl = resolveNeonAuthUrl(connection, process.env);
  if (!connection || !authUrl) {
    console.warn("Odin backend configuration", {
      databaseConfigured: !!connection,
      authConfigured: !!authUrl,
      configuredVariableNames: Object.keys(process.env).filter((key) =>
        /^(?:ODIN_DATABASE|DATABASE_|POSTGRES_|PG(?:HOST|USER|DATABASE|PASSWORD)|NEON_|VITE_NEON_)/u.test(
          key,
        ),
      ),
    });
    throw new ChatError(
      "BACKEND_CONFIG",
      "Neon database and Auth must be configured for this deployment.",
      503,
    );
  }
  const pool = createNeonPool(connection);
  attachDatabasePool(pool);
  const auth = new NeonAuth(authUrl);
  const models: ChatModel[] = [];
  const addNvidiaModel = (input: {
    id: string;
    label: string;
    model: string;
    plan: "free" | "pro" | "developer" | "ultra";
    summary: string;
    recommendedFor: readonly string[];
    credential: () => string;
    version: string;
    reference: string;
    capabilities: ReturnType<typeof makeCapabilities>;
    timeoutMs: number;
  }) => {
    if (!input.credential()) return;
    const capabilities = new CapabilityRegistry([
      {
        model: input.model,
        provider: "nvidia",
        version: input.version,
        provenance: {
          kind: "provider",
          observedAt: "2026-09-09T00:00:00.000Z",
          reference: input.reference,
        },
        capabilities: input.capabilities,
      },
    ]);
    models.push({
      id: input.id,
      label: input.label,
      model: input.model,
      plan: input.plan,
      summary: input.summary,
      recommendedFor: input.recommendedFor,
      provider: new NvidiaProvider({
        capabilities,
        credential: input.credential,
        reasoningParameter: "reasoning_effort",
        defaultTimeoutMs: input.timeoutMs,
      }),
    });
  };
  addNvidiaModel({
    id: "kimi",
    label: "Kimi K3",
    model: "moonshotai/kimi-k3",
    plan: "free",
    summary: "Großer Kontext für Coding, Reasoning und lange Aufgaben.",
    recommendedFor: ["Coding", "Thinking", "Long context"],
    credential: () => process.env.NV_API_KEY ?? process.env.NVIDIA_API_KEY ?? "",
    version: "nvidia-build-2026-09-04",
    reference: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer",
    capabilities: makeCapabilities({
      textInput: true,
      toolUse: true,
      streaming: true,
      reasoningEfforts: ["low", "high", "max"],
      contextWindowTokens: 1048576,
      maxOutputTokens: 65536,
    }),
    timeoutMs: 180000,
  });
  addNvidiaModel({
    id: "muse-glimmer",
    label: "Muse Glimmer 30B",
    model: "meta/muse-glimmer-30b",
    plan: "pro",
    summary: "Multimodales Reasoning-Modell für agentische Aufgaben, Coding und Tool-Nutzung.",
    recommendedFor: ["Pro", "Coding", "Agents", "Vision", "Tool use"],
    credential: () =>
      process.env.NV_API_KEY_2 ??
      process.env.NV_PRO_API_KEY ??
      process.env.NV_API_KEY ??
      process.env.NVIDIA_API_KEY ??
      "",
    version: "nvidia-build-2026-09-09",
    reference: "https://docs.api.nvidia.com/nim/re/reference/meta-muse-glimmer-30b-infer",
    capabilities: makeCapabilities({
      textInput: true,
      imageInput: true,
      toolUse: true,
      streaming: true,
      temperature: true,
      reasoningEfforts: ["minimal", "low", "medium", "high", "max"],
      contextWindowTokens: 131072,
      maxOutputTokens: 8192,
    }),
    timeoutMs: 120000,
  });
  console.info("Odin backend readiness", {
    databaseConfigured: true,
    authConfigured: true,
    modelCount: models.length,
    modelIds: models.map((model) => model.id),
  });
  return { pool, auth, models };
}
export async function hostedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const security =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", security);
  try {
    const host = req.headers.host ?? "";
    const origins = [
      process.env.ODIN_PUBLIC_ORIGIN,
      ...[
        process.env.VERCEL_URL,
        process.env.VERCEL_BRANCH_URL,
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
      ]
        .filter(Boolean)
        .map((host) => `https://${host}`),
    ].filter((v): v is string => !!v);
    const origin = `https://${host}`;
    if (
      !origins.includes(origin) ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw new ChatError("ORIGIN_DENIED", "Unrecognized application origin.", 403);
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/api" && url.searchParams.has("odin_path"))
      url.pathname = `/api/${url.searchParams.get("odin_path")}`;
    if (
      !["GET", "HEAD"].includes(method) &&
      url.pathname !== "/api/stripe/webhook" &&
      req.headers["x-odin-request"] !== "1"
    )
      throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);
    if (url.pathname === "/api/auth/config") {
      send(res, 200, { provider: "neon", emailVerificationRequired: true });
      return;
    }
    services ??= createServices();
    const { auth, pool, models } = services;
    if (url.pathname === "/api/stripe/webhook" && method === "POST") {
      const raw = await rawBody(req);
      verifyStripeSignature(
        raw,
        String(req.headers["stripe-signature"] ?? ""),
        process.env.STRIPE_WEBHOOK_SECRET,
      );
      const event = JSON.parse(raw.toString("utf8")) as {
        id?: string;
        created?: number;
        type?: string;
        data?: { object?: Record<string, unknown> };
      };
      const item = event.data?.object;
      const metadata = item?.metadata as Record<string, unknown> | undefined;
      const owner = metadata?.odin_owner_id;
      if (
        !event.id ||
        !Number.isSafeInteger(event.created) ||
        ![
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ].includes(event.type ?? "") ||
        typeof owner !== "string"
      )
        throw new ChatError("STRIPE_EVENT", "Invalid Stripe event.");
      const webhookDb = new NeonActorDatabase(pool, { id: owner });
      await webhookDb.transaction(async (client) => {
        const accepted = await client.query(
          "INSERT INTO odin_api.stripe_events(event_id,created) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
          [event.id, event.created],
        );
        if (!accepted.rows.length) return;
        const plan = stripePricePlan(subscriptionPriceId(item ?? {}));
        const status = String(
          item?.status ?? (event.type === "customer.subscription.deleted" ? "canceled" : "free"),
        );
        await client.query(
          `INSERT INTO odin_api.accounts(plan,subscription_status,stripe_customer_id,stripe_subscription_id,stripe_event_created,cancel_at_period_end)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id) DO UPDATE SET
           plan=CASE WHEN excluded.stripe_event_created>=odin_api.accounts.stripe_event_created THEN excluded.plan ELSE odin_api.accounts.plan END,
           subscription_status=CASE WHEN excluded.stripe_event_created>=odin_api.accounts.stripe_event_created THEN excluded.subscription_status ELSE odin_api.accounts.subscription_status END,
           stripe_customer_id=COALESCE(excluded.stripe_customer_id,odin_api.accounts.stripe_customer_id),
           stripe_subscription_id=COALESCE(excluded.stripe_subscription_id,odin_api.accounts.stripe_subscription_id),
           stripe_event_created=GREATEST(excluded.stripe_event_created,odin_api.accounts.stripe_event_created),
           cancel_at_period_end=CASE WHEN excluded.stripe_event_created>=odin_api.accounts.stripe_event_created THEN excluded.cancel_at_period_end ELSE odin_api.accounts.cancel_at_period_end END,updated_at=now()`,
          [
            plan,
            status,
            item?.customer ?? null,
            item?.id ?? null,
            event.created,
            item?.cancel_at_period_end === true,
          ],
        );
      });
      send(res, 200, { received: true });
      return;
    }
    if (url.pathname.startsWith("/api/auth/") && method === "POST") {
      const address =
        String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0] ?? "unknown";
      const limiter = new NeonActorDatabase(pool, { id: "odin-internal-auth-throttle" });
      await rate(limiter, hashText(address), 10, 60);
      const body = object(await jsonBody(req), ["email", "password", "name", "otp"]);
      const operation = url.pathname.slice("/api/auth/".length);
      const actions: Record<string, string> = {
        login: "sign-in/email",
        signup: "sign-up/email",
        logout: "sign-out",
        sendCode: "email-otp/send-verification-otp",
        verify: "email-otp/verify-email",
        forgot: "email-otp/request-password-reset",
        reset: "email-otp/reset-password",
      };
      const path = actions[operation];
      if (!path) throw new ChatError("NOT_FOUND", "Unknown authentication action.", 404);
      const payload: Record<string, string> = {};
      if (operation !== "logout") {
        if (
          typeof body.email !== "string" ||
          body.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(body.email)
        )
          throw new ChatError("INVALID_EMAIL", "Enter a valid email address.");
        payload.email = body.email;
      }
      if (["login", "signup", "reset"].includes(operation)) {
        if (
          typeof body.password !== "string" ||
          body.password.length > 128 ||
          body.password.length < (["signup", "reset"].includes(operation) ? 14 : 1)
        )
          throw new ChatError("INVALID_PASSWORD", "Use a password with at least 14 characters.");
        payload.password = body.password;
      }
      if (operation === "signup")
        payload.name = typeof body.name === "string" ? body.name.slice(0, 100) : "Odin user";
      if (operation === "sendCode") payload.type = "email-verification";
      if (["verify", "reset"].includes(operation)) {
        if (typeof body.otp !== "string" || !/^\d{6}$/u.test(body.otp))
          throw new ChatError("INVALID_CODE", "Enter the six-digit email code.");
        payload.otp = body.otp;
      }
      const upstream = await auth.upstream(path, "POST", origin, req.headers.cookie ?? "", payload);
      const cookies = auth.cookies(upstream);
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      // Auth responses can contain session secrets; only a minimal status crosses this boundary.
      if (!upstream.ok)
        throw new ChatError(
          "AUTH_FAILED",
          "Authentication failed. Check your details and email verification.",
          upstream.status === 429 ? 429 : 400,
        );
      send(res, 200, { ok: true, requiresVerification: operation === "signup" });
      return;
    }
    const identity = await auth.session(req.headers.cookie ?? "", origin);
    const db = new NeonActorDatabase(pool, identity);
    const product = new ProductStore(
      db,
      new CredentialVault(process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY),
    );
    const githubConnection = await product.github();
    const githubToken = githubConnection.connected ? await product.githubToken() : undefined;
    const githubWorkspaceReady = Boolean(
      githubConnection.connected &&
        typeof githubConnection.repository === "string" &&
        typeof githubConnection.defaultBranch === "string" &&
        githubToken,
    );
    const availableModels = [...models, ...(await byokModels(product))];
    const store = new NeonChatStore(db);
    const createEngine = (
      database: NeonActorDatabase,
      conversationId?: string,
      signal?: AbortSignal,
    ) => {
      const githubReady = githubWorkspaceReady ? (githubToken as string) : undefined;
      const quality = githubReady
        ? new GitHubWorkspace(
            githubReady,
            githubConnection.repository,
            githubConnection.defaultBranch,
            async () => {},
          )
        : conversationId
          ? new NeonWorkspace(database, conversationId, async () => {})
          : undefined;
      return new ChatEngine({
        store: new NeonChatStore(database),
        events: new NeonMissionStore(database),
        models: availableModels,
        autoRun: false,
        atomic: (action) =>
          database.transaction(async (client) => {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
              `${identity.id}:${conversationId ?? "account"}`,
            ]);
            return action();
          }),
        limits: { ...DEFAULT_CHAT_LIMITS, maxTurnMs: 240000 },
        allowWorkspaceWrites: true,
        ...(quality && conversationId
          ? {
              quality,
              workspace: (changed) =>
                githubReady
                  ? new GitHubWorkspace(
                      githubReady,
                      githubConnection.repository,
                      githubConnection.defaultBranch,
                      changed,
                    )
                  : new NeonWorkspace(database, conversationId, changed),
            }
          : {}),
        research: new WikipediaResearchAdapter("de"),
        ...(signal ? { signal } : {}),
      });
    };
    if (url.pathname === "/api/session" && method === "DELETE") {
      const response = await auth.upstream(
        "sign-out",
        "POST",
        origin,
        req.headers.cookie ?? "",
        {},
      );
      if (!response.ok) throw new ChatError("AUTH_FAILED", "Sign-out failed.", 502);
      res.setHeader("Set-Cookie", auth.cookies(response));
      send(res, 200, { authenticated: false });
      return;
    }
    if (url.pathname === "/api/config" && method === "GET") {
      const account = await product.account();
      send(res, 200, {
        ...createEngine(db).capabilities(),
        user: { email: identity.email },
        account: { ...account, effectivePlan: effectivePlan(account) },
        providers: await product.credentials(),
        github: await product.github(),
        billing: {
          proCheckoutConfigured: !!(process.env.STRIPE_SECRET_KEY && configuredStripePrice("pro")),
          developerCheckoutConfigured: !!(
            process.env.STRIPE_SECRET_KEY && configuredStripePrice("developer")
          ),
          ultraCheckoutConfigured: !!(
            process.env.STRIPE_SECRET_KEY && configuredStripePrice("ultra")
          ),
        },
        execution: "request",
        workspace: {
          connected: true,
          writable: true,
          kind: "static-web",
          quality: "Syntax checks only; browser execution is isolated in the preview.",
        },
      });
      return;
    }
    if (url.pathname === "/api/providers" && method === "GET") {
      send(res, 200, { providers: await product.credentials() });
      return;
    }
    const providerRoute = /^\/api\/providers\/([a-z]+)$/u.exec(url.pathname);
    if (providerRoute) {
      const id = provider(providerRoute[1]);
      if (method === "PUT") {
        const body = object(await jsonBody(req), ["key"]);
        if (typeof body.key !== "string")
          throw new ChatError("INVALID_CREDENTIAL", "Enter a provider key.");
        await verifyProviderKey(id, body.key);
        send(res, 200, await product.saveCredential(id, body.key));
        return;
      }
      if (method === "DELETE") {
        await product.deleteCredential(id);
        send(res, 200, { connected: false });
        return;
      }
    }
    if (url.pathname === "/api/github/connect" && method === "GET") {
      if (!process.env.GITHUB_OAUTH_CLIENT_ID)
        throw new ChatError("GITHUB_NOT_CONFIGURED", "GitHub OAuth is not configured.", 503);
      const target = new URL("https://github.com/login/oauth/authorize");
      target.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID);
      target.searchParams.set("redirect_uri", `${origin}/api/github/callback`);
      target.searchParams.set("scope", "repo read:user");
      target.searchParams.set("state", await product.createOAuthState());
      res.statusCode = 302;
      res.setHeader("Location", target.href);
      res.end();
      return;
    }
    if (url.pathname === "/api/github/callback" && method === "GET") {
      await product.consumeOAuthState(url.searchParams.get("state") ?? "");
      const code = url.searchParams.get("code");
      const client = process.env.GITHUB_OAUTH_CLIENT_ID;
      const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
      if (!code || !client || !secret)
        throw new ChatError("GITHUB_OAUTH", "GitHub authorization failed.", 400);
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: client,
          client_secret: secret,
          code,
          redirect_uri: `${origin}/api/github/callback`,
        }),
      });
      const token = (await response.json()) as { access_token?: string };
      if (!response.ok || !token.access_token)
        throw new ChatError("GITHUB_OAUTH", "GitHub authorization failed.", 502);
      const user = await github(token.access_token, "/user");
      if (Array.isArray(user) || typeof user.login !== "string")
        throw new ChatError("GITHUB_UPSTREAM", "GitHub user response was invalid.", 502);
      await product.saveGithub(token.access_token, user.login);
      res.statusCode = 303;
      res.setHeader("Location", "/app?settings=github");
      res.end();
      return;
    }
    if (url.pathname === "/api/github" && method === "GET") {
      send(res, 200, await product.github());
      return;
    }
    if (url.pathname === "/api/github/repositories" && method === "GET") {
      const token = await product.githubToken();
      if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
      const repositories = (await github(
        token,
        "/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated",
      )) as unknown[];
      send(res, 200, { repositories: repositories.map(publicRepository) });
      return;
    }
    if (url.pathname === "/api/github/repository" && method === "PUT") {
      const body = object(await jsonBody(req), ["repository", "branch"]);
      await product.selectRepository(String(body.repository ?? ""), String(body.branch ?? ""));
      send(res, 200, await product.github());
      return;
    }
    if (url.pathname === "/api/github" && method === "DELETE") {
      const token = await product.githubToken();
      const client = process.env.GITHUB_OAUTH_CLIENT_ID;
      const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
      if (token && client && secret) {
        await fetch(`https://api.github.com/applications/${client}/token`, {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString("base64")}`,
            "Content-Type": "application/json",
            "User-Agent": "Odin-Agent",
          },
          body: JSON.stringify({ access_token: token }),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined);
      }
      await product.deleteGithub();
      send(res, 200, { connected: false });
      return;
    }
    if (url.pathname === "/api/billing/checkout" && method === "POST") {
      const body = object(await jsonBody(req), ["plan"]);
      const selected =
        body.plan === "pro" || body.plan === "developer" || body.plan === "ultra"
          ? body.plan
          : undefined;
      if (!selected) throw new ChatError("INVALID_PLAN", "Choose Pro, Developer or Ultra.");
      const price = selected ? configuredStripePrice(selected) : undefined;
      if (!process.env.STRIPE_SECRET_KEY || !price)
        throw new ChatError(
          "CHECKOUT_NOT_CONFIGURED",
          "Checkout is not configured for this plan.",
          503,
        );
      const checkout = await stripe("checkout/sessions", {
        mode: "subscription",
        success_url: `${origin}/app?billing=pending`,
        cancel_url: `${origin}/app?billing=cancelled`,
        client_reference_id: identity.id,
        "metadata[odin_owner_id]": identity.id,
        "subscription_data[metadata][odin_owner_id]": identity.id,
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
      });
      send(res, 200, { url: checkout.url });
      return;
    }
    if (url.pathname === "/api/billing/portal" && method === "POST") {
      await jsonBody(req);
      const customer = await db.transaction(
        async (client) =>
          (await client.query("SELECT stripe_customer_id FROM odin_api.accounts")).rows[0]
            ?.stripe_customer_id,
      );
      if (typeof customer !== "string")
        throw new ChatError("PORTAL_UNAVAILABLE", "No billing account is linked yet.", 409);
      const portal = await stripe("billing_portal/sessions", {
        customer,
        return_url: `${origin}/app?settings=billing`,
      });
      send(res, 200, { url: portal.url });
      return;
    }
    if (url.pathname === "/api/account/export" && method === "GET") {
      const exported = await db.transaction(async (client) => {
        const tables = [
          "accounts",
          "credentials",
          "github_connections",
          "conversations",
          "turns",
          "events",
        ];
        const result: Record<string, unknown> = {};
        for (const table of tables) {
          const rows = (await client.query(`SELECT * FROM odin_api.${table}`)).rows;
          result[table] =
            table === "credentials" || table === "github_connections"
              ? rows.map((row) => ({ ...row, ciphertext: "[REDACTED]" }))
              : rows;
        }
        return result;
      });
      send(res, 200, { exportedAt: new Date().toISOString(), data: exported });
      return;
    }
    if (url.pathname === "/api/account" && method === "DELETE") {
      await jsonBody(req);
      await db.transaction(async (client) => {
        for (const table of [
          "events",
          "checkpoints",
          "workspace_files",
          "turns",
          "mission_streams",
          "conversations",
          "leases",
          "rate_limits",
          "oauth_states",
          "credentials",
          "github_connections",
          "accounts",
        ])
          await client.query(`DELETE FROM odin_api.${table}`);
      });
      const response = await auth.upstream(
        "sign-out",
        "POST",
        origin,
        req.headers.cookie ?? "",
        {},
      );
      if (response.ok) res.setHeader("Set-Cookie", auth.cookies(response));
      send(res, 200, { deleted: true, authAccountDeletionRequired: true });
      return;
    }
    if (url.pathname === "/api/benchmarks" && method === "GET") {
      send(res, 200, await readBenchmarks(join(process.cwd(), "docs/evals")));
      return;
    }
    if (url.pathname === "/api/conversations") {
      if (method === "GET") {
        send(res, 200, { conversations: await store.conversations() });
        return;
      }
      if (method === "POST") {
        await rate(db, "conversations", 10, 60);
        const body = object(await jsonBody(req), ["title"]);
        send(
          res,
          201,
          await store.createConversation(
            typeof body.title === "string" ? body.title : "New conversation",
          ),
        );
        return;
      }
    }
    const conversation = /^\/api\/conversations\/([\w-]+)(?:\/(turns|events|preview))?$/u.exec(
      url.pathname,
    );
    if (conversation) {
      const id = identifier(conversation[1]);
      await store.conversation(id);
      const engine = createEngine(db, id);
      if (!conversation[2] && method === "GET") {
        send(res, 200, await engine.conversation(id));
        return;
      }
      if (conversation[2] === "preview" && method === "GET") {
        const workspace = new NeonWorkspace(db, id, async () => {});
        const html = await workspace.preview(url.searchParams.get("file") ?? "index.html");
        res.setHeader("Content-Security-Policy", PREVIEW_CSP);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }
      if (conversation[2] === "turns" && method === "POST") {
        await rate(db, "turns", 10, 60);
        const token = await db.claim(`submit:${id}`, 15);
        if (!token) throw new ChatError("BUSY", "A submission is already being saved.", 409);
        try {
          const body = object(await jsonBody(req), ["text", "mode", "modelId", "requestId"]);
          const account = await product.account();
          const selectedModel = availableModels.find((model) => model.id === body.modelId);
          const mode = typeof body.mode === "string" ? body.mode : "";
          if (!Object.hasOwn(MODE_MINIMUM_PLAN, mode))
            throw new ChatError("UNKNOWN_MODE", "Choose a supported mode.");
          const modePlan = MODE_MINIMUM_PLAN[mode as keyof typeof MODE_MINIMUM_PLAN];
          const modelPlan = selectedModel?.plan ?? "free";
          const requiredPlan = planAllows(modePlan, modelPlan) ? modePlan : modelPlan;
          if (!planAllows(effectivePlan(account), requiredPlan))
            throw new ChatError(
              "ENTITLEMENT_REQUIRED",
              `This mission requires the ${requiredPlan} plan.`,
              403,
            );
          if (mode === "coding" && !githubWorkspaceReady)
            throw new ChatError(
              "GITHUB_WORKSPACE_REQUIRED",
              "Coding requires a connected GitHub account and selected repository.",
              409,
            );
          send(
            res,
            202,
            await engine.submit({
              conversationId: id,
              text: typeof body.text === "string" ? body.text : "",
              mode: body.mode,
              modelId: identifier(body.modelId),
              requestId: identifier(body.requestId),
            }),
          );
        } finally {
          await db.release(`submit:${id}`, token);
        }
        return;
      }
      if (conversation[2] === "events" && method === "GET") {
        let cursor = integer(
          Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0),
          0,
          Number.MAX_SAFE_INTEGER,
        );
        if (req.headers.accept !== "text/event-stream") {
          send(res, 200, { events: await store.events(id, cursor, 1000) });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        const end = Date.now() + 20000;
        while (!res.destroyed && Date.now() < end) {
          const events = await store.events(id, cursor, 200);
          for (const event of events) {
            if (!res.write(`id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`)) {
              res.end();
              return;
            }
            cursor = event.cursor;
          }
          if (!events.length) res.write(": heartbeat\n\n");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        res.end();
        return;
      }
    }
    const turn = /^\/api\/turns\/([\w-]+)(?:\/(control|steer|run))?$/u.exec(url.pathname);
    if (turn) {
      const id = identifier(turn[1]);
      const found = await store.turn(id);
      const engine = createEngine(db, found.conversationId);
      if (!turn[2] && method === "GET") {
        send(res, 200, await engine.view(id));
        return;
      }
      if (turn[2] === "steer" && method === "POST") {
        await rate(db, "steering", 30, 60);
        const body = object(await jsonBody(req), ["text"]);
        await engine.steer(id, typeof body.text === "string" ? body.text : "");
        send(res, 200, { ok: true });
        return;
      }
      if (turn[2] === "control" && method === "POST") {
        const body = object(await jsonBody(req), ["command", "expectedVersion"]);
        const view = await db.withLeaseLock(`run:${id}`, async (client) => {
          const updated = await engine.control(
            id,
            String(body.command),
            Number(body.expectedVersion),
          );
          if (["PAUSED", "CANCELLED"].includes(updated.state))
            await client.query("DELETE FROM odin_api.leases WHERE resource=$1", [`run:${id}`]);
          return updated;
        });
        send(res, 200, view);
        return;
      }
      if (turn[2] === "run" && method === "POST") {
        await jsonBody(req);
        const resource = `run:${id}`;
        const lease = await db.claim(resource);
        if (!lease) throw new ChatError("BUSY", "This task already has an active worker.", 409);
        const controller = new AbortController();
        const workerDb = new NeonActorDatabase(pool, identity, { resource, token: lease });
        const worker = createEngine(workerDb, found.conversationId, controller.signal);
        let checking = false,
          lastAuth = Date.now();
        const monitor = setInterval(() => {
          if (checking) return;
          checking = true;
          void (async () => {
            try {
              const view = await engine.view(id);
              if (["PAUSED", "CANCELLED", "BLOCKED", "FAILED"].includes(view.state))
                controller.abort();
              if (Date.now() - lastAuth > 30000) {
                await auth.session(req.headers.cookie ?? "", origin);
                lastAuth = Date.now();
              }
            } catch {
              controller.abort();
            } finally {
              checking = false;
            }
          })();
        }, 1000);
        const disconnect = () => controller.abort();
        res.once("close", disconnect);
        try {
          await worker.execute(id);
          send(res, 200, await engine.view(id));
        } finally {
          clearInterval(monitor);
          res.off("close", disconnect);
          await db.release(resource, lease);
        }
        return;
      }
    }
    throw new ChatError("NOT_FOUND", "Endpoint not found.", 404);
  } catch (error) {
    if (!res.headersSent)
      send(res, error instanceof ChatError ? error.status : 500, publicError(error));
    else res.end();
  }
}
async function rate(
  db: NeonActorDatabase,
  scope: string,
  limit: number,
  seconds: number,
): Promise<void> {
  await db.transaction(async (c) => {
    await c.query("DELETE FROM odin_api.rate_limits WHERE expires_at<now()");
    const rows = (
      await c.query(
        `INSERT INTO odin_api.rate_limits(scope,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(owner_id,scope) DO UPDATE SET hits=odin_api.rate_limits.hits+1 WHERE odin_api.rate_limits.hits<$3 RETURNING hits`,
        [scope, seconds, limit],
      )
    ).rows;
    if (!rows.length)
      throw new ChatError("RATE_LIMIT", "Too many requests. Try again shortly.", 429);
  });
}
async function jsonBody(req: IncomingMessage): Promise<unknown> {
  if (
    !String(req.headers["content-type"] ?? "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new ChatError("CONTENT_TYPE", "Use an application/json request body.", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 64000) throw new ChatError("BODY_LIMIT", "Request is too large.", 413);
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ChatError("INVALID_JSON", "Invalid JSON body.");
  }
}
async function rawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 1_000_000) throw new ChatError("BODY_LIMIT", "Request is too large.", 413);
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}
async function github(token: string, path: string): Promise<Record<string, unknown> | unknown[]> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Odin-Agent",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ChatError("GITHUB_UPSTREAM", "GitHub request failed.", 502);
  return (await response.json()) as Record<string, unknown> | unknown[];
}
function publicRepository(value: unknown) {
  const item = value as Record<string, unknown>;
  return {
    fullName: item.full_name,
    private: item.private === true,
    defaultBranch: item.default_branch,
  };
}
async function verifyProviderKey(providerId: string, key: string): Promise<void> {
  const endpoints: Record<string, [string, Record<string, string>]> = {
    openai: ["https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` }],
    anthropic: [
      "https://api.anthropic.com/v1/models?limit=1",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
    ],
    openrouter: ["https://openrouter.ai/api/v1/auth/key", { Authorization: `Bearer ${key}` }],
    nvidia: ["https://integrate.api.nvidia.com/v1/models", { Authorization: `Bearer ${key}` }],
    google: ["https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": key }],
  };
  const endpoint = endpoints[providerId];
  if (!endpoint) throw new ChatError("INVALID_PROVIDER", "Unsupported provider.");
  const response = await fetch(endpoint[0], {
    headers: endpoint[1],
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new ChatError("INVALID_CREDENTIAL", "The provider rejected this credential.", 400);
  const catalog = JSON.stringify(await response.json());
  const expected: Record<string, string> = {
    openai: "gpt-4.1-mini",
    anthropic: "claude-sonnet-4-20250514",
    openrouter: "openrouter/auto",
    nvidia: "moonshotai/kimi-k3",
    google: "gemini-2.5-flash",
  };
  if (providerId !== "openrouter" && !catalog.includes(expected[providerId] ?? "model-unavailable"))
    throw new ChatError(
      "MODEL_UNAVAILABLE",
      "The configured model is not available to this provider account.",
      409,
    );
}
async function byokModels(product: ProductStore): Promise<ChatModel[]> {
  const definitions = [
    { provider: "openai", id: "openai-gpt-4.1-mini", label: "GPT-4.1 mini", model: "gpt-4.1-mini" },
    {
      provider: "anthropic",
      id: "anthropic-sonnet-4",
      label: "Claude Sonnet 4",
      model: "claude-sonnet-4-20250514",
    },
    {
      provider: "openrouter",
      id: "openrouter-auto",
      label: "OpenRouter Auto",
      model: "openrouter/auto",
    },
    {
      provider: "nvidia",
      id: "nvidia-kimi-k3-byok",
      label: "Kimi K3 (BYOK)",
      model: "moonshotai/kimi-k3",
    },
    {
      provider: "google",
      id: "google-gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      model: "gemini-2.5-flash",
    },
  ] as const;
  const result: ChatModel[] = [];
  for (const item of definitions) {
    const credential = await product.credential(item.provider);
    if (!credential) continue;
    const capabilities = new CapabilityRegistry([
      {
        model: item.model,
        provider: item.provider,
        version: "p-r-catalog-2026-09-09",
        provenance: {
          kind: "provider",
          observedAt: "2026-09-09T00:00:00.000Z",
          reference: "provider account model endpoint",
        },
        capabilities: makeCapabilities({
          textInput: true,
          toolUse: true,
          streaming: true,
          temperature: true,
          reasoningEfforts: ["low", "medium", "high"],
          contextWindowTokens: 128000,
          maxOutputTokens: 8192,
        }),
      },
    ]);
    const common = { capabilities, credential: () => credential, defaultTimeoutMs: 180_000 };
    const adapter =
      item.provider === "openai"
        ? new OpenAIProvider(common)
        : item.provider === "anthropic"
          ? new AnthropicProvider(common)
          : item.provider === "openrouter"
            ? new OpenRouterProvider(common)
            : item.provider === "nvidia"
              ? new NvidiaProvider(common)
              : new OpenAICompatibleProvider({
                  ...common,
                  providerId: "google",
                  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
                });
    result.push({
      id: item.id,
      label: item.label,
      model: item.model,
      provider: adapter,
      plan: "free",
      summary: "User-owned provider credential; provider usage is billed by that provider.",
      recommendedFor: ["BYOK"],
    });
  }
  return result;
}
async function stripe(path: string, values: Record<string, string>) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ChatError("CHECKOUT_NOT_CONFIGURED", "Stripe is not configured.", 503);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(values),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json()) as { url?: string };
  if (!response.ok || !body.url)
    throw new ChatError("STRIPE_UPSTREAM", "Stripe could not create this session.", 502);
  return body;
}
function send(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
