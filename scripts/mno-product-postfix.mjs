import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const path = "web/product-info.js";
const before = await readFile(path, "utf8");
const broken = `    statusCard("Auth + RLS", config?.user ? "LIVE", "Neon Auth, serverseitige Sessions und nutzergebundener Postgres-Kontext." : "ANMELDUNG ERFORDERLICH", "Neon Auth und RLS werden serverseitig erzwungen."),`;
const fixed = `    statusCard(
      "Auth + RLS",
      config?.user ? "LIVE" : "ANMELDUNG ERFORDERLICH",
      "Neon Auth, serverseitige Sessions, nutzergebundener Postgres-Kontext und Row-Level Security.",
    ),`;
assert(before.includes(broken), "POSTFIX_TARGET_MISSING");
await writeFile(path, before.replace(broken, fixed));
console.log("M–O product post-fix applied");
