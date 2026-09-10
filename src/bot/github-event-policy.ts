import { createHmac, timingSafeEqual } from "node:crypto";
import { ChatError } from "../chat/types.js";

export type GitHubEventName =
  | "pull_request"
  | "pull_request_review"
  | "check_run"
  | "workflow_run"
  | "push";

export type GitHubEventPredicate =
  | "any"
  | "opened"
  | "closed"
  | "merged"
  | "changes_requested"
  | "checks_failed"
  | "checks_passed"
  | "pushed";

export interface NormalizedGitHubEvent {
  repository: string;
  eventName: GitHubEventName;
  predicate: GitHubEventPredicate;
  action: string | null;
  pullNumber: number | null;
  conclusion: string | null;
  branch: string | null;
  merged: boolean | null;
}

export interface GitHubAutomationSelector {
  event: GitHubEventName | "checks" | "*";
  predicate: GitHubEventPredicate;
}

export interface ProactiveGitHubSignal {
  category: "information" | "important";
  title: string;
  body: string;
  recommendedAction: "inspect" | "repair" | "review" | "none";
}

const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
]);
const PASS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > max) return null;
  if ([...clean].some((character) => character.charCodeAt(0) < 32)) return null;
  return clean;
}

function integer(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function firstPullNumber(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (const item of value.slice(0, 20)) {
    const number = integer(record(item).number);
    if (number) return number;
  }
  return null;
}

function branchFromRef(value: unknown): string | null {
  const clean = text(value, 240);
  return clean?.startsWith("refs/heads/") ? clean.slice("refs/heads/".length) : clean;
}

function checkPredicate(conclusion: string | null): GitHubEventPredicate {
  if (conclusion && FAILURE_CONCLUSIONS.has(conclusion)) return "checks_failed";
  if (conclusion && PASS_CONCLUSIONS.has(conclusion)) return "checks_passed";
  return "any";
}

export function githubTriggerForInstruction(instruction: string): GitHubAutomationSelector {
  const lower = instruction.trim().toLowerCase();
  const pullRequest = /pull request|\bpr\b/u.test(lower);
  if (pullRequest && /merge|gemerg|zusammengef/u.test(lower))
    return { event: "pull_request", predicate: "merged" };
  if (
    pullRequest &&
    /changes requested|change request|änderung.{0,12}(angefordert|verlangt)|review.{0,20}(change|änderung)/u.test(
      lower,
    )
  )
    return { event: "pull_request_review", predicate: "changes_requested" };
  if (pullRequest && /opened|open|erstellt|geöffnet/u.test(lower))
    return { event: "pull_request", predicate: "opened" };
  if (pullRequest && /closed|geschlossen/u.test(lower))
    return { event: "pull_request", predicate: "closed" };

  if (/\bci\b|checks?|workflow|actions?/u.test(lower)) {
    if (/fail|failed|failure|fehler|fehlgeschlagen|rot|broken/u.test(lower))
      return { event: "checks", predicate: "checks_failed" };
    if (/pass|passed|success|successful|erfolgreich|grün|green/u.test(lower))
      return { event: "checks", predicate: "checks_passed" };
  }
  if (/\bpush\b|commit/u.test(lower)) return { event: "push", predicate: "pushed" };
  return { event: "*", predicate: "any" };
}

export function normalizeGitHubEvent(eventName: string, payload: unknown): NormalizedGitHubEvent {
  if (!["pull_request", "pull_request_review", "check_run", "workflow_run", "push"].includes(eventName))
    throw new ChatError("BOT_EVENT_UNSUPPORTED", "This GitHub event is not supported.", 202);
  const root = record(payload);
  const repository = text(record(root.repository).full_name, 201) ?? "";
  if (!REPOSITORY.test(repository))
    throw new ChatError("BOT_EVENT_INVALID", "GitHub event repository is invalid.", 400);

  const action = text(root.action, 80);
  let pullNumber = integer(root.number);
  let conclusion: string | null = null;
  let branch: string | null = null;
  let merged: boolean | null = null;
  let predicate: GitHubEventPredicate = "any";

  if (eventName === "pull_request") {
    const pull = record(root.pull_request);
    pullNumber ??= integer(pull.number);
    branch = branchFromRef(record(pull.head).ref);
    merged = typeof pull.merged === "boolean" ? pull.merged : null;
    if (action === "opened" || action === "reopened") predicate = "opened";
    else if (action === "closed" && merged === true) predicate = "merged";
    else if (action === "closed") predicate = "closed";
  } else if (eventName === "pull_request_review") {
    const pull = record(root.pull_request);
    const review = record(root.review);
    pullNumber ??= integer(pull.number);
    branch = branchFromRef(record(pull.head).ref);
    const state = text(review.state, 80)?.toLowerCase() ?? null;
    if (state === "changes_requested") predicate = "changes_requested";
  } else if (eventName === "check_run") {
    const check = record(root.check_run);
    conclusion = text(check.conclusion, 80)?.toLowerCase() ?? null;
    pullNumber ??= firstPullNumber(check.pull_requests);
    branch = branchFromRef(record(check.check_suite).head_branch) ?? branchFromRef(check.head_branch);
    predicate = checkPredicate(conclusion);
  } else if (eventName === "workflow_run") {
    const workflow = record(root.workflow_run);
    conclusion = text(workflow.conclusion, 80)?.toLowerCase() ?? null;
    pullNumber ??= firstPullNumber(workflow.pull_requests);
    branch = branchFromRef(workflow.head_branch);
    predicate = checkPredicate(conclusion);
  } else {
    branch = branchFromRef(root.ref);
    predicate = "pushed";
  }

  return {
    repository,
    eventName: eventName as GitHubEventName,
    predicate,
    action,
    pullNumber,
    conclusion,
    branch,
    merged,
  };
}

export function githubEventMatches(
  trigger: Record<string, unknown>,
  event: NormalizedGitHubEvent,
): boolean {
  if (trigger.kind !== "event" || trigger.source !== "github") return false;
  const fallback = githubTriggerForInstruction(String(trigger.expression ?? ""));
  const selectedEvent =
    typeof trigger.event === "string" ? trigger.event : fallback.event;
  const selectedPredicate =
    typeof trigger.predicate === "string" ? trigger.predicate : fallback.predicate;
  const eventMatches =
    selectedEvent === "*" ||
    selectedEvent === event.eventName ||
    (selectedEvent === "checks" && ["check_run", "workflow_run"].includes(event.eventName));
  return eventMatches && (selectedPredicate === "any" || selectedPredicate === event.predicate);
}

export function verifyGitHubWebhookSignature(
  secret: string,
  body: Uint8Array,
  signature: string | undefined,
): void {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(secret))
    throw new ChatError("BOT_EVENT_UNAUTHORIZED", "GitHub event authorization is invalid.", 401);
  const supplied = /^sha256=([a-f0-9]{64})$/u.exec(signature ?? "")?.[1];
  if (!supplied)
    throw new ChatError("BOT_EVENT_UNAUTHORIZED", "GitHub event signature is required.", 401);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  )
    throw new ChatError("BOT_EVENT_UNAUTHORIZED", "GitHub event signature is invalid.", 401);
}

export function proactiveGitHubSignal(
  event: NormalizedGitHubEvent,
): ProactiveGitHubSignal | null {
  if (event.predicate === "checks_failed")
    return {
      category: "important",
      title: "GitHub checks need attention",
      body: "A verification run on an Odin pull request failed. Inspect the failing checks before merging.",
      recommendedAction: "repair",
    };
  if (event.predicate === "changes_requested")
    return {
      category: "important",
      title: "Review changes requested",
      body: "A reviewer requested changes on an Odin pull request. Review the feedback before continuing delivery.",
      recommendedAction: "review",
    };
  if (event.predicate === "merged")
    return {
      category: "information",
      title: "Odin pull request merged",
      body: "GitHub confirmed that the Odin pull request was merged.",
      recommendedAction: "none",
    };
  if (event.predicate === "closed")
    return {
      category: "important",
      title: "Odin pull request closed",
      body: "GitHub reported that the Odin pull request was closed without a confirmed merge.",
      recommendedAction: "inspect",
    };
  return null;
}
