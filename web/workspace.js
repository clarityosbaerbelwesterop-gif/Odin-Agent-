const css = document.createElement("link");
css.rel = "stylesheet";
css.href = "/workspace.css";
document.head.append(css);

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

async function request(path, body, method = body === undefined ? "GET" : "POST") {
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
    // Use the stable product fallback below.
  }
  if (!response.ok) {
    const error = new Error(data.message ?? "Workspace request failed.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

let config = null;
let repositories = [];
let selectedRepository = null;
let loading = false;

const button = el("button", undefined, "workspace-pill");
button.type = "button";
button.id = "workspace-picker-button";
button.setAttribute("aria-haspopup", "dialog");
button.append(
  el("span", "Repository", "workspace-pill-label"),
  el("strong", "Kein Repository", "workspace-pill-value"),
);
const topActions = document.querySelector(".top-actions");
if (topActions) topActions.prepend(button);

const dialog = document.createElement("dialog");
dialog.id = "workspace-picker";
dialog.className = "workspace-dialog";
dialog.innerHTML = `
  <div class="workspace-dialog-shell">
    <header class="workspace-dialog-header">
      <div><span class="workspace-eyebrow">GITHUB WORKSPACE</span><h2>Repository auswählen</h2></div>
      <button type="button" class="workspace-close" aria-label="Workspace-Auswahl schließen">×</button>
    </header>
    <div id="workspace-error" class="workspace-error" role="alert" hidden></div>
    <section id="workspace-disconnected" class="workspace-disconnected" hidden>
      <h3>GitHub verbinden</h3>
      <p>Verbinde deinen GitHub Account, damit Odin deine freigegebenen Repositories laden kann.</p>
      <button id="workspace-connect" type="button" class="workspace-primary">GitHub verbinden</button>
    </section>
    <section id="workspace-connected" hidden>
      <div class="workspace-account-row"><span id="workspace-account">GitHub</span><button id="workspace-reconnect" type="button">Neu verbinden</button></div>
      <label class="workspace-search"><span class="sr-only">Repositories durchsuchen</span><input id="workspace-search" type="search" autocomplete="off" placeholder="Repository suchen …" /></label>
      <div class="workspace-columns">
        <div><div class="workspace-column-title"><span>Repositories</span><span id="workspace-repo-count">0</span></div><div id="workspace-repositories" class="workspace-list" role="listbox" aria-label="Repositories"></div></div>
        <div><div class="workspace-column-title"><span>Branch</span><span id="workspace-branch-count">0</span></div><div id="workspace-branches" class="workspace-list" role="listbox" aria-label="Branches"><p class="workspace-empty">Wähle zuerst ein Repository.</p></div></div>
      </div>
      <footer class="workspace-dialog-footer"><div><strong id="workspace-selection">Keine Auswahl</strong><span id="workspace-selection-meta"></span></div><button id="workspace-save" type="button" class="workspace-primary" disabled>Workspace öffnen</button></footer>
    </section>
  </div>`;
document.body.append(dialog);

const $ = (id) => document.getElementById(id);
const currentValue = button.querySelector(".workspace-pill-value");

function showError(error) {
  $("workspace-error").textContent = error.message;
  $("workspace-error").hidden = false;
}
function clearError() {
  $("workspace-error").hidden = true;
  $("workspace-error").textContent = "";
}
function updatePill() {
  const github = config?.github;
  currentValue.textContent = github?.repository
    ? `${github.repository} · ${github.defaultBranch ?? "branch"}`
    : github?.connected
      ? "Repository auswählen"
      : "GitHub verbinden";
  button.classList.toggle("connected", Boolean(github?.repository));
}
function setLoading(value) {
  loading = value;
  $("workspace-save").disabled = value || !$("workspace-save").dataset.branch;
  $("workspace-search").disabled = value;
}
function renderRepositories(query = "") {
  const target = $("workspace-repositories");
  target.replaceChildren();
  const needle = query.trim().toLowerCase();
  const values = repositories.filter(
    (repo) => !needle || repo.fullName.toLowerCase().includes(needle),
  );
  $("workspace-repo-count").textContent = String(values.length);
  if (!values.length) {
    target.append(el("p", "Keine passenden Repositories.", "workspace-empty"));
    return;
  }
  for (const repo of values) {
    const item = el("button", undefined, "workspace-list-item");
    item.type = "button";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(selectedRepository?.fullName === repo.fullName));
    const name = el("span", undefined, "workspace-list-main");
    name.append(el("strong", repo.name), el("small", repo.owner));
    item.append(name, el("span", repo.private ? "Private" : "Public", "workspace-badge"));
    if (repo.archived) item.disabled = true;
    item.addEventListener("click", () => selectRepository(repo));
    target.append(item);
  }
}
async function selectRepository(repo) {
  if (loading) return;
  selectedRepository = repo;
  renderRepositories($("workspace-search").value);
  $("workspace-selection").textContent = repo.fullName;
  $("workspace-selection-meta").textContent = "Branch wird geladen …";
  $("workspace-save").dataset.repository = repo.fullName;
  delete $("workspace-save").dataset.branch;
  setLoading(true);
  clearError();
  try {
    const result = await request(
      `/api/github/branches?repository=${encodeURIComponent(repo.fullName)}`,
    );
    renderBranches(result.branches ?? [], repo.defaultBranch);
  } catch (error) {
    showError(error);
    $("workspace-branches").replaceChildren(
      el("p", "Branches konnten nicht geladen werden.", "workspace-empty"),
    );
  } finally {
    setLoading(false);
  }
}
function renderBranches(branches, preferred) {
  const target = $("workspace-branches");
  target.replaceChildren();
  $("workspace-branch-count").textContent = String(branches.length);
  if (!branches.length) {
    target.append(el("p", "Keine Branches verfügbar.", "workspace-empty"));
    return;
  }
  const choose = (branch) => {
    for (const row of target.querySelectorAll("button"))
      row.setAttribute("aria-selected", String(row.dataset.name === branch.name));
    $("workspace-save").dataset.branch = branch.name;
    $("workspace-save").disabled = false;
    $("workspace-selection-meta").textContent = `${branch.name} · ${branch.commitSha.slice(0, 8)}`;
  };
  for (const branch of branches) {
    const item = el("button", undefined, "workspace-list-item branch-item");
    item.type = "button";
    item.dataset.name = branch.name;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.append(
      el("strong", branch.name),
      el("small", branch.protected ? "Protected" : branch.commitSha.slice(0, 8)),
    );
    item.addEventListener("click", () => choose(branch));
    target.append(item);
  }
  choose(branches.find((branch) => branch.name === preferred) ?? branches[0]);
}
async function refreshConfig() {
  config = await request("/api/config");
  updatePill();
  const github = config.github;
  $("workspace-disconnected").hidden = Boolean(github?.connected);
  $("workspace-connected").hidden = !github?.connected;
  if (github?.connected) $("workspace-account").textContent = `@${github.login}`;
}
async function loadRepositories() {
  setLoading(true);
  clearError();
  try {
    const result = await request("/api/github/repositories");
    repositories = result.repositories ?? [];
    renderRepositories();
    const current = repositories.find((repo) => repo.fullName === config?.github?.repository);
    if (current) await selectRepository(current);
  } catch (error) {
    showError(error);
  } finally {
    setLoading(false);
  }
}
async function openPicker() {
  clearError();
  dialog.showModal();
  try {
    await refreshConfig();
    if (config?.github?.connected) await loadRepositories();
  } catch (error) {
    showError(error);
  }
}

button.addEventListener("click", openPicker);
dialog.querySelector(".workspace-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", () => dialog.close());
$("workspace-search").addEventListener("input", () =>
  renderRepositories($("workspace-search").value),
);
$("workspace-connect").addEventListener("click", () =>
  window.location.assign("/api/github/connect"),
);
$("workspace-reconnect").addEventListener("click", () =>
  window.location.assign("/api/github/connect"),
);
$("workspace-save").addEventListener("click", async () => {
  if (loading) return;
  const repository = $("workspace-save").dataset.repository;
  const branch = $("workspace-save").dataset.branch;
  if (!repository || !branch) return;
  setLoading(true);
  clearError();
  try {
    await request("/api/github/repository", { repository, branch }, "PUT");
    await refreshConfig();
    dialog.close();
    window.dispatchEvent(new CustomEvent("odin:workspace-changed", { detail: config.github }));
  } catch (error) {
    showError(error);
  } finally {
    setLoading(false);
  }
});

refreshConfig().catch(() => {
  currentValue.textContent = "Workspace";
});
