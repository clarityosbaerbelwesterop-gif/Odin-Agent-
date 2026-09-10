import assert from "node:assert/strict";
import test from "node:test";
import { nextAutomationWake, parseAutomationText } from "../../src/bot/wakeup.js";

test("natural daily automation becomes a durable scheduled wakeup", () => {
  const parsed = parseAutomationText(
    "Jeden Morgen um 8 prüfe mein Projekt",
    "Europe/Berlin",
    new Date("2026-09-10T05:00:00Z"),
  );
  assert.equal(parsed.triggerType, "schedule");
  assert.equal(parsed.display, "Every day · 08:00");
  assert.equal(parsed.nextWakeupAt, "2026-09-10T06:00:00.000Z");
});

test("interval automation enforces a non-spam floor", () => {
  const parsed = parseAutomationText(
    "Alle 15 Minuten prüfe den Status",
    "UTC",
    new Date("2026-09-10T10:00:00Z"),
  );
  assert.equal(parsed.nextWakeupAt, "2026-09-10T10:15:00.000Z");
  assert.throws(() => parseAutomationText("Alle 2 Minuten prüfen", "UTC"), /five minutes/u);
});

test("event instructions do not create pointless polling", () => {
  const parsed = parseAutomationText("Wenn GitHub CI fehlschlägt, repariere es", "Europe/Berlin");
  assert.equal(parsed.triggerType, "condition");
  assert.equal(parsed.trigger.source, "github");
  assert.equal(parsed.nextWakeupAt, null);
  assert.equal(nextAutomationWake(parsed.trigger), null);
});
