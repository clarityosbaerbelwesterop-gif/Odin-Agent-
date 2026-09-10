import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { attachDatabasePool, waitUntil } from "@vercel/functions";
import { BotControlStore } from "../bot/control-store.js";
import { botPlanLimits } from "../bot/entitlements.js";
import { OdinBotWorker } from "../bot/executor.js";
import { GitHubEventBridge, processGitHubEvent } from "../bot/github-events.js";
import { BotStore } from "../bot/store.js";
import { botSpecialists } from "../bot/team.js";
import { parseAutomationText } from "../bot/wakeup.js";
import { verifyBotSchedulerAuthorization } from "../bot/worker-auth.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { CapabilityRegistry, makeCapabilities } from "../providers/capabilities.js";
import { NvidiaProvider } from "../providers/nvidia.js";
import { OpenAIProvider } from "../providers/openai.js";
import { OpenAICompatibleProvider } from "../providers/openai-compatible.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import { readBenchmarks } from "./benchmarks.js";
import { resolveNeonAuthUrl } from "./deployment.js";
import { ChatEngine } from "./engine.js";
import { GitHubCatalog } from "./github-catalog.js";
import { GitHubWorkspaceSession } from "./github-workspace-session.js";
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
import { createSharedNvidiaModels } from "./server-models.js";
import { ChatError, type ChatModel } from "./types.js";

