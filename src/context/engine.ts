import { createHash } from "node:crypto";
import type {
  MemoryKind,
  MemoryReader,
  MemoryRetrievalQuery,
  MemoryScope,
  RetrievedMemory,
} from "../memory/index.js";
import { DeterministicContextCompiler } from "./compiler.js";
import type { CompiledContext, ContextBudget, ContextCandidate, ContextPriority } from "./types.js";

export interface ContextMemoryQuery {
  readonly userId: string;
  readonly projectId: string;
  readonly kinds: readonly MemoryKind[];
  readonly text: string;
  readonly tags?: readonly string[];
  readonly limit: number;
  readonly evaluatedAt: string;
}

export interface ContextEngineRequest {
  readonly missionId: string;
  readonly taskId: string;
  readonly policyVersion: string;
  readonly budget: ContextBudget;
  readonly trustedCandidates: readonly ContextCandidate[];
  readonly historyCandidates?: readonly ContextCandidate[];
  readonly memory: ContextMemoryQuery;
}

export class ContextEngine {
  readonly #unsubscribe: () => void;

  constructor(
    readonly memory: MemoryReader,
    readonly compiler = new DeterministicContextCompiler(),
  ) {
    this.#unsubscribe = memory.subscribe((change) => {
      this.compiler.invalidateSource(memoryCandidateId(change.id, change.scope));
    });
  }

  async compile(request: ContextEngineRequest): Promise<CompiledContext> {
    validateSuppliedCandidates(request.trustedCandidates, ["P0", "P1", "P2", "P3", "P4"]);
    const history = request.historyCandidates ?? [];
    validateSuppliedCandidates(history, ["P6"]);
    const retrieval: MemoryRetrievalQuery = {
      evaluatedAt: request.memory.evaluatedAt,
      kinds: [...request.memory.kinds],
      limit: request.memory.limit,
      missionId: request.missionId,
      projectId: request.memory.projectId,
      ...(request.memory.tags === undefined ? {} : { tags: [...request.memory.tags] }),
      text: request.memory.text,
      userId: request.memory.userId,
    };
    const retrieved = await this.memory.retrieve(retrieval);
    const candidates = [
      ...request.trustedCandidates,
      ...retrieved.map(memoryCandidate),
      ...history,
    ];
    return this.compiler.compile({
      budget: request.budget,
      candidates,
      missionId: request.missionId,
      policyVersion: request.policyVersion,
      taskId: request.taskId,
    });
  }

  dispose(): void {
    this.#unsubscribe();
  }
}

function validateSuppliedCandidates(
  candidates: readonly ContextCandidate[],
  allowed: readonly ContextPriority[],
): void {
  const allowedSet = new Set(allowed);
  for (const candidate of candidates) {
    if (!allowedSet.has(candidate.priority)) {
      throw new TypeError(
        `Caller-supplied context priority ${candidate.priority} is not permitted in this channel.`,
      );
    }
  }
}

function memoryCandidate(retrieved: RetrievedMemory): ContextCandidate {
  const { record, score } = retrieved;
  return {
    content: record.content,
    id: memoryCandidateId(record.id, record.scope),
    priority: "P5",
    relevance: Math.max(0, Math.min(100, score)),
    semanticKey: record.key,
    sensitivity: record.sensitivity,
    source: {
      class: "memory",
      contentHash: record.provenance.contentHash,
      observedAt: record.updatedAt,
      reference: `memory:${record.id}`,
      version: String(record.version),
    },
  };
}

function memoryCandidateId(id: string, scope: MemoryScope): string {
  const encoded = JSON.stringify({ id, scope });
  const digest = createHash("sha256").update(encoded).digest("hex");
  return `memory:${digest}`;
}
