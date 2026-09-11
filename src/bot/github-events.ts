import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { ActorDatabase } from "../chat/neon-database.js";
import { ChatError } from "../chat/types.js";
import {
  githubEventMatches,
  type NormalizedGitHubEvent,
  normalizeGitHubEvent,
  proactiveGitHubSignal,
  verifyGitHubWebhookSignature,
} from "./github-event-policy.js";
import { BotStore } from "./store.js";
import type { BotPlanLimits } from "./types.js";

const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const DELIVERY = /^[A-Za-z0-9-]{8,128}$/u;
const EVENT = /^(?:pull_request|pull_request_review|check_run|workflow_run|push|ping)$/u;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function validRepository(value: string): string {
  if (!REPOSITORY.test(value))
    throw new ChatError("GITHUB_REPOSITORY_INVALID", "Selected GitHub repository is invalid.");
  return value;
}

function validOwner(value: string): string {
  const hasControl = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!value || value.length > 200 || hasControl)
    throw new ChatError("BOT_EVENT_OWNER", "Bot event owner is invalid.", 500);
  return value;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface AuthenticatedGitHubDelivery {
  ownerId: string;
  deliveryId: string;
  duplicate: boolean;
  event: NormalizedGitHubEvent;
}

export class GitHubEventBridge {
  readonly origin: string;

  constructor(
    readonly pool: Pool,
    publicOrigin: string,
    readonly request: typeof fetch = fetch,
  ) {
    const parsed = new URL(publicOrigin);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new ChatError("BOT_EVENT_ORIGIN", "A secure public Odin origin is required.", 500);
    this.origin = parsed.origin;
  }

