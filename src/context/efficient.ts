import { createHash } from "node:crypto";
import type { RoutingRisk } from "../routing/types.js";
import { DeterministicContextCompiler } from "./compiler.js";
import type {
  CompiledContext,
  CompiledContextItem,
  CompiledContextSection,
  ContextCompileRequest,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_BASELINES = 128;

export interface EfficientContextRequest {
  readonly context: ContextCompileRequest;
  readonly stablePrefixHash: string;
  readonly modelProfileHash: string;
  readonly verificationRequirementHash: string;
  readonly previousResultHash?: string;
}

export interface EfficientContextResult {
  readonly schemaVersion: 1;
  readonly full: CompiledContext;
  readonly deltaSections: readonly CompiledContextSection[];
  readonly reusedIds: readonly string[];
  readonly removedIds: readonly string[];
  readonly deltaEstimatedTokens: number;
  readonly effectiveEstimatedTokens: number;
  readonly savingsBps: number;
  readonly bindingHash: string;
  readonly resultHash: string;
}

interface TrustedBaseline {
  readonly bindingHash: string;
  readonly result: CompiledContext;
}

export type AdaptiveReasoningDepth = "DEEP" | "DIRECT" | "STANDARD";

export class EfficientContextCompiler {
  readonly #baselines = new Map<string, TrustedBaseline>();

  constructor(readonly compiler = new DeterministicContextCompiler()) {}

  compile(request: EfficientContextRequest): EfficientContextResult {
    validateRequest(request);
    const full = this.compiler.compile(request.context);
    const bindingHash = hashJson({
      missionId: full.missionId,
      modelProfileHash: request.modelProfileHash,
      policyVersion: full.policyVersion,
      stablePrefixHash: request.stablePrefixHash,
      taskId: full.taskId,
      verificationRequirementHash: request.verificationRequirementHash,
    });
    const previous =
      request.previousResultHash === undefined
        ? undefined
        : this.#baselines.get(request.previousResultHash);
    const mayReuse = previous !== undefined && previous.bindingHash === bindingHash;
    const previousItems = mayReuse
      ? itemMap(previous.result)
      : new Map<string, CompiledContextItem>();
    const reusedIds: string[] = [];
    const deltaItems: CompiledContextItem[] = [];

    for (const item of allItems(full)) {
      const prior = previousItems.get(item.id);
      if (
        prior !== undefined &&
        prior.priority === item.priority &&
        prior.semanticKey === item.semanticKey &&
        prior.source.contentHash === item.source.contentHash &&
        prior.source.reference === item.source.reference &&
        prior.source.version === item.source.version
      ) {
        reusedIds.push(item.id);
      } else {
        deltaItems.push(item);
      }
    }

    const deltaSections = sections(deltaItems);
    const currentIds = new Set(allItems(full).map((item) => item.id));
    const removedIds = mayReuse
      ? [...previousItems.keys()].filter((id) => !currentIds.has(id)).sort()
      : [];
    const deltaEstimatedTokens = deltaItems.reduce((sum, item) => sum + item.estimatedTokens, 0);
    const effectiveEstimatedTokens = full.estimatedTokens;
    const savingsBps =
      effectiveEstimatedTokens === 0
        ? 0
        : Math.floor(
            ((effectiveEstimatedTokens - deltaEstimatedTokens) * 10_000) / effectiveEstimatedTokens,
          );
    const body = {
      bindingHash,
      deltaEstimatedTokens,
      deltaSections,
      effectiveEstimatedTokens,
      fullResultHash: full.resultHash,
      removedIds,
      reusedIds: reusedIds.sort(),
      savingsBps,
      schemaVersion: 1 as const,
    };
    const result = Object.freeze({ ...body, full, resultHash: hashJson(body) });

    if (!allItems(full).some((item) => item.sensitivity === "sensitive")) {
      this.#baselines.set(full.resultHash, {
        bindingHash,
        result: structuredClone(full),
      });
      while (this.#baselines.size > MAX_BASELINES) {
        const oldest = this.#baselines.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#baselines.delete(oldest);
      }
    }
    return structuredClone(result);
  }

  clear(): void {
    this.#baselines.clear();
  }
}

