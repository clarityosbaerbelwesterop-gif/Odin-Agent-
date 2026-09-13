import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PRODUCT M6 client exposes Build entry, canonical Run execution, revision Preview and delta iteration", async () => {
  const [client, css] = await Promise.all([
    readFile("web/build-mode.js", "utf8"),
    readFile("web/product-m6.css", "utf8"),
  ]);
  assert.match(client, /Build something/u);
  assert.match(client, /\/api\/build/u);
  assert.match(client, /\/api\/projects\/\$\{encodeURIComponent\(m6State\.projectId\)\}\/turns/u);
  assert.match(client, /\/api\/turns\/\$\{encodeURIComponent\(turn\.id\)\}\/run/u);
  assert.match(client, /\/iterate/u);
  assert.match(client, /rememberDecision/u);
  assert.match(client, /targetRef/u);
  assert.match(client, /revision=/u);
  assert.match(client, /Preview ≠ Production/u);
  assert.doesNotMatch(client, /skill\.(?:selected|loaded|result).*dispatchEvent/iu);
  assert.doesNotMatch(client, /localStorage|sessionStorage/iu);
  assert.match(css, /@media\(max-width:980px\)/u);
  assert.match(css, /@media\(max-width:700px\)/u);
  assert.match(css, /iframe\[data-viewport="tablet"\]/u);
  assert.match(css, /iframe\[data-viewport="mobile"\]/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.doesNotMatch(css, /!important/iu);
});
