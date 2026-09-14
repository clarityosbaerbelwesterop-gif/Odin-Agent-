import { createHash, randomUUID } from "node:crypto";
import { SecureBrowserHttpClient } from "./browser-http.js";
import {
  applyBrowserEvent,
  approvalForBrowserAction,
  assertBrowserTarget,
  assertSessionOwnership,
  authorizeBrowserAction,
  type BrowserActionRequest,
  type BrowserOutcome,
  type BrowserRiskProfile,
  type BrowserSession,
  browserRisk,
  createBrowserSession,
} from "./browser-mode.js";
import type { ActorDatabase } from "./neon-database.js";
import { NeonChatStore } from "./neon-store.js";
import { identifier, safeText } from "./safety.js";
import { ChatError, type ChatEvent } from "./types.js";

interface PreparedAction {
  readonly actionId: string;
  readonly sessionId: string;
  readonly requestHash: string;
  readonly operation: BrowserActionRequest["operation"];
  readonly targetUrl: string;
  readonly riskClass: "high";
  readonly dataSummary: string;
  readonly expiresAt: string;
}

export class BrowserProductStore {
  readonly chat: NeonChatStore;
  readonly #http: SecureBrowserHttpClient;

  constructor(
    readonly db: ActorDatabase,
    readonly userId: string,
    http: SecureBrowserHttpClient = new SecureBrowserHttpClient(),
  ) {
    this.chat = new NeonChatStore(db);
    this.#http = http;
  }

  async start(
    projectId: string,
    runId: string,
    allowedOrigins: readonly string[],
    riskProfile: BrowserRiskProfile = "ASSISTED",
  ): Promise<BrowserSession> {
    const project = identifier(projectId);
    const run = identifier(runId);
    await this.chat.conversation(project);
    const turn = await this.chat.turn(run);
    if (turn.conversationId !== project)
      throw new ChatError(
        "BROWSER_RUN_SCOPE",
        "The selected Run does not belong to this Project.",
        403,
      );
    const session = createBrowserSession({
      ownerId: this.userId,
      projectId: project,
      runId: run,
      allowedOrigins,
      riskProfile,
    });
    await this.chat.emit(turn, "browser.session.started", { session });
    return session;
  }

  async list(projectId: string): Promise<readonly BrowserSession[]> {
    const project = identifier(projectId);
    await this.chat.conversation(project);
    const events = await this.chat.events(project, 0, 1000);
    const sessions = new Map<string, BrowserSession>();
    for (const event of events) {
      if (event.type === "browser.session.started") {
        const session = browserSessionFromStart(event);
        if (session.ownerId === this.userId && session.projectId === project)
          sessions.set(session.id, session);
        continue;
      }
      const sessionId = typeof event.data.sessionId === "string" ? event.data.sessionId : "";
      const current = sessions.get(sessionId);
      if (current) sessions.set(sessionId, applyBrowserEvent(current, event));
    }
    return [...sessions.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 50);
  }

  async session(projectId: string, sessionId: string): Promise<BrowserSession> {
    const project = identifier(projectId);
    const id = identifier(sessionId);
    const session = (await this.list(project)).find((candidate) => candidate.id === id);
    if (!session)
      throw new ChatError("BROWSER_SESSION_NOT_FOUND", "Browser session was not found.", 404);
    assertSessionOwnership(session, this.userId, project);
    return session;
  }

