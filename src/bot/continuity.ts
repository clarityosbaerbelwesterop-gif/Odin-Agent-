import { createHash } from "node:crypto";

export type BotMemoryKind =
  | "user_preference"
  | "project"
  | "recurring_task"
  | "decision"
  | "working_context"
  | "previous_mission"
  | "learned_procedure";
export type BotMemorySensitivity = "public" | "internal" | "sensitive";
export type BotMemorySourceClass = "explicit_user" | "repository" | "tool" | "mission" | "verified_learning";

export interface BotMemoryInput {
  readonly kind: BotMemoryKind;
  readonly key: string;
  readonly content: string;
  readonly sourceClass: BotMemorySourceClass;
  readonly sourceRef: string;
  readonly sourceTimestamp: string;
  readonly scope?: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly sensitivity: BotMemorySensitivity;
  readonly expiresAt?: string | null;
}

export interface BotFocusState {
  readonly taskId: string;
  readonly primaryObjective: string;
  readonly definitionOfDone: readonly string[];
  readonly constraints: readonly string[];
  readonly currentPlan: readonly string[];
  readonly completedSteps: readonly string[];
  readonly openBlockers: readonly string[];
  readonly teamPlan: Readonly<Record<string, unknown>>;
  readonly driftCount: number;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface FocusCheck {
  readonly aligned: boolean;
  readonly overlap: number;
  readonly reason: string;
  readonly shouldReplan: boolean;
}

const CONTINUATION = /\b(?:continue|weiter|weitermachen|gestern|yesterday|that thing|dem ding|da weiter|mach da)\b/iu;

export function isContinuationRequest(text: string): boolean {
  return CONTINUATION.test(text.trim());
}

export function checkFocus(primaryObjective: string, candidateObjective: string): FocusCheck {
  const primary = significantTokens(primaryObjective);
  const candidate = significantTokens(candidateObjective);
  if (candidate.size === 0 || primary.size === 0) {
    return { aligned: false, overlap: 0, reason: "Objective lacks enough stable terms to prove alignment.", shouldReplan: true };
  }
  const shared = [...candidate].filter((token) => primary.has(token)).length;
  const overlap = shared / Math.max(1, Math.min(primary.size, candidate.size));
  const aligned = overlap >= 0.2 || isContinuationRequest(candidateObjective);
  return {
    aligned,
    overlap,
    reason: aligned ? "Candidate remains anchored to the primary objective." : "Candidate drifted from the stored primary objective.",
    shouldReplan: !aligned,
  };
}

export function defaultDefinitionOfDone(goal: string): readonly string[] {
  const clean = goal.trim();
  if (!clean) throw new TypeError("Focus objective is required.");
  return [
    "Primary objective completed or a concrete external blocker recorded",
    "Relevant verification gates executed and evidence persisted",
    "No unapproved high-impact action executed",
    "Current state checkpointed so another worker can resume safely",
  ];
}

export function memoryContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function validateMemoryInput(input: BotMemoryInput): void {
  if (!input.key.trim() || input.key.length > 240) throw new TypeError("Memory key is invalid.");
  if (!input.content.trim() || input.content.length > 65_536) throw new TypeError("Memory content is invalid.");
  if (!input.sourceRef.trim() || input.sourceRef.length > 1000) throw new TypeError("Memory source reference is invalid.");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new TypeError("Memory confidence must be between 0 and 1.");
  const timestamp = Date.parse(input.sourceTimestamp);
  if (!Number.isFinite(timestamp)) throw new TypeError("Memory source timestamp is invalid.");
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) throw new TypeError("Memory expiry is invalid.");
}

function significantTokens(text: string): Set<string> {
  const stop = new Set(["the", "and", "that", "this", "with", "from", "dann", "und", "das", "der", "die", "den", "dem", "ein", "eine", "mach", "make", "please", "bitte"]);
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKC")
      .split(/[^\p{L}\p{N}_.-]+/u)
      .filter((token) => token.length >= 3 && !stop.has(token))
      .slice(0, 256),
  );
}
