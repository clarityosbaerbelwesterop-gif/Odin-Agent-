import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactReference } from "../../src/durable/types.js";
import type { BudgetCounters, MissionCreateInput } from "../../src/mission/runtime.js";

export const T0 = "2026-09-03T12:00:00.000Z";

export const BUDGETS: BudgetCounters = Object.freeze({
  attempts: 100,
  costMicros: 0,
  inputTokens: 100_000,
  outputTokens: 100_000,
  toolCalls: 100,
});

export function missionInput(id: string): MissionCreateInput {
  return {
    budgetLimits: BUDGETS,
    focus: "complex",
    id,
    objective: "Prove durable mission recovery",
    tasks: [
      {
        definitionOfDone: ["durable evidence exists"],
        id: "task-1",
        title: "Durable task",
      },
    ],
  };
}

export function artifact(id: string): ArtifactReference {
  return Object.freeze({
    artifactId: id,
    sha256: createHash("sha256").update(id).digest("hex"),
  });
}

export function plusMs(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

export async function temporaryDatabase(): Promise<{
  readonly directory: string;
  readonly path: string;
  readonly cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "odin-m8-"));
  return {
    cleanup: async () => {
      await rm(directory, { force: true, recursive: true });
    },
    directory,
    path: join(directory, "odin.sqlite"),
  };
}
