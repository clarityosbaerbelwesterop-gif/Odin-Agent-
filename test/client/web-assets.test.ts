import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const HTML = new URL("../../web/index.html", import.meta.url);
const CSS = new URL("../../web/styles.css", import.meta.url);
const APP = new URL("../../web/app.js", import.meta.url);

test("responsive web fixture exposes accessible mission surfaces and deliberate cancellation", async () => {
  const [html, css] = await Promise.all([readFile(HTML, "utf8"), readFile(CSS, "utf8")]);

  assert.match(html, /<meta name="viewport"/u);
  assert.match(html, /<header class="topbar">/u);
  assert.match(html, /<main class="dashboard"/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /id="task-list"/u);
  assert.match(html, /id="budget-grid"/u);
  assert.match(html, /id="worker-counts"/u);
  assert.match(html, /id="evidence-list"/u);
  assert.match(html, /id="pause-control"/u);
  assert.match(html, /id="resume-control"/u);
  assert.match(html, /id="cancel-control"[^>]*class="danger"/u);
  assert.match(html, /<dialog id="cancel-dialog"/u);
  assert.match(html, /value="confirm" class="danger"/u);
  assert.match(css, /@media \(max-width: 900px\)/u);
  assert.match(css, /@media \(max-width: 560px\)/u);
});

test("web fixture renders with text APIs and contains no live transport or persistent browser state", async () => {
  const app = await readFile(APP, "utf8");

  assert.match(app, /textContent/u);
  assert.match(app, /replaceChildren/u);
  assert.equal(app.includes("innerHTML"), false);
  assert.equal(app.includes("fetch("), false);
  assert.equal(app.includes("WebSocket"), false);
  assert.equal(app.includes("EventSource"), false);
  assert.equal(app.includes("localStorage"), false);
  assert.equal(app.includes("sessionStorage"), false);
  assert.equal(app.includes("document.cookie"), false);
});
