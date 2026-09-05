import { readFile, writeFile } from "node:fs/promises";

function replaceExact(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing M20-M22 hardening anchor: ${label}`);
  return text.replace(from, to);
}

const soakPath = "src/autonomy/soak.ts";
let soak = await readFile(soakPath, "utf8");
soak = replaceExact(
  soak,
  `  validateObservationBody(body);`,
  `  validateObservationBody(body, false);`,
  "producer observation validation",
);
soak = replaceExact(
  soak,
  `    validateObservationBody(observation);`,
  `    validateObservationBody(observation, true);`,
  "evaluator observation validation",
);
soak = replaceExact(
  soak,
  `function validateObservationBody(value: SoakObservationBody): void {
  if (!Number.isSafeInteger(value.atMs) || value.atMs < 0) {
    throw new AutonomyIntegrityError("Soak synthetic time must be a non-negative safe integer.");
  }
  const kinds = new Set([
    "checkpoint",
    "restart",
    "lease_reclaimed",
    "job_settled",
    "cancel_requested",
    "retry_failed",
    "budget_consumed",
    "heartbeat",
  ]);
  if (!kinds.has(value.kind)) throw new AutonomyIntegrityError("Unsupported soak event kind.");
}`,
  `function validateObservationBody(value: SoakObservationBody, envelope: boolean): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AutonomyIntegrityError("Soak observation must be an object.");
  }
  if (!Number.isSafeInteger(value.atMs) || value.atMs < 0) {
    throw new AutonomyIntegrityError("Soak synthetic time must be a non-negative safe integer.");
  }
  const shapes: Readonly<Record<string, readonly string[]>> = Object.freeze({
    budget_consumed: ["budgetUnits"],
    cancel_requested: ["jobId"],
    checkpoint: ["checkpointHash"],
    heartbeat: [],
    job_settled: ["generation", "jobId", "settlement"],
    lease_reclaimed: ["generation", "jobId"],
    restart: ["checkpointHash"],
    retry_failed: ["failureSignature"],
  });
  const shape = shapes[value.kind];
  if (shape === undefined) throw new AutonomyIntegrityError("Unsupported soak event kind.");
  const expectedKeys = [
    "atMs",
    "kind",
    ...shape,
    ...(envelope ? ["eventHash", "previousHash", "sequence"] : []),
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new AutonomyIntegrityError("Soak observation has unknown, missing, or misplaced fields.");
  }
  switch (value.kind) {
    case "checkpoint":
    case "restart":
      requiredHash(value.checkpointHash, "checkpointHash");
      break;
    case "lease_reclaimed":
      requiredId(value.jobId, "jobId");
      requiredGeneration(value.generation);
      break;
    case "job_settled":
      requiredId(value.jobId, "jobId");
      requiredGeneration(value.generation);
      if (
        value.settlement !== "SUCCEEDED" &&
        value.settlement !== "BLOCKED" &&
        value.settlement !== "CANCELLED"
      ) {
        throw new AutonomyIntegrityError("Job settlement status is invalid.");
      }
      break;
    case "cancel_requested":
      requiredId(value.jobId, "jobId");
      break;
    case "retry_failed":
      requiredHash(value.failureSignature, "failureSignature");
      break;
    case "budget_consumed":
      if (!Number.isSafeInteger(value.budgetUnits) || (value.budgetUnits ?? 0) <= 0) {
        throw new AutonomyIntegrityError("Budget consumption must be a positive safe integer.");
      }
      break;
    case "heartbeat":
      break;
  }
}`,
  "exact event shape validation",
);
await writeFile(soakPath, soak, "utf8");

const soakTestPath = "test/autonomy/soak.test.ts";
let soakTest = await readFile(soakTestPath, "utf8");
soakTest += `

