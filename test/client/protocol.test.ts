import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientProtocolError,
  decodeClientCommandRequest,
  decodeClientStateRequest,
  normalizeCapabilityGrant,
} from "../../src/client/index.js";
import { capability, commandRequest, stateRequest, T0 } from "./helpers.js";

test("client protocol accepts only the supported version and exact bounded request shapes", () => {
  assert.deepEqual(decodeClientStateRequest(stateRequest()), stateRequest());
  assert.deepEqual(
    decodeClientCommandRequest(commandRequest("mission.pause", 6)),
    commandRequest("mission.pause", 6),
  );

  assert.throws(
    () => decodeClientStateRequest({ ...stateRequest(), protocol: { major: 2, minor: 0 } }),
    (error: unknown) => error instanceof ClientProtocolError && error.code === "UNSUPPORTED_VERSION",
  );
  assert.throws(
    () => decodeClientStateRequest({ ...stateRequest(), unexpected: true }),
    (error: unknown) => error instanceof ClientProtocolError && error.code === "MALFORMED",
  );
  assert.throws(
    () => decodeClientStateRequest({ ...stateRequest(), requestedAt: "2026-09-03" }),
    ClientProtocolError,
  );
  assert.throws(
    () => decodeClientStateRequest({ ...stateRequest(), limit: 100 }),
    ClientProtocolError,
  );
});

test("command codec refuses arbitrary mutation types and unknown command payload fields", () => {
  assert.throws(
    () => decodeClientCommandRequest({ ...commandRequest("mission.pause", 6), command: "mission.complete" }),
    ClientProtocolError,
  );
  assert.throws(
    () =>
      decodeClientCommandRequest({
        ...commandRequest("mission.cancel", 6),
        targetState: "COMPLETED",
      }),
    ClientProtocolError,
  );
  assert.throws(
    () => decodeClientCommandRequest({ ...commandRequest("mission.cancel", 6), expectedVersion: -1 }),
    ClientProtocolError,
  );
});

test("capability grants are exact, scoped, canonical, and deduplicated", () => {
  const normalized = normalizeCapabilityGrant(capability());
  assert.deepEqual(normalized.commands, ["mission.cancel", "mission.pause", "mission.resume"]);
  assert.equal(normalized.expiresAt > T0, true);
  assert.throws(
    () => normalizeCapabilityGrant({ ...capability(), commands: ["mission.pause", "mission.pause"] }),
    ClientProtocolError,
  );
  assert.throws(
    () => normalizeCapabilityGrant({ ...capability(), expiresAt: "tomorrow" }),
    ClientProtocolError,
  );
});
