import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ClientMissionProjection, ClientStateResponse } from "../../src/client/index.js";
import {
  assertMobileCommandAllowed,
  buildMobilePresentation,
  createMobileOfflineSnapshot,
  type MobileApprovalChallenge,
  MobileApprovalAuthority,
  MobileExperienceError,
  type MobileExperienceMetadata,
  type MobilePlatformClass,
  openMobileNotification,
  readMobileOfflineSnapshot,
  resumeMobileExperience,
} from "../../src/mobile/index.js";

const NOW = "2026-09-06T08:00:00.000Z";
const LATER = "2026-09-06T08:02:00.000Z";
const EXPIRES = "2026-09-06T08:05:00.000Z";

function projection(version = 7): ClientMissionProjection {
  return {
    budgetLimits: { attempts: 8, costMicros: 5_000, inputTokens: 20_000, outputTokens: 10_000, toolCalls: 40 },
    budgetUsage: { attempts: 2, costMicros: 800, inputTokens: 2_000, outputTokens: 600, toolCalls: 5 },
    checkpointVersion: 6,
    focus: "critical",
    jobs: { BLOCKED: 0, CANCELLED: 0, CANCELLING: 0, PENDING: 1, RETRY_WAIT: 0, RUNNING: 1, SUCCEEDED: 4 },
    missionId: "mission-1",
    objective: "Operate Odin from mobile",
    resumeState: null,
    state: "EXECUTING",
    tasks: [{ dependsOn: [], id: "task-1", priority: 1, status: "RUNNING", title: "Mobile UX" }],
    verification: { evidenceRefs: ["evidence/m28"], status: "PENDING" },
    version,
  };
}

function response(fromCursor = 12, nextCursor = 14, version = 7): ClientStateResponse {
  return {
    emittedAt: NOW,
    events: [],
    fromCursor,
    hasMore: false,
    missionId: "mission-1",
    nextCursor,
    projection: projection(version),
    protocol: { major: 1, minor: 0 },
    requestId: `state-${fromCursor}-${nextCursor}`,
    sessionId: "session-1",
  };
}

function metadata(platform: MobilePlatformClass = "ios"): MobileExperienceMetadata {
  return { clientVersion: "1.0.0", locale: "de-DE", platform, sessionId: "session-1" };
}

function issue(authority: MobileApprovalAuthority): MobileApprovalChallenge {
  return authority.issue({
    actionId: "tool.deploy.production",
    challengeId: "challenge-1",
    expectedVersion: 7,
    expiresAt: EXPIRES,
    issuedAt: NOW,
    missionId: "mission-1",
    sessionId: "session-1",
    taskId: "task-1",
  });
}

test("mobile presentation supports every platform class without changing server authority", () => {
  const platforms: readonly MobilePlatformClass[] = [
    "responsive_web",
    "ios",
    "ipados",
    "android",
    "macos",
    "desktop_web",
  ];
  for (const platform of platforms) {
    const view = buildMobilePresentation(metadata(platform), response());
    assert.equal(view.platform, platform);
    assert.equal(view.missionId, "mission-1");
    assert.equal(view.version, 7);
    assert.equal(view.mode, "ONLINE");
  }
});

test("device metadata never substitutes for exact server session scope", () => {
  assert.throws(
    () => buildMobilePresentation({ ...metadata(), sessionId: "session-2" }, response()),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "SCOPE_DENIED",
  );
});

test("offline presentation is integrity-bound and strictly read-only", () => {
  const snapshot = createMobileOfflineSnapshot(response(), LATER);
  const view = readMobileOfflineSnapshot(metadata(), snapshot);
  assert.equal(view.mode, "OFFLINE_READ_ONLY");
  assert.throws(
    () => assertMobileCommandAllowed(view, "mission.cancel"),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "OFFLINE_MUTATION_DENIED",
  );
  assert.throws(
    () => readMobileOfflineSnapshot(metadata(), { ...snapshot, cursor: snapshot.cursor + 1 }),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "MALFORMED",
  );
});

