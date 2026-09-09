import assert from "node:assert/strict";
import test from "node:test";
import { createLiveProviderPacer } from "../../src/capability-packs/live-pacer.js";

test("live pacer spaces provider starts without delaying the first attempt", async () => {
  let now = 1_000;
  const waits: number[] = [];
  const pacer = createLiveProviderPacer({
    minStartIntervalMs: 65_000,
    clock: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  assert.equal(await pacer.beforeAttempt(), 0);
  assert.equal(await pacer.beforeAttempt(), 65_000);
  now += 5_000;
  assert.equal(await pacer.beforeAttempt(), 60_000);
  assert.deepEqual(waits, [65_000, 60_000]);
  assert.deepEqual(pacer.snapshot(), {
    attempts: 3,
    minStartIntervalMs: 65_000,
    waitedMs: 125_000,
  });
});

test("concurrent pacing reservations remain globally serialized", async () => {
  let now = 10_000;
  const pacer = createLiveProviderPacer({
    minStartIntervalMs: 30_000,
    clock: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
  });

  const waits = await Promise.all([
    pacer.beforeAttempt(),
    pacer.beforeAttempt(),
    pacer.beforeAttempt(),
  ]);

  assert.deepEqual(waits, [0, 30_000, 30_000]);
  assert.deepEqual(pacer.snapshot(), {
    attempts: 3,
    minStartIntervalMs: 30_000,
    waitedMs: 60_000,
  });
});

test("aborted pacing does not consume an attempt", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const pacer = createLiveProviderPacer({ minStartIntervalMs: 1_000 });

  await assert.rejects(() => pacer.beforeAttempt(controller.signal), /cancelled/u);
  assert.equal(pacer.snapshot().attempts, 0);
});

test("pacing rejects unsafe intervals and a clock that does not advance", async () => {
  assert.throws(() => createLiveProviderPacer({ minStartIntervalMs: 0 }), TypeError);
  assert.throws(() => createLiveProviderPacer({ minStartIntervalMs: 300_001 }), TypeError);

  const pacer = createLiveProviderPacer({
    minStartIntervalMs: 1_000,
    clock: () => 5_000,
    sleep: async () => undefined,
  });
  await pacer.beforeAttempt();
  await assert.rejects(() => pacer.beforeAttempt(), /clock did not advance/u);
  assert.equal(pacer.snapshot().attempts, 1);
});
