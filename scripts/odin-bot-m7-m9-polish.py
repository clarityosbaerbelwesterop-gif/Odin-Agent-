from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "src/bot/github-event-policy.ts",
    '''export type GitHubEventName =
  | "pull_request"
  | "pull_request_review"
  | "check_run"
  | "workflow_run"
  | "push";''',
    '''export type GitHubEventName =
  | "pull_request"
  | "pull_request_review"
  | "check_run"
  | "workflow_run"
  | "push"
  | "ping";''',
)
replace_once(
    "src/bot/github-event-policy.ts",
    '''  if (!["pull_request", "pull_request_review", "check_run", "workflow_run", "push"].includes(eventName))''',
    '''  if (!["pull_request", "pull_request_review", "check_run", "workflow_run", "push", "ping"].includes(eventName))''',
)
replace_once(
    "src/bot/github-event-policy.ts",
    '''  } else {
    branch = branchFromRef(root.ref);
    predicate = "pushed";
  }''',
    '''  } else if (eventName === "push") {
    branch = branchFromRef(root.ref);
    predicate = "pushed";
  } else {
    predicate = "any";
  }''',
)
replace_once(
    "src/bot/github-event-policy.ts",
    '''  if (trigger.kind !== "event" || trigger.source !== "github") return false;
  const fallback = githubTriggerForInstruction(String(trigger.expression ?? ""));''',
    '''  if (trigger.kind !== "event" || trigger.source !== "github") return false;
  if (event.eventName === "ping") return false;
  const fallback = githubTriggerForInstruction(String(trigger.expression ?? ""));''',
)

replace_once(
    "src/bot/github-events.ts",
    '''const EVENT = /^(?:pull_request|pull_request_review|check_run|workflow_run|push)$/u;''',
    '''const EVENT = /^(?:pull_request|pull_request_review|check_run|workflow_run|push|ping)$/u;''',
)

replace_once(
    "migrations/008_odin_bot_m7_m9.sql",
    '''event_name text NOT NULL CHECK(event_name IN ('pull_request','pull_request_review','check_run','workflow_run','push')),''',
    '''event_name text NOT NULL CHECK(event_name IN ('pull_request','pull_request_review','check_run','workflow_run','push','ping')),''',
)

replace_once(
    "src/bot/store.ts",
    '''    const key = `event:${id}:${createHash("sha256").update(deliveryId).digest("hex").slice(0, 24)}`;
    const created = await this.createTask(
      { goal, mode, idempotencyKey: key, sourceAutomationId: id },
      limits,
    );
    await this.db.transaction(async (client) => {''',
    '''    const key = `event:${id}:${createHash("sha256").update(deliveryId).digest("hex").slice(0, 24)}`;
    const replay = await this.db.transaction(async (client) =>
      (await client.query("SELECT * FROM odin_api.bot_tasks WHERE idempotency_key=$1", [key])).rows[0],
    );
    const created = replay
      ? task(replay)
      : await this.createTask(
          { goal, mode, idempotencyKey: key, sourceAutomationId: id },
          limits,
        );
    await this.db.transaction(async (client) => {''',
)

# Lock the ping/replay behavior in tests.
path = Path("test/bot/github-events.test.ts")
text = path.read_text()
needle = '''test("M9 proactive signals surface only meaningful PR lifecycle changes", () => {'''
if text.count(needle) != 1:
    raise SystemExit("github event test anchor mismatch")
insert = '''test("M7 GitHub hook ping is authenticated metadata but never fires an automation", () => {
  const ping = normalizeGitHubEvent("ping", {
    repository: { full_name: "acme/odin" },
    zen: "untrusted prose must not become instructions",
  });
  assert.equal(ping.eventName, "ping");
  assert.equal(ping.predicate, "any");
  assert.equal(
    githubEventMatches(
      { kind: "event", source: "github", expression: "When anything changes", event: "*", predicate: "any" },
      ping,
    ),
    false,
  );
  assert.equal(proactiveGitHubSignal(ping), null);
});

'''
path.write_text(text.replace(needle, insert + needle, 1))