test("resume accepts exact durable cursor or authenticated full bootstrap and rejects gaps", () => {
  const snapshot = createMobileOfflineSnapshot(response(10, 12), LATER);
  const continued = resumeMobileExperience(metadata(), snapshot, response(12, 15, 8));
  assert.equal(continued.mode, "CONTINUED");
  const bootstrapped = resumeMobileExperience(metadata(), snapshot, response(0, 15, 8));
  assert.equal(bootstrapped.mode, "BOOTSTRAPPED");
  assert.throws(
    () => resumeMobileExperience(metadata(), snapshot, response(11, 15, 8)),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "RESYNC_REQUIRED",
  );
  assert.throws(
    () => resumeMobileExperience(metadata(), snapshot, response(12, 12, 6)),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "RESYNC_REQUIRED",
  );
});

test("approval is fresh, exact, one-use, and never becomes command authority itself", () => {
  const authority = new MobileApprovalAuthority();
  const challenge = issue(authority);
  const receipt = authority.decide({
    actionId: challenge.actionId,
    challengeHash: challenge.challengeHash,
    challengeId: challenge.challengeId,
    decidedAt: LATER,
    decision: "APPROVE",
    expectedVersion: challenge.expectedVersion,
    missionId: challenge.missionId,
    online: true,
    sessionId: challenge.sessionId,
    taskId: challenge.taskId,
  });
  assert.equal(receipt.commandAuthority, "REQUIRES_FRESH_SERVER_VALIDATION");
  assert.throws(
    () =>
      authority.decide({
        actionId: challenge.actionId,
        challengeHash: challenge.challengeHash,
        challengeId: challenge.challengeId,
        decidedAt: LATER,
        decision: "APPROVE",
        expectedVersion: challenge.expectedVersion,
        missionId: challenge.missionId,
        online: true,
        sessionId: challenge.sessionId,
        taskId: challenge.taskId,
      }),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "APPROVAL_REPLAYED",
  );
});

test("approval denies offline, expired, and cross-mission decisions", () => {
  const offlineAuthority = new MobileApprovalAuthority();
  const offline = issue(offlineAuthority);
  assert.throws(
    () =>
      offlineAuthority.decide({
        actionId: offline.actionId,
        challengeHash: offline.challengeHash,
        challengeId: offline.challengeId,
        decidedAt: LATER,
        decision: "APPROVE",
        expectedVersion: offline.expectedVersion,
        missionId: offline.missionId,
        online: false,
        sessionId: offline.sessionId,
        taskId: offline.taskId,
      }),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "OFFLINE_MUTATION_DENIED",
  );

  const crossAuthority = new MobileApprovalAuthority();
  const cross = issue(crossAuthority);
  assert.throws(
    () =>
      crossAuthority.decide({
        actionId: cross.actionId,
        challengeHash: cross.challengeHash,
        challengeId: cross.challengeId,
        decidedAt: LATER,
        decision: "APPROVE",
        expectedVersion: cross.expectedVersion,
        missionId: "mission-2",
        online: true,
        sessionId: cross.sessionId,
        taskId: cross.taskId,
      }),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "APPROVAL_INVALID",
  );

  const expiredAuthority = new MobileApprovalAuthority();
  const expired = issue(expiredAuthority);
  assert.throws(
    () =>
      expiredAuthority.decide({
        actionId: expired.actionId,
        challengeHash: expired.challengeHash,
        challengeId: expired.challengeId,
        decidedAt: "2026-09-06T08:06:00.000Z",
        decision: "APPROVE",
        expectedVersion: expired.expectedVersion,
        missionId: expired.missionId,
        online: true,
        sessionId: expired.sessionId,
        taskId: expired.taskId,
      }),
    (error: unknown) => error instanceof MobileExperienceError && error.code === "APPROVAL_EXPIRED",
  );
});

test("notification hints never prove mission state", () => {
  const opened = openMobileNotification({
    cursorHint: 14,
    emittedAt: NOW,
    hintType: "approval_required",
    missionId: "mission-1",
  });
  assert.equal(opened.provesMissionState, false);
  assert.equal(opened.requiresAuthenticatedRefresh, true);
});

test("responsive mobile fixture demonstrates progress, reconnect, and approval without persistent credentials", async () => {
  const [html, script] = await Promise.all([
    readFile("web/mobile-reference.html", "utf8"),
    readFile("web/mobile-reference.js", "utf8"),
  ]);
  const source = `${html}\n${script}`;
  assert.match(source, /Reconnect/u);
  assert.match(source, /approval/u);
  assert.match(source, /progress/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|Bearer\s|authorization/iu);
});
