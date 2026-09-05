import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "../../src/providers/errors.js";
import {
  classifyFailure,
  classifyThrownFailure,
  type FailureSignal,
  type RecoveryAction,
  type RecoveryRequest,
  ReliabilityController,
  ReliabilityError,
} from "../../src/reliability/index.js";
import { ToolRuntimeError } from "../../src/tools/types.js";

const HASH = "a".repeat(64);

function signal(overrides: Partial<FailureSignal> = {}) {
  return classifyFailure({
    contradictoryEvidence: false,
    independentEvidence: false,
    missionId: "mission-17",
    phase: "VERIFYING",
    reasonCode: "provider_timeout",
    retryable: true,
    sideEffect: "NONE",
    source: "provider",
    taskId: "task-17",
    ...overrides,
  });
}

function request(
  overrides: Partial<RecoveryRequest> & { failure?: RecoveryRequest["failure"] } = {},
): RecoveryRequest {
  return {
    attempts: [],
    budget: {
      alternativePlansRemaining: 1,
      maxRepeatedStrategyFailures: 1,
      modelEscalationsRemaining: 1,
      repairsRemaining: 1,
      retriesRemaining: 1,
      rollbacksRemaining: 1,
      verifierEscalationsRemaining: 1,
    },
    capabilities: {
      contextReduction: true,
      modelEscalation: true,
      verifierEscalation: true,
    },
    failure: overrides.failure ?? signal(),
    ...overrides,
  };
}

function decide(overrides: Parameters<typeof request>[0] = {}) {
  return new ReliabilityController().decide(request(overrides));
}

test("typed transient failures retry only before safe side effects", () => {
  assert.equal(decide().action, "TARGETED_RETRY");
  assert.equal(
    decide({ failure: signal({ reasonCode: "rate_limit", sideEffect: "IDEMPOTENT" }) }).action,
    "TARGETED_RETRY",
  );
  assert.equal(
    decide({
      failure: signal({ reasonCode: "timeout", sideEffect: "IRREVERSIBLE_OR_UNKNOWN" }),
    }).action,
    "CHECKPOINT_AND_BLOCK",
  );
});

test("provider and tool exceptions normalize without persisting raw error messages", () => {
  const context = {
    contradictoryEvidence: false,
    fallbackSource: "runtime" as const,
    independentEvidence: false,
    missionId: "mission-17",
    phase: "EXECUTING",
    sideEffect: "NONE" as const,
    taskId: "task-17",
  };
  const provider = classifyThrownFailure(
    new ProviderError({
      category: "rate_limit",
      message: "secret provider body must not persist",
      provider: "fixture",
      retryable: true,
    }),
    context,
  );
  assert.equal(provider.category, "TRANSIENT");
  assert.equal(provider.reasonCode, "rate_limit");
  assert.equal(JSON.stringify(provider).includes("secret provider body"), false);

  const tool = classifyThrownFailure(
    new ToolRuntimeError("conflict", "sensitive handler detail", false),
    context,
  );
  assert.equal(tool.category, "CONFLICT");
  assert.equal(tool.source, "tool");
  assert.equal(JSON.stringify(tool).includes("sensitive handler detail"), false);

  const unknown = classifyThrownFailure(new Error("private stack"), context);
  assert.equal(unknown.category, "UNKNOWN");
  assert.equal(unknown.retryable, false);
});

test("context overflow reduces context before retry or model escalation", () => {
  const failure = signal({ reasonCode: "context_overflow", retryable: false });
  assert.equal(decide({ failure }).action, "REDUCE_CONTEXT");
  assert.equal(
    decide({
      attempts: [attempt(failure.signature, "REDUCE_CONTEXT")],
      failure,
    }).action,
    "ESCALATE_MODEL",
  );
});

test("invalid plans select an alternative and anti-loop switches strategy", () => {
  const failure = signal({ reasonCode: "malformed_response", retryable: false });
  const first = decide({ failure });
  assert.equal(first.action, "ALTERNATIVE_PLAN");
  const second = decide({
    attempts: [attempt(failure.signature, first.action, first.decisionHash)],
    failure,
  });
  assert.equal(second.action, "ESCALATE_MODEL");
  assert.notEqual(first.decisionHash, second.decisionHash);
});