let services: ReturnType<typeof createServices> | undefined;
function configuredNeonAuthBase(): string | undefined {
  const connection =
    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const value = resolveNeonAuthUrl(connection, process.env);
  if (!value) return undefined;
  try {
    const url = new URL(value.replace(/\/$/u, ""));
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".neon.tech") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.href.replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}
function createServices() {
  const connection =
    process.env.ODIN_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const authUrl = configuredNeonAuthBase();
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
  const models: ChatModel[] = createSharedNvidiaModels(process.env);
  console.info("Odin backend readiness", {
    databaseConfigured: true,
    authConfigured: true,
    modelCount: models.length,
    modelIds: models.map((model) => model.id),
  });
  return { pool, auth, models };
}
export async function hostedHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const authBase = configuredNeonAuthBase();
  const authOrigin = authBase ? new URL(authBase).origin : "";
  const security = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'${authOrigin ? ` ${authOrigin}` : ""}; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
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
    const githubEventRoute = /^\/api\/bot\/events\/github\/([A-Za-z0-9_-]{43})$/u.exec(
      url.pathname,
    );
    if (
      !["GET", "HEAD"].includes(method) &&
      url.pathname !== "/api/stripe/webhook" &&
      !githubEventRoute &&
      req.headers["x-odin-request"] !== "1"
    )
      throw new ChatError("CSRF_DENIED", "Missing same-origin request header.", 403);
    if (url.pathname === "/api/auth/config") {
      const githubAvailable = Boolean(
        authBase && process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET,
      );
      send(res, 200, {
        provider: "neon",
        emailVerificationRequired: true,
        oauth: {
          github: {
            available: githubAvailable,
            ...(githubAvailable && authBase ? { authBase } : {}),
          },
        },
      });
      return;
    }
    services ??= createServices();
    const { auth, pool, models } = services;
    if (githubEventRoute && method === "POST") {
      const bridge = new GitHubEventBridge(pool, process.env.ODIN_PUBLIC_ORIGIN ?? origin);
      const delivery = await bridge.authenticateDelivery(
        githubEventRoute[1] ?? "",
        req.headers,
        await rawBody(req),
      );
      if (delivery.duplicate) {
        send(res, 202, { accepted: true, duplicate: true, fired: 0 });
        return;
      }
      const eventDb = new NeonActorDatabase(pool, { id: delivery.ownerId });
      const eventProduct = new ProductStore(
        eventDb,
        new CredentialVault(process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY),
      );
      const limits = botPlanLimits(effectivePlan(await eventProduct.account()));
      if (!limits.enabled) {
        await bridge.markProcessed(delivery.ownerId, delivery.deliveryId);
        send(res, 202, { accepted: true, duplicate: false, fired: 0 });
        return;
      }
      const processed = await processGitHubEvent(
        eventDb,
        delivery.event,
        delivery.deliveryId,
        limits,
      );
      await bridge.markProcessed(delivery.ownerId, delivery.deliveryId);
      if (processed.firedTaskIds.length) {
        const worker = new OdinBotWorker({
          pool,
          baseModels: models,
          credentialEncryptionKey: process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY,
          publicOrigin: process.env.ODIN_PUBLIC_ORIGIN ?? origin,
        });
        waitUntil(worker.runBatch(`github-event:${delivery.deliveryId}`, 3, delivery.ownerId));
      }
      send(res, 202, {
        accepted: true,
        duplicate: false,
        fired: processed.firedTaskIds.length,
        linkedTask: processed.linkedTaskId !== null,
      });
      return;
    }
    if (url.pathname === "/api/bot/worker" && method === "GET") {
      await verifyBotSchedulerAuthorization(
        typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
      );
      const worker = new OdinBotWorker({
        pool,
        baseModels: models,
        credentialEncryptionKey: process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY,
        publicOrigin: process.env.ODIN_PUBLIC_ORIGIN ?? origin,
      });
      send(res, 200, await worker.runBatch("github-oidc-scheduler", 3));
      return;
    }
    if (url.pathname === "/api/auth/github/finalize" && method === "POST") {
      const address =
        String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0] ?? "unknown";
      const limiter = new NeonActorDatabase(pool, { id: "odin-internal-auth-throttle" });
      await rate(limiter, hashText(address), 10, 60);
      const body = object(await jsonBody(req), ["token"]);
      if (typeof body.token !== "string" || body.token.length < 32 || body.token.length > 16000)
        throw new ChatError("INVALID_AUTH_TOKEN", "Invalid identity token.", 400);
      const identity = await auth.verifyToken(body.token);
      if (!identity.emailVerified)
        throw new ChatError(
          "EMAIL_UNVERIFIED",
          "Verify your email before opening the workspace.",
          403,
        );
      res.setHeader("Set-Cookie", auth.oauthJwtCookie(body.token));
      send(res, 200, { ok: true });
      return;
    }
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
    const botStore = new BotStore(db);
    const botControl = new BotControlStore(db);
    const botAccess = async () => {
      const account = await product.account();
      const plan = effectivePlan(account);
      const limits = botPlanLimits(plan);
      if (!limits.enabled)
        throw new ChatError("BOT_ENTITLEMENT_REQUIRED", "Odin Bot requires Pro or higher.", 403);
      return { account, plan, limits };
    };
    const createEngine = (
      database: NeonActorDatabase,
      conversationId?: string,
      signal?: AbortSignal,
    ) => {
      const githubReady = githubWorkspaceReady ? (githubToken as string) : undefined;
      const githubSession =
        githubReady && conversationId
          ? new GitHubWorkspaceSession(
              githubReady,
              githubConnection.repository,
              githubConnection.defaultBranch,
            )
          : undefined;
      const quality =
        githubSession ??
        (conversationId ? new NeonWorkspace(database, conversationId, async () => {}) : undefined);
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
                githubSession
                  ? githubSession.workspace(changed)
                  : new NeonWorkspace(database, conversationId, changed),
            }
          : {}),
        research: new WikipediaResearchAdapter("de"),
        ...(signal ? { signal } : {}),
      });
    };
    if (url.pathname === "/api/session" && method === "DELETE") {
      const cookieHeader = req.headers.cookie ?? "";
      if (auth.oauthJwt(cookieHeader)) {
        res.setHeader("Set-Cookie", auth.clearOauthJwtCookie());
        send(res, 200, { authenticated: false });
        return;
      }
      const response = await auth.upstream("sign-out", "POST", origin, cookieHeader, {});
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
        bot: {
          available: botPlanLimits(effectivePlan(account)).enabled,
          durable: true,
          path: "/bot",
        },
        workspace: githubWorkspaceReady
          ? {
              connected: true,
              writable: true,
              kind: "github",
              account: githubConnection.login,
              repository: githubConnection.repository,
              branch: githubConnection.defaultBranch,
              quality: "Changes run on an isolated Odin branch and require repository checks.",
            }
          : {
              connected: false,
              writable: false,
              kind: "github",
              account: githubConnection.connected ? githubConnection.login : null,
              repository: null,
              branch: null,
              quality: "Connect GitHub and choose a repository before starting Coding mode.",
            },
      });
      return;
    }
    if (url.pathname === "/api/bot" && method === "GET") {
      const { limits } = await botAccess();
      send(res, 200, {
        bot: await botStore.ensureDefaultBot(),
        tasks: await botStore.tasks(),
        automations: await botStore.automations(),
        approvals: await botControl.approvals(),
        inbox: await botStore.inbox(),
        team: botSpecialists(),
        limits,
        runtime: {
          durable: true,
          browserIndependent: true,
          scheduler: "github-oidc",
          wakeCadenceMinutes: 5,
          eventDrivenGitHub: true,
          pullRequestDelivery: true,
          proactiveLifecycleInbox: true,
        },
      });
      return;
    }
    if (url.pathname === "/api/bot/settings" && method === "POST") {
      await botAccess();
      const body = object(await jsonBody(req), ["autonomyLevel"]);
      const level = Number(body.autonomyLevel);
      if (!Number.isInteger(level) || level < 0 || level > 4)
        throw new ChatError("INVALID_AUTONOMY", "Choose autonomy level 0 through 4.");
      const bot = await botStore.ensureDefaultBot();
      send(res, 200, {
        autonomyLevel: await botControl.setBotAutonomy(bot.id, level as 0 | 1 | 2 | 3 | 4),
      });
      return;
    }
    if (url.pathname === "/api/bot/approvals" && method === "GET") {
      await botAccess();
      send(res, 200, { approvals: await botControl.approvals() });
      return;
    }
    const botApprovalRoute = /^\/api\/bot\/approvals\/([\w-]+)$/u.exec(url.pathname);
    if (botApprovalRoute && method === "POST") {
      await botAccess();
      const body = object(await jsonBody(req), ["decision", "actionHash"]);
      if (body.decision !== "approve" && body.decision !== "reject")
        throw new ChatError("INVALID_APPROVAL_DECISION", "Choose approve or reject.");
      send(res, 200, {
        approval: await botControl.decideApproval(
          identifier(botApprovalRoute[1]),
          body.decision,
          typeof body.actionHash === "string" ? body.actionHash : undefined,
        ),
      });
      return;
    }
    if (url.pathname === "/api/bot/memory") {
      await botAccess();
      const bot = await botStore.ensureDefaultBot();
      if (method === "GET") {
        send(res, 200, { memories: await botControl.memories(bot.id) });
        return;
      }
      if (method === "POST") {
        const body = object(await jsonBody(req), [
          "kind",
          "key",
          "content",
          "sourceRef",
          "scope",
          "confidence",
          "sensitivity",
          "expiresAt",
        ]);
        const kinds = new Set([
          "user_preference",
          "project",
          "recurring_task",
          "decision",
          "working_context",
          "previous_mission",
          "learned_procedure",
        ]);
        const sensitivities = new Set(["public", "internal", "sensitive"]);
        if (
          !kinds.has(String(body.kind)) ||
          !sensitivities.has(String(body.sensitivity ?? "internal"))
        )
          throw new ChatError("INVALID_MEMORY", "Choose a supported memory kind and sensitivity.");
        send(
          res,
          201,
          await botControl.remember(bot.id, {
            kind: String(body.kind) as
              | "user_preference"
              | "project"
              | "recurring_task"
              | "decision"
              | "working_context"
              | "previous_mission"
              | "learned_procedure",
            key: typeof body.key === "string" ? body.key : "",
            content: typeof body.content === "string" ? body.content : "",
            sourceClass: "explicit_user",
            sourceRef: typeof body.sourceRef === "string" ? body.sourceRef : "user:bot-memory",
            sourceTimestamp: new Date().toISOString(),
            scope:
              body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
                ? (body.scope as Record<string, unknown>)
                : {},
            confidence: typeof body.confidence === "number" ? body.confidence : 1,
            sensitivity: String(body.sensitivity ?? "internal") as
              | "public"
              | "internal"
              | "sensitive",
            expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
          }),
        );
        return;
      }
    }
    if (url.pathname === "/api/bot/tasks" && method === "POST") {
      await rate(db, "bot-tasks", 20, 60);
      const { limits } = await botAccess();
      const body = object(await jsonBody(req), [
        "goal",
        "mode",
        "modelId",
        "priority",
        "idempotencyKey",
      ]);
      const mode = ["chat", "thinking", "research", "coding", "ultra"].includes(
        String(body.mode ?? "thinking"),
      )
        ? (String(body.mode ?? "thinking") as keyof typeof MODE_MINIMUM_PLAN)
        : "thinking";
      const requiredPlan = MODE_MINIMUM_PLAN[mode];
      if (!planAllows((await botAccess()).plan, requiredPlan))
        throw new ChatError(
          "ENTITLEMENT_REQUIRED",
          `This bot task requires the ${requiredPlan} plan.`,
          403,
        );
      const task = await botStore.createTask(
        {
          goal: typeof body.goal === "string" ? body.goal : "",
          mode,
          modelId: typeof body.modelId === "string" ? body.modelId : null,
          priority: typeof body.priority === "number" ? body.priority : 50,
          idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
        },
        limits,
      );
      const worker = new OdinBotWorker({
        pool,
        baseModels: models,
        credentialEncryptionKey: process.env.ODIN_CREDENTIAL_ENCRYPTION_KEY,
        publicOrigin: process.env.ODIN_PUBLIC_ORIGIN ?? origin,
      });
      waitUntil(worker.runBatch(`request:${identity.id}`, 1, identity.id));
      send(res, 202, { task });
      return;
    }
    const botTaskRoute = /^\/api\/bot\/tasks\/([\w-]+)(?:\/(control))?$/u.exec(url.pathname);
    if (botTaskRoute) {
      const taskId = identifier(botTaskRoute[1]);
      await botAccess();
      if (!botTaskRoute[2] && method === "GET") {
        send(res, 200, {
          task: await botStore.task(taskId),
          events: await botStore.events(taskId),
          focus: await botControl.focus(taskId).catch(() => null),
        });
        return;
      }
      if (botTaskRoute[2] === "control" && method === "POST") {
        const body = object(await jsonBody(req), ["command"]);
        if (body.command !== "cancel")
          throw new ChatError("INVALID_COMMAND", "Only cancel is available in this milestone.");
        send(res, 200, { task: await botStore.cancel(taskId) });
        return;
      }
    }
    if (url.pathname === "/api/bot/automations/parse" && method === "POST") {
      await botAccess();
      const body = object(await jsonBody(req), ["instruction", "timeZone"]);
      send(
        res,
        200,
        parseAutomationText(
          typeof body.instruction === "string" ? body.instruction : "",
          typeof body.timeZone === "string" ? body.timeZone : "UTC",
        ),
      );
      return;
    }
    if (url.pathname === "/api/bot/automations") {
      const { limits } = await botAccess();
      if (method === "GET") {
        send(res, 200, { automations: await botStore.automations() });
        return;
      }
      if (method === "POST") {
        await rate(db, "bot-automations", 10, 60);
        const body = object(await jsonBody(req), ["instruction", "timeZone", "notificationPolicy"]);
        const instruction = typeof body.instruction === "string" ? body.instruction : "";
        const parsed = parseAutomationText(
          instruction,
          typeof body.timeZone === "string" ? body.timeZone : "UTC",
        );
        const notificationPolicy = ["critical", "important", "all", "digest", "silent"].includes(
          String(body.notificationPolicy ?? "important"),
        )
          ? (String(body.notificationPolicy ?? "important") as
              | "critical"
              | "important"
              | "all"
              | "digest"
              | "silent")
          : "important";
        const created = await botStore.createAutomation(
          instruction,
          parsed,
          limits,
          notificationPolicy,
        );
        if (parsed.trigger.kind === "event") {
          if (parsed.trigger.source !== "github") {
            await botStore.deleteAutomation(created.id);
            throw new ChatError(
              "AUTOMATION_SOURCE_UNAVAILABLE",
              "This event source is not available yet. GitHub repository events are supported.",
              409,
            );
          }
          if (!githubWorkspaceReady || !githubToken || !githubConnection.repository) {
            await botStore.deleteAutomation(created.id);
            throw new ChatError(
              "GITHUB_WORKSPACE_REQUIRED",
              "Connect GitHub and select a repository before creating a GitHub event automation.",
              409,
            );
          }
          try {
            await new GitHubEventBridge(pool, process.env.ODIN_PUBLIC_ORIGIN ?? origin).ensureHook(
              identity.id,
              githubToken,
              githubConnection.repository,
            );
          } catch (error) {
            await botStore.deleteAutomation(created.id);
            throw error;
          }
        }
        send(res, 201, created);
        return;
      }
    }
    const botAutomationRoute = /^\/api\/bot\/automations\/([\w-]+)$/u.exec(url.pathname);
    if (botAutomationRoute && method === "DELETE") {
      await botAccess();
      await jsonBody(req);
      await botStore.deleteAutomation(identifier(botAutomationRoute[1]));
      send(res, 200, { deleted: true });
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
      send(res, 200, { repositories: await new GitHubCatalog(token).repositories() });
      return;
    }
    if (url.pathname === "/api/github/branches" && method === "GET") {
      const token = await product.githubToken();
      if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
      const repository = url.searchParams.get("repository") ?? "";
      send(res, 200, { branches: await new GitHubCatalog(token).branches(repository) });
      return;
    }
    if (url.pathname === "/api/github/repository" && method === "PUT") {
      const body = object(await jsonBody(req), ["repository", "branch"]);
      const token = await product.githubToken();
      if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
      const verified = await new GitHubCatalog(token).verifySelection(
        String(body.repository ?? ""),
        String(body.branch ?? ""),
      );
      await product.selectRepository(verified.repository.fullName, verified.branch.name);
      if ((await botStore.eventAutomations("github")).length) {
        await new GitHubEventBridge(pool, process.env.ODIN_PUBLIC_ORIGIN ?? origin).ensureHook(
          identity.id,
          token,
          verified.repository.fullName,
        );
      }
      send(res, 200, await product.github());
      return;
    }
    if (url.pathname === "/api/github" && method === "DELETE") {
      const token = await product.githubToken();
      if (token) {
        await new GitHubEventBridge(pool, process.env.ODIN_PUBLIC_ORIGIN ?? origin).disconnectHook(
          identity.id,
          token,
        );
      }
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
          "bots",
          "bot_tasks",
          "bot_task_events",
          "bot_automations",
          "bot_inbox",
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
      if (githubToken) {
        await new GitHubEventBridge(pool, process.env.ODIN_PUBLIC_ORIGIN ?? origin).disconnectHook(
          identity.id,
          githubToken,
        );
      }
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
          "bot_inbox",
          "bot_task_events",
          "bot_automations",
          "bot_tasks",
          "bots",
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
        const run = (async () => {
          const controller = new AbortController();
          const workerDb = new NeonActorDatabase(pool, identity, { resource, token: lease });
          const worker = createEngine(workerDb, found.conversationId, controller.signal);
          let checking = false;
          const monitor = setInterval(() => {
            if (checking) return;
            checking = true;
            void (async () => {
              try {
                const view = await engine.view(id);
                if (["PAUSED", "CANCELLED", "BLOCKED", "FAILED"].includes(view.state))
                  controller.abort();
              } catch {
                controller.abort();
              } finally {
                checking = false;
              }
            })();
          }, 1000);
          try {
            await worker.execute(id);
          } finally {
            clearInterval(monitor);
            await db.release(resource, lease);
          }
        })();
        // A browser reload must not cancel server-side work. Vercel owns the bounded promise
        // after this acknowledgement and the database lease fences duplicate workers.
        waitUntil(run);
        send(res, 202, { accepted: true, turn: await engine.view(id) });
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
