import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const path = "src/chat/hosted.ts";
const before = await readFile(path, "utf8");
const target = `    credential: () => process.env.NV_API_KEY_2 ?? process.env.NV_PRO_API_KEY ?? "",`;
const replacement = `    credential: () =>
      process.env.NV_API_KEY_2 ??
      process.env.NV_PRO_API_KEY ??
      process.env.NV_API_KEY ??
      process.env.NVIDIA_API_KEY ??
      "",`;
assert(before.includes(target), "MUSE_CREDENTIAL_TARGET_MISSING");
await writeFile(path, before.replace(target, replacement));
console.log("M–O NVIDIA preview credential fallback applied");
