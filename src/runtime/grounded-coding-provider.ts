import { createHash } from "node:crypto";
import { MissionDomainError } from "../mission/runtime.js";
import type {
  CapabilityProfile,
  ConversationMessage,
  JsonObject,
  JsonValue,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ProviderCallOptions,
} from "../providers/types.js";
import { validateToolInput } from "../tools/schema.js";

const PLAN_RESPONSE_NAME = "odin_m4_coding_plan";
const REPAIR_RESPONSE_NAME = "odin_m4_coding_repair";
const MIN_COMPACT_OUTPUT_TOKENS = 512;
const MAX_COMPACT_OUTPUT_TOKENS = 4_096;

export const GROUNDED_CODING_PLAN_SCHEMA: JsonObject = Object.freeze({
  additionalProperties: false,
  properties: {
    change: {
      additionalProperties: false,
      properties: {
        content: { maxLength: 100_000, minLength: 1, type: "string" },
        path: { maxLength: 500, minLength: 1, type: "string" },
      },
      required: ["content", "path"],
      type: "object",
    },
    qualityCommandId: { maxLength: 100, minLength: 1, type: "string" },
  },
  required: ["change", "qualityCommandId"],
  type: "object",
});

export const GROUNDED_CODING_REPAIR_SCHEMA: JsonObject = Object.freeze({
  additionalProperties: false,
  properties: {
    content: { maxLength: 100_000, minLength: 1, type: "string" },
  },
  required: ["content"],
  type: "object",
});

interface PlanBinding {
  readonly objective: string;
  readonly qualityCommandIds: readonly string[];
  readonly files: ReadonlyMap<string, { readonly content: string; readonly sha: string }>;
}

interface RepairBinding {
  readonly objective: string;
  readonly qualityCommandId: string;
  readonly failureEvidence: string;
  readonly currentFile: {
    readonly content: string;
    readonly path: string;
    readonly sha: string;
  };
}

interface PreparedRequest {
  readonly request: ModelRequest;
  readonly expand: (response: ModelResponse) => ModelResponse;
}

/**
 * Compacts the M4 model contract while preserving Odin-owned authority.
 *
 * The model no longer spends output tokens copying optimistic SHA values or task metadata. Those fields
 * are rebound from the already-trusted M4 prompt after the provider returns. Repair similarly asks only
 * for replacement content because path and current SHA are runtime state, not model decisions.
 */
export class GroundedCodingProvider implements ModelProvider {
  readonly id: string;
  readonly #base: ModelProvider;

  constructor(base: ModelProvider) {
    this.#base = base;
    this.id = base.id;
  }

  capabilities(model: string): CapabilityProfile {
    return this.#base.capabilities(model);
  }

  async generate(request: ModelRequest, options?: ProviderCallOptions): Promise<ModelResponse> {
    const prepared = prepareGroundedRequest(request);
    if (prepared === null) return this.#base.generate(request, options);
    const response = await this.#base.generate(prepared.request, options);
    return prepared.expand(response);
  }

  stream(request: ModelRequest, options?: ProviderCallOptions): AsyncIterable<ModelStreamEvent> {
    return this.#base.stream(request, options);
  }
}

function prepareGroundedRequest(request: ModelRequest): PreparedRequest | null {
  const name = responseFormatName(request);
  if (name === PLAN_RESPONSE_NAME) return preparePlanRequest(request);
  if (name === REPAIR_RESPONSE_NAME) return prepareRepairRequest(request);
  return null;
}