test("soak observations reject unknown and event-inappropriate fields before hashing", () => {
  assert.throws(
    () =>
      createSoakObservation(null, {
        atMs: HOUR_MS,
        kind: "heartbeat",
        jobId: "smuggled-job",
      } as SoakObservationBody),
    /unknown, missing, or misplaced fields/u,
  );
  assert.throws(
    () =>
      createSoakObservation(null, {
        atMs: HOUR_MS,
        checkpointHash: sha("checkpoint"),
        kind: "checkpoint",
        unexpected: true,
      } as unknown as SoakObservationBody),
    /unknown, missing, or misplaced fields/u,
  );
});

test("hash-valid replay envelopes still reject extra semantic metadata", () => {
  const profile = SOAK_PROFILES["soak-6h-v1"];
  const events = [...passingSoak(profile)];
  const first = events[0];
  assert.ok(first !== undefined);
  const forged = { ...first, jobId: "smuggled-job" } as SoakObservation;
  events[0] = forged;
  assert.throws(() => evaluateSoak(profile, events), /unknown, missing, or misplaced fields/u);
});
`;
await writeFile(soakTestPath, soakTest, "utf8");

const routingPath = "src/routing/multi-model.ts";
let routing = await readFile(routingPath, "utf8");
routing = replaceExact(
  routing,
  `    const request = normalizeRouteRequest(requestValue);
    if (!Array.isArray(failuresValue) || failuresValue.length > 1_000) {`,
  `    const request = normalizeRouteRequest(requestValue);
    if (
      inputs === null ||
      typeof inputs !== "object" ||
      !Array.isArray(inputs.evaluations) ||
      !Array.isArray(inputs.profiles)
    ) {
      throw new RoutingError("INVALID_INPUT", "M21 routing inputs must contain profile and evaluation arrays.");
    }
    if (!Array.isArray(failuresValue) || failuresValue.length > 1_000) {`,
  "bounded routing input shape",
);
await writeFile(routingPath, routing, "utf8");

const routingTestPath = "test/routing/multi-model.test.ts";
let routingTest = await readFile(routingTestPath, "utf8");
routingTest += `

test("malformed M21 routing input containers fail with a bounded routing error", () => {
  assert.throws(
    () =>
      new FailureAwareModelRouter().route(
        routeRequest(),
        { evaluations: null, profiles: [] } as never,
        [],
      ),
    (error: unknown) => error instanceof RoutingError && error.code === "INVALID_INPUT",
  );
});
`;
await writeFile(routingTestPath, routingTest, "utf8");

const frontierTestPath = "test/frontier-evals/suite.test.ts";
let frontierTest = await readFile(frontierTestPath, "utf8");
frontierTest += `

test("declared case budgets are enforced independently of global result bounds", () => {
  const allCases = cases(50);
  const first = allCases[0];
  assert.ok(first !== undefined);
  const overBudget = createFrontierArmResult({
    ...result(first, "odin"),
    modelCalls: budget.maxModelCalls + 1,
  });
  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: allCases,
        harnessVersion: "frontier-harness-v1",
        results: [result(first, "model_alone"), overBudget],
        suiteVersion: "frontier-suite-v1",
      }),
    /exceeds its declared equal-condition budget/u,
  );
});

test("two distinct results for the same case arm cannot be cherry-picked", () => {
  const allCases = cases(50);
  const first = allCases[0];
  assert.ok(first !== undefined);
  const baseline = result(first, "model_alone");
  const alternateBaseline = createFrontierArmResult({
    ...baseline,
    latencyMs: baseline.latencyMs + 1,
  });
  assert.notEqual(baseline.resultHash, alternateBaseline.resultHash);
  assert.throws(
    () =>
      evaluateFrontierSuite({
        cases: allCases,
        harnessVersion: "frontier-harness-v1",
        results: [baseline, alternateBaseline, result(first, "odin")],
        suiteVersion: "frontier-suite-v1",
      }),
    /duplicate results for one arm/u,
  );
});
`;
await writeFile(frontierTestPath, frontierTest, "utf8");
