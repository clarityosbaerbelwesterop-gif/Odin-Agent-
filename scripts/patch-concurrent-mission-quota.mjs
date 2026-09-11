import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../src/chat/hosted.ts", import.meta.url);
let text = await readFile(path, "utf8");

const oldImport = 'import { QuotaStore } from "./quota.js";';
const newImport = 'import { planQuota, QuotaStore } from "./quota.js";';
if (!text.includes(oldImport)) throw new Error("quota import anchor missing");
text = text.replace(oldImport, newImport);

const oldRun = `        const resource = \`run:\${id}\`;
        const lease = await db.claim(resource);
        if (!lease) throw new ChatError("BUSY", "This task already has an active worker.", 409);`;
const newRun = `        const resource = \`run:\${id}\`;
        const runLimit = planQuota(effectivePlan(await product.account())).maxConcurrentMissions;
        const claimed = await db.claimBounded(resource, "run:", runLimit);
        if (claimed.status === "busy")
          throw new ChatError("BUSY", "This task already has an active worker.", 409);
        if (claimed.status === "limit")
          throw new ChatError(
            "CONCURRENT_MISSION_LIMIT",
            "Your plan's concurrent mission limit is reached.",
            409,
          );
        const lease = claimed.token;`;
if (!text.includes(oldRun)) throw new Error("run admission anchor missing");
text = text.replace(oldRun, newRun);
await writeFile(path, text);
