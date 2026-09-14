const m7css = document.createElement("link");
m7css.rel = "stylesheet";
m7css.href = "/product-m7.css";
document.head.append(m7css);

const m7$ = (id) => document.getElementById(id);
const m7el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const codeNav = m7el("button", undefined, "nav-item");
codeNav.id = "coding-view";
codeNav.type = "button";
codeNav.innerHTML = '<span class="nav-icon">⌘</span>Code';
(m7$("build-view") ?? m7$("home-view"))?.after(codeNav);

const surface = m7el("section", undefined, "workspace-surface m7-coding");
surface.id = "coding-panel";
surface.hidden = true;
surface.innerHTML = `
<header class="m7-hero"><div><span class="welcome-tag">CODING MODE</span><h1>Understand. Change. Prove.</h1><p>Repository work stays on an isolated Odin branch and remains reviewable before delivery.</p></div><span id="m7-repo-badge" class="m7-badge">No repository</span></header>
<div id="m7-status" class="m7-status" role="status">Open a Project with a connected GitHub repository.</div>
<nav class="m7-mobile-tabs" aria-label="Coding surfaces"><button data-m7-focus="repo" class="selected">Repository</button><button data-m7-focus="code">Code / Diff</button><button data-m7-focus="odin">Odin</button></nav>
<div class="m7-grid" data-focus="repo">
  <aside class="m7-pane m7-repo" data-m7-pane="repo"><header><span class="m7-label">REPOSITORY</span><strong id="m7-branch">—</strong></header><form id="m7-search-form" class="m7-search"><input id="m7-search" type="search" maxlength="240" placeholder="Search files or text"/><button type="submit">Search</button></form><div class="m7-section-title">FILES</div><div id="m7-tree" class="m7-tree"></div><div class="m7-section-title">CHANGED</div><div id="m7-changed" class="m7-changed"></div></aside>
  <main class="m7-pane m7-editor" data-m7-pane="code"><header><div><span class="m7-label">FILE / DIFF</span><strong id="m7-file-name">Select a file</strong></div><div class="m7-editor-tabs"><button id="m7-view-file" class="selected" type="button">File</button><button id="m7-view-diff" type="button">Diff</button></div></header><div id="m7-editor-empty" class="m7-empty">Select a repository file or changed file.</div><ol id="m7-code" class="m7-code" hidden></ol><pre id="m7-diff" class="m7-diff" hidden></pre><footer>Read-only review surface · source edits go through Odin's scoped repository tools.</footer></main>
  <aside class="m7-pane m7-odin" data-m7-pane="odin"><header><span class="m7-label">ODIN</span><strong id="m7-run-state">Ready</strong></header><form id="m7-task-form" class="m7-task"><textarea id="m7-task" rows="5" maxlength="16000" placeholder="Fix the failing login test."></textarea><button type="submit">Run Coding task</button></form><section><div class="m7-section-title">PROGRESS</div><div id="m7-progress" class="m7-progress">No Coding Run yet.</div></section><section><div class="m7-section-title">TESTS / VERIFICATION</div><div id="m7-tests" class="m7-tests"></div></section><section><div class="m7-section-title">DELIVERY</div><p id="m7-pr-reason" class="m7-muted">A completed verified Run with repository changes is required.</p><button id="m7-pr" type="button" disabled>Open Pull Request</button></section><section class="m7-review"><div class="m7-section-title">REVIEW EXISTING PR</div><div><input id="m7-review-number" inputmode="numeric" placeholder="PR #"/><button id="m7-review" type="button">Inspect</button></div><div id="m7-review-result"></div></section></aside>
</div>`;
document.querySelector("main.main")?.append(surface);

const m7State = {
  projectId: null,
  summary: null,
  selectedPath: null,
  selectedDiff: null,
  poll: null,
};
const terminalStates = new Set(["COMPLETED", "CANCELLED", "FAILED", "BLOCKED"]);

async function m7request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Odin-Request": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "Coding request failed.");
  return data;
}

function m7Project() {
  return new URLSearchParams(window.location.search).get("project");
}
function m7HideSurfaces() {
  for (const selector of [
    "#chat-layout",
    "#projects-panel",
    "#knowledge-panel",
    "#skills-panel",
    "#activity-page",
    "#models-panel",
    "#system-panel",
    "#benchmarks",
    "#build-panel",
  ]) {
    const node = document.querySelector(selector);
    if (node) node.hidden = true;
  }
  for (const item of document.querySelectorAll(".sidebar .nav-item"))
    item.classList.remove("selected");
  codeNav.classList.add("selected");
  m7$("page-title").textContent = "Code";
}