  async #github(
    token: string,
    repository: string,
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.request(`https://api.github.com/repos/${repository}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Odin-Agent",
        ...init.headers,
      },
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok && !(init.method === "DELETE" && response.status === 404))
      throw new ChatError(
        response.status === 401 || response.status === 403
          ? "GITHUB_PERMISSION_DENIED"
          : "GITHUB_UPSTREAM",
        response.status === 401 || response.status === 403
          ? "GitHub permission is required to manage Odin repository events."
          : "GitHub event configuration failed.",
        response.status === 401 || response.status === 403 ? 403 : 502,
      );
    if (response.status === 204 || response.status === 404) return {};
    return response.json();
  }

  async #deleteRemoteHook(token: string, repository: string, hookId: string): Promise<void> {
    if (!/^\d{1,30}$/u.test(hookId)) return;
    await this.#github(token, repository, `/hooks/${hookId}`, { method: "DELETE" });
  }

  async ensureHook(
    ownerId: string,
    githubToken: string,
    repository: string,
  ): Promise<{
    repository: string;
    connected: boolean;
  }> {
    const owner = validOwner(ownerId);
    const repo = validRepository(repository);
    const existing = (
      await this.pool.query(
        "SELECT repository,hook_id FROM odin_control.bot_github_hooks WHERE owner_id=$1",
        [owner],
      )
    ).rows[0];
    if (existing?.repository === repo && typeof existing.hook_id === "string")
      return { repository: repo, connected: true };

    if (existing) {
      await this.#deleteRemoteHook(
        githubToken,
        String(existing.repository),
        String(existing.hook_id),
      ).catch(() => undefined);
      await this.pool.query("DELETE FROM odin_control.bot_github_hooks WHERE owner_id=$1", [owner]);
    }

    const secret = randomBytes(32).toString("base64url");
    const callback = `${this.origin}/api/bot/events/github/${secret}`;
    const created = asRecord(
      await this.#github(githubToken, repo, "/hooks", {
        method: "POST",
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["pull_request", "pull_request_review", "check_run", "workflow_run", "push"],
          config: {
            url: callback,
            content_type: "json",
            secret,
            insecure_ssl: "0",
          },
        }),
      }),
    );
    const hookId = Number.isSafeInteger(created.id) ? String(created.id) : "";
    if (!/^\d{1,30}$/u.test(hookId))
      throw new ChatError("GITHUB_UPSTREAM", "GitHub did not confirm the event hook.", 502);

    try {
      const inserted = await this.pool.query(
        `INSERT INTO odin_control.bot_github_hooks(owner_id,repository,hook_id,token_hash)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(owner_id) DO NOTHING RETURNING owner_id`,
        [owner, repo, hookId, tokenHash(secret)],
      );
      if (!inserted.rowCount) {
        await this.#deleteRemoteHook(githubToken, repo, hookId).catch(() => undefined);
        const winner = (
          await this.pool.query(
            "SELECT repository FROM odin_control.bot_github_hooks WHERE owner_id=$1",
            [owner],
          )
        ).rows[0];
        if (winner?.repository !== repo)
          throw new ChatError(
            "BOT_EVENT_CONFLICT",
            "Repository event configuration changed; retry.",
            409,
          );
      }
    } catch (error) {
      await this.#deleteRemoteHook(githubToken, repo, hookId).catch(() => undefined);
      throw error;
    }
    return { repository: repo, connected: true };
  }

  async disconnectHook(ownerId: string, githubToken: string): Promise<void> {
    const owner = validOwner(ownerId);
    const existing = (
      await this.pool.query(
        "SELECT repository,hook_id FROM odin_control.bot_github_hooks WHERE owner_id=$1",
        [owner],
      )
    ).rows[0];
    if (existing)
      await this.#deleteRemoteHook(
        githubToken,
        String(existing.repository),
        String(existing.hook_id),
      ).catch(() => undefined);
    await this.pool.query("DELETE FROM odin_control.bot_github_hooks WHERE owner_id=$1", [owner]);
  }

  async authenticateDelivery(
    secret: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Uint8Array,
  ): Promise<AuthenticatedGitHubDelivery> {
    if (!TOKEN.test(secret))
      throw new ChatError("BOT_EVENT_NOT_FOUND", "Repository event endpoint not found.", 404);
    const mapping = (
      await this.pool.query(
        "SELECT owner_id,repository FROM odin_control.bot_github_hooks WHERE token_hash=$1",
        [tokenHash(secret)],
      )
    ).rows[0];
    if (!mapping)
      throw new ChatError("BOT_EVENT_NOT_FOUND", "Repository event endpoint not found.", 404);

    verifyGitHubWebhookSignature(secret, rawBody, header(headers, "x-hub-signature-256"));
    const deliveryId = header(headers, "x-github-delivery") ?? "";
    const eventName = (header(headers, "x-github-event") ?? "").toLowerCase();
    if (!DELIVERY.test(deliveryId) || !EVENT.test(eventName))
      throw new ChatError("BOT_EVENT_INVALID", "GitHub event headers are invalid.", 400);

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    } catch {
      throw new ChatError("BOT_EVENT_INVALID", "GitHub event body is invalid.", 400);
    }
    const event = normalizeGitHubEvent(eventName, payload);
    if (event.repository !== mapping.repository)
      throw new ChatError("BOT_EVENT_UNAUTHORIZED", "GitHub event repository does not match.", 401);

    const inserted = await this.pool.query(
      `INSERT INTO odin_control.bot_event_receipts(owner_id,delivery_id,event_name,repository)
       VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,delivery_id) DO NOTHING RETURNING owner_id`,
      [mapping.owner_id, deliveryId, event.eventName, event.repository],
    );
    if (inserted.rowCount)
      return { ownerId: String(mapping.owner_id), deliveryId, duplicate: false, event };
    const prior = (
      await this.pool.query(
        "SELECT processed_at FROM odin_control.bot_event_receipts WHERE owner_id=$1 AND delivery_id=$2",
        [mapping.owner_id, deliveryId],
      )
    ).rows[0];
    return {
      ownerId: String(mapping.owner_id),
      deliveryId,
      duplicate: Boolean(prior?.processed_at),
      event,
    };
  }

  async markProcessed(ownerId: string, deliveryId: string): Promise<void> {
    await this.pool.query(
      "UPDATE odin_control.bot_event_receipts SET processed_at=COALESCE(processed_at,now()) WHERE owner_id=$1 AND delivery_id=$2",
      [validOwner(ownerId), deliveryId],
    );
  }
}

export async function processGitHubEvent(
  db: ActorDatabase,
  event: NormalizedGitHubEvent,
  deliveryId: string,
  limits: BotPlanLimits,
): Promise<{
  firedTaskIds: string[];
  linkedTaskId: string | null;
}> {
  const store = new BotStore(db);
  const firedTaskIds: string[] = [];
  for (const automation of await store.eventAutomations("github")) {
    if (!githubEventMatches(automation.trigger, event)) continue;
    const created = await store.fireEventAutomation(
      automation.id,
      deliveryId,
      new Date().toISOString(),
      limits,
      {
        repository: event.repository,
        eventName: event.eventName,
        predicate: event.predicate,
        action: event.action,
        pullNumber: event.pullNumber,
        conclusion: event.conclusion,
        branch: event.branch,
      },
    );
    if (created) firedTaskIds.push(created.id);
  }

  const linked = event.pullNumber
    ? await store.taskForPullRequest(event.repository, event.pullNumber)
    : null;
  if (linked) {
    const priorDelivery = asRecord(linked.checkpoint.delivery);
    if (event.predicate === "merged" || event.predicate === "closed") {
      await store.mergeCheckpoint(linked.id, {
        delivery: {
          ...priorDelivery,
          state: event.predicate === "merged" ? "merged" : "closed",
          observedAt: new Date().toISOString(),
        },
      });
    } else if (event.predicate === "checks_failed" || event.predicate === "checks_passed") {
      await store.mergeCheckpoint(linked.id, {
        delivery: {
          ...priorDelivery,
          checks: event.predicate === "checks_passed" ? "passed" : "failed",
          checksObservedAt: new Date().toISOString(),
        },
      });
    }
    const signal = proactiveGitHubSignal(event);
    if (signal) {
      await store.addInbox(
        linked.id,
        signal.category,
        signal.title,
        signal.body,
        {
          taskId: linked.id,
          repository: event.repository,
          pullNumber: event.pullNumber,
          recommendedAction: signal.recommendedAction,
        },
        `github:${deliveryId}:signal`,
      );
    }
  }
  return { firedTaskIds, linkedTaskId: linked?.id ?? null };
}
