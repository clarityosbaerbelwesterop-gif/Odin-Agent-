import { readFile, writeFile } from "node:fs/promises";

const path = "src/routing/multi-model.ts";
let text = await readFile(path, "utf8");
text = text.replace(
  'import type { CapabilityProfile, ReasoningEffort } from "../providers/types.js";',
  'import type { ReasoningEffort } from "../providers/types.js";',
);
text = text.replace("  type ModelEvaluation,\n", "");
const anchor = "    let routing: RoutingDecision;\n";
if (!text.includes(anchor)) throw new Error("Missing M21 routing anchor");
text = text.replace(
  anchor,
  `    if (profiles.length === 0 || evaluations.length === 0) {
      throw new RoutingError(
        "NO_ELIGIBLE_MODEL",
        "No M21 route remains after quality/capability gates and bounded recent-failure exclusions.",
        [...excluded].sort(),
      );
    }

${anchor}`,
);
await writeFile(path, text, "utf8");
