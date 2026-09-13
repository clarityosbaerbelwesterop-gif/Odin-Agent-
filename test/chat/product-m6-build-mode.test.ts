import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildIterationObjective,
  buildIterationRunRequest,
  buildPreview,
  buildPreviewRevision,
  buildRunObjective,
  buildRunRequest,
  buildStage,
  extractVisualTargets,
} from "../../src/chat/build-mode.js";

test("PRODUCT M6 greenfield and existing objectives compose existing tool/verification authority", () => {
  const greenfield = buildRunObjective(
    "Build a simple student exam planner.",
    "greenfield",
    "static-web",
  );
  assert.match(greenfield, /real project files/iu);
  assert.match(greenfield, /repo_patch/u);
  assert.match(greenfield, /repo_quality/u);
  assert.match(greenfield, /static-web/u);
  assert.match(greenfield, /tablet\/iPad/iu);
  assert.match(greenfield, /Preview is separate from production deployment/iu);
  assert.match(greenfield, /Never execute destructive production database/iu);

  const existing = buildRunObjective("Add dark mode.", "existing", "existing");
  assert.match(existing, /Inspect the current repository before editing/iu);
  assert.match(existing, /delta plan/iu);
  assert.match(existing, /Do not regenerate or replace the whole application/iu);
});

test("PRODUCT M6 request envelopes retain canonical request identity and supported mode", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const initial = buildRunRequest(
    requestId,
    "Build a simple student exam planner.",
    "greenfield",
    "static-web",
  );
  assert.equal(initial.requestId, requestId);
  assert.equal(initial.mode, "ultra");
  assert.match(initial.text, /BUILD MODE/u);

  const iteration = buildIterationRunRequest(
    requestId,
    "Make the sidebar smaller.",
    "existing",
    "existing",
    null,
  );
  assert.equal(iteration.requestId, requestId);
  assert.equal(iteration.mode, "coding");
  assert.match(iteration.text, /BUILD ITERATION/u);
  assert.throws(
    () => buildRunObjective("Build a valid product goal.", "greenfield", "existing"),
    /stack does not match/iu,
  );
});

test("PRODUCT M6 iteration is delta-scoped and exact visual targets never become authority", () => {
  const objective = buildIterationObjective(
    "Make this larger.",
    "greenfield",
    "static-web",
    "index.html#exam-list",
  );
  assert.match(objective, /index\.html#exam-list/u);
  assert.match(objective, /smallest safe delta|scoped/u);
  assert.match(
    objective,
    /Do not expand tool, network, credential, database, deployment, billing/iu,
  );
  assert.throws(
    () =>
      buildIterationObjective(
        "Make this larger.",
        "greenfield",
        "static-web",
        "../../secret#panel",
      ),
    (error) => error instanceof Error && /traversal|workspace path/iu.test(error.message),
  );
});

test("PRODUCT M6 Preview identity is content-bound and excludes editable planning documents", () => {
  const base = [
    { path: "index.html", content: "<main>One</main>", sha: "1".repeat(64) },
    { path: "styles.css", content: "main{}", sha: "2".repeat(64) },
    { path: "documents/spec.md", content: "draft", sha: "3".repeat(64) },
  ] as const;
  const first = buildPreview(base);
  assert.ok(first);
  assert.equal(first.file, "index.html");
  assert.match(first.revision, /^[a-f0-9]{64}$/u);
  assert.equal(buildPreviewRevision(base), first.revision);
  const planningOnly = buildPreview([
    base[0],
    base[1],
    { path: "documents/spec.md", sha: "4".repeat(64), content: "edited planning" },
  ]);
  assert.equal(planningOnly?.revision, first.revision);
  const changedOutput = buildPreview([
    { path: "index.html", sha: "5".repeat(64), content: "<main>Two</main>" },
    base[1],
    base[2],
  ]);
  assert.notEqual(changedOutput?.revision, first.revision);
  assert.equal(buildPreview([{ path: "notes.md", content: "none", sha: "6".repeat(64) }]), null);
});

test("PRODUCT M6 visual editing exposes only explicit safe source mappings", () => {
  const html = `<!doctype html><main data-odin-source="index.html#app-shell"><section id="exams" data-odin-source="index.html#exam-list"></section><div data-odin-source="../../secret#oops"></div><aside></aside></main>`;
  assert.deepEqual(extractVisualTargets(html, "index.html"), [
    { sourceRef: "index.html#app-shell", tag: "main", label: "main" },
    { sourceRef: "index.html#exam-list", tag: "section", label: "exams" },
  ]);
  assert.deepEqual(extractVisualTargets("<main>No mapping</main>", "index.html"), []);
});

test("PRODUCT M6 progress labels are projections of canonical Run state and Preview evidence", () => {
  assert.equal(buildStage(null, false), "Designing");
  assert.equal(buildStage("UNDERSTANDING", false), "Understanding");
  assert.equal(buildStage("PLANNING", false), "Specifying");
  assert.equal(buildStage("EXECUTING", false), "Building");
  assert.equal(buildStage("VERIFYING", false), "Testing");
  assert.equal(buildStage("BLOCKED", false), "Repairing");
  assert.equal(buildStage("COMPLETED", false), "Testing");
  assert.equal(buildStage("COMPLETED", true), "Preview Ready");
});

test("PRODUCT M6 API source binds Run to Project, keeps memory/workspace canonical and never deploys", async () => {
  const [api, build, hosted, preview] = await Promise.all([
    readFile("src/chat/build-api.ts", "utf8"),
    readFile("src/chat/build-mode.ts", "utf8"),
    readFile("src/chat/hosted.ts", "utf8"),
    readFile("src/chat/preview.ts", "utf8"),
  ]);
  assert.match(api, /BuildProductStore/u);
  assert.match(build, /WorkspaceOsStore/u);
  assert.match(build, /MemoryBrainStore/u);
  assert.match(build, /SELECT 1 FROM odin_api\.turns WHERE conversation_id=\$1 AND id=\$2/u);
  assert.match(build, /ORDER BY cursor ASC/u);
  assert.match(build, /build\.run\.bound/u);
  assert.doesNotMatch(build, /CREATE TABLE|ALTER TABLE|DROP TABLE/iu);
  assert.doesNotMatch(build, /deploy(?:ment)?\.(?:execute|run)|VERCEL_TOKEN/iu);
  assert.match(hosted, /NeonWorkspace/u);
  assert.match(preview, /connect-src 'none'/u);
});
