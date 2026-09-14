import { createHash, randomUUID } from "node:crypto";
import type { ApprovalEvidence, ToolRiskClass } from "../tools/types.js";
import { InMemoryCapabilityPolicy } from "../tools/policy.js";
import { ChatError } from "./types.js";

export const BROWSER_OPERATIONS = [
  "navigate",
  "read",
  "search",
  "extract",
  "download",
  "fill",
  "click",
  "submit",
  "upload",
  "send",
  "publish",
  "delete",
  "purchase",
] as const;
export type BrowserOperation = (typeof BROWSER_OPERATIONS)[number];
export type BrowserSessionState = "ACTIVE" | "PAUSED" | "OUTCOME_UNKNOWN" | "COMPLETED";
export type BrowserRiskProfile = "READ_ONLY" | "ASSISTED" | "CONTROLLED";
export type BrowserOutcome = "EXECUTED" | "NOT_EXECUTED" | "UNKNOWN";

export interface BrowserSession {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly allowedOrigins: readonly string[];
  readonly riskProfile: BrowserRiskProfile;
  readonly state: BrowserSessionState;
  readonly currentUrl: string | null;
  readonly lastSafeActionId: string | null;
  readonly pendingActionId: string | null;
  readonly actionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface BrowserPageEvidence {
  readonly url: string;
  readonly status: number;
  readonly title: string;
  readonly text: string;
  readonly links: readonly { readonly text: string; readonly url: string }[];
  readonly forms: readonly {
    readonly action: string;
    readonly method: "GET" | "POST";
    readonly fields: readonly {
      readonly name: string;
      readonly type: string;
      readonly required: boolean;
    }[];
  }[];
  readonly contentHash: string;
  readonly trust: "UNTRUSTED_WEB_CONTENT";
}

export interface BrowserActionRequest {
  readonly operation: BrowserOperation;
  readonly url: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly workspaceItemId?: string;
  readonly approval?: ApprovalEvidence;
}

export interface BrowserActionDecision {
  readonly actionId: string;
  readonly operation: BrowserOperation;
  readonly targetUrl: string;
  readonly riskClass: ToolRiskClass;
  readonly approvalRequired: boolean;
  readonly dataSummary: string;
}

export interface BrowserEventLike {
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: string;
}

const MAX_ORIGINS = 8;
const MAX_ACTIONS = 100;
const SESSION_TTL_MS = 60 * 60 * 1000;

export function createBrowserSession(input: {
  readonly ownerId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly allowedOrigins: readonly string[];
  readonly riskProfile?: BrowserRiskProfile;
  readonly now?: Date;
}): BrowserSession {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);
  return Object.freeze({
    id: randomUUID(),
    ownerId: required(input.ownerId, "owner"),
    projectId: required(input.projectId, "Project"),
    runId: required(input.runId, "Run"),
    allowedOrigins,
    riskProfile: input.riskProfile ?? "ASSISTED",
    state: "ACTIVE" as const,
    currentUrl: null,
    lastSafeActionId: null,
    pendingActionId: null,
    actionCount: 0,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  });
}

export function normalizeAllowedOrigins(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ORIGINS)
    throw new ChatError("BROWSER_SCOPE", "Choose between one and eight browser origins.");
  const normalized = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ChatError("BROWSER_SCOPE", "Browser origin is malformed.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !url.hostname
    )
      throw new ChatError("BROWSER_SCOPE", "Browser scope must contain exact HTTPS origins only.");
    return url.origin.toLowerCase();
  });
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length)
    throw new ChatError("BROWSER_SCOPE", "Browser scope contains duplicate origins.");
  return Object.freeze(unique);
}