async function openCoding() {
  m7HideSurfaces();
  surface.hidden = false;
  const project = m7Project();
  m7State.projectId = project;
  if (!project) {
    m7Status("Open a Project first.", true);
    return;
  }
  await Promise.all([m7Load(), m7LoadTree("")]);
}

async function m7Load() {
  if (!m7State.projectId) return;
  try {
    const summary = await m7request(
      `/api/coding/projects/${encodeURIComponent(m7State.projectId)}`,
    );
    m7State.summary = summary;
    m7$("m7-repo-badge").textContent = summary.repository;
    m7$("m7-branch").textContent = summary.repositoryState.workBranch ?? summary.baseBranch;
    m7$("m7-run-state").textContent = summary.latestRun?.state ?? "Ready";
    m7RenderChanges(summary.changes ?? []);
    m7RenderTests(summary.quality ?? []);
    m7RenderProgress(summary);
    m7$("m7-pr").disabled = !summary.prReady?.ready;
    m7$("m7-pr-reason").textContent = summary.prReady?.ready
      ? "Verified isolated branch is ready for review and PR delivery."
      : (summary.prReady?.reason ?? "Not ready.");
    m7Status(
      summary.latestRun
        ? `${summary.latestRun.state} · ${summary.repository}`
        : `Ready · ${summary.repository}`,
    );
  } catch (error) {
    m7Status(error.message, true);
  }
}

async function m7LoadTree(query) {
  if (!m7State.projectId) return;
  try {
    const path = `/api/coding/projects/${encodeURIComponent(m7State.projectId)}/tree?q=${encodeURIComponent(query)}`;
    const data = await m7request(path);
    const root = m7$("m7-tree");
    root.replaceChildren();
    for (const entry of data.entries ?? []) {
      const button = m7el("button", entry.path);
      button.type = "button";
      button.dataset.path = entry.path;
      button.addEventListener("click", () => m7OpenFile(entry.path));
      root.append(button);
    }
    if (!root.children.length) root.textContent = "No matching files.";
  } catch (error) {
    m7Status(error.message, true);
  }
}

async function m7OpenFile(path) {
  if (!m7State.projectId) return;
  try {
    const data = await m7request(
      `/api/coding/projects/${encodeURIComponent(m7State.projectId)}/file?path=${encodeURIComponent(path)}`,
    );
    m7State.selectedPath = path;
    m7State.selectedDiff =
      (m7State.summary?.changes ?? []).find((change) => change.path === path)?.diff ?? null;
    m7$("m7-file-name").textContent = path;
    const code = m7$("m7-code");
    code.replaceChildren();
    for (const line of String(data.file.content ?? "").split("\n")) {
      const item = m7el("li");
      const text = m7el("code", line || " ");
      text.dataset.language = path.split(".").at(-1) ?? "text";
      item.append(text);
      code.append(item);
    }
    m7ShowFile();
    m7Focus("code");
  } catch (error) {
    m7Status(error.message, true);
  }
}

function m7RenderChanges(changes) {
  const root = m7$("m7-changed");
  root.replaceChildren();
  for (const change of changes) {
    const button = m7el("button");
    button.type = "button";
    button.innerHTML = `<strong>${m7Escape(change.path)}</strong><small>${change.branch ? "modified · isolated branch" : "modified"}</small>`;
    button.addEventListener("click", () => {
      m7State.selectedPath = change.path;
      m7State.selectedDiff = change.diff;
      m7$("m7-file-name").textContent = change.path;
      m7ShowDiff();
      m7Focus("code");
    });
    root.append(button);
  }
  if (!root.children.length) root.textContent = "No repository changes.";
}

function m7RenderTests(quality) {
  const root = m7$("m7-tests");
  root.replaceChildren();
  for (const item of quality) {
    const row = m7el("div", undefined, `m7-test ${item.passed ? "passed" : "failed"}`);
    row.innerHTML = `<strong>${m7Escape(item.commandId)}</strong><span>${m7Escape(item.summary)}</span>`;
    root.append(row);
  }
  if (!root.children.length) root.textContent = "No verification evidence yet.";
}
function m7RenderProgress(summary) {
  const run = summary.latestRun;
  if (!run) {
    m7$("m7-progress").textContent = "No Coding Run yet.";
    return;
  }
  m7$("m7-progress").innerHTML =
    `<strong>${m7Escape(run.state)}</strong><span>${m7Escape(run.objective)}</span><small>${summary.changes.length} changed file(s)</small>`;
}

