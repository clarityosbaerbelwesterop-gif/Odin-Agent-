import type {
  CapabilityProfile,
  HttpRequest,
  HttpTransport,
  ModelCapabilities,
  ModelRequest,
  ModelStreamEvent,
} from "../../src/providers/index.js";
import { makeCapabilities } from "../../src/providers/index.js";

export class MockTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  readonly #handler: (request: HttpRequest) => Promise<Response> | Response;

  constructor(handler: (request: HttpRequest) => Promise<Response> | Response) {
    this.#handler = handler;
  }

  async request(request: HttpRequest): Promise<Response> {
    this.requests.push(request);
    return this.#handler(request);
  }
}

export function capabilityProfile(
  provider: string,
  model = "test-model",
  overrides: Partial<ModelCapabilities> = {},
): CapabilityProfile {
  return {
    capabilities: makeCapabilities({
      imageInput: true,
      reasoningEfforts: ["low", "medium", "high"],
      streaming: true,
      strictStructuredOutput: true,
      strictToolSchema: true,
      structuredOutput: true,
      temperature: true,
      toolUse: true,
      ...overrides,
    }),
    model,
    provider,
    provenance: {
      kind: "project_config",
      observedAt: "2026-09-02T00:00:00.000Z",
      reference: "test fixture",
    },
    version: "test-v1",
  };
}

export function basicRequest(model = "test-model"): ModelRequest {
  return {
    messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
    model,
  };
}

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers, status: init.status ?? 200 });
}

export function sseResponse(
  chunks: readonly string[],
  headers?: Readonly<Record<string, string>>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", ...Object.fromEntries(new Headers(headers)) },
    status: 200,
  });
}

export async function collectStream(
  stream: AsyncIterable<ModelStreamEvent>,
): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
