import { readFile, writeFile } from "node:fs/promises";

const path = "src/runtime/multi-file.ts";
let source = await readFile(path, "utf8");

function replaceExact(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing M19 type-fix anchor: ${label}`);
  source = source.replace(from, to);
}

replaceExact(
  `        verificationResultHash: null,
        signal: undefined,
      });`,
  `        verificationResultHash: null,
      });`,
  "cancel rollback signal",
);
replaceExact(
  `        signal: input.signal,
        taskId: normalized.changeSet.taskId,`,
  `        ...(input.signal === undefined ? {} : { signal: input.signal }),
        taskId: normalized.changeSet.taskId,`,
  "quality optional signal",
);

await writeFile(path, source, "utf8");
