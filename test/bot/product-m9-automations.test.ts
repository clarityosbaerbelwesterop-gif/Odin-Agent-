import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  githubEventMatches,
  githubTriggerForInstruction,
  normalizeGitHubEvent,
} from "../../src/bot/github-event-policy.js";
import { nextDailyWake } from "../../src/bot/wakeup.js";

test("PRODUCT M9 daily scheduling follows Europe/Berlin DST instead of fixed UTC offsets", () => {
  const autumn = nextDailyWake(new Date("2026-10-24T07:30:00.000Z"), 8, 0, "Europe/Berlin");
  assert.equal(autumn.toISOString(), "2026-10-25T07:00:00.000Z");

  const spring = nextDailyWake(new Date("2026-03-28T08:30:00.000Z"), 8, 0, "Europe/Berlin");
  assert.equal(spring.toISOString(), "2026-03-29T06:00:00.000Z");
});

test("PRODUCT M9 condition watch stays false until the matching trusted GitHub state transition", () => {
  const expression = "Wenn GitHub CI fehlschlägt, repariere es";
  const selector = githubTriggerForInstruction(expression);
  const trigger = { kind: "event", source: "github", expression, ...selector };
  const passing = normalizeGitHubEvent("check_run", {
    repository: { full_name: "odin/example" },
    check_run: { conclusion: "success", check_suite: { head_branch: "main" } },
  });
  const failing = normalizeGitHubEvent("check_run", {
    repository: { full_name: "odin/example" },
    check_run: { conclusion: "failure", check_suite: { head_branch: "main" } },
  });

  assert.equal(githubEventMatches(trigger, passing), false);
  assert.equal(githubEventMatches(trigger, failing), true);
});

test("PRODUCT M9 occurrence, budget and circuit-breaker authority remain server owned", async () => {
  const [store, executor, hosted, migration] = await Promise.all([
    readFile("src/bot/store.ts", "utf8"),
    readFile("src/bot/executor.ts", "utf8"),
    readFile("src/chat/hosted.ts", "utf8"),
    readFile("migrations/016_product_m9_automation_hardening.sql", "utf8"),
  ]);

  assert.match(store, /budget: item\.budget/u);
  assert.match(store, /used >= limits\.maxDailyWakeups/u);
  assert.match(store, /BOT_AUTOMATION_DAILY_LIMIT/u);
  assert.match(store, /pg_advisory_xact_lock/u);
  assert.match(store, /setAutomationEnabled/u);
  assert.match(store, /pauseAutomation/u);
  assert.match(executor, /wake\.scheduledAt/u);
  assert.match(executor, /wake\.attempt >= 5/u);
  assert.match(executor, /pauseAutomation\(wake\.targetId, code\)/u);
  assert.match(executor, /failed\.sourceAutomationId/u);
  assert.match(hosted, /method === "PATCH"/u);
  assert.match(hosted, /typeof body\.enabled !== "boolean"/u);

  assert.match(migration, /scheduled_at timestamptz/u);
  assert.match(migration, /odin_api\.actor\(\)/u);
  assert.match(migration, /clear_bot_automation_wakeups/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION odin_control\.clear_bot_automation_wakeups/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION odin_control\.clear_bot_automation_wakeups/u,
  );
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE).*bot_wakeups/iu);
});

test("PRODUCT M9 Automation UI is natural-language first and exposes reversible status", async () => {
  const [html, client] = await Promise.all([
    readFile("web/bot.html", "utf8"),
    readFile("web/bot.js", "utf8"),
  ]);
  assert.match(html, /Automations/u);
  assert.match(html, /Jeden Morgen um 8 prüfe mein Projekt/u);
  assert.match(client, /Watching for the condition/u);
  assert.match(client, /Not run yet/u);
  assert.match(client, /up to .* min \/ Run/u);
  assert.match(client, /Pause/u);
  assert.match(client, /Resume/u);
  assert.match(client, /method: "PATCH"/u);
});
