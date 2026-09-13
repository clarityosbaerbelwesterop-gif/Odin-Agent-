const m3Panel = document.getElementById("knowledge-panel");

if (m3Panel) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/product-m3.css";
  document.head.append(stylesheet);

  m3Panel.innerHTML = `
    <div class="m3-shell">
      <header class="m3-header">
        <div>
          <span class="m3-eyebrow">MEMORY BRAIN</span>
          <h1 id="m3-title">Knowledge with a source.</h1>
          <p id="m3-subtitle">Open a Project to inspect the memories Odin may use, where they came from, and what is currently active in context.</p>
        </div>
        <div class="m3-pulse-card" id="m3-pulse-card" data-active="false">
          <span class="m3-pulse-dot" aria-hidden="true"></span>
          <div><strong>Brain Pulse</strong><small id="m3-pulse-label">No selected context yet</small></div>
        </div>
      </header>

      <div class="m3-toolbar" aria-label="Memory Brain controls">
        <label class="m3-search"><span class="sr-only">Search Memory</span><input id="m3-search" type="search" placeholder="Search memory…" autocomplete="off" maxlength="240" /></label>
        <select id="m3-kind" aria-label="Memory kind">
          <option value="">All kinds</option><option value="project">Project</option><option value="semantic">Knowledge</option><option value="user_preference">Preferences</option><option value="episodic">Episodes</option><option value="working">Working</option>
        </select>
        <select id="m3-status" aria-label="Memory status">
          <option value="">All states</option><option value="ACTIVE">Active</option><option value="CONFLICTED">Conflicted</option><option value="STALE">Stale</option><option value="SUPERSEDED">Superseded</option><option value="NOISE_CANDIDATE">Noise candidate</option><option value="ARCHIVED">Archived</option><option value="TEMPORARY">Temporary</option>
        </select>
        <button id="m3-fit" type="button">Fit</button>
        <button id="m3-zoom-out" type="button" aria-label="Zoom out">−</button>
        <button id="m3-zoom-in" type="button" aria-label="Zoom in">+</button>
        <button id="m3-refresh" type="button">Refresh</button>
      </div>

      <div id="m3-status-line" class="m3-status-line" role="status" aria-live="polite"></div>
      <div class="m3-layout">
        <section class="m3-graph-card" aria-label="Memory graph">
          <div id="m3-empty" class="m3-empty" hidden>
            <span aria-hidden="true">◎</span><h2>No durable memories yet</h2><p>Odin only adds memory through controlled writes. Documents and artifacts stay Workspace sources until promoted.</p>
          </div>
          <svg id="m3-graph" viewBox="-600 -420 1200 840" role="img" aria-label="Interactive graph of project memory">
            <g id="m3-viewport"><g id="m3-edges"></g><g id="m3-nodes"></g></g>
          </svg>
          <div class="m3-legend" aria-label="Graph legend">
            <span><i class="active"></i>Active</span><span><i class="pulse"></i>In context</span><span><i class="conflict"></i>Conflict</span><span><i class="stale"></i>Stale</span><span><i class="archive"></i>Archived</span>
          </div>
        </section>

        <aside class="m3-inspector" aria-label="Memory inspector">
          <div class="m3-inspector-top"><span class="m3-eyebrow">INSPECTOR</span><button id="m3-close-inspector" type="button" aria-label="Close inspector">×</button></div>
          <div id="m3-inspector-empty" class="m3-inspector-empty"><strong>Select a node</strong><p>Inspect provenance, status, history and the exact signals Odin uses.</p></div>
          <div id="m3-inspector-content" hidden>
            <div class="m3-node-heading"><span id="m3-node-class">MEMORY</span><h2 id="m3-node-title"></h2><span id="m3-node-status" class="m3-status-badge"></span></div>
            <p id="m3-node-summary" class="m3-node-summary"></p>
            <dl id="m3-node-meta" class="m3-meta"></dl>
            <div id="m3-node-actions" class="m3-actions"></div>
            <section class="m3-inspector-section"><div class="m3-section-title"><span>History</span><span id="m3-history-count">0</span></div><div id="m3-history" class="m3-history"></div></section>
            <section class="m3-inspector-section"><div class="m3-section-title"><span>Relationships</span></div><div id="m3-relations" class="m3-relations"></div></section>
          </div>
        </aside>
      </div>

      <section class="m3-health-grid" aria-label="Memory hygiene">
        <article><span>Conflicts</span><strong id="m3-conflicts">0</strong><small>Equally fresh incompatible conclusions stay blocked from silent recall.</small></article>
        <article><span>Stale</span><strong id="m3-stale">0</strong><small>Current sources and newer project memory outrank stale conclusions.</small></article>
        <article><span>Noise candidates</span><strong id="m3-noise">0</strong><small>Filtered candidates are retained until an explicit safe action changes them.</small></article>
        <article><span>Archived</span><strong id="m3-archived">0</strong><small>Archived memory is excluded from ordinary automatic context.</small></article>
      </section>
      <section id="m3-retention" class="m3-retention" hidden></section>
    </div>`;

  const m3 = (id) => document.getElementById(id);
  const state = {
    projectId: null,
    projection: null,
    selectedId: null,
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    loadGeneration: 0,
    searchTimer: null,
  };

  const request = async (path, body, method = body === undefined ? "GET" : "POST") => {
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
      // A stable error is rendered below.
    }
    if (!response.ok) {
      const error = new Error(data.message ?? "Memory request failed.");
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  };

  const projectFromUrl = () => new URLSearchParams(window.location.search).get("project");

  function setStatus(text, kind = "") {
    m3("m3-status-line").textContent = text;
    m3("m3-status-line").dataset.state = kind;
    m3("m3-status-line").hidden = !text;
  }

  function params() {
    const query = new URLSearchParams();
    const q = m3("m3-search").value.trim();
    const kind = m3("m3-kind").value;
    const status = m3("m3-status").value;
    if (q) query.set("q", q);
    if (kind) query.set("kind", kind);
    if (status) query.set("status", status);
    const encoded = query.toString();
    return encoded ? `?${encoded}` : "";
  }

  async function load({ preserveSelection = true } = {}) {
    const projectId = projectFromUrl();
    const generation = ++state.loadGeneration;
    state.projectId = projectId;
    if (!projectId) {
      state.projection = null;
      state.selectedId = null;
      renderNoProject();
      return;
    }
    setStatus("Loading Memory Brain…");
    try {
      const [projection, retention] = await Promise.all([
        request(`/api/memory/projects/${encodeURIComponent(projectId)}${params()}`),
        request(`/api/memory/projects/${encodeURIComponent(projectId)}/retention`),
      ]);
      if (generation !== state.loadGeneration || projectFromUrl() !== projectId) return;
      state.projection = projection;
      if (!preserveSelection || !projection.nodes.some((node) => node.id === state.selectedId))
        state.selectedId = null;
      render();
      renderRetention(retention);
      setStatus("");
    } catch (error) {
      if (generation !== state.loadGeneration) return;
      setStatus(error.message ?? "Memory Brain unavailable.", "error");
      renderNoData();
    }
  }

  function renderNoProject() {
    m3("m3-title").textContent = "Knowledge with a source.";
    m3("m3-subtitle").textContent =
      "Open a Project, then choose Knowledge to inspect its isolated Memory Brain.";
    m3("m3-empty").hidden = false;
    m3("m3-empty").querySelector("h2").textContent = "Choose a Project";
    m3("m3-empty").querySelector("p").textContent =
      "Memory is project-scoped. Odin never combines unrelated Projects into one graph.";
    m3("m3-graph").hidden = true;
    clearInspector();
    updateCounts({});
    renderPulse(null);
  }

  function renderNoData() {
    m3("m3-empty").hidden = false;
    m3("m3-graph").hidden = true;
    clearInspector();
  }

  function render() {
    const projection = state.projection;
    if (!projection) return renderNoData();
    m3("m3-title").textContent = "Project Memory Brain";
    m3("m3-subtitle").textContent =
      "Every visible node comes from canonical Memory or a real Workspace source. Status and context activity are evidence-backed.";
    const memoryNodes = projection.nodes.filter((node) => node.nodeClass === "MEMORY");
    m3("m3-empty").hidden = memoryNodes.length > 0;
    m3("m3-graph").hidden = memoryNodes.length === 0;
    updateCounts(projection.counts ?? {});
    renderPulse(projection.pulse);
    renderGraph(projection);
    if (state.selectedId) selectNode(state.selectedId, { fetchHistory: false });
    else clearInspector();
  }

  function updateCounts(counts) {
    m3("m3-conflicts").textContent = String(counts.CONFLICTED ?? 0);
    m3("m3-stale").textContent = String(counts.STALE ?? 0);
    m3("m3-noise").textContent = String(counts.NOISE_CANDIDATE ?? 0);
    m3("m3-archived").textContent = String(counts.ARCHIVED ?? 0);
  }

  function renderPulse(pulse) {
    const card = m3("m3-pulse-card");
    card.dataset.active = String(Boolean(pulse));
    if (!pulse) {
      m3("m3-pulse-label").textContent = "No selected context yet";
      return;
    }
    const total = (pulse.selectedMemoryIds?.length ?? 0) + (pulse.selectedWorkspaceReferences?.length ?? 0);
    m3("m3-pulse-label").textContent = `${total} selected context reference${total === 1 ? "" : "s"} · ${new Date(pulse.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function layoutNodes(nodes) {
    const positions = new Map();
    const project = nodes.find((node) => node.nodeClass === "PROJECT");
    if (project) positions.set(project.id, { x: 0, y: 0 });
    const memories = nodes.filter((node) => node.nodeClass === "MEMORY");
    memories.forEach((node, index) => {
      const ring = Math.floor(index / 14);
      const offset = ring * 14;
      const count = Math.min(14, memories.length - offset);
      const angle = ((index - offset) / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
      const radius = 170 + ring * 125;
      positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    const sources = nodes.filter((node) => !["MEMORY", "PROJECT"].includes(node.nodeClass));
    sources.forEach((node, index) => {
      const angle = (index / Math.max(1, sources.length)) * Math.PI * 2 + Math.PI / 8;
      const radius = 360 + Math.floor(index / 18) * 100;
      positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    return positions;
  }

  function renderGraph(projection) {
    const positions = layoutNodes(projection.nodes);
    const edges = m3("m3-edges");
    const nodes = m3("m3-nodes");
    edges.replaceChildren();
    nodes.replaceChildren();

    for (const edge of projection.edges ?? []) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y));
      line.setAttribute("class", `m3-edge relation-${edge.relation}`);
      edges.append(line);
    }

    for (const node of projection.nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      group.setAttribute(
        "class",
        `m3-node node-${node.nodeClass.toLowerCase()} status-${String(node.status ?? "neutral").toLowerCase()}${node.activeInContext ? " in-context" : ""}${state.selectedId === node.id ? " selected" : ""}`,
      );
      group.dataset.nodeId = node.id;
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `${node.title}${node.status ? `, ${node.status}` : ""}`);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const radius =
        node.nodeClass === "PROJECT"
          ? 29
          : node.nodeClass === "MEMORY"
            ? Math.max(10, Math.min(23, 10 + Number(node.importance ?? 30) * 0.13))
            : 9;
      circle.setAttribute("r", String(radius));
      group.append(circle);
      if (node.activeInContext) {
        const pulse = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        pulse.setAttribute("r", String(radius + 8));
        pulse.setAttribute("class", "m3-context-ring");
        group.prepend(pulse);
      }
      if (node.nodeClass === "PROJECT" || node.activeInContext || (node.importance ?? 0) >= 65) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("y", String(radius + 18));
        label.setAttribute("text-anchor", "middle");
        label.textContent = truncate(node.title, 28);
        group.append(label);
      }
      const activate = () => selectNode(node.id);
      group.addEventListener("click", activate);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
      nodes.append(group);
    }
    applyTransform();
  }

  async function selectNode(id, { fetchHistory = true } = {}) {
    const node = state.projection?.nodes.find((item) => item.id === id);
    if (!node) return;
    state.selectedId = id;
    for (const item of m3("m3-nodes").querySelectorAll(".m3-node"))
      item.classList.toggle("selected", item.dataset.nodeId === id);
    m3("m3-inspector-empty").hidden = true;
    m3("m3-inspector-content").hidden = false;
    m3("m3-node-class").textContent = node.nodeClass.replaceAll("_", " ");
    m3("m3-node-title").textContent = node.title;
    m3("m3-node-status").textContent = node.status ?? "SOURCE";
    m3("m3-node-status").dataset.status = node.status ?? "SOURCE";
    m3("m3-node-summary").textContent = node.summary ?? "Source node linked to canonical memory.";
    renderMeta(node);
    renderRelations(node);
    renderActions(node);
    if (fetchHistory && node.nodeClass === "MEMORY" && state.projectId) await loadHistory(node.id);
    else if (node.nodeClass !== "MEMORY") renderHistory([]);
  }

  function renderMeta(node) {
    const target = m3("m3-node-meta");
    target.replaceChildren();
    const rows = [
      ["Kind", node.memoryKind],
      ["Sensitivity", node.sensitivity],
      ["Source", node.sourceClass],
      ["Source version", node.sourceVersion],
      ["Observed", formatDate(node.sourceObservedAt)],
      ["Updated", formatDate(node.updatedAt)],
      ["Expires", formatDate(node.expiresAt)],
      ["Version", node.version],
      ["Uses", node.usageCount],
      ["Last used", formatDate(node.lastUsedAt)],
      ["Pinned", node.pinned === undefined ? undefined : node.pinned ? "Yes" : "No"],
      ["Merged records", node.mergedCount && node.mergedCount > 1 ? node.mergedCount : undefined],
      ["Reference", node.sourceReference],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = String(label);
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      target.append(dt, dd);
    }
  }

  function renderRelations(node) {
    const target = m3("m3-relations");
    target.replaceChildren();
    const related = (state.projection?.edges ?? []).filter(
      (edge) => edge.from === node.id || edge.to === node.id,
    );
    if (!related.length) {
      target.append(textNode("No graph relationships."));
      return;
    }
    for (const edge of related.slice(0, 24)) {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const other = state.projection.nodes.find((candidate) => candidate.id === otherId);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${edge.relation.replaceAll("_", " ")} · ${other?.title ?? otherId}`;
      button.onclick = () => selectNode(otherId);
      target.append(button);
    }
  }

  function renderActions(node) {
    const target = m3("m3-node-actions");
    target.replaceChildren();
    if (node.nodeClass !== "MEMORY" || !state.projectId || !node.version) return;
    const pin = actionButton(node.pinned ? "Unpin" : "Pin", async () => {
      await request(
        `/api/memory/projects/${encodeURIComponent(state.projectId)}/signals/${encodeURIComponent(node.id)}`,
        { pinned: !node.pinned },
      );
      await load();
    });
    const archived = node.status === "ARCHIVED";
    const archive = actionButton(archived ? "Unarchive" : "Archive", async () => {
      await request(
        `/api/memory/projects/${encodeURIComponent(state.projectId)}/signals/${encodeURIComponent(node.id)}`,
        { archived: !archived },
      );
      await load();
    });
    const clear = actionButton("Clear content", async () => {
      if (!window.confirm("Clear this memory content? The audit tombstone will remain.")) return;
      await request(
        `/api/memory/projects/${encodeURIComponent(state.projectId)}/records/${encodeURIComponent(node.id)}`,
        { expectedVersion: node.version },
        "DELETE",
      );
      state.selectedId = null;
      await load({ preserveSelection: false });
    }, "danger");
    target.append(pin, archive, clear);
  }

  async function loadHistory(memoryId) {
    m3("m3-history").replaceChildren(textNode("Loading history…"));
    try {
      const data = await request(
        `/api/memory/projects/${encodeURIComponent(state.projectId)}/records/${encodeURIComponent(memoryId)}/history`,
      );
      renderHistory(data.history ?? []);
    } catch (error) {
      m3("m3-history").replaceChildren(textNode(error.message ?? "History unavailable."));
    }
  }

  function renderHistory(history) {
    const target = m3("m3-history");
    target.replaceChildren();
    m3("m3-history-count").textContent = String(history.length);
    if (!history.length) {
      target.append(textNode("No revision history available."));
      return;
    }
    for (const revision of [...history].reverse().slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "m3-history-row";
      const label = document.createElement("strong");
      label.textContent = `v${revision.version} · ${revision.action}`;
      const time = document.createElement("time");
      time.textContent = formatDate(revision.updatedAt) ?? "";
      row.append(label, time);
      target.append(row);
    }
  }

  function renderRetention(data) {
    const target = m3("m3-retention");
    const candidates = data?.plan?.candidates ?? [];
    target.hidden = candidates.length === 0;
    target.replaceChildren();
    if (!candidates.length) return;
    const heading = document.createElement("div");
    heading.innerHTML = `<span class="m3-eyebrow">RETENTION REVIEW</span><h2>${candidates.length} candidate${candidates.length === 1 ? "" : "s"} need review</h2><p>Retention planning is advisory. Odin does not destructively remove these memories automatically.</p>`;
    target.append(heading);
    const list = document.createElement("div");
    list.className = "m3-retention-list";
    for (const candidate of candidates.slice(0, 20)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${candidate.kind} · ${candidate.id}`;
      button.onclick = () => selectNode(candidate.id);
      list.append(button);
    }
    target.append(list);
  }

  function clearInspector() {
    m3("m3-inspector-empty").hidden = false;
    m3("m3-inspector-content").hidden = true;
  }

  function actionButton(label, handler, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.onclick = async () => {
      button.disabled = true;
      setStatus(`${label}…`);
      try {
        await handler();
        setStatus("");
      } catch (error) {
        setStatus(error.message ?? "Memory action failed.", "error");
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }

  function textNode(text) {
    const node = document.createElement("p");
    node.className = "m3-muted";
    node.textContent = text;
    return node;
  }

  function formatDate(value) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : undefined;
  }

  function truncate(value, length) {
    return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
  }

  function applyTransform() {
    m3("m3-viewport").setAttribute(
      "transform",
      `translate(${state.x} ${state.y}) scale(${state.scale})`,
    );
  }

  function zoom(factor) {
    state.scale = Math.max(0.45, Math.min(2.8, state.scale * factor));
    applyTransform();
  }

  function fit() {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    applyTransform();
  }

  const svg = m3("m3-graph");
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".m3-node")) return;
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.originX = state.x;
    state.originY = state.y;
    svg.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    state.x = state.originX + (event.clientX - state.startX);
    state.y = state.originY + (event.clientY - state.startY);
    applyTransform();
  });
  const endDrag = (event) => {
    if (event.pointerId !== state.pointerId) return;
    state.dragging = false;
    state.pointerId = null;
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  m3("m3-fit").onclick = fit;
  m3("m3-zoom-in").onclick = () => zoom(1.2);
  m3("m3-zoom-out").onclick = () => zoom(0.82);
  m3("m3-refresh").onclick = () => load();
  m3("m3-close-inspector").onclick = () => {
    state.selectedId = null;
    clearInspector();
    for (const node of m3("m3-nodes").querySelectorAll(".m3-node")) node.classList.remove("selected");
  };
  m3("m3-kind").onchange = () => load({ preserveSelection: false });
  m3("m3-status").onchange = () => load({ preserveSelection: false });
  m3("m3-search").oninput = () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => void load({ preserveSelection: false }), 180);
  };

  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("#knowledge-view,[data-project-section='knowledge']");
    if (!target) return;
    setTimeout(() => void load(), 0);
  });
  window.addEventListener("popstate", () => {
    if (!m3Panel.hidden) void load();
  });
  window.addEventListener("odin:m2-location", () => {
    if (!m3Panel.hidden) void load();
  });

  renderNoProject();
}
