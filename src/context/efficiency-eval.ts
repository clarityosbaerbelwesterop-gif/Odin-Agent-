import { createHash } from "node:crypto";

export interface ContextEfficiencyCase {
  readonly id: string;
  readonly baselineTokens: number;
  readonly candidateTokens: number;
  readonly baselineOutcome: "BLOCK" | "PASS" | "REPAIR_REQUIRED";
  readonly candidateOutcome: "BLOCK" | "PASS" | "REPAIR_REQUIRED";
}

export interface ContextEfficiencyReport {
  readonly caseCount: number;
  readonly baselineTokens: number;
  readonly candidateTokens: number;
  readonly savingsBps: number;
  readonly verifierParity: boolean;
  readonly passed: boolean;
  readonly reportHash: string;
}

export function evaluateContextEfficiency(
  casesValue: readonly ContextEfficiencyCase[],
  minimumSavingsBps = 5_000,
): ContextEfficiencyReport {
  if (
    !Array.isArray(casesValue) ||
    casesValue.length < 3 ||
    casesValue.length > 200 ||
    !Number.isSafeInteger(minimumSavingsBps) ||
    minimumSavingsBps < 0 ||
    minimumSavingsBps > 10_000
  ) {
    throw new TypeError("Context efficiency evaluation bounds are invalid.");
  }
  const seen = new Set<string>();
  const outcomes = new Set(["BLOCK", "PASS", "REPAIR_REQUIRED"]);
  const cases = [...casesValue]
    .map((entry) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.id) || seen.has(entry.id)) {
        throw new TypeError("Context efficiency case identity is invalid or duplicated.");
      }
      seen.add(entry.id);
      for (const [label, value] of [
        ["baselineTokens", entry.baselineTokens],
        ["candidateTokens", entry.candidateTokens],
      ] as const) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
          throw new TypeError(`${label} is outside its integer bounds.`);
        }
      }
      if (entry.baselineTokens < 1 || entry.candidateTokens > entry.baselineTokens) {
        throw new TypeError(
          "Context efficiency cases require a non-empty non-increasing baseline.",
        );
      }
      if (!outcomes.has(entry.baselineOutcome) || !outcomes.has(entry.candidateOutcome)) {
        throw new TypeError("Context efficiency case outcome is unsupported.");
      }
      return Object.freeze({ ...entry });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const baselineTokens = cases.reduce((sum, entry) => sum + entry.baselineTokens, 0);
  const candidateTokens = cases.reduce((sum, entry) => sum + entry.candidateTokens, 0);
  const savingsBps = Math.floor(((baselineTokens - candidateTokens) * 10_000) / baselineTokens);
  const verifierParity = cases.every((entry) => entry.baselineOutcome === entry.candidateOutcome);
  const body = {
    baselineTokens,
    candidateTokens,
    caseCount: cases.length,
    cases,
    minimumSavingsBps,
    passed: verifierParity && savingsBps >= minimumSavingsBps,
    savingsBps,
    verifierParity,
  };
  return Object.freeze({
    baselineTokens,
    candidateTokens,
    caseCount: cases.length,
    passed: body.passed,
    reportHash: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    savingsBps,
    verifierParity,
  });
}
