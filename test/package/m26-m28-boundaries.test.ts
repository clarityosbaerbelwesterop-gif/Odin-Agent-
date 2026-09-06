import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("M28 mobile experience remains a bounded M9 presentation layer", async () => {
  const mobile = await source("src/mobile/experience.ts");

  assert.match(mobile, /\.\.\/client\/types\.js/u);
  assert.doesNotMatch(
    mobile,
    /\.\.\/(?:tools|sandbox|providers|durable|hosted|runtime)\//u,
  );
  assert.doesNotMatch(
    mobile,
    /process\.env|node:child_process|\bfetch\s*\(|localStorage|sessionStorage|document\.cookie/u,
  );
  assert.match(mobile, /OFFLINE_MUTATION_DENIED/u);
  assert.match(mobile, /REQUIRES_FRESH_SERVER_VALIDATION/u);
});

test("M27 hosted service stays provider-neutral and delegates canonical client and durable semantics", async () => {
  const hosted = await source("src/hosted/service.ts");

  assert.match(hosted, /\.\.\/client\/types\.js/u);
  assert.match(hosted, /\.\.\/durable\/types\.js/u);
  assert.doesNotMatch(
    hosted,
    /@aws|amazonaws|@azure|google-cloud|firebase|supabase|vercel|neon|process\.env|node:child_process|\bfetch\s*\(/iu,
  );
  assert.match(hosted, /HostedAuthenticationResolver/u);
  assert.match(hosted, /HostedQueueAdapter/u);
  assert.match(hosted, /HostedBackupAdapter/u);
});

test("M26 strong isolation classes cannot relabel host-process execution as production isolation", async () => {
  const sandbox = await source("src/sandbox/production.ts");

  assert.match(
    sandbox,
    /export type ProductionIsolationClass = "container" \| "microvm" \| "vm";/u,
  );
  assert.doesNotMatch(
    sandbox,
    /ProductionIsolationClass\s*=\s*[^;]*(?:host_process|host-process)/u,
  );
  assert.match(sandbox, /ProductionIsolationAttestation/u);
  assert.match(sandbox, /ProductionSecretBroker/u);
});

test("mobile reference fixture contains no persistent credential or canonical-state storage surface", async () => {
  const html = await source("web/mobile-reference.html");
  const script = await source("web/mobile-reference.js");
  const fixture = `${html}\n${script}`;

  assert.doesNotMatch(
    fixture,
    /localStorage|sessionStorage|indexedDB|document\.cookie|Bearer\s|authorization|api[_-]?key/iu,
  );
  assert.match(fixture, /Reconnect/u);
  assert.match(fixture, /server challenge/u);
});