export function selectAdaptiveReasoningDepth(input: {
  readonly risk: RoutingRisk;
  readonly uncertaintyBps: number;
  readonly previousFailures: number;
  readonly remainingModelCalls: number;
  readonly independentPass: boolean;
}): AdaptiveReasoningDepth {
  if (!new Set(["critical", "high", "low", "medium"]).has(input.risk)) {
    throw new TypeError("risk is unsupported.");
  }
  for (const [label, value, maximum] of [
    ["uncertaintyBps", input.uncertaintyBps, 10_000],
    ["previousFailures", input.previousFailures, 1_000],
    ["remainingModelCalls", input.remainingModelCalls, 1_000],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new TypeError(`${label} is outside its integer bounds.`);
    }
  }
  if (typeof input.independentPass !== "boolean") {
    throw new TypeError("independentPass must be boolean.");
  }
  if (input.independentPass) return "DIRECT";
  if (input.remainingModelCalls === 0) return "DIRECT";
  if (
    input.risk === "critical" ||
    input.risk === "high" ||
    input.uncertaintyBps >= 7_500 ||
    input.previousFailures > 0
  ) {
    return "DEEP";
  }
  return input.risk === "medium" || input.uncertaintyBps >= 3_000 ? "STANDARD" : "DIRECT";
}

export function canExitEarly(input: {
  readonly outcome: "BLOCK" | "PASS" | "REPAIR_REQUIRED";
  readonly verificationVerdict: "FAIL" | "PASS";
  readonly reviewVerdict: "ACCEPT" | "BLOCK" | "REPAIR_REQUIRED";
  readonly independent: boolean;
  readonly contradictory: boolean;
  readonly evidenceHash: string;
}): boolean {
  assertHash(input.evidenceHash, "evidenceHash");
  if (typeof input.independent !== "boolean" || typeof input.contradictory !== "boolean") {
    throw new TypeError("Early-exit evidence flags must be boolean.");
  }
  if (
    !new Set(["BLOCK", "PASS", "REPAIR_REQUIRED"]).has(input.outcome) ||
    !new Set(["FAIL", "PASS"]).has(input.verificationVerdict) ||
    !new Set(["ACCEPT", "BLOCK", "REPAIR_REQUIRED"]).has(input.reviewVerdict)
  ) {
    throw new TypeError("Early-exit verdict is unsupported.");
  }
  return (
    input.independent &&
    !input.contradictory &&
    input.outcome === "PASS" &&
    input.verificationVerdict === "PASS" &&
    input.reviewVerdict === "ACCEPT"
  );
}

function validateRequest(request: EfficientContextRequest): void {
  assertHash(request.stablePrefixHash, "stablePrefixHash");
  assertHash(request.modelProfileHash, "modelProfileHash");
  assertHash(request.verificationRequirementHash, "verificationRequirementHash");
  if (request.previousResultHash !== undefined) {
    assertHash(request.previousResultHash, "previousResultHash");
  }
}

function allItems(context: CompiledContext): CompiledContextItem[] {
  return context.sections.flatMap((section) => section.items);
}

function itemMap(context: CompiledContext): Map<string, CompiledContextItem> {
  return new Map(allItems(context).map((item) => [item.id, item]));
}

function sections(items: readonly CompiledContextItem[]): CompiledContextSection[] {
  const priorities = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"] as const;
  return priorities
    .map((priority) => {
      const selected = items.filter((item) => item.priority === priority);
      return {
        estimatedTokens: selected.reduce((sum, item) => sum + item.estimatedTokens, 0),
        items: selected,
        priority,
      };
    })
    .filter((section) => section.items.length > 0);
}

function assertHash(value: string, label: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}
