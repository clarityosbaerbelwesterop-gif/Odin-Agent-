import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError, parseServerSentEvents } from "../../src/providers/index.js";

function fragmentedStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("SSE parser handles comments, CRLF, arbitrary chunks, and multiline data", async () => {
  const stream = fragmentedStream([
    ": keep-alive\r",
    "\nid: evt-7\r\nevent: update\r\nda",
    "ta: first\r\ndata: second\r\nretry: 120\r\n\r\n",
  ]);
  const events = [];
  for await (const event of parseServerSentEvents(stream, { provider: "test" })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ data: "first\nsecond", event: "update", id: "evt-7", retry: 120 }]);
});

test("SSE parser dispatches an unterminated final event", async () => {
  const events = [];
  for await (const event of parseServerSentEvents(fragmentedStream(["data: final"]), {
    provider: "test",
  })) {
    events.push(event);
  }
  assert.deepEqual(events, [{ data: "final" }]);
});

test("SSE parser enforces an event-size limit", async () => {
  const consume = async () => {
    for await (const _event of parseServerSentEvents(fragmentedStream(["data: too-long\n\n"]), {
      maxEventBytes: 5,
      provider: "test",
    })) {
      // Consume the generator to trigger validation.
    }
  };
  await assert.rejects(consume(), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.category, "malformed_response");
    return true;
  });
});
