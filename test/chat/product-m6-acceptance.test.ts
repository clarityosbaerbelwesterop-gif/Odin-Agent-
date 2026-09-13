import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildIterationObjective,
  buildRunObjective,
  extractVisualTargets,
} from "../../src/chat/build-mode.js";
import { assemblePreview } from "../../src/chat/preview.js";
import { hashText } from "../../src/chat/safety.js";
import { fixture, provider, response } from "./helpers.js";

const examHtml = `<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main data-odin-source="index.html#app-shell"><h1>Exam planner</h1><section id="exam-list" data-odin-source="index.html#exam-list"><p id="empty">No exams yet.</p><ul id="exams"></ul></section><form id="exam-form" data-odin-source="index.html#create-exam"><label>Subject<input id="subject" required></label><label>Date<input id="date" type="date" required></label><button id="add-exam">Add exam</button></form></main><script src="app.js"></script></body></html>`;
const examCss = `body{font-family:system-ui;margin:0}main{max-width:760px;margin:auto;padding:24px}form{display:grid;gap:12px}@media(max-width:700px){main{padding:16px}}`;
const examJs = `const key="odin-exams";let exams=JSON.parse(localStorage.getItem(key)||"[]");const list=document.querySelector("#exams");const empty=document.querySelector("#empty");function render(){list.replaceChildren(...exams.map((exam)=>{const li=document.createElement("li");li.textContent=exam.subject+" — "+exam.date;return li;}));empty.hidden=exams.length>0;}document.querySelector("#exam-form").addEventListener("submit",(event)=>{event.preventDefault();exams=[...exams,{subject:document.querySelector("#subject").value,date:document.querySelector("#date").value}];localStorage.setItem(key,JSON.stringify(exams));render();event.target.reset();});render();`;
const smallerCss = `${examCss}\n#add-exam{font-size:.875rem;padding:8px 12px}`;

