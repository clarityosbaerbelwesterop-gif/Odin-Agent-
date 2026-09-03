import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedRuntimeEventBuffer,
  createRuntimeEvent,
  ObservabilityError,
} from "../../src/observability/index.js";

const BASE = {
  kind: "sandbox" as const,
  occurredAt: "2026-09-03T19:20:00.000Z",
  reasonCode: "SANDBOX_ALLOCATED",
  severity: "info" as const,
  source: "sandbox.registry",
};

test("runtime event identity is deterministic across metadata insertion order", () => {
  const left = createRuntimeEvent({
    ...BASE,
    metadata: { backendId: "remote-a", retryCount: 0, reused: false },
    missionId: "mission-1",
    taskId: "task-1",
  });
  const right = createRuntimeEvent({
    ...BASE,
    metadata: { reused: false, retryCount: 0, backendId: "remote-a" },
    missionId: "mission-1",
    taskId: "task-1",
  });

  assert.equal(left.eventHash, right.eventHash);
  assert.equal(left.eventHash.length, 64);
  assert.deepEqual(left.metadata, { backendId: "remote-a", retryCount: 0, reused: false });
});

test("observability rejects secret-bearing keys and obvious secret values before logging", () => {
  assert.throws(
    () => createRuntimeEvent({ ...BASE, metadata: { apiKey: "redacted" } }),
    ObservabilityError,
  );
  assert.throws(
    () => createRuntimeEvent({ ...BASE, metadata: { detail: "Bearer abcdefghijklmnop" } }),
    ObservabilityError,
  );
  assert.throws(
    () => createRuntimeEvent({ ...BASE, metadata: { prompt: "harmless text" } }),
    ObservabilityError,
  );
});

test("runtime events reject noncanonical time, unsafe numbers, and oversized metadata", () => {
  assert.throws(
    () => createRuntimeEvent({ ...BASE, occurredAt: "2026-09-03T19:20:00Z" }),
    ObservabilityError,
  );
  assert.throws(
    () => createRuntimeEvent({ ...BASE, metadata: { durationMs: 1.5 } }),
    ObservabilityError,
  );
  const metadata = Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [`field${index}`, index]),
  );
  assert.throws(() => createRuntimeEvent({ ...BASE, metadata }), ObservabilityError);
});

test("bounded event buffer retains deterministic newest insertion order and defensive snapshots", () => {
  const buffer = new BoundedRuntimeEventBuffer(2);
  buffer.append({ ...BASE, reasonCode: "FIRST" });
  buffer.append({ ...BASE, reasonCode: "SECOND" });
  buffer.append({ ...BASE, reasonCode: "THIRD" });

  const events = buffer.list();
  assert.deepEqual(
    events.map((event) => event.reasonCode),
    ["SECOND", "THIRD"],
  );
  assert.equal(Object.isFrozen(events), true);
  assert.equal(Object.isFrozen(events[0]), true);
  assert.equal(Object.isFrozen(events[0]?.metadata), true);
});
