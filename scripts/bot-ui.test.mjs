import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Odin Bot home exposes real task, schedule and inbox surfaces", async () => {
  const html = await readFile("web/bot.html", "utf8");
  const js = await readFile("web/bot.js", "utf8");
  assert.match(html, /What should I take care of\?/u);
  assert.match(html, /Active/u);
  assert.match(html, /Scheduled/u);
  assert.match(html, /Inbox/u);
  assert.match(js, /\/api\/bot\/tasks/u);
  assert.match(js, /\/api\/bot\/automations/u);
  assert.doesNotMatch(html, /\bdemo\b|fake activity/iu);
});
