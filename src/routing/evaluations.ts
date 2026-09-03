import {
  canonicalTimestamp,
  exactKeys,
  identifier,
  nonEmptyText,
  objectValue,
  safeInteger,
  sha256Json,
} from "./internal.js";
import {
  type EvaluationProducerClass,
  type ModelEvaluation,
  type ModelEvaluationInput,
  RoutingError,
  type RoutingTaskClass,
} from "./types.js";

const TASK_CLASSES = new Set<RoutingTaskClass>(["coding", "general", "planning", "research"]);
const INDEPENDENT_PRODUCERS = new Set<EvaluationProducerClass>([
  "independent_eval",
  "project_eval",
]);

export class ModelEvaluationRegistry {
  readonly #records = new Map<string, ModelEvaluation>();

  constructor(records: readonly ModelEvaluation[] = []) {
    for (const record of records) this.register(record);
  }

  register(value: unknown): ModelEvaluation {
    const record = normalizeEvaluation(value);
    if (this.#records.has(record.id)) {
      throw new RoutingError(
        "EVALUATION_CONFLICT",
        `Evaluation id ${record.id} is already registered.`,
      );
    }
    this.#records.set(record.id, record);
    return cloneEvaluation(record);
  }

  list(): readonly ModelEvaluation[] {
    return Object.freeze(
      [...this.#records.values()]
        .sort((left, right) => evaluationSortKey(left).localeCompare(evaluationSortKey(right)))
        .map(cloneEvaluation),
    );
  }
}

export function createEvaluationRecord(value: unknown): ModelEvaluation {
  const input = normalizeEvaluationInput(value);
  return freezeEvaluation({ ...input, contentHash: evaluationContentHash(input) });
}

export function evaluationContentHash(value: ModelEvaluationInput): string {
  return sha256Json({
    id: value.id,
    inputTokensPerSample: value.inputTokensPerSample,
    medianLatencyMs: value.medianLatencyMs,
    model: value.model,
    observedAt: value.observedAt,
    outputTokensPerSample: value.outputTokensPerSample,
    passRateBps: value.passRateBps,
    producer: value.producer,
    profileVersion: value.profileVersion,
    provider: value.provider,
    qualityScoreBps: value.qualityScoreBps,
    samples: value.samples,
    taskClass: value.taskClass,
  });
}

export function normalizeEvaluation(value: unknown): ModelEvaluation {
  const object = objectValue(value, "model evaluation");
  exactKeys(
    object,
    [
      "contentHash",
      "id",
      "inputTokensPerSample",
      "medianLatencyMs",
      "model",
      "observedAt",
      "outputTokensPerSample",
      "passRateBps",
      "producer",
      "profileVersion",
      "provider",
      "qualityScoreBps",
      "samples",
      "taskClass",
    ],
    [],
    "model evaluation",
  );
  const input = normalizeEvaluationInput(object);
  const contentHash = nonEmptyText(object.contentHash, "evaluation contentHash", 64);
  const expected = evaluationContentHash(input);
  if (contentHash !== expected) {
    throw new RoutingError("EVALUATION_INVALID", "Evaluation content hash does not match its data.");
  }
  return freezeEvaluation({ ...input, contentHash });
}

function normalizeEvaluationInput(value: unknown): ModelEvaluationInput {
  const object = objectValue(value, "model evaluation input");
  const allowedInputKeys = [
    "id",
    "inputTokensPerSample",
    "medianLatencyMs",
    "model",
    "observedAt",
    "outputTokensPerSample",
    "passRateBps",
    "producer",
    "profileVersion",
    "provider",
    "qualityScoreBps",
    "samples",
    "taskClass",
  ] as const;
  if (!("contentHash" in object)) {
    exactKeys(object, allowedInputKeys, [], "model evaluation input");
  }

  const producer = objectValue(object.producer, "evaluation producer");
  exactKeys(producer, ["class", "id", "reference"], [], "evaluation producer");
  const producerClass = nonEmptyText(
    producer.class,
    "evaluation producer class",
    64,
  ) as EvaluationProducerClass;
  if (!INDEPENDENT_PRODUCERS.has(producerClass)) {
    throw new RoutingError(
      "EVALUATION_INVALID",
      "Model, runtime, and worker self-evaluations cannot establish routing quality.",
    );
  }

  const taskClass = nonEmptyText(object.taskClass, "evaluation taskClass", 32) as RoutingTaskClass;
  if (!TASK_CLASSES.has(taskClass)) {
    throw new RoutingError("EVALUATION_INVALID", "Evaluation task class is unsupported.");
  }

  return Object.freeze({
    id: identifier(object.id, "evaluation id"),
    inputTokensPerSample: safeInteger(
      object.inputTokensPerSample,
      "evaluation inputTokensPerSample",
      0,
    ),
    medianLatencyMs: safeInteger(object.medianLatencyMs, "evaluation medianLatencyMs", 1),
    model: identifier(object.model, "evaluation model"),
    observedAt: canonicalTimestamp(object.observedAt, "evaluation observedAt"),
    outputTokensPerSample: safeInteger(
      object.outputTokensPerSample,
      "evaluation outputTokensPerSample",
      0,
    ),
    passRateBps: safeInteger(object.passRateBps, "evaluation passRateBps", 0, 10_000),
    producer: Object.freeze({
      class: producerClass,
      id: identifier(producer.id, "evaluation producer id"),
      reference: nonEmptyText(producer.reference, "evaluation producer reference", 2_048),
    }),
    profileVersion: identifier(object.profileVersion, "evaluation profileVersion"),
    provider: identifier(object.provider, "evaluation provider"),
    qualityScoreBps: safeInteger(
      object.qualityScoreBps,
      "evaluation qualityScoreBps",
      0,
      10_000,
    ),
    samples: safeInteger(object.samples, "evaluation samples", 1, 1_000_000),
    taskClass,
  });
}

function evaluationSortKey(value: ModelEvaluation): string {
  return [
    value.provider,
    value.model,
    value.profileVersion,
    value.taskClass,
    value.observedAt,
    value.id,
  ].join("\u0000");
}

function freezeEvaluation(value: ModelEvaluation): ModelEvaluation {
  return Object.freeze({
    ...value,
    producer: Object.freeze({ ...value.producer }),
  });
}

function cloneEvaluation(value: ModelEvaluation): ModelEvaluation {
  return freezeEvaluation({ ...value, producer: { ...value.producer } });
}
