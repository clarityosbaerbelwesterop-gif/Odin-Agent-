import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readBenchmarks(directory: string) {
  const read = async (file: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(join(directory, file), "utf8"));
    } catch {
      return null;
    }
  };
  const [
    modelComparison,
    protocolComparison,
    externalFrontier,
    gpt55Reference,
    benchmarkBlueprint,
  ] = await Promise.all([
    read("chathub-ab-2026-09-07.json"),
    read("paced-kimi-2026-09-07-summary.json"),
    read("frontier-reference-2026-09-09.json"),
    read("gpt-5-5-reference-2026-09-09.json"),
    read("benchmark-v2-blueprint-2026-09-09.json"),
  ]);
  return {
    modelComparison,
    protocolComparison,
    externalFrontier,
    gpt55Reference,
    benchmarkBlueprint,
  };
}