test("reversible mutation rolls back only with runtime-attested preimage evidence", () => {
  assert.equal(
    decide({
      failure: signal({
        reasonCode: "quality_gate_failed",
        retryable: false,
        rollbackEvidenceHash: HASH,
        sideEffect: "REVERSIBLE",
        source: "verification",
      }),
    }).action,
    "ROLLBACK",
  );
  assert.equal(
    decide({
      failure: signal({
        reasonCode: "quality_gate_failed",
        retryable: false,
        sideEffect: "REVERSIBLE",
        source: "verification",
      }),
    }).action,
    "TARGETED_REPAIR",
  );
});

test("contradictory independent verification escalates the verifier and never accepts", () => {
  const decision = decide({
    failure: signal({
      contradictoryEvidence: true,
      evidenceHash: HASH,
      independentEvidence: true,
      reasonCode: "verification_contradiction",
      retryable: false,
      source: "verification",
    }),
  });
  assert.equal(decision.action, "ESCALATE_VERIFIER");
});

test("policy budget and cancellation failures stop without retry", () => {
  assert.equal(
    decide({ failure: signal({ reasonCode: "denied", retryable: false, source: "tool" }) }).action,
    "CHECKPOINT_AND_BLOCK",
  );
  assert.equal(
    decide({ failure: signal({ reasonCode: "budget_exceeded", retryable: false }) }).action,
    "CHECKPOINT_AND_BLOCK",
  );
  assert.equal(
    decide({ failure: signal({ reasonCode: "cancelled", retryable: false }) }).action,
    "STOP_CANCELLED",
  );
});

test("unknown failures escalate for diagnosis then block at the ceiling", () => {
  const failure = signal({ reasonCode: "novel_failure", retryable: false });
  assert.equal(decide({ failure }).action, "ESCALATE_MODEL");
  assert.equal(
    decide({ budget: { ...request().budget, modelEscalationsRemaining: 0 }, failure }).action,
    "CHECKPOINT_AND_BLOCK",
  );
});

test("classification and decisions are deterministic and input ordering independent", () => {
  const failure = signal({ evidenceHash: HASH, independentEvidence: true });
  assert.deepEqual(failure, signal({ independentEvidence: true, evidenceHash: HASH }));
  assert.deepEqual(decide({ failure }), decide({ failure }));

  const firstAttempt = attempt("b".repeat(64), "TARGETED_RETRY", "1".repeat(64));
  const secondAttempt = attempt("c".repeat(64), "ALTERNATIVE_PLAN", "2".repeat(64));
  assert.deepEqual(
    decide({ attempts: [firstAttempt, secondAttempt], failure }),
    decide({ attempts: [secondAttempt, firstAttempt], failure }),
  );
});

test("tampered signatures malformed evidence and foreign fields fail closed", () => {
  const failure = signal();
  assert.throws(
    () =>
      decide({
        failure: { ...failure, signature: "b".repeat(64) },
      }),
    (error: unknown) => error instanceof ReliabilityError && error.code === "INVALID_INPUT",
  );
  assert.throws(
    () =>
      signal({
        contradictoryEvidence: true,
        independentEvidence: false,
        reasonCode: "verification_contradiction",
      }),
    ReliabilityError,
  );
  assert.throws(
    () =>
      decide({
        attempts: [
          attempt(failure.signature, "TARGETED_RETRY"),
          attempt(failure.signature, "ALTERNATIVE_PLAN"),
        ],
        failure,
      }),
    ReliabilityError,
  );
  assert.throws(
    () =>
      classifyFailure({
        ...signal(),
        extra: "field",
      } as FailureSignal),
    ReliabilityError,
  );
});

function attempt(failureSignature: string, action: RecoveryAction, decisionHash = "c".repeat(64)) {
  return {
    action,
    decisionHash,
    failureSignature,
    outcome: "NO_PROGRESS" as const,
  };
}
