import { isProviderError, ProviderError } from "./errors.js";

export interface ServerSentEvent {
  readonly data: string;
  readonly event?: string;
  readonly id?: string;
  readonly retry?: number;
}

export interface SseParserOptions {
  readonly provider: string;
  readonly maxEventBytes?: number;
}

const DEFAULT_MAX_EVENT_BYTES = 2 * 1024 * 1024;

export async function* parseServerSentEvents(
  stream: ReadableStream<Uint8Array>,
  options: SseParserOptions,
): AsyncIterable<ServerSentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  let buffer = "";
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let eventId: string | undefined;
  let retry: number | undefined;
  let eventBytes = 0;

  const dispatch = (): ServerSentEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = undefined;
      retry = undefined;
      eventBytes = 0;
      return undefined;
    }
    const event: ServerSentEvent = {
      data: dataLines.join("\n"),
      ...(eventName === undefined ? {} : { event: eventName }),
      ...(eventId === undefined ? {} : { id: eventId }),
      ...(retry === undefined ? {} : { retry }),
    };
    dataLines = [];
    eventName = undefined;
    retry = undefined;
    eventBytes = 0;
    return event;
  };

  const processLine = (line: string): ServerSentEvent | undefined => {
    if (line === "") return dispatch();
    eventBytes += new TextEncoder().encode(line).byteLength;
    assertWithinLimit(options.provider, eventBytes, maxEventBytes);
    if (line.startsWith(":")) return undefined;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value;
    else if (field === "id" && !value.includes("\u0000")) eventId = value;
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      while (true) {
        const lineEnd = nextLineEnd(buffer, done);
        if (lineEnd === undefined) break;
        const line = buffer.slice(0, lineEnd.index);
        buffer = buffer.slice(lineEnd.index + lineEnd.width);
        const event = processLine(line);
        if (event !== undefined) yield event;
      }

      const pendingBytes = new TextEncoder().encode(buffer).byteLength;
      assertWithinLimit(options.provider, eventBytes + pendingBytes, maxEventBytes);

      if (done) break;
    }

    if (buffer !== "") {
      const event = processLine(buffer);
      if (event !== undefined) yield event;
    }
    const event = dispatch();
    if (event !== undefined) yield event;
  } catch (error) {
    if (isProviderError(error)) throw error;
    throw new ProviderError({
      category: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
      cause: error,
      message: "The provider event stream could not be read.",
      provider: options.provider,
      retryable: true,
    });
  } finally {
    reader.releaseLock();
  }
}

function assertWithinLimit(provider: string, bytes: number, maxEventBytes: number): void {
  if (bytes <= maxEventBytes) return;
  throw new ProviderError({
    category: "malformed_response",
    message: `A streaming event exceeded the ${maxEventBytes}-byte safety limit.`,
    provider,
    retryable: false,
  });
}

function nextLineEnd(
  value: string,
  endOfStream: boolean,
): { readonly index: number; readonly width: number } | undefined {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\n") return { index, width: 1 };
    if (character === "\r") {
      if (index + 1 < value.length) {
        return { index, width: value[index + 1] === "\n" ? 2 : 1 };
      }
      if (endOfStream) return { index, width: 1 };
      return undefined;
    }
  }
  return undefined;
}
