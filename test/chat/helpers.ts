import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatEngine, type ChatEngineOptions } from "../../src/chat/engine.js";
import { ChatStore } from "../../src/chat/store.js";
import { SqliteDurableStore } from "../../src/durable/store.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderCallOptions,
} from "../../src/providers/types.js";
import { capabilityProfile } from "../providers/helpers.js";

/** Node fetch replaces Host; this transport preserves the trusted deployment host in local tests. */
export function hostedRequest(
  port: number,
  origin: string,
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Host: new URL(origin).host,
          Origin: origin,
          Cookie: cookie,
          "X-Odin-Request": "1",
          "Content-Type": "application/json",
        },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers))
            for (const item of Array.isArray(value) ? value : [value])
              if (item !== undefined) headers.append(key, item);
          resolve(
            new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 500, headers }),
          );
        });
      },
    );
    call.setTimeout(20000, () => call.destroy(new Error("Hosted test request timed out")));
    call.on("error", reject);
    call.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export function response(
  text = "A checked response.",
  tools: ModelResponse["message"]["toolCalls"] = [],
): ModelResponse {
  return {
    id: "test-response",
    provider: "fixture",
    model: "test-model",
    finishReason: tools.length ? "tool_call" : "stop",
    message: { role: "assistant", content: text ? [{ type: "text", text }] : [], toolCalls: tools },
    usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
  };
}
export function provider(
  handler: (
    request: ModelRequest,
    call: number,
    options?: ProviderCallOptions,
  ) => Promise<ModelResponse> | ModelResponse,
): ModelProvider & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const run = async (request: ModelRequest, options?: ProviderCallOptions) => {
    requests.push(request);
    return handler(request, requests.length, options);
  };
  return {
    id: "fixture",
    requests,
    capabilities: () =>
      capabilityProfile("fixture", "test-model", {
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 8192,
      }),
    generate: run,
    stream: async function* (request, options) {
      const result = await run(request, options);
      yield { type: "completed", response: result };
    },
  };
}
export async function fixture(
  model: ModelProvider = provider(() => response()),
  options: Partial<Omit<ChatEngineOptions, "store" | "events" | "models">> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "odin-chat-"));
  const store = new ChatStore(join(root, "chat.sqlite"));
  const events = new SqliteDurableStore(join(root, "missions.sqlite"));
  const engine = new ChatEngine({
    ...options,
    store,
    events,
    models: [{ id: "fixture", label: "Fixture provider", provider: model, model: "test-model" }],
  });
  await engine.initialize();
  const conversation = store.createConversation("Test conversation");
  return {
    root,
    engine,
    store,
    events,
    conversation,
    submit: (text = "A user task", mode = "chat", requestId = "request-1") =>
      engine.submit({ conversationId: conversation.id, text, mode, modelId: "fixture", requestId }),
    close: async () => {
      await engine.close();
      store.close();
      events.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 3000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