function preparePlanRequest(request: ModelRequest): PreparedRequest {
  const payload = parseLastUserJson(request);
  const binding = parsePlanBinding(payload);
  const files = [...binding.files.entries()].map(([path, file]) => ({
    content: file.content,
    path,
  }));
  const compactPayload = JSON.stringify({
    files,
    objective: binding.objective,
    qualityCommandIds: binding.qualityCommandIds,
  });
  const maxFileChars = files.reduce((maximum, file) => Math.max(maximum, file.content.length), 0);
  const compactRequest: ModelRequest = {
    ...request,
    maxOutputTokens: compactOutputBudget(request.maxOutputTokens, maxFileChars),
    messages: [
      {
        content: [
          {
            text: "Return only strict JSON. Choose exactly one supplied path and one supplied qualityCommandId. Return the complete replacement file with the smallest change that satisfies the objective. Odin binds SHA and task metadata; do not invent them.",
            type: "text",
          },
        ],
        role: "system",
      },
      { content: [{ text: compactPayload, type: "text" }], role: "user" },
    ],
    responseFormat: {
      name: "odin_grounded_coding_plan_v1",
      schema: GROUNDED_CODING_PLAN_SCHEMA,
      strict: true,
      type: "json_schema",
    },
  };
  return {
    request: compactRequest,
    expand: (response) => expandPlanResponse(response, binding),
  };
}

function prepareRepairRequest(request: ModelRequest): PreparedRequest {
  const payload = parseLastUserJson(request);
  const binding = parseRepairBinding(payload);
  const compactPayload = JSON.stringify({
    currentFile: {
      content: binding.currentFile.content,
      path: binding.currentFile.path,
    },
    failureEvidence: boundedText(binding.failureEvidence, 1_000),
    objective: binding.objective,
    qualityCommandId: binding.qualityCommandId,
  });
  const compactRequest: ModelRequest = {
    ...request,
    maxOutputTokens: compactOutputBudget(
      request.maxOutputTokens,
      binding.currentFile.content.length,
    ),
    messages: [
      {
        content: [
          {
            text: "Return only strict JSON with the complete replacement content. It must differ from currentFile and fix the stated failure while preserving unrelated behavior. Odin binds path and SHA.",
            type: "text",
          },
        ],
        role: "system",
      },
      { content: [{ text: compactPayload, type: "text" }], role: "user" },
    ],
    responseFormat: {
      name: "odin_grounded_coding_repair_v1",
      schema: GROUNDED_CODING_REPAIR_SCHEMA,
      strict: true,
      type: "json_schema",
    },
  };
  return {
    request: compactRequest,
    expand: (response) => expandRepairResponse(response, binding),
  };
}

function expandPlanResponse(response: ModelResponse, binding: PlanBinding): ModelResponse {
  const output = jsonObject(
    response.structuredOutput,
    "Grounded coding plan is not a JSON object.",
  );
  validateToolInput(GROUNDED_CODING_PLAN_SCHEMA, output);
  const change = jsonObject(output.change, "Grounded coding change is not an object.");
  const path = stringValue(change.path, "Grounded coding path is invalid.");
  const content = stringValue(change.content, "Grounded coding content is invalid.");
  const qualityCommandId = stringValue(
    output.qualityCommandId,
    "Grounded coding quality command is invalid.",
  );
  const file = binding.files.get(path);
  if (file === undefined) {
    throw new MissionDomainError(
      "Grounded coding provider selected a path outside trusted discovery.",
    );
  }
  if (!binding.qualityCommandIds.includes(qualityCommandId)) {
    throw new MissionDomainError(
      "Grounded coding provider selected an unregistered quality command.",
    );
  }
  const taskId = `change-${shortHash(`${binding.objective}\u0000${path}`, 20)}`;
  return {
    ...response,
    structuredOutput: {
      change: { content, expectedSha: file.sha, path },
      qualityCommandId,
      task: {
        definitionOfDone: [boundedText(binding.objective, 500)],
        dependsOn: [],
        id: taskId,
        priority: 10,
        title: boundedText(`Apply requested change to ${path}`, 500),
      },
    },
  };
}