  async observe(projectId: string, sessionId: string, rawUrl: string) {
    const session = await this.session(projectId, sessionId);
    const targetUrl = assertBrowserTarget(session, safeText(rawUrl, 4_000));
    authorizeBrowserAction(session, { operation: "navigate", url: targetUrl });
    const evidence = await this.#http.observe(
      targetUrl,
      session.allowedOrigins,
      AbortSignal.timeout(25_000),
    );
    assertBrowserTarget(session, evidence.url);
    await this.emit(session, "browser.page.opened", {
      sessionId: session.id,
      url: evidence.url,
      status: evidence.status,
      title: evidence.title,
      contentHash: evidence.contentHash,
      trust: evidence.trust,
    });
    await this.emit(session, "browser.content.read", {
      sessionId: session.id,
      url: evidence.url,
      contentHash: evidence.contentHash,
      linkCount: evidence.links.length,
      formCount: evidence.forms.length,
      trust: evidence.trust,
    });
    return { session: await this.session(projectId, sessionId), evidence };
  }

  async prepareAction(
    projectId: string,
    sessionId: string,
    request: BrowserActionRequest,
  ): Promise<PreparedAction | { readonly approvalRequired: false; readonly requestHash: string }> {
    const session = await this.session(projectId, sessionId);
    const targetUrl = assertBrowserTarget(session, safeText(request.url, 4_000));
    const normalized = normalizeActionRequest(request, targetUrl);
    const riskClass = browserRisk(normalized.operation);
    const requestHash = actionHash(normalized);
    if (riskClass !== "high") {
      authorizeBrowserAction(session, normalized);
      if (normalized.operation === "fill")
        await this.emit(session, "browser.form.prepared", {
          sessionId: session.id,
          url: targetUrl,
          fieldNames: Object.keys(normalized.fields ?? {})
            .sort()
            .slice(0, 100),
          requestHash,
        });
      return { approvalRequired: false, requestHash };
    }

    // Calling the canonical Tool policy without approval validates every other boundary.
    try {
      authorizeBrowserAction(session, normalized);
      throw new ChatError(
        "BROWSER_POLICY",
        "High-risk browser action unexpectedly bypassed approval.",
        500,
      );
    } catch (error) {
      if (!(error instanceof ChatError) || error.code !== "BROWSER_APPROVAL_REQUIRED") throw error;
    }
    const actionId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const dataSummary = summarize(normalized);
    const prepared: PreparedAction = {
      actionId,
      sessionId: session.id,
      requestHash,
      operation: normalized.operation,
      targetUrl,
      riskClass: "high",
      dataSummary,
      expiresAt,
    };
    await this.emit(session, "browser.approval.required", {
      ...prepared,
      fieldNames: Object.keys(normalized.fields ?? {})
        .sort()
        .slice(0, 100),
      workspaceItemId: normalized.workspaceItemId ?? null,
      irreversible: ["submit", "send", "publish", "delete", "purchase"].includes(
        normalized.operation,
      ),
    });
    return prepared;
  }

  async approve(projectId: string, sessionId: string, actionId: string): Promise<void> {
    const session = await this.session(projectId, sessionId);
    const prepared = await this.preparedAction(session, identifier(actionId));
    if (Date.parse(prepared.expiresAt) <= Date.now())
      throw new ChatError(
        "BROWSER_APPROVAL_EXPIRED",
        "This browser approval request expired.",
        409,
      );
    await this.emit(session, "browser.approval.granted", {
      sessionId: session.id,
      actionId: prepared.actionId,
      requestHash: prepared.requestHash,
      approvedBy: this.userId,
      expiresAt: prepared.expiresAt,
    });
  }

  async execute(
    projectId: string,
    sessionId: string,
    request: BrowserActionRequest,
    preparedActionId?: string,
  ) {
    const session = await this.session(projectId, sessionId);
    const targetUrl = assertBrowserTarget(session, safeText(request.url, 4_000));
    const normalized = normalizeActionRequest(request, targetUrl);
    const riskClass = browserRisk(normalized.operation);
    let actionId: string | undefined;
    let approval: ReturnType<typeof approvalForBrowserAction> | undefined;
    if (riskClass === "high") {
      if (!preparedActionId)
        throw new ChatError(
          "BROWSER_APPROVAL_REQUIRED",
          "Prepare and approve this external action first.",
          409,
        );
      const prepared = await this.preparedAction(session, identifier(preparedActionId));
      if (prepared.requestHash !== actionHash(normalized))
        throw new ChatError(
          "BROWSER_APPROVAL_MISMATCH",
          "Action changed after approval review.",
          409,
        );
      const granted = await this.grantedApproval(session, prepared);
      approval = approvalForBrowserAction({
        approvalId: granted.actionId,
        session,
        expiresAt: granted.expiresAt,
      });
      actionId = prepared.actionId;
    }
    const decision = authorizeBrowserAction(
      session,
      approval === undefined ? normalized : { ...normalized, approval },
    );
    actionId ??= decision.actionId;

    if (normalized.operation === "fill") {
      await this.emit(session, "browser.form.prepared", {
        sessionId: session.id,
        actionId,
        url: targetUrl,
        fieldNames: Object.keys(normalized.fields ?? {})
          .sort()
          .slice(0, 100),
        requestHash: actionHash(normalized),
      });
      return {
        outcome: "NOT_EXECUTED" as const,
        actionId,
        session: await this.session(projectId, sessionId),
      };
    }

    try {
      if (normalized.operation === "click") {
        const evidence = await this.#http.observe(
          targetUrl,
          session.allowedOrigins,
          AbortSignal.timeout(25_000),
        );
        await this.emit(session, "browser.action.executed", {
          sessionId: session.id,
          actionId,
          operation: normalized.operation,
          url: evidence.url,
          status: evidence.status,
        });
        await this.emit(session, "browser.page.opened", {
          sessionId: session.id,
          url: evidence.url,
          status: evidence.status,
          title: evidence.title,
          contentHash: evidence.contentHash,
          trust: evidence.trust,
        });
        return {
          outcome: "EXECUTED" as const,
          actionId,
          evidence,
          session: await this.session(projectId, sessionId),
        };
      }
      if (normalized.operation !== "submit")
        throw new ChatError(
          "BROWSER_CONNECTION_REQUIRED",
          "This action requires a supported connected application; generic browser execution is intentionally unavailable.",
          409,
        );
      const result = await this.#http.submitForm(
        targetUrl,
        normalized.fields ?? {},
        session.allowedOrigins,
        AbortSignal.timeout(25_000),
      );
      if (result.outcome === "UNKNOWN") {
        await this.emit(session, "browser.action.outcome_unknown", {
          sessionId: session.id,
          actionId,
          operation: normalized.operation,
          url: targetUrl,
        });
      } else {
        await this.emit(session, "browser.action.executed", {
          sessionId: session.id,
          actionId,
          operation: normalized.operation,
          url: result.finalUrl,
          status: result.status,
        });
      }
      return { ...result, actionId, session: await this.session(projectId, sessionId) };
    } catch (error) {
      if (error instanceof ChatError && error.code === "BROWSER_CONNECTION_REQUIRED") throw error;
      await this.emit(session, "browser.action.failed", {
        sessionId: session.id,
        actionId,
        operation: normalized.operation,
        url: targetUrl,
        error: error instanceof ChatError ? error.code : "BROWSER_ACTION_FAILED",
      });
      throw error;
    }
  }

  async reconcile(
    projectId: string,
    sessionId: string,
    outcome: BrowserOutcome,
  ): Promise<BrowserSession> {
    const session = await this.session(projectId, sessionId);
    if (session.state !== "OUTCOME_UNKNOWN" || !session.pendingActionId)
      throw new ChatError(
        "BROWSER_RECONCILE",
        "There is no uncertain browser action to reconcile.",
        409,
      );
    if (outcome === "UNKNOWN")
      throw new ChatError(
        "BROWSER_RECONCILE",
        "Provide verified external state before clearing an uncertain action.",
        409,
      );
    await this.emit(session, "browser.action.reconciled", {
      sessionId: session.id,
      actionId: session.pendingActionId,
      outcome,
      verifiedBy: this.userId,
    });
    return this.session(projectId, sessionId);
  }

  async control(projectId: string, sessionId: string, action: "pause" | "resume" | "complete") {
    const session = await this.session(projectId, sessionId);
    const event =
      action === "pause"
        ? "browser.session.paused"
        : action === "resume"
          ? "browser.session.resumed"
          : "browser.session.completed";
    await this.emit(session, event, { sessionId: session.id });
    return this.session(projectId, sessionId);
  }

  private async preparedAction(session: BrowserSession, actionId: string): Promise<PreparedAction> {
    const events = await this.chat.events(session.projectId, 0, 1000);
    const event = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "browser.approval.required" &&
          candidate.data.sessionId === session.id &&
          candidate.data.actionId === actionId,
      );
    if (!event)
      throw new ChatError(
        "BROWSER_APPROVAL_NOT_FOUND",
        "Browser approval request was not found.",
        404,
      );
    const operation = event.data.operation;
    if (
      typeof operation !== "string" ||
      !["click", "submit", "upload", "send", "publish", "delete", "purchase"].includes(operation)
    )
      throw new ChatError("BROWSER_APPROVAL_INVALID", "Browser approval evidence is invalid.", 500);
    return {
      actionId,
      sessionId: session.id,
      requestHash: requiredEventString(event, "requestHash"),
      operation: operation as PreparedAction["operation"],
      targetUrl: requiredEventString(event, "targetUrl"),
      riskClass: "high",
      dataSummary: requiredEventString(event, "dataSummary"),
      expiresAt: requiredEventString(event, "expiresAt"),
    };
  }

  private async grantedApproval(session: BrowserSession, prepared: PreparedAction) {
    const events = await this.chat.events(session.projectId, 0, 1000);
    const event = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "browser.approval.granted" &&
          candidate.data.sessionId === session.id &&
          candidate.data.actionId === prepared.actionId &&
          candidate.data.requestHash === prepared.requestHash &&
          candidate.data.approvedBy === this.userId,
      );
    if (!event)
      throw new ChatError("BROWSER_APPROVAL_REQUIRED", "Explicit approval is still required.", 409);
    const expiresAt = requiredEventString(event, "expiresAt");
    if (Date.parse(expiresAt) <= Date.now())
      throw new ChatError(
        "BROWSER_APPROVAL_EXPIRED",
        "Browser approval expired before execution.",
        409,
      );
    return { actionId: prepared.actionId, expiresAt };
  }

  private async emit(session: BrowserSession, type: string, data: Record<string, unknown>) {
    const turn = await this.chat.turn(session.runId);
    if (turn.conversationId !== session.projectId)
      throw new ChatError(
        "BROWSER_RUN_SCOPE",
        "Run scope changed while recording browser evidence.",
        409,
      );
    return this.chat.emit(turn, type, data);
  }
}

