import type { BudgetCounters, MissionCreateInput } from "../../src/mission/index.js";

export const LIMITS: BudgetCounters = {
  attempts: 4,
  costMicros: 100_000,
  inputTokens: 10_000,
  outputTokens: 5_000,
  toolCalls: 20,
};

export const ZERO: BudgetCounters = {
  attempts: 0,
  costMicros: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
};

export function missionInput(id = "mission-1"): MissionCreateInput {
  return {
    budgetLimits: LIMITS,
    focus: "complex",
    id,
    objective: "Ship a verified change",
    tasks: [
      {
        definitionOfDone: ["Repository understood"],
        id: "inspect",
        priority: 10,
        title: "Inspect repository",
      },
      {
        definitionOfDone: ["Change implemented"],
        dependsOn: ["inspect"],
        id: "implement",
        priority: 5,
        title: "Implement change",
      },
      {
        definitionOfDone: ["Verification passed"],
        dependsOn: ["inspect"],
        id: "verify",
        priority: 20,
        title: "Verify change",
      },
    ],
  };
}

export function fixedClock(): () => string {
  let tick = 0;
  return () => `2026-09-02T20:00:${String(tick++).padStart(2, "0")}.000Z`;
}
