const m2css = document.createElement("link");
m2css.rel = "stylesheet";
m2css.href = "/product-m2.css";
document.head.append(m2css);

const m2el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

async function m2request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Odin-Request": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Keep a stable user-facing error below.
  }
  if (!response.ok) {
    const error = new Error(data.message ?? "Workspace request failed.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

const main = document.querySelector(".main");
const surface = document.createElement("section");
surface.id = "workspace-os-panel";
surface.className = "m2-workspace";
surface.hidden = true;
surface.innerHTML = `
  <div class="m2-grid">
    <aside class="m2-resources" aria-label="Project resources">
      <div class="m2-panel-heading">
        <div><span class="m2-eyebrow">PROJECT</span><strong id="m2-project-title">Workspace</strong></div>
        <button id="m2-resource-close" type="button" class="m2-icon-button" aria-label="Close resources">×</button>
      </div>
      <label class="m2-search"><span class="sr-only">Search project</span><input id="m2-search" type="search" placeholder="Search project…" autocomplete="off" /></label>
      <div class="m2-resource-actions">
        <button id="m2-new-document" type="button">+ Document</button>
        <button id="m2-import" type="button">Import</button>
        <input id="m2-file-input" type="file" accept="text/plain,text/markdown,text/html,text/css,text/javascript,application/javascript,application/json,.md,.txt,.json,.html,.css,.js,.mjs" hidden />
      </div>
      <div id="m2-resource-tree" class="m2-resource-tree"></div>
    </aside>

    <section class="m2-work-area" aria-label="Workspace content">
      <header class="m2-work-header">
        <button id="m2-resource-toggle" type="button" class="m2-icon-button" aria-label="Open project resources">☰</button>
        <div id="m2-tabs" class="m2-tabs" role="tablist" aria-label="Open workspace items"></div>
        <button id="m2-context-toggle" type="button" class="m2-icon-button" aria-label="Open context panel">◎</button>
      </header>
      <div id="m2-status" class="m2-status" role="status" aria-live="polite"></div>
      <div id="m2-content" class="m2-content"></div>
    </section>

    <aside id="m2-context-panel" class="m2-context" aria-label="Project context">
      <div class="m2-panel-heading">
        <div><span class="m2-eyebrow">CONTEXT</span><strong>Project context</strong></div>
        <button id="m2-context-close" type="button" class="m2-icon-button" aria-label="Close context">×</button>
      </div>
      <div class="m2-companion-card">
        <span class="m2-companion-mark" aria-hidden="true">O</span>
        <div><strong id="m2-companion-label">Workspace ready</strong><small id="m2-companion-detail">Open an item or continue the project.</small></div>
      </div>
      <section class="m2-context-section">
        <div class="m2-section-title"><span>Selected context</span><span id="m2-context-count">0</span></div>
        <p class="m2-help">Pinned resources stay attached to this Project. Odin keeps these references separate from permissions and security policy.</p>
        <div id="m2-context-list"></div>
      </section>
      <section class="m2-context-section">
        <div class="m2-section-title"><span>Current run</span></div>
        <div id="m2-run-card" class="m2-run-card"></div>
      </section>
      <section class="m2-context-section">
        <div class="m2-section-title"><span>Recent activity</span></div>
        <div id="m2-activity"></div>
      </section>
    </aside>
  </div>

  <dialog id="m2-document-dialog" class="m2-dialog">
    <form id="m2-document-form">
      <span class="m2-eyebrow">NEW DOCUMENT</span>
      <h2>Create a project document</h2>
      <label>Title<input id="m2-document-title" maxlength="200" required autocomplete="off" /></label>
      <label>Format<select id="m2-document-format"><option value="markdown">Markdown</option><option value="text">Plain text</option><option value="note">Note</option></select></label>
      <div class="m2-dialog-actions"><button id="m2-document-cancel" type="button">Cancel</button><button type="submit" class="m2-primary">Create</button></div>
    </form>
  </dialog>`;
main?.append(surface);

const m2$ = (id) => document.getElementById(id);
const m2State = {
  projectId: null,
  project: null,
  workspace: null,
  items: new Map(),
  openIds: [],
  activeId: null,
  layoutVersion: 0,
  loading: false,
  saveTimer: null,
  saveGeneration: 0,
};

function m2ProjectFromUrl() {
  return new URLSearchParams(window.location.search).get("project");
}
function m2SetStatus(text, state = "") {
  m2$("m2-status").textContent = text;
  m2$("m2-status").dataset.state = state;
  m2$("m2-status").hidden = !text;
}
function m2ShowError(error) {
  m2SetStatus(error.message ?? "Workspace action failed.", "error");
}
function m2Hide() {
  surface.hidden = true;
  surface.classList.remove("show-resources", "show-context");
}
function m2HideOtherSurfaces() {
  for (const id of [
    "chat-layout",
    "projects-panel",
    "knowledge-panel",
    "skills-panel",
    "activity-page",
    "models-panel",
    "system-panel",
    "benchmarks",
  ]) {
    const node = document.getElementById(id);
    if (node) node.hidden = true;
  }
}
function m2Show() {
  if (!m2State.projectId) return;
  m2HideOtherSurfaces();
  surface.hidden = false;
  m2$("project-nav").hidden = false;
  for (const button of document.querySelectorAll("[data-project-section]"))
    button.classList.toggle("selected", button.dataset.projectSection === "workspace");
}

async function m2Load(projectId, { show = true } = {}) {
  if (!projectId || m2State.loading) return;
  m2State.loading = true;
  m2SetStatus("Opening workspace…");
  try {
    const [workspace, projectData, activityData] = await Promise.all([
      m2request(`/api/workspace/projects/${encodeURIComponent(projectId)}`),
      m2request(`/api/projects/${encodeURIComponent(projectId)}`),
      m2request(`/api/projects/${encodeURIComponent(projectId)}/activity?after=0`),
    ]);
    if (m2ProjectFromUrl() !== projectId) return;
    m2State.projectId = projectId;
    m2State.project = projectData;
    m2State.workspace = workspace;
    m2State.items = new Map(workspace.items.map((item) => [item.id, item]));
    m2State.openIds = workspace.layout.openItemIds.filter((id) => m2State.items.has(id));
    m2State.activeId =
      workspace.layout.activeItemId && m2State.openIds.includes(workspace.layout.activeItemId)
        ? workspace.layout.activeItemId
        : (m2State.openIds[0] ?? null);
    m2State.layoutVersion = workspace.layout.version;
    m2$("m2-project-title").textContent = projectData.conversation.title;
    m2RenderResources();
    m2RenderContext();
    m2RenderRun();
    m2RenderActivity(activityData.activity ?? []);
    m2RenderTabs();
    if (m2State.activeId) await m2OpenItem(m2State.activeId, { persist: false });
    else m2RenderHome();
    m2SetStatus("");
    if (show) m2Show();
  } catch (error) {
    m2ShowError(error);
  } finally {
    m2State.loading = false;
  }
}

function m2Group(item) {
  if (["DOCUMENT", "NOTE", "TEXT", "MARKDOWN"].includes(item.kind) && item.origin !== "runtime")
    return "Documents";
  if (item.origin === "import" || item.kind === "FILE_REFERENCE") return "Files";
  return "Artifacts";
}
function m2RenderResources(items = [...m2State.items.values()]) {
  const target = m2$("m2-resource-tree");
  target.replaceChildren();
  const groups = new Map([
    ["Documents", []],
    ["Artifacts", []],
    ["Files", []],
  ]);
  for (const item of items) groups.get(m2Group(item))?.push(item);
  for (const [label, values] of groups) {
    const section = m2el("section", undefined, "m2-resource-group");
    const heading = m2el("div", undefined, "m2-resource-heading");
    heading.append(m2el("span", label), m2el("span", String(values.length)));
    section.append(heading);
    if (!values.length) section.append(m2el("p", "Nothing here yet.", "m2-empty-line"));
    for (const item of values) {
      const row = m2el("div", undefined, "m2-resource-row");
      const open = m2el("button", undefined, "m2-resource-open");
      open.type = "button";
      open.append(m2el("span", m2Icon(item)), m2el("span", item.title));
      open.addEventListener("click", () => m2OpenItem(item.id).catch(m2ShowError));
      const selected = m2State.workspace?.context.some((entry) => entry.itemId === item.id);
      const context = m2el("button", selected ? "−" : "+", "m2-context-action");
      context.type = "button";
      context.title = selected ? "Remove from project context" : "Add to project context";
      context.setAttribute("aria-label", context.title);
      context.addEventListener("click", () => m2ToggleContext(item.id, !selected));
      row.append(open, context);
      section.append(row);
    }
    target.append(section);
  }
}
function m2Icon(item) {
  if (item.kind === "HTML") return "▱";
  if (item.kind === "JSON" || item.kind === "CODE") return "‹›";
  if (item.origin === "import") return "↥";
  if (m2Group(item) === "Artifacts") return "◇";
  return "≡";
}

function m2RenderTabs() {
  const target = m2$("m2-tabs");
  target.replaceChildren();
  if (!m2State.openIds.length) {
    const home = m2el("button", "Workspace", "m2-tab selected");
    home.type = "button";
    home.setAttribute("role", "tab");
    home.setAttribute("aria-selected", "true");
    home.onclick = () => {
      m2State.activeId = null;
      m2RenderTabs();
      m2RenderHome();
      void m2SaveLayout();
    };
    target.append(home);
    return;
  }
  for (const id of m2State.openIds) {
    const item = m2State.items.get(id);
    if (!item) continue;
    const tab = m2el("div", undefined, `m2-tab${id === m2State.activeId ? " selected" : ""}`);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(id === m2State.activeId));
    tab.tabIndex = id === m2State.activeId ? 0 : -1;
    const open = m2el("button", item.title, "m2-tab-open");
    open.type = "button";
    open.onclick = () => m2OpenItem(id).catch(m2ShowError);
    const close = m2el("button", "×", "m2-tab-close");
    close.type = "button";
    close.setAttribute("aria-label", `Close ${item.title}`);
    close.onclick = (event) => {
      event.stopPropagation();
      void m2CloseTab(id);
    };
    tab.append(open, close);
    target.append(tab);
  }
}

async function m2OpenItem(itemId, { persist = true } = {}) {
  const cached = m2State.items.get(itemId);
  if (!cached || !m2State.projectId) return;
  if (!m2State.openIds.includes(itemId)) m2State.openIds.push(itemId);
  if (m2State.openIds.length > 12) m2State.openIds.shift();
  m2State.activeId = itemId;
  m2RenderTabs();
  m2SetStatus("Opening…");
  try {
    const { item } = await m2request(
      `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/items/${encodeURIComponent(itemId)}`,
    );
    m2State.items.set(item.id, item);
    m2RenderItem(item);
    m2UpdateCompanion(item);
    m2SetStatus("");
    if (persist) await m2SaveLayout();
  } catch (error) {
    m2ShowError(error);
  }
}

async function m2CloseTab(itemId) {
  const index = m2State.openIds.indexOf(itemId);
  m2State.openIds = m2State.openIds.filter((id) => id !== itemId);
  if (m2State.activeId === itemId) {
    m2State.activeId = m2State.openIds[Math.max(0, index - 1)] ?? m2State.openIds[0] ?? null;
  }
  m2RenderTabs();
  if (m2State.activeId) await m2OpenItem(m2State.activeId, { persist: false });
  else m2RenderHome();
  await m2SaveLayout();
}

function m2RenderHome() {
  const target = m2$("m2-content");
  target.replaceChildren();
  const turns = m2State.project?.turns ?? [];
  const current = turns.at(-1);
  const hero = m2el("section", undefined, "m2-home-hero");
  hero.append(
    m2el("span", "PROJECT WORKSPACE", "m2-eyebrow"),
    m2el("h1", m2State.project?.conversation.title ?? "Workspace"),
  );
  hero.append(
    m2el(
      "p",
      current?.objective ?? "Start a Run or create a document to begin accumulating project work.",
    ),
  );
  target.append(hero);

  const grid = m2el("div", undefined, "m2-home-grid");
  const plan = m2el("article", undefined, "m2-home-card m2-plan-card");
  plan.append(
    m2el("span", "CURRENT PLAN", "m2-eyebrow"),
    m2el("h2", current ? "What Odin is doing" : "No active plan"),
  );
  const steps = m2el("ol", undefined, "m2-plan-list");
  for (const step of current?.plan ?? []) {
    const row = m2el("li", undefined, step.status);
    row.append(
      m2el("span", step.status === "done" ? "✓" : step.status === "active" ? "●" : "○"),
      m2el("span", step.title),
    );
    steps.append(row);
  }
  if (!steps.children.length)
    steps.append(m2el("li", "Create a goal from Home to start a real Run."));
  plan.append(steps);

  const recent = m2el("article", undefined, "m2-home-card");
  recent.append(m2el("span", "RECENT WORK", "m2-eyebrow"), m2el("h2", "Workspace resources"));
  const recentList = m2el("div", undefined, "m2-home-recent");
  for (const item of [...m2State.items.values()].slice(0, 5)) {
    const button = m2el("button", undefined);
    button.type = "button";
    button.append(
      m2el("strong", item.title),
      m2el("small", `${m2Group(item)} · ${new Date(item.updatedAt).toLocaleDateString()}`),
    );
    button.onclick = () => m2OpenItem(item.id).catch(m2ShowError);
    recentList.append(button);
  }
  if (!recentList.children.length)
    recentList.append(m2el("p", "No documents or artifacts yet.", "m2-help"));
  recent.append(recentList);

  const next = m2el("article", undefined, "m2-home-card");
  next.append(
    m2el("span", "NEXT ACTION", "m2-eyebrow"),
    m2el(
      "h2",
      current && !["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"].includes(current.state)
        ? "Continue the current Run"
        : "Add durable project material",
    ),
  );
  next.append(
    m2el(
      "p",
      m2State.workspace?.context.length
        ? `${m2State.workspace.context.length} resource${m2State.workspace.context.length === 1 ? " is" : "s are"} pinned as project context.`
        : "Create a document, import a supported text file, or continue the project from the composer.",
    ),
  );
  if (current?.state === "COMPLETED") {
    const save = m2el("button", "Save latest result as artifact", "m2-primary");
    save.type = "button";
    save.onclick = () => m2SaveRunArtifact(current.id);
    next.append(save);
  }
  grid.append(plan, recent, next);
  target.append(grid);
  m2UpdateCompanion(null);
}

function m2RenderItem(item) {
  const target = m2$("m2-content");
  target.replaceChildren();
  const editable =
    item.origin !== "runtime" && ["DOCUMENT", "NOTE", "TEXT", "MARKDOWN"].includes(item.kind);
  const shell = m2el("article", undefined, "m2-item");
  const header = m2el("header", undefined, "m2-item-header");
  const meta = m2el("div", undefined, "m2-item-meta");
  meta.append(
    m2el("span", m2Group(item)),
    m2el("span", `v${item.version}`),
    m2el("span", new Date(item.updatedAt).toLocaleString()),
  );
  const contextSelected = m2State.workspace?.context.some((entry) => entry.itemId === item.id);
  const contextButton = m2el(
    "button",
    contextSelected ? "Remove context" : "Add to context",
    "m2-context-pill",
  );
  contextButton.type = "button";
  contextButton.onclick = () => m2ToggleContext(item.id, !contextSelected);
  header.append(meta, contextButton);
  shell.append(header);

  if (editable) {
    const title = document.createElement("input");
    title.className = "m2-document-title";
    title.value = item.title;
    title.maxLength = 200;
    title.setAttribute("aria-label", "Document title");
    const body = document.createElement("textarea");
    body.className = "m2-document-editor";
    body.value = item.content ?? "";
    body.spellcheck = true;
    body.setAttribute("aria-label", "Document body");
    const saveState = m2el("span", "Saved", "m2-save-state");
    const queue = () => m2QueueSave(item.id, title, body, saveState);
    title.addEventListener("input", queue);
    body.addEventListener("input", queue);
    shell.append(title, body, saveState);
  } else {
    const title = m2el("h1", item.title, "m2-artifact-title");
    const provenance = m2el("p", undefined, "m2-provenance");
    provenance.textContent = item.sourceRunId
      ? `Created by Run ${item.sourceRunId.slice(0, 8)} · ${new Date(item.createdAt).toLocaleString()}`
      : `${item.origin === "runtime" ? "Created by Odin" : "Imported"} · ${new Date(item.createdAt).toLocaleString()}`;
    shell.append(title, provenance);
    if (item.kind === "HTML" || item.mimeType === "text/html") {
      const previewBar = m2el("div", undefined, "m2-preview-bar");
      previewBar.append(m2el("span", "Isolated preview"));
      const iframe = document.createElement("iframe");
      iframe.className = "m2-preview";
      iframe.title = `Preview of ${item.title}`;
      iframe.sandbox = "allow-scripts";
      iframe.referrerPolicy = "no-referrer";
      iframe.src = `/api/projects/${encodeURIComponent(m2State.projectId)}/preview?file=${encodeURIComponent(item.path)}`;
      shell.append(previewBar, iframe);
    } else {
      const body = m2el("pre", item.content ?? "", "m2-artifact-body");
      shell.append(body);
    }
  }
  target.append(shell);
}

function m2QueueSave(itemId, titleInput, bodyInput, stateNode) {
  clearTimeout(m2State.saveTimer);
  const generation = ++m2State.saveGeneration;
  stateNode.textContent = "Saving…";
  stateNode.dataset.state = "saving";
  m2State.saveTimer = setTimeout(async () => {
    const item = m2State.items.get(itemId);
    if (!item || !m2State.projectId || generation !== m2State.saveGeneration) return;
    try {
      const result = await m2request(
        `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/items/${encodeURIComponent(itemId)}`,
        { title: titleInput.value, content: bodyInput.value, expectedVersion: item.version },
        "PUT",
      );
      m2State.items.set(itemId, result.item);
      if (m2State.workspace) {
        const index = m2State.workspace.items.findIndex((candidate) => candidate.id === itemId);
        if (index >= 0) m2State.workspace.items[index] = result.item;
      }
      stateNode.textContent = "Saved";
      stateNode.dataset.state = "saved";
      m2RenderResources();
      m2RenderTabs();
    } catch (error) {
      stateNode.textContent =
        error.code === "STALE_DOCUMENT"
          ? "Conflict · reload required"
          : "Save failed · retrying when you edit";
      stateNode.dataset.state = "error";
      m2ShowError(error);
    }
  }, 850);
}

async function m2SaveLayout() {
  if (!m2State.projectId) return;
  try {
    const result = await m2request(
      `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/layout`,
      {
        openItemIds: m2State.openIds,
        activeItemId: m2State.activeId,
        expectedVersion: m2State.layoutVersion,
      },
      "PUT",
    );
    m2State.layoutVersion = result.layout.version;
  } catch (error) {
    if (error.code === "STALE_LAYOUT") {
      const refreshed = await m2request(
        `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}`,
      );
      m2State.layoutVersion = refreshed.layout.version;
      return;
    }
    m2ShowError(error);
  }
}

async function m2ToggleContext(itemId, selected) {
  if (!m2State.projectId) return;
  try {
    const result = await m2request(
      `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/context`,
      { itemId, selected, reason: "Selected by user" },
    );
    m2State.workspace.context = result.context;
    m2RenderContext();
    m2RenderResources();
    const item = m2State.items.get(itemId);
    if (m2State.activeId === itemId && item) m2RenderItem(item);
  } catch (error) {
    m2ShowError(error);
  }
}

function m2RenderContext() {
  const target = m2$("m2-context-list");
  target.replaceChildren();
  const context = m2State.workspace?.context ?? [];
  m2$("m2-context-count").textContent = String(context.length);
  if (!context.length) target.append(m2el("p", "No project context selected.", "m2-empty-line"));
  for (const entry of context) {
    const row = m2el("div", undefined, "m2-context-row");
    const open = m2el("button", undefined);
    open.type = "button";
    open.append(m2el("strong", entry.title), m2el("small", entry.reason));
    open.onclick = () => m2OpenItem(entry.itemId).catch(m2ShowError);
    const remove = m2el("button", "×", "m2-icon-button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${entry.title} from context`);
    remove.onclick = () => m2ToggleContext(entry.itemId, false);
    row.append(open, remove);
    target.append(row);
  }
}

function m2RenderRun() {
  const target = m2$("m2-run-card");
  target.replaceChildren();
  const run = m2State.project?.turns?.at(-1);
  if (!run) {
    target.append(m2el("p", "No Run yet.", "m2-empty-line"));
    return;
  }
  target.append(
    m2el("strong", run.objective),
    m2el(
      "small",
      `${run.companionState ?? run.state} · ${run.plan?.filter((step) => step.status === "done").length ?? 0}/${run.plan?.length ?? 0} plan steps`,
    ),
  );
  if (run.state === "COMPLETED") {
    const button = m2el("button", "Save result as artifact", "m2-secondary");
    button.type = "button";
    button.onclick = () => m2SaveRunArtifact(run.id);
    target.append(button);
  }
}

async function m2SaveRunArtifact(turnId) {
  if (!m2State.projectId) return;
  m2SetStatus("Saving Run result…", "saving");
  try {
    const result = await m2request(
      `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/artifacts/from-run`,
      { turnId },
    );
    m2State.items.set(result.item.id, result.item);
    m2State.workspace.items.unshift(result.item);
    m2RenderResources();
    await m2OpenItem(result.item.id);
    m2SetStatus("Run result saved as a durable artifact.", "saved");
    setTimeout(() => m2SetStatus(""), 2200);
  } catch (error) {
    m2ShowError(error);
  }
}

function m2RenderActivity(events) {
  const target = m2$("m2-activity");
  target.replaceChildren();
  const recent = events.slice(-6).reverse();
  if (!recent.length) target.append(m2el("p", "No activity yet.", "m2-empty-line"));
  for (const event of recent) {
    const row = m2el("div", undefined, "m2-activity-row");
    row.append(
      m2el("span", event.label),
      m2el(
        "time",
        new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ),
    );
    target.append(row);
  }
}

function m2UpdateCompanion(item) {
  const contextCount = m2State.workspace?.context.length ?? 0;
  m2$("m2-companion-label").textContent = item ? item.title : "Workspace ready";
  m2$("m2-companion-detail").textContent = item
    ? `${m2Group(item)} open · ${contextCount} context item${contextCount === 1 ? "" : "s"} selected`
    : `${contextCount} context item${contextCount === 1 ? "" : "s"} selected · project state is durable`;
}

async function m2Search() {
  if (!m2State.projectId) return;
  const query = m2$("m2-search").value.trim();
  try {
    const result = await m2request(
      `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/items?q=${encodeURIComponent(query)}`,
    );
    m2RenderResources(result.items);
  } catch (error) {
    m2ShowError(error);
  }
}

m2$("m2-new-document").onclick = () => {
  m2$("m2-document-title").value = "";
  m2$("m2-document-format").value = "markdown";
  m2$("m2-document-dialog").showModal();
  m2$("m2-document-title").focus();
};
m2$("m2-document-cancel").onclick = () => m2$("m2-document-dialog").close();
m2$("m2-document-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!m2State.projectId) return;
  try {
    const result = await m2request(
      `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/documents`,
      {
        title: m2$("m2-document-title").value,
        format: m2$("m2-document-format").value,
        content: "",
      },
    );
    m2$("m2-document-dialog").close();
    m2State.items.set(result.item.id, result.item);
    m2State.workspace.items.unshift(result.item);
    m2RenderResources();
    await m2OpenItem(result.item.id);
  } catch (error) {
    m2ShowError(error);
  }
};
m2$("m2-import").onclick = () => m2$("m2-file-input").click();
m2$("m2-file-input").onchange = async () => {
  const file = m2$("m2-file-input").files?.[0];
  m2$("m2-file-input").value = "";
  if (!file || !m2State.projectId) return;
  if (file.size > 262144) {
    m2ShowError(new Error("Text imports must stay below 256 KB."));
    return;
  }
  try {
    const content = await file.text();
    const result = await m2request(
      `/api/workspace/projects/${encodeURIComponent(m2State.projectId)}/import`,
      { filename: file.name, mimeType: file.type || inferMime(file.name), content },
    );
    m2State.items.set(result.item.id, result.item);
    m2State.workspace.items.unshift(result.item);
    m2RenderResources();
    await m2OpenItem(result.item.id);
  } catch (error) {
    m2ShowError(error);
  }
};
let searchTimer = null;
m2$("m2-search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void m2Search(), 220);
};
m2$("m2-resource-toggle").onclick = () => surface.classList.toggle("show-resources");
m2$("m2-resource-close").onclick = () => surface.classList.remove("show-resources");
m2$("m2-context-toggle").onclick = () => surface.classList.toggle("show-context");
m2$("m2-context-close").onclick = () => surface.classList.remove("show-context");
m2$("m2-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...m2$("m2-tabs").querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;
  const current = Math.max(0, tabs.indexOf(document.activeElement));
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
});

function inferMime(name) {
  if (/\.md$/iu.test(name)) return "text/markdown";
  if (/\.json$/iu.test(name)) return "application/json";
  if (/\.html?$/iu.test(name)) return "text/html";
  if (/\.css$/iu.test(name)) return "text/css";
  if (/\.m?js$/iu.test(name)) return "text/javascript";
  return "text/plain";
}

function m2HandleLocation({ show = true } = {}) {
  const projectId = m2ProjectFromUrl();
  if (!projectId) {
    m2State.projectId = null;
    m2Hide();
    return;
  }
  if (projectId !== m2State.projectId) void m2Load(projectId, { show });
  else if (show) m2Show();
}

const originalReplaceState = history.replaceState.bind(history);
history.replaceState = (...args) => {
  originalReplaceState(...args);
  window.dispatchEvent(new Event("odin:m2-location"));
};
window.addEventListener("popstate", () => m2HandleLocation());
window.addEventListener("odin:m2-location", () => m2HandleLocation());
window.addEventListener("odin:workspace-changed", () => {
  if (m2State.projectId) void m2Load(m2State.projectId, { show: !surface.hidden });
});

document.addEventListener(
  "click",
  (event) => {
    const projectButton = event.target.closest?.("[data-project-section]");
    if (projectButton?.dataset.projectSection === "workspace" && m2ProjectFromUrl()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const projectId = m2ProjectFromUrl();
      if (projectId !== m2State.projectId) void m2Load(projectId);
      else m2Show();
      return;
    }
    const globalNav = event.target.closest?.(
      "#home-view,#projects-view,#knowledge-view,#skills-view,#activity-view,#models-view,#system-view,#benchmark-view,#new-chat",
    );
    if (globalNav) m2Hide();
  },
  true,
);

// M1 may finish its async bootstrap before or after this module executes. Resolve the URL once now
// and once after the initial product bootstrap settles; no client state is treated as authoritative.
m2HandleLocation({ show: false });
setTimeout(() => m2HandleLocation(), 500);
