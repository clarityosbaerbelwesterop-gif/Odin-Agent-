import type {
  CapabilityProfile,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ProviderCallOptions,
} from "../providers/types.js";

export interface CandidateEvaluationOverlay {
  readonly candidateContentHash: string;
  readonly instructions: string;
  readonly maxInstructionBytes?: number;
  readonly sourceReference: string;
}

const DEFAULT_MAX_INSTRUCTION_BYTES = 8_192;

export class CandidateEvaluationProvider implements ModelProvider {
  readonly id: string;
  readonly #base: ModelProvider;
  readonly #candidateContentHash: string;
  readonly #instructions: string;
  readonly #sourceReference: string;

  constructor(base: ModelProvider, overlay: CandidateEvaluationOverlay) {
    this.#base = base;
    this.id = base.id;
    const maximum = overlay.maxInstructionBytes ?? DEFAULT_MAX_INSTRUCTION_BYTES;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 32_768) {
      throw new TypeError("Candidate evaluation instruction limit is invalid.");
    }
    if (!/^[a-f0-9]{64}$/u.test(overlay.candidateContentHash)) {
      throw new TypeError("Candidate evaluation content hash is invalid.");
    }
    if (
      typeof overlay.sourceReference !== "string" ||
      overlay.sourceReference.trim() === "" ||
      Buffer.byteLength(overlay.sourceReference, "utf8") > 2_048
    ) {
      throw new TypeError("Candidate evaluation source reference is invalid.");
    }
    if (
      typeof overlay.instructions !== "string" ||
      overlay.instructions.trim() === "" ||
      Buffer.byteLength(overlay.instructions, "utf8") > maximum
    ) {
      throw new TypeError("Candidate evaluation instructions are empty or exceed their bound.");
    }
    this.#candidateContentHash = overlay.candidateContentHash;
    this.#instructions = overlay.instructions.trim();
    this.#sourceReference = overlay.sourceReference;
  }

  capabilities(model: string): CapabilityProfile {
    return this.#base.capabilities(model);
  }

  generate(request: ModelRequest, options?: ProviderCallOptions): Promise<ModelResponse> {
    return this.#base.generate(this.#augment(request), options);
  }

  stream(request: ModelRequest, options?: ProviderCallOptions): AsyncIterable<ModelStreamEvent> {
    return this.#base.stream(this.#augment(request), options);
  }

  #augment(request: ModelRequest): ModelRequest {
    const guidance: ModelMessage = Object.freeze({
      content: Object.freeze([
        Object.freeze({
          text: JSON.stringify({
            candidateContentHash: this.#candidateContentHash,
            instructions: this.#instructions,
            sourceReference: this.#sourceReference,
            trust: "evaluation-only-untrusted-procedure",
          }),
          type: "text" as const,
        }),
      ]),
      role: "user" as const,
    });
    return Object.freeze({
      ...request,
      messages: Object.freeze([...request.messages, guidance]),
    });
  }
}