function browserSessionFromStart(event: ChatEvent): BrowserSession {
  const value = event.data.session;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChatError("BROWSER_EVENT", "Browser session evidence is malformed.", 500);
  const raw = value as Record<string, unknown>;
  const allowedOrigins = raw.allowedOrigins;
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.every((item) => typeof item === "string"))
    throw new ChatError("BROWSER_EVENT", "Browser session scope evidence is malformed.", 500);
  const riskProfile = raw.riskProfile;
  if (riskProfile !== "READ_ONLY" && riskProfile !== "ASSISTED" && riskProfile !== "CONTROLLED")
    throw new ChatError("BROWSER_EVENT", "Browser risk profile evidence is malformed.", 500);
  return Object.freeze({
    id: requiredRaw(raw, "id"),
    ownerId: requiredRaw(raw, "ownerId"),
    projectId: requiredRaw(raw, "projectId"),
    runId: requiredRaw(raw, "runId"),
    allowedOrigins: Object.freeze([...allowedOrigins]),
    riskProfile,
    state: "ACTIVE" as const,
    currentUrl: null,
    lastSafeActionId: null,
    pendingActionId: null,
    actionCount: 0,
    createdAt: requiredRaw(raw, "createdAt"),
    updatedAt: requiredRaw(raw, "updatedAt"),
    expiresAt: requiredRaw(raw, "expiresAt"),
  });
}

