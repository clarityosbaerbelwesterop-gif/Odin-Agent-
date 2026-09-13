import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PRODUCT M7 exposes repository, diff, verification and PR delivery without browser-owned Git authority", async () => {
  const [client, css, html] = await Promise.all([
    readFile("web/coding-mode.js", "utf8"),
    readFile("web/product-m7.css", "utf8"),
    readFile("web/chat.html", "utf8"),
  ]);
  assert.match(html, /\/coding-mode\.js/u);
  assert.match(client, /\/api\/coding\/projects\//u);
  assert.match(client, /mode:\s*"coding"/u);
  assert.match(client, /\/api\/turns\/\$\{encodeURIComponent\(turn\.id\)\}\/run/u);
  assert.match(client, /pull-request/u);
  assert.match(client, /review\/\$\{number\}/u);
  assert.match(client, /Read-only review surface/u);
  assert.doesNotMatch(client, /github\.com\/repos|Authorization:\s*`Bearer|localStorage|sessionStorage/iu);
  assert.match(css, /grid-template-columns/u);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/u);
  assert.match(css, /@media\s*\(max-width:\s*680px\)/u);
  assert.match(css, /data-focus="repo"/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.doesNotMatch(css, /!important/iu);
});
