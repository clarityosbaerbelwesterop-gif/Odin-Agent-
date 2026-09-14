import assert from "node:assert/strict";
import test from "node:test";
import {
  type CodingChange,
  CodingProductStore,
  type CodingQualityEvidence,
} from "../../src/chat/coding-product.js";
import type { GitHubWorkspaceRepositoryState } from "../../src/chat/github-workspace.js";
import type { ChatEvent } from "../../src/chat/types.js";

const project = "project-1";
const run = "run-1";
const repository = "acme/odin";
const branch = "odin/2026-09-14/1234abcd";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const quality: CodingQualityEvidence = {
  cursor: 3,
  passed: true,
  commandId: "github-checks",
  classification: "repository-checks",
  summary: "CI: completed/success",
};
const change: CodingChange = {
  path: "src/login.ts",
  before: "old",
  after: "new",
  sha: "c".repeat(64),
  repository,
  baseSha,
  branch,
  headSha,
  diff: "diff",
};
const events: ChatEvent[] = [
  {
    cursor: 2,
    conversationId: project,
    turnId: run,
    type: "file.changed",
    data: {},
    createdAt: "2026-09-14T07:00:00.000Z",
  },
  {
    cursor: 3,
    conversationId: project,
    turnId: run,
    type: "quality",
    data: { passed: true },
    createdAt: "2026-09-14T07:00:01.000Z",
  },
];
const state: GitHubWorkspaceRepositoryState = {
  repository,
  baseBranch: "main",
  storedBaseSha: baseSha,
  currentBaseSha: baseSha,
  workBranch: branch,
  headSha,
};

type Readiness = {
  prReadiness(
    runId: string | null,
    events: readonly ChatEvent[],
    changes: readonly CodingChange[],
    quality: CodingQualityEvidence | null,
    state: GitHubWorkspaceRepositoryState,
  ): Promise<{ ready: boolean; reason: string | null }>;
};

function storeWithState(missionState: string): Readiness {
  const store = new CodingProductStore({} as never, "user-1", {
    token: "token",
    repository,
    defaultBranch: "main",
  });
  Object.defineProperty(store, "missions", {
    value: { load: async () => ({ state: missionState }) },
  });
  return store as unknown as Readiness;
}

test("PRODUCT M7 PR readiness fails closed at every delivery boundary and opens only for exact verified provenance", async () => {
  const completed = storeWithState("COMPLETED");
  assert.match(
    (await completed.prReadiness(null, [], [], null, state)).reason ?? "",
    /No Coding Run/u,
  );
  assert.match(
    (await storeWithState("RUNNING").prReadiness(run, events, [change], quality, state)).reason ??
      "",
    /RUNNING/u,
  );
  assert.match(
    (await completed.prReadiness(run, events, [], quality, state)).reason ?? "",
    /No repository changes/u,
  );
  assert.match(
    (await completed.prReadiness(run, events, [change], null, state)).reason ?? "",
    /passing repository quality/u,
  );
  const staleQuality = { ...quality, cursor: 1 };
  const staleEvents = [events[0]!, { ...events[1]!, cursor: 1 }];
  assert.match(
    (await completed.prReadiness(run, staleEvents, [change], staleQuality, state)).reason ?? "",
    /passing repository quality/u,
  );
  assert.match(
    (await completed.prReadiness(run, events, [{ ...change, branch: null }], quality, state))
      .reason ?? "",
    /provenance is incomplete/u,
  );
  assert.match(
    (
      await completed.prReadiness(run, events, [change], quality, {
        ...state,
        currentBaseSha: "d".repeat(40),
      })
    ).reason ?? "",
    /Base branch moved/u,
  );
  assert.match(
    (
      await completed.prReadiness(run, events, [change], quality, {
        ...state,
        workBranch: "odin/other",
        headSha: null,
      })
    ).reason ?? "",
    /work branch is unavailable/u,
  );
  assert.deepEqual(await completed.prReadiness(run, events, [change], quality, state), {
    ready: true,
    reason: null,
  });
});