function normalizeActionRequest(
  request: BrowserActionRequest,
  targetUrl: string,
): BrowserActionRequest {
  const fields = request.fields
    ? Object.fromEntries(
        Object.entries(request.fields)
          .slice(0, 100)
          .map(([key, value]) => [safeText(key, 300), safeText(value, 4_000)]),
      )
    : undefined;
  return {
    operation: request.operation,
    url: targetUrl,
    ...(fields === undefined ? {} : { fields }),
    ...(request.workspaceItemId === undefined
      ? {}
      : { workspaceItemId: identifier(request.workspaceItemId) }),
  };
}

function actionHash(request: BrowserActionRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        operation: request.operation,
        url: request.url,
        fields: Object.fromEntries(
          Object.entries(request.fields ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        ),
        workspaceItemId: request.workspaceItemId ?? null,
      }),
    )
    .digest("hex");
}

function summarize(request: BrowserActionRequest): string {
  const names = Object.keys(request.fields ?? {}).sort();
  return names.length
    ? `${names.length} form field${names.length === 1 ? "" : "s"}: ${names.slice(0, 8).join(", ")}`
    : request.workspaceItemId
      ? "Explicit Project Workspace resource"
      : "No form fields";
}

function requiredEventString(event: ChatEvent, key: string): string {
  const value = event.data[key];
  if (typeof value !== "string" || !value)
    throw new ChatError("BROWSER_EVENT", `Browser ${key} evidence is malformed.`, 500);
  return value;
}
function requiredRaw(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || !value)
    throw new ChatError("BROWSER_EVENT", `Browser session ${key} is malformed.`, 500);
  return value;
}
