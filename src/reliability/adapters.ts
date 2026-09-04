import { isProviderError } from "../providers/errors.js";
import { ToolRuntimeError } from "../tools/types.js";
import { classifyFailure } from "./classifier.js";
import { exactKeys } from "./internal.js";
import type { ClassifiedFailure, FailureSideEffect, FailureSource } from "./types.js";

export interface ThrownFailureContext {
  readonly missionId: string;
  readonly taskId: string;
  readonly phase: string;
  readonly fallbackSource: FailureSource;
  readonly sideEffect: FailureSideEffect;
  readonly evidenceHash?: string;
  readonly rollbackEvidenceHash?: string;
  readonly independentEvidence: boolean;
  readonly contradictoryEvidence: boolean;
}

export function classifyThrownFailure(
  error: unknown,
  context: ThrownFailureContext,
): ClassifiedFailure {
  exactKeys(
    context,
    [
      "missionId",
      "taskId",
      "phase",
      "fallbackSource",
      "sideEffect",
      "independentEvidence",
      "contradictoryEvidence",
    ],
    ["evidenceHash", "rollbackEvidenceHash"],
    "thrown failure context",
  );
  const shared = {
    contradictoryEvidence: context.contradictoryEvidence,
    ...(context.evidenceHash === undefined ? {} : { evidenceHash: context.evidenceHash }),
    independentEvidence: context.independentEvidence,
    missionId: context.missionId,
    phase: context.phase,
    ...(context.rollbackEvidenceHash === undefined
      ? {}
      : { rollbackEvidenceHash: context.rollbackEvidenceHash }),
    sideEffect: context.sideEffect,
    taskId: context.taskId,
  };
  if (isProviderError(error)) {
    return classifyFailure({
      ...shared,
      reasonCode: error.category,
      retryable: error.retryable,
      source: "provider",
    });
  }
  if (error instanceof ToolRuntimeError) {
    return classifyFailure({
      ...shared,
      reasonCode: error.category,
      retryable: error.retryable,
      source: "tool",
    });
  }
  return classifyFailure({
    ...shared,
    reasonCode: "unknown_failure",
    retryable: false,
    source: context.fallbackSource,
  });
}
