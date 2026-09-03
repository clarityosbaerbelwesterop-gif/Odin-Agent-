import type { RoutingCandidate, RoutingDecision } from "../routing/types.js";
import { type SandboxSession, SandboxBackendRegistry } from "./backend.js";
import { SandboxError } from "./types.js";

export type SandboxRouteChoice =
  | { readonly kind: "primary" }
  | { readonly kind: "escalation"; readonly index: number };

export interface RoutedSandboxAllocationRequest {
  readonly decision: RoutingDecision;
  readonly choice: SandboxRouteChoice;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface RoutedSandboxSession extends SandboxSession {
  readonly routeDecisionHash: string;
  readonly routeEvaluationId: string;
  readonly routeEvaluationHash: string;
  readonly routeChoice: SandboxRouteChoice;
}

export class RoutedSandboxAllocator {
  readonly #registry: SandboxBackendRegistry;

  constructor(registry: SandboxBackendRegistry) {
    this.#registry = registry;
  }

  async allocate(request: RoutedSandboxAllocationRequest): Promise<RoutedSandboxSession> {
    if (typeof request.decision !== "object" || request.decision === null) {
      throw new SandboxError("BACKEND_INVALID", "Routing decision is required for sandbox allocation.");
    }
    const candidate = selectedCandidate(request.decision, request.choice);
    const session = await this.#registry.allocate({
      missionId: request.decision.missionId,
      model: candidate.model,
      profileVersion: candidate.profileVersion,
      provider: candidate.provider,
      signal: request.signal,
      taskId: request.decision.taskId,
      timeoutMs: request.timeoutMs,
    });
    return Object.freeze({
      ...session,
      routeChoice: freezeChoice(request.choice),
      routeDecisionHash: request.decision.decisionHash,
      routeEvaluationHash: candidate.evaluationHash,
      routeEvaluationId: candidate.evaluationId,
    });
  }
}

function selectedCandidate(
  decision: RoutingDecision,
  choice: SandboxRouteChoice,
): RoutingCandidate {
  if (choice.kind === "primary") return decision.primary;
  if (
    choice.kind !== "escalation" ||
    !Number.isSafeInteger(choice.index) ||
    choice.index < 0 ||
    choice.index >= decision.escalations.length
  ) {
    throw new SandboxError("BACKEND_INVALID", "Sandbox routing choice is invalid.");
  }
  const candidate = decision.escalations[choice.index];
  if (candidate === undefined) {
    throw new SandboxError("BACKEND_INVALID", "Sandbox routing candidate is unavailable.");
  }
  return candidate;
}

function freezeChoice(choice: SandboxRouteChoice): SandboxRouteChoice {
  return choice.kind === "primary"
    ? Object.freeze({ kind: "primary" })
    : Object.freeze({ index: choice.index, kind: "escalation" });
}