function m7ShowFile() {
  m7$("m7-code").hidden = false;
  m7$("m7-diff").hidden = true;
  m7$("m7-editor-empty").hidden = true;
  m7$("m7-view-file").classList.add("selected");
  m7$("m7-view-diff").classList.remove("selected");
}
function m7ShowDiff() {
  m7$("m7-diff").textContent = m7State.selectedDiff ?? "No recorded diff for this file.";
  m7$("m7-code").hidden = true;
  m7$("m7-diff").hidden = false;
  m7$("m7-editor-empty").hidden = true;
  m7$("m7-view-diff").classList.add("selected");
  m7$("m7-view-file").classList.remove("selected");
}
function m7Status(text, error = false) {
  m7$("m7-status").textContent = text;
  m7$("m7-status").dataset.state = error ? "error" : "ok";
}
function m7Focus(name) {
  document.querySelector(".m7-grid")?.setAttribute("data-focus", name);
  for (const button of document.querySelectorAll("[data-m7-focus]"))
    button.classList.toggle("selected", button.dataset.m7Focus === name);
}
function m7Escape(value) {
  return String(value ?? "").replace(
    /[&<>"']/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

m7$("m7-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = m7$("m7-search").value.trim();
  if (!query) return m7LoadTree("");
  try {
    const data = await m7request(
      `/api/coding/projects/${encodeURIComponent(m7State.projectId)}/search?q=${encodeURIComponent(query)}`,
    );
    const root = m7$("m7-tree");
    root.replaceChildren();
    for (const result of data.results ?? []) {
      const button = m7el("button");
      button.type = "button";
      button.innerHTML = `<strong>${m7Escape(result.path)}</strong><small>line ${result.line} · ${m7Escape(result.preview)}</small>`;
      button.addEventListener("click", () => m7OpenFile(result.path));
      root.append(button);
    }
    if (!root.children.length) root.textContent = "No search results.";
  } catch (error) {
    m7Status(error.message, true);
  }
});

m7$("m7-task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!m7State.projectId) return m7Status("Open a Project first.", true);
  const text = m7$("m7-task").value.trim();
  const modelId = m7$("model")?.value;
  if (!text || !modelId) return m7Status("Enter a task and choose an available model.", true);
  try {
    m7Status("Creating canonical Coding Run…");
    const turn = await m7request(`/api/projects/${encodeURIComponent(m7State.projectId)}/turns`, {
      text,
      mode: "coding",
      modelId,
      requestId: crypto.randomUUID(),
      attachments: [],
    });
    await m7request(`/api/turns/${encodeURIComponent(turn.id)}/run`, {});
    m7StartPolling(turn.id);
  } catch (error) {
    m7Status(error.message, true);
  }
});

function m7StartPolling(turnId) {
  if (m7State.poll) clearInterval(m7State.poll);
  const tick = async () => {
    await m7Load();
    const turn = await m7request(`/api/turns/${encodeURIComponent(turnId)}`).catch(() => null);
    if (turn && terminalStates.has(turn.state)) {
      clearInterval(m7State.poll);
      m7State.poll = null;
      await Promise.all([m7Load(), m7LoadTree("")]);
    }
  };
  void tick();
  m7State.poll = setInterval(() => void tick(), 1800);
}

m7$("m7-pr").addEventListener("click", async () => {
  const turnId = m7State.summary?.latestRun?.id;
  if (!turnId || !m7State.projectId) return;
  try {
    m7$("m7-pr").disabled = true;
    const result = await m7request(
      `/api/coding/projects/${encodeURIComponent(m7State.projectId)}/pull-request`,
      { turnId },
    );
    m7Status(`Pull request #${result.delivery.number} is open on the verified Odin branch.`);
    await m7Load();
  } catch (error) {
    m7Status(error.message, true);
    await m7Load();
  }
});

m7$("m7-review").addEventListener("click", async () => {
  const number = Number(m7$("m7-review-number").value);
  if (!Number.isSafeInteger(number) || number < 1 || !m7State.projectId)
    return m7Status("Enter a valid PR number.", true);
  try {
    const data = await m7request(
      `/api/coding/projects/${encodeURIComponent(m7State.projectId)}/review/${number}`,
    );
    m7$("m7-review-result").innerHTML =
      `<strong>PR #${data.status.number} · ${m7Escape(data.status.state)}</strong><span>${data.files.length} changed file(s)</span>`;
  } catch (error) {
    m7Status(error.message, true);
  }
});

m7$("m7-view-file").addEventListener("click", m7ShowFile);
m7$("m7-view-diff").addEventListener("click", m7ShowDiff);
codeNav.addEventListener("click", () => void openCoding());
for (const button of document.querySelectorAll("[data-m7-focus]"))
  button.addEventListener("click", () => m7Focus(button.dataset.m7Focus));
window.addEventListener("popstate", () => {
  if (!surface.hidden) void openCoding();
});
