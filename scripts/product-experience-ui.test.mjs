import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [chat, live, liveCss, landing, landingCss] = await Promise.all([
  readFile(new URL("../web/chat.js", import.meta.url), "utf8"),
  readFile(new URL("../web/live-work.js", import.meta.url), "utf8"),
  readFile(new URL("../web/live-work.css", import.meta.url), "utf8"),
  readFile(new URL("../web/landing.js", import.meta.url), "utf8"),
  readFile(new URL("../web/product-experience-landing.css", import.meta.url), "utf8"),
]);

test("product experience projects canonical SSE events into the live work accordion", () => {
  assert.match(chat, /odin:runtime-event/u);
  assert.match(live, /odin:runtime-event/u);
  assert.match(live, /tool\.start/u);
  assert.match(live, /tool\.end/u);
  assert.match(live, /file\.changed/u);
  assert.match(live, /quality/u);
  assert.match(live, /verification/u);
  assert.match(live, /approval/u);
  assert.match(live, /Private chain-of-thought is never exposed/u);
  assert.doesNotMatch(live, /new EventSource/u);
});

test("live work and landing are responsive, animated and reduced-motion safe", () => {
  assert.match(liveCss, /@media \(max-width: 900px\)/u);
  assert.match(liveCss, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(liveCss, /@keyframes odin-live-pulse/u);
  assert.match(landing, /odin-live-demo/u);
  assert.match(landingCss, /landing-live-demo/u);
  assert.match(landingCss, /@media \(max-width: 800px\)/u);
  assert.match(landingCss, /prefers-reduced-motion/u);
});
