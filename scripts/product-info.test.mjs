import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("settings ships product controls, runtime education and legal links", async () => {
  const [html, script] = await Promise.all([read("web/chat.html"), read("web/product-info.js")]);
  assert.match(html, /product-info\.css/u);
  assert.match(html, /product-info\.js/u);
  assert.match(html, /Einstellungen & Informationen/u);
  for (const phrase of [
    "Aufgabe verstehen",
    "Kontext zusammenstellen",
    "Modell auswählen",
    "Werkzeuge kontrolliert nutzen",
    "Prüfen und reparieren",
    "FREE",
    "PRO",
    "DEVELOPER",
    "ULTRA",
    "\\$9.99 / month",
    "\\$19.99 / month",
    "\\$49.99 / month",
    "Checkout nicht konfiguriert",
    "GitHub Workspace",
    "Model Provider",
    "Datenschutzerklärung",
    "Impressum",
  ])
    assert.match(script, new RegExp(phrase, "u"));
  assert.match(script, /Das Modell schlägt vor\. Odin entscheidet/u);
});

test("benchmark dashboard separates live, protocol, blueprint and external reference evidence", async () => {
  const [script, frontierRaw, gpt55Raw, blueprintRaw] = await Promise.all([
    read("web/product-info.js"),
    read("docs/evals/frontier-reference-2026-09-09.json"),
    read("docs/evals/gpt-5-5-reference-2026-09-09.json"),
    read("docs/evals/benchmark-v2-blueprint-2026-09-09.json"),
  ]);
  const frontier = JSON.parse(frontierRaw);
  const gpt55 = JSON.parse(gpt55Raw);
  const blueprint = JSON.parse(blueprintRaw);
  assert.equal(frontier.status, "EXTERNAL_REFERENCE_ONLY");
  assert.equal(frontier.comparableToOdinLiveRuns, false);
  assert.equal(
    frontier.benchmarks.find((item) => item.name === "Terminal-Bench 4.0").scores["GPT-6 Astra"],
    57.9,
  );
  assert.equal(
    frontier.benchmarks.find((item) => item.name === "Terminal-Bench 4.0").scores[
      "Claude Fable 5.1"
    ],
    55.8,
  );
  assert.equal(gpt55.comparableToAstraTerminalBench4, false);
  assert.equal(gpt55.benchmarks.find((item) => item.name === "Terminal-Bench 2.0").score, 82.7);
  assert.equal(blueprint.totalCases, 100);
  assert.equal(
    blueprint.domains.reduce((sum, domain) => sum + domain.cases, 0),
    100,
  );
  assert.match(script, /ZIELHYPOTHESE · NICHT BEWIESEN/u);
  assert.match(script, /Unterschiedliche Benchmark-Versionen/u);
});

test("public legal surfaces keep incomplete operator and compliance gates visible", async () => {
  const pages = await Promise.all(
    ["privacy", "eula", "gdpr", "imprint"].map((name) => read(`web/${name}.html`)),
  );
  assert.match(pages[0], /TESTBETRIEB/u);
  assert.match(pages[0], /\[BETREIBERNAME/u);
  assert.match(pages[0], /Launch-Gate/u);
  assert.match(pages[1], /Pre-Stripe-Testbetrieb/u);
  assert.match(pages[2], /PARTIALLY VERIFIED/u);
  assert.match(pages[3], /BLOCKED · BETREIBERANGABEN FEHLEN/u);
  for (const page of pages) {
    assert.match(page, /privacy\.html/u);
    assert.match(page, /eula\.html/u);
    assert.match(page, /imprint\.html/u);
  }
});