function expandRepairResponse(response: ModelResponse, binding: RepairBinding): ModelResponse {
  const output = jsonObject(
    response.structuredOutput,
    "Grounded coding repair is not a JSON object.",
  );
  validateToolInput(GROUNDED_CODING_REPAIR_SCHEMA, output);
  return {
    ...response,
    structuredOutput: {
      content: stringValue(output.content, "Grounded coding repair content is invalid."),
      expectedSha: binding.currentFile.sha,
      path: binding.currentFile.path,
    },
  };
}

function parsePlanBinding(payload: JsonObject): PlanBinding {
  const objective = stringValue(payload.objective, "Grounded plan objective is invalid.");
  const qualityCommandIds = stringArray(
    payload.qualityCommandIds,
    "Grounded plan quality commands are invalid.",
  );
  if (qualityCommandIds.length === 0) {
    throw new MissionDomainError("Grounded plan has no registered quality command.");
  }
  if (!Array.isArray(payload.relevantFiles) || payload.relevantFiles.length === 0) {
    throw new MissionDomainError("Grounded plan has no trusted repository files.");
  }
  const files = new Map<string, { content: string; sha: string }>();
  for (const raw of payload.relevantFiles) {
    const file = jsonObject(raw, "Grounded plan repository file is invalid.");
    const path = stringValue(file.path, "Grounded plan repository path is invalid.");
    const sha = stringValue(file.sha, "Grounded plan repository SHA is invalid.");
    const content = stringValue(file.content, "Grounded plan repository content is invalid.");
    if (files.has(path))
      throw new MissionDomainError("Grounded plan repository path is duplicated.");
    files.set(path, { content, sha });
  }
  return { files, objective, qualityCommandIds };
}

function parseRepairBinding(payload: JsonObject): RepairBinding {
  const currentFile = jsonObject(payload.currentFile, "Grounded repair currentFile is invalid.");
  return {
    currentFile: {
      content: stringValue(currentFile.content, "Grounded repair content is invalid."),
      path: stringValue(currentFile.path, "Grounded repair path is invalid."),
      sha: stringValue(currentFile.sha, "Grounded repair SHA is invalid."),
    },
    failureEvidence: stringValue(
      payload.failureEvidence,
      "Grounded repair failure evidence is invalid.",
    ),
    objective: stringValue(payload.objective, "Grounded repair objective is invalid."),
    qualityCommandId: stringValue(
      payload.qualityCommandId,
      "Grounded repair quality command is invalid.",
    ),
  };
}

function parseLastUserJson(request: ModelRequest): JsonObject {
  let user: ConversationMessage | undefined;
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === "user") {
      user = message;
      break;
    }
  }
  if (user === undefined)
    throw new MissionDomainError("Grounded coding request has no user payload.");
  const text = user.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  try {
    return jsonObject(JSON.parse(text) as JsonValue, "Grounded coding user payload is invalid.");
  } catch (error) {
    if (error instanceof MissionDomainError) throw error;
    throw new MissionDomainError("Grounded coding user payload is not valid JSON.");
  }
}

function responseFormatName(request: ModelRequest): string | undefined {
  return request.responseFormat?.type === "json_schema" ? request.responseFormat.name : undefined;
}

function compactOutputBudget(original: number | undefined, fileChars: number): number {
  const estimated = Math.ceil(fileChars / 3) + 256;
  const ceiling = Math.min(original ?? MAX_COMPACT_OUTPUT_TOKENS, MAX_COMPACT_OUTPUT_TOKENS);
  return Math.max(MIN_COMPACT_OUTPUT_TOKENS, Math.min(ceiling, estimated));
}

function jsonObject(value: JsonValue | undefined, message: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MissionDomainError(message);
  }
  return value as JsonObject;
}

function stringValue(value: JsonValue | undefined, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new MissionDomainError(message);
  return value;
}

function stringArray(value: JsonValue | undefined, message: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry !== "")) {
    throw new MissionDomainError(message);
  }
  return [...value];
}

function boundedText(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function shortHash(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}
