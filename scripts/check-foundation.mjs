import { readFile, stat } from "node:fs/promises";
import process from "node:process";

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "ARCHITECTURE.md",
  "SECURITY.md",
  "ROADMAP.md",
  "HANDOVER.md",
  "CONTRIBUTING.md",
  "docs/TESTING.md",
  "docs/research/HERMES_OPENCLAW_DECISIONS.md",
  "docs/adr/README.md",
  ".env.example",
  ".github/workflows/ci.yml",
];

const failures = [];

for (const path of requiredFiles) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size === 0) {
      failures.push(`${path}: missing content`);
    }
  } catch {
    failures.push(`${path}: missing`);
  }
}

const envExample = await readFile(".env.example", "utf8");
for (const line of envExample.split(/\r?\n/u)) {
  const match = /^(?<name>[A-Z][A-Z0-9_]*)=(?<value>.*)$/u.exec(line.trim());
  if (!match?.groups) continue;

  const { name, value } = match.groups;
  if ((name.endsWith("_KEY") || name.endsWith("_SECRET") || name.endsWith("_TOKEN")) && value) {
    failures.push(`.env.example: ${name} must not contain a value`);
  }
}

if (failures.length > 0) {
  console.error("Foundation verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Foundation verification passed (${requiredFiles.length} required files).`);
}
