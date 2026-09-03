import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedRoutingResultCache,
  EmpiricalModelRouter,
  RoutingError,
} from "../../src/routing/index.js";
import { routeRequest, routingEvaluation, routingProfile } from "./helpers.js";

function cachedRoute(taskId: string, contextHash = "a".repeat(64)) {
  return new EmpiricalModelRouter().route(
    routeRequest({
      cache: { ...routeRequest().cache, contextHash },
      taskId,
    }),
    {
      evaluations: [routingEvaluation("provider-a", "small", { id: `eval-${taskId}` })],
      profiles: [routingProfile("provider-a", "small")],
    },
  );
}

test("routing cache stores only cache-eligible immutable metadata and expires deterministically", () => {
  const cache = new BoundedRoutingResultCache(2);
  const route = cachedRoute("cache-one");
  const stored = cache.put(route, "artifact:one", "1".repeat(64), "2026-09-03T12:00:00.000Z");
  assert.ok(stored !== null);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(cache.get(route, "2026-09-03T12:00:30.000Z")?.artifactRef, "artifact:one");
  assert.equal(cache.get(route, "2026-09-03T12:01:00.000Z"), null);
});

test("sensitive and read-disabled routes never return cached results", () => {
  const router = new EmpiricalModelRouter();
  const inputs = {
    evaluations: [routingEvaluation("provider-a", "small", { id: "sensitive-eval" })],
    profiles: [routingProfile("provider-a", "small")],
  };
  const sensitive = router.route(
    routeRequest({ cache: { ...routeRequest().cache, sensitive: true } }),
    inputs,
  );
  const cache = new BoundedRoutingResultCache();
  assert.equal(
    cache.put(sensitive, "artifact:sensitive", "2".repeat(64), "2026-09-03T12:00:00.000Z"),
    null,
  );

  const writeOnly = router.route(
    routeRequest({ cache: { ...routeRequest().cache, allowRead: false } }),
    inputs,
  );
  assert.ok(cache.put(writeOnly, "artifact:write", "3".repeat(64), "2026-09-03T12:00:00.000Z"));
  assert.equal(cache.get(writeOnly, "2026-09-03T12:00:01.000Z"), null);
});

test("same immutable cache key rejects conflicting result writes", () => {
  const cache = new BoundedRoutingResultCache();
  const route = cachedRoute("cache-conflict");
  cache.put(route, "artifact:first", "4".repeat(64), "2026-09-03T12:00:00.000Z");
  assert.throws(
    () => cache.put(route, "artifact:second", "5".repeat(64), "2026-09-03T12:00:00.000Z"),
    (error: unknown) => error instanceof RoutingError && error.code === "INVALID_INPUT",
  );
});

test("bounded cache evicts oldest entry with deterministic key tie-break", () => {
  const cache = new BoundedRoutingResultCache(2);
  const first = cachedRoute("cache-a", "a".repeat(64));
  const second = cachedRoute("cache-b", "b".repeat(64));
  const third = cachedRoute("cache-c", "c".repeat(64));
  cache.put(first, "artifact:a", "6".repeat(64), "2026-09-03T12:00:00.000Z");
  cache.put(second, "artifact:b", "7".repeat(64), "2026-09-03T12:00:01.000Z");
  cache.put(third, "artifact:c", "8".repeat(64), "2026-09-03T12:00:02.000Z");
  assert.equal(cache.size(), 2);
  assert.equal(cache.get(first, "2026-09-03T12:00:03.000Z"), null);
  assert.equal(cache.get(second, "2026-09-03T12:00:03.000Z")?.artifactRef, "artifact:b");
  assert.equal(cache.get(third, "2026-09-03T12:00:03.000Z")?.artifactRef, "artifact:c");
});
