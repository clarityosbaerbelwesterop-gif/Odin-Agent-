import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aggregateChanges, qualityEvidence, unifiedDiff } from "../../src/chat/coding-product.js";
import type { ChatEvent } from "../../src/chat/types.js";

const event = (cursor: number, type: string, data: Record<string, unknown>): ChatEvent => ({
  cursor,
  conversationId: "project-1",
  turnId: "run-1",
  type,
  data,
  createdAt: "2026-09-13T16:00:00.000Z",
});

test("PRODUCT M7 aggregates canonical file changes into reviewable diffs with repository provenance", () => {
  const changes = aggregateChanges([
    event(1, "file.changed", {
      path: "src/login.ts",
      before: "export const ok = false;\n",
      after: "export const ok = true;\n",
      sha: "a".repeat(64),
      repository: "odin/example",
      baseSha: "b".repeat(40),
      branch: "odin/2026-09-13/abcdef12",
      headSha: "c".repeat(40),
    }),
    event(2, "file.changed", {
      path: "src/login.ts",
      before: "export const ok = true;\n",
      after: "export const ok = isValid();\n",
      sha: "d".repeat(64),
      repository: "odin/example",
      baseSha: "b".repeat(40),
      branch: "odin/2026-09-13/abcdef12",
      headSha: "e".repeat(40),
    }),
  ]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.before, "export const ok = false;\n");
  assert.equal(changes[0]?.after, "export const ok = isValid();\n");
  assert.equal(changes[0]?.branch, "odin/2026-09-13/abcdef12");
  assert.match(changes[0]?.diff ?? "", /-export const ok = false;/u);
  assert.match(changes[0]?.diff ?? "", /\+export const ok = isValid\(\);/u);
});

test("PRODUCT M7 distinguishes real repository checks from branch-integrity-only fallback", () => {
  const real = qualityEvidence(
    event(4, "quality", {
      passed: true,
      commandId: "github-checks",
      output: '{"exitCode":0,"output":"CI: success"}',
    }),
  );
  assert.equal(real.classification, "repository-checks");
  assert.equal(real.passed, true);

  const fallback = qualityEvidence(
    event(5, "quality", {
      passed: true,
      commandId: "github-checks",
      output: "verification=branch-integrity-only; build/test correctness remains unverified",
    }),
  );
  assert.equal(fallback.classification, "branch-integrity-only");
  assert.match(fallback.summary, /tests are unavailable/iu);

  const failed = qualityEvidence(
    event(6, "quality", { passed: false, commandId: "github-checks", output: "failed" }),
  );
  assert.equal(failed.classification, "failed");
});

test("PRODUCT M7 unified diff is bounded to the changed middle", () => {
  const diff = unifiedDiff("a.ts", "one\ntwo\nthree", "one\nTWO\nthree");
  assert.match(diff, /@@ -2,1 \+2,1 @@/u);
  assert.match(diff, /-two/u);
  assert.match(diff, /\+TWO/u);
  assert.doesNotMatch(diff, /-one|\+one|-three|\+three/u);
});

test("PRODUCT M7 source keeps PR delivery behind completed evidence and reuses existing GitHub classes", async () => {
  const [product, api, workspace, delivery, hosted] = await Promise.all([
    readFile("src/chat/coding-product.ts", "utf8"),
    readFile("src/chat/coding-api.ts", "utf8"),
    readFile("src/chat/github-workspace.ts", "utf8"),
    readFile("src/chat/github-delivery.ts", "utf8"),
    readFile("src/chat/hosted.ts", "utf8"),
  ]);
  assert.match(product, /GitHubWorkspace/u);
  assert.match(product, /GitHubPullRequestClient/u);
  assert.match(product, /snapshot\.state !== "COMPLETED"/u);
  assert.match(product, /lastQualityEvent\.cursor <= lastChangeCursor/u);
  assert.match(product, /currentBaseSha !== latest\.baseSha/u);
  assert.match(product, /containsObviousSecret/u);
  assert.match(api, /ProductStore/u);
  assert.match(api, /githubToken/u);
  assert.match(workspace, /const ODIN_WORK_BRANCH/u);
  assert.match(workspace, /const branch = `odin\/\$\{new Date/u);
  assert.match(workspace, /repositoryState/u);
  assert.match(delivery, /ensurePullRequest/u);
  assert.match(delivery, /async files/u);
  assert.match(hosted, /restoreGitHubWorkspace/u);
  assert.doesNotMatch(product, /child_process|exec\(|spawn\(|shell/iu);
});