export function assertBrowserTarget(session: BrowserSession, rawUrl: string): string {
  assertSessionUsable(session);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ChatError("BROWSER_TARGET", "Browser destination is malformed.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new ChatError("BROWSER_TARGET", "Browser destination must be a clean HTTPS URL.");
  if (!session.allowedOrigins.includes(url.origin.toLowerCase()))
    throw new ChatError(
      "BROWSER_REDIRECT_DENIED",
      "Browser destination escaped the approved origin scope.",
      403,
    );
  return url.toString();
}

export function browserRisk(operation: BrowserOperation): ToolRiskClass {
  if (["navigate", "read", "search", "extract", "download"].includes(operation)) return "low";
  if (operation === "fill") return "medium";
  return "high";
}

export function authorizeBrowserAction(
  session: BrowserSession,
  request: BrowserActionRequest,
  now = new Date(),
): BrowserActionDecision {
  assertSessionUsable(session, now);
  if (!BROWSER_OPERATIONS.includes(request.operation))
    throw new ChatError("BROWSER_ACTION", "Browser operation is unsupported.");
  if (session.state === "OUTCOME_UNKNOWN")
    throw new ChatError(
      "BROWSER_OUTCOME_UNKNOWN",
      "Resolve the previous uncertain external action before doing anything else.",
      409,
    );
  if (session.actionCount >= MAX_ACTIONS)
    throw new ChatError("BROWSER_ACTION_LIMIT", "This browser session reached its action limit.", 429);

  const targetUrl = assertBrowserTarget(session, request.url);
  const riskClass = browserRisk(request.operation);
  if (session.riskProfile === "READ_ONLY" && riskClass !== "low")
    throw new ChatError("BROWSER_READ_ONLY", "This browser session is read only.", 403);
  if (session.riskProfile === "ASSISTED" && request.operation === "purchase")
    throw new ChatError(
      "BROWSER_FINANCIAL_SCOPE",
      "Financial commitment is disabled for this browser session.",
      403,
    );
  if ((request.operation === "upload" || request.operation === "publish") && !request.workspaceItemId)
    throw new ChatError(
      "BROWSER_WORKSPACE_FILE_REQUIRED",
      "Only an explicit Project Workspace item may be uploaded or published.",
      400,
    );

  const operation = riskClass === "low" ? "read" : riskClass === "medium" ? "write" : "execute";
  const grants = session.allowedOrigins.map((origin, index) => ({
    grantId: `${session.id}:${operation}:${index}`,
    missionId: session.runId,
    taskId: session.id,
    tool: riskClass === "low" ? "browser.observe" : "browser.act",
    operation,
    resourcePrefix: origin,
    maxCalls: MAX_ACTIONS,
    expiresAt: session.expiresAt,
  }) as const);
  const policy = new InMemoryCapabilityPolicy(grants);
  const authorization = policy.authorizeAndConsume({
    missionId: session.runId,
    taskId: session.id,
    tool: riskClass === "low" ? "browser.observe" : "browser.act",
    operation,
    resource: targetUrl,
    riskClass,
    now: now.toISOString(),
    ...(request.approval === undefined ? {} : { approval: request.approval }),
  });
  if (authorization.decision === "REQUIRE_APPROVAL")
    throw new ChatError(
      "BROWSER_APPROVAL_REQUIRED",
      "This external action needs explicit matching approval before Odin can execute it.",
      409,
    );
  if (authorization.decision !== "ALLOW")
    throw new ChatError("BROWSER_POLICY_DENIED", authorization.reason, 403);

  return Object.freeze({
    actionId: randomUUID(),
    operation: request.operation,
    targetUrl,
    riskClass,
    approvalRequired: riskClass === "high",
    dataSummary: summarizeSubmission(request),
  });
}

export function approvalForBrowserAction(input: {
  readonly approvalId: string;
  readonly session: BrowserSession;
  readonly expiresAt: string;
}): ApprovalEvidence {
  return {
    approvalId: required(input.approvalId, "approval"),
    missionId: input.session.runId,
    taskId: input.session.id,
    tool: "browser.act",
    expiresAt: input.expiresAt,
  };
}

export function applyBrowserEvent(
  session: BrowserSession,
  event: BrowserEventLike,
): BrowserSession {
  if (event.data.sessionId !== session.id) return session;
  const at = iso(event.createdAt);
  if (event.type === "browser.page.opened") {
    const url = typeof event.data.url === "string" ? assertBrowserTarget(session, event.data.url) : null;
    return Object.freeze({ ...session, currentUrl: url, updatedAt: at });
  }
  if (event.type === "browser.form.prepared") {
    return Object.freeze({ ...session, updatedAt: at });
  }
  if (event.type === "browser.action.executed") {
    const actionId = stringOrNull(event.data.actionId);
    return Object.freeze({
      ...session,
      state: "ACTIVE" as const,
      lastSafeActionId: actionId,
      pendingActionId: null,
      actionCount: session.actionCount + 1,
      updatedAt: at,
    });
  }
  if (event.type === "browser.action.failed") {
    return Object.freeze({
      ...session,
      pendingActionId: null,
      actionCount: session.actionCount + 1,
      updatedAt: at,
    });
  }
  if (event.type === "browser.action.outcome_unknown") {
    return Object.freeze({
      ...session,
      state: "OUTCOME_UNKNOWN" as const,
      pendingActionId: stringOrNull(event.data.actionId),
      actionCount: session.actionCount + 1,
      updatedAt: at,
    });
  }
  if (event.type === "browser.action.reconciled") {
    const outcome = event.data.outcome;
    if (outcome !== "EXECUTED" && outcome !== "NOT_EXECUTED" && outcome !== "UNKNOWN")
      return session;
    return Object.freeze({
      ...session,
      state: outcome === "UNKNOWN" ? ("OUTCOME_UNKNOWN" as const) : ("ACTIVE" as const),
      lastSafeActionId:
        outcome === "EXECUTED" ? session.pendingActionId : session.lastSafeActionId,
      pendingActionId: outcome === "UNKNOWN" ? session.pendingActionId : null,
      updatedAt: at,
    });
  }
  if (event.type === "browser.session.paused")
    return Object.freeze({ ...session, state: "PAUSED" as const, updatedAt: at });
  if (event.type === "browser.session.resumed")
    return Object.freeze({ ...session, state: "ACTIVE" as const, updatedAt: at });
  if (event.type === "browser.session.completed")
    return Object.freeze({ ...session, state: "COMPLETED" as const, updatedAt: at });
  return session;
}

export function pageEvidence(input: {
  readonly url: string;
  readonly status: number;
  readonly title?: string;
  readonly text: string;
  readonly links?: readonly { readonly text: string; readonly url: string }[];
  readonly forms?: BrowserPageEvidence["forms"];
}): BrowserPageEvidence {
  const text = boundedText(input.text, 200_000);
  const title = boundedText(input.title ?? "", 500);
  const links = (input.links ?? []).slice(0, 100).map((link) => ({
    text: boundedText(link.text, 500),
    url: boundedText(link.url, 4_000),
  }));
  const forms = (input.forms ?? []).slice(0, 20).map((form) => ({
    action: boundedText(form.action, 4_000),
    method: form.method,
    fields: form.fields.slice(0, 100).map((field) => ({
      name: boundedText(field.name, 300),
      type: boundedText(field.type, 80),
      required: field.required === true,
    })),
  }));
  return Object.freeze({
    url: boundedText(input.url, 4_000),
    status: input.status,
    title,
    text,
    links: Object.freeze(links),
    forms: Object.freeze(forms),
    contentHash: createHash("sha256").update(text).digest("hex"),
    trust: "UNTRUSTED_WEB_CONTENT" as const,
  });
}

export function validateDownload(input: {
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
}): { readonly filename: string; readonly mimeType: string; readonly size: number } {
  const filename = required(input.filename, "filename");
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".." ||
    filename.includes("\u0000")
  )
    throw new ChatError("BROWSER_DOWNLOAD_NAME", "Downloaded filename is unsafe.");
  if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > 10 * 1024 * 1024)
    throw new ChatError("BROWSER_DOWNLOAD_LIMIT", "Download exceeds the 10 MB Workspace limit.", 413);
  const mimeType = required(input.mimeType, "MIME type").toLowerCase();
  const allowed = ["text/", "application/json", "application/pdf", "image/png", "image/jpeg", "image/webp"];
  if (!allowed.some((prefix) => mimeType === prefix || mimeType.startsWith(prefix)))
    throw new ChatError("BROWSER_DOWNLOAD_TYPE", "Downloaded file type is not allowed.", 415);
  return Object.freeze({ filename, mimeType, size: input.size });
}