test("PRODUCT M6 acceptance #1 builds a student exam planner through the canonical coding tools then applies a delta", async () => {
  const root = await mkdtemp(join(tmpdir(), "odin-m6-exam-"));
  const model = provider((_request, call) => {
    if (call === 1)
      return response("", [
        {
          id: "html",
          name: "repo_patch",
          arguments: { path: "index.html", expectedSha: "absent", content: examHtml },
        },
      ]);
    if (call === 2)
      return response("", [
        {
          id: "css",
          name: "repo_patch",
          arguments: { path: "styles.css", expectedSha: "absent", content: examCss },
        },
      ]);
    if (call === 3)
      return response("", [
        {
          id: "js",
          name: "repo_patch",
          arguments: { path: "app.js", expectedSha: "absent", content: examJs },
        },
      ]);
    if (call === 4)
      return response("", [
        { id: "quality", name: "repo_quality", arguments: { commandId: "acceptance" } },
      ]);
    if (call === 5) return response("Exam planner implemented and verified.");
    if (call === 6)
      return response("", [
        { id: "read", name: "repo_read", arguments: { path: "styles.css", maxBytes: 10000 } },
      ]);
    if (call === 7)
      return response("", [
        {
          id: "delta",
          name: "repo_patch",
          arguments: { path: "styles.css", expectedSha: hashText(examCss), content: smallerCss },
        },
      ]);
    if (call === 8)
      return response("", [
        { id: "delta-quality", name: "repo_quality", arguments: { commandId: "acceptance" } },
      ]);
    return response("The selected button was made smaller and verification passed.");
  });
  const f = await fixture(model, {
    workspaceRoot: root,
    allowWorkspaceWrites: true,
    quality: {
      commands: () => [{ id: "acceptance", label: "PRODUCT M6 acceptance" }],
      run: async () => {
        const html = await readFile(join(root, "index.html"), "utf8").catch(() => "");
        const css = await readFile(join(root, "styles.css"), "utf8").catch(() => "");
        const js = await readFile(join(root, "app.js"), "utf8").catch(() => "");
        const pass =
          /exam-list/u.test(html) &&
          /exam-form/u.test(html) &&
          /subject/u.test(html) &&
          /date/u.test(html) &&
          /localStorage/u.test(js) &&
          /@media/u.test(css);
        return { exitCode: pass ? 0 : 1, output: pass ? "Acceptance passed" : "Acceptance failed" };
      },
    },
  });
  try {
    const first = await f.submit(
      buildRunObjective("Build a simple student exam planner.", "greenfield", "static-web"),
      "coding",
      "m6-exam-build",
    );
    await f.engine.idle();
    assert.equal((await f.engine.view(first.id)).state, "COMPLETED");
    assert.match(await readFile(join(root, "index.html"), "utf8"), /Exam planner/u);
    assert.match(await readFile(join(root, "app.js"), "utf8"), /localStorage/u);
    assert.deepEqual(
      extractVisualTargets(examHtml, "index.html").map((target) => target.sourceRef),
      ["index.html#app-shell", "index.html#exam-list", "index.html#create-exam"],
    );
    const preview = assemblePreview(
      [
        { path: "index.html", content: examHtml },
        { path: "styles.css", content: examCss },
        { path: "app.js", content: examJs },
      ],
      "index.html",
    );
    assert.match(preview, /Exam planner/u);
    assert.match(preview, /font-family:system-ui/u);

    const delta = await f.submit(
      buildIterationObjective(
        "Make the Add exam button smaller.",
        "greenfield",
        "static-web",
        "index.html#create-exam",
      ),
      "coding",
      "m6-exam-delta",
    );
    await f.engine.idle();
    assert.equal((await f.engine.view(delta.id)).state, "COMPLETED");
    assert.equal(await readFile(join(root, "styles.css"), "utf8"), smallerCss);
    assert.equal(await readFile(join(root, "index.html"), "utf8"), examHtml);
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PRODUCT M6 acceptance #2 adds dark mode to an existing fixture as a scoped verified delta", async () => {
  const root = await mkdtemp(join(tmpdir(), "odin-m6-existing-"));
  const html = `<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main><h1>Existing app</h1></main></body></html>`;
  const beforeCss = `:root{color-scheme:light}body{background:#fff;color:#111}`;
  const afterCss = `${beforeCss}\n@media(prefers-color-scheme:dark){:root{color-scheme:dark}body{background:#111;color:#f6f6f6}}`;
  await writeFile(join(root, "index.html"), html);
  await writeFile(join(root, "styles.css"), beforeCss);
  const model = provider((_request, call) => {
    if (call === 1)
      return response("", [
        { id: "read", name: "repo_read", arguments: { path: "styles.css", maxBytes: 10000 } },
      ]);
    if (call === 2)
      return response("", [
        {
          id: "patch",
          name: "repo_patch",
          arguments: { path: "styles.css", expectedSha: hashText(beforeCss), content: afterCss },
        },
      ]);
    if (call === 3)
      return response("", [
        { id: "quality", name: "repo_quality", arguments: { commandId: "existing" } },
      ]);
    return response("Dark mode added as a scoped delta and verified.");
  });
  const f = await fixture(model, {
    workspaceRoot: root,
    allowWorkspaceWrites: true,
    quality: {
      commands: () => [{ id: "existing", label: "Existing app fixture" }],
      run: async () => ({
        exitCode: (await readFile(join(root, "styles.css"), "utf8")) === afterCss ? 0 : 1,
        output: "Existing-app quality check",
      }),
    },
  });
  try {
    const turn = await f.submit(
      buildRunObjective("Add dark mode.", "existing", "existing"),
      "coding",
      "m6-existing-dark",
    );
    await f.engine.idle();
    assert.equal((await f.engine.view(turn.id)).state, "COMPLETED");
    assert.equal(await readFile(join(root, "index.html"), "utf8"), html);
    assert.equal(await readFile(join(root, "styles.css"), "utf8"), afterCss);
    assert(f.store.events(f.conversation.id).some((event) => event.type === "file.changed"));
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
