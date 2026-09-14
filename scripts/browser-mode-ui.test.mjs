import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PRODUCT M8 Browser Workspace exposes scoped navigation, approval and responsive companion UX", async () => {
  const [html, client, css] = await Promise.all([
    readFile("web/browser.html", "utf8"),
    readFile("web/browser.js", "utf8"),
    readFile("web/browser.css", "utf8"),
  ]);
  assert.match(html, /ACT \/ BROWSER/u);
  assert.match(html, /APPROVAL REQUIRED/u);
  assert.match(html, /Allowed HTTPS origins/u);
  assert.match(client, /\/api\/browser\/projects\//u);
  assert.match(client, /\/prepare/u);
  assert.match(client, /\/approve/u);
  assert.match(client, /\/execute/u);
  assert.match(client, /OUTCOME_UNKNOWN/u);
  assert.match(client, /textContent/u);
  assert.doesNotMatch(client, /innerHTML|localStorage|sessionStorage|document\.cookie/iu);
  assert.match(css, /grid-template-columns/u);
  assert.match(css, /@media\(max-width:900px\)/u);
  assert.match(css, /@media\(max-width:600px\)/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.doesNotMatch(css, /!important/iu);
});
