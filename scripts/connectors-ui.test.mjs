import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../web/chat.html", import.meta.url), "utf8");
const js = await readFile(new URL("../web/connectors.js", import.meta.url), "utf8");
const live = await readFile(new URL("../web/live-work.js", import.meta.url), "utf8");
const catalog = await readFile(new URL("../src/connectors/catalog.ts", import.meta.url), "utf8");

test("connector hub is loaded in the existing Connections surface", () => {
  assert.match(html, /connectors\.js/u);
  assert.match(js, /MCP CONNECTIONS/u);
  for (const id of ["neon", "vercel", "google-workspace", "linkedin"])
    assert.match(catalog, new RegExp(`id: "${id}"`, "u"));
  assert.match(js, /cState\.catalog = data\.connectors/u);
  assert.match(js, /api\/connectors/u);
  assert.doesNotMatch(js, /localStorage|sessionStorage/u);
});

test("live work approval executes through the server and resumes the same Run", () => {
  assert.match(live, /approval\.requested/u);
  assert.match(live, /Approve & continue/u);
  assert.match(live, /api\/connectors\/approvals/u);
  assert.match(live, /command: "resume"/u);
});