export function assertSessionOwnership(
  session: BrowserSession,
  ownerId: string,
  projectId: string,
  runId?: string,
): void {
  if (
    session.ownerId !== ownerId ||
    session.projectId !== projectId ||
    (runId !== undefined && session.runId !== runId)
  )
    throw new ChatError("BROWSER_SCOPE", "Browser session does not belong to this user/Project/Run.", 403);
}

function assertSessionUsable(session: BrowserSession, now = new Date()): void {
  if (Date.parse(session.expiresAt) <= now.getTime())
    throw new ChatError("BROWSER_SESSION_EXPIRED", "Browser session expired. Start a new session.", 409);
  if (session.state === "COMPLETED")
    throw new ChatError("BROWSER_SESSION_COMPLETE", "Browser session is already complete.", 409);
  if (session.state === "PAUSED")
    throw new ChatError("BROWSER_SESSION_PAUSED", "Resume the browser session before continuing.", 409);
}

function summarizeSubmission(request: BrowserActionRequest): string {
  const names = Object.keys(request.fields ?? {}).sort();
  if (names.length === 0)
    return request.workspaceItemId ? "Explicit Workspace resource" : "No form fields";
  return `${names.length} field${names.length === 1 ? "" : "s"}: ${names.slice(0, 8).join(", ")}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function required(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ChatError("BROWSER_INPUT", `${label} is required.`);
  return boundedText(value.trim(), 4_000);
}

function boundedText(value: string, max: number): string {
  if (typeof value !== "string") throw new ChatError("BROWSER_INPUT", "Browser text must be text.");
  if (value.length > max) throw new ChatError("BROWSER_INPUT_LIMIT", "Browser data exceeded its bounded limit.", 413);
  return value;
}

function iso(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new ChatError("BROWSER_EVENT", "Browser event time is invalid.", 500);
  return new Date(time).toISOString();
}
