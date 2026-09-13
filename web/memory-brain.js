const panel = document.getElementById("knowledge-panel");

if (panel) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/product-m3.css";
  document.head.append(css);

  panel.innerHTML = `
    <div class="m3-shell">
      <header class="m3-header">
        <div>
          <span class="m3-eyebrow">MEMORY BRAIN</span>
          <h1 id="m3-title">Knowledge with a source.</h1>
          <p id="m3-subtitle">Open a Project to inspect scoped Memory, provenance and selected context.</p>
        </div>
        <div id="m3-pulse-card" class="m3-pulse-card" data-active="false">
          <span class="m3-pulse-dot" aria-hidden="true"></span>
          <div><strong>Brain Pulse</strong><small id="m3-pulse-label">No selected context yet</small></div>
        </div>
      </header>
      <div class="m3-toolbar" aria-label="Memory Brain controls">
        <label class="m3-search"><span class="sr-only">Search Memory</span><input id="m3-search" type="search" placeholder="Search memory…" autocomplete="off" maxlength="240" /></label>
        <select id="m3-kind" aria-label="Memory kind"><option value="">All kinds</option><option value="project">Project</option><option value="semantic">Knowledge</option><option value="user_preference">Preferences</option><option value="episodic">Episodes</option><option value="working">Working</option></select>
        <select id="m3-status" aria-label="Memory status"><option value="">All states</option><option value="ACTIVE">Active</option><option value="CONFLICTED">Conflicted</option><option value="STALE">Stale</option><option value="SUPERSEDED">Superseded</option><option value="NOISE_CANDIDATE">Noise candidate</option><option value="ARCHIVED">Archived</option><option value="TEMPORARY">Temporary</option></select>
        <button id="m3-fit" type="button">Fit</button><button id="m3-zoom-out" type="button" aria-label="Zoom out">−</button><button id="m3-zoom-in" type="button" aria-label="Zoom in">+</button><button id="m3-refresh" type="button">Refresh</button>
      </div>
      <div id="m3-status-line" class="m3-status-line" role="status" aria-live="polite"></div>
      <div class="m3-layout">
        <section class="m3-graph-card" aria-label="Memory graph">
          <div id="m3-empty" class="m3-empty" hidden><span aria-hidden="true">◎</span><h2>No durable memories yet</h2><p>Documents stay Workspace sources until a controlled Memory write occurs.</p></div>
          <svg id="m3-graph" class="m3-graph" viewBox="-600 -420 1200 840" role="img" aria-label="Interactive graph of project memory"><g id="m3-viewport"><g id="m3-edges"></g><g id="m3-nodes"></g></g></svg>
          <div class="m3-legend"><span><i></i>Active</span><span><i class="pulse"></i>In context</span><span><i class="conflict"></i>Conflict</span><span><i class="stale"></i>Stale</span><span><i class="archive"></i>Archived</span></div>
        </section>
        <aside class="m3-inspector" aria-label="Memory inspector">
          <div class="m3-inspector-top"><span class="m3-eyebrow">INSPECTOR</span><button id="m3-close-inspector" type="button" aria-label="Close inspector">×</button></div>
          <div id="m3-inspector-empty" class="m3-inspector-empty"><strong>Select a node</strong><p>Inspect provenance, status, history and usage signals.</p></div>
          <div id="m3-inspector-content" hidden>
            <div class="m3-node-heading"><span id="m3-node-class">MEMORY</span><h2 id="m3-node-title"></h2><span id="m3-node-status" class="m3-status-badge"></span></div>
            <p id="m3-node-summary" class="m3-node-summary"></p><dl id="m3-node-meta" class="m3-meta"></dl><div id="m3-node-actions" class="m3-actions"></div>
            <section class="m3-inspector-section"><div class="m3-section-title"><span>History</span><span id="m3-history-count">0</span></div><div id="m3-history" class="m3-history"></div></section>
            <section class="m3-inspector-section"><div class="m3-section-title"><span>Relationships</span></div><div id="m3-relations" class="m3-relations"></div></section>
          </div>
        </aside>
      </div>
      <section class="m3-health-grid"><article><span>Conflicts</span><strong id="m3-conflicts">0</strong><small>Ambiguous conclusions are not silently recalled.</small></article><article><span>Stale</span><strong id="m3-stale">0</strong><small>Current sources outrank stale Memory.</small></article><article><span>Noise candidates</span><strong id="m3-noise">0</strong><small>Candidates are filtered, not silently deleted.</small></article><article><span>Archived</span><strong id="m3-archived">0</strong><small>Archived Memory stays outside ordinary context.</small></article></section>
      <section id="m3-retention" class="m3-retention" hidden></section>
    </div>`;

  const byId = (id) => document.getElementById(id);
  const state = {
    projectId: null,
    projection: null,
    selectedId: null,
    scale: 1,
    x: 0,
    y: 0,
    drag: null,
    generation: 0,
    timer: null,
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
      // Stable fallback below.
    }
    if (!response.ok) {
      const error = new Error(data.message ?? "Memory request failed.");
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function projectFromUrl() {
    return new URLSearchParams(window.location.search).get("project");
  }

  function queryString() {
    const query = new URLSearchParams();
    const text = byId("m3-search").value.trim();
    if (text) query.set("q", text);
    if (byId("m3-kind").value) query.set("kind", byId("m3-kind").value);
    if (byId("m3-status").value) query.set("status", byId("m3-status").value);
    return query.size ? `?${query}` : "";
  }

  function setStatus(text, kind = "") {
    const line = byId("m3-status-line");
    line.textContent = text;
    line.dataset.state = kind;
    line.hidden = !text;
  }

  async function load(options = {}) {
    const projectId = projectFromUrl();
    const generation = ++state.generation;
    state.projectId = projectId;
    if (!projectId) {
      renderNoProject();
      return;
    }
    setStatus("Loading Memory Brain…");
    try {
      const [projection, retention] = await Promise.all([
        request(`/api/memory/projects/${encodeURIComponent(projectId)}${queryString()}`),
        request(`/api/memory/projects/${encodeURIComponent(projectId)}/retention`),
      ]);
      if (generation !== state.generation || projectFromUrl() !== projectId) return;
      state.projection = applyAdvancedStates(projection);
      if (
        options.preserveSelection === false ||
        !state.projection.nodes.some((node) => node.id === state.selectedId)
      )
        state.selectedId = null;
      render();
      renderRetention(retention);
      setStatus("");
    } catch (error) {
      if (generation !== state.generation) return;
      setStatus(error.message ?? "Memory Brain unavailable.", "error");
    }
  }

  function applyAdvancedStates(projection) {
    const stale = new Set((projection.advanced?.stale ?? []).map((item) => item.recordId));
    const conflicted = new Set(
      (projection.advanced?.conflicts ?? []).flatMap((group) => group.recordIds ?? []),
    );
    const counts = { ...projection.counts };
    const nodes = projection.nodes.map((node) => {
      if (node.nodeClass !== "MEMORY" || node.status === "ARCHIVED") return node;
      const nextStatus = conflicted.has(node.id) ? "CONFLICTED" : stale.has(node.id) ? "STALE" : null;
      if (!nextStatus || nextStatus === node.status) return node;
      if (node.status && counts[node.status] > 0) counts[node.status] -= 1;
      counts[nextStatus] = (counts[nextStatus] ?? 0) + 1;
      return { ...node, status: nextStatus };
    });
    return { ...projection, nodes, counts };
  }

  function renderNoProject() {
    state.projection = null;
    state.selectedId = null;
    byId("m3-title").textContent = "Knowledge with a source.";
    byId("m3-subtitle").textContent =
      "Open a Project, then choose Knowledge to inspect its isolated Memory Brain.";
    byId("m3-empty").hidden = false;
    byId("m3-graph").hidden = true;
    clearInspector();
    updateCounts({});
    renderPulse(null);
  }

  function render() {
    if (!state.projection) return;
    const memoryCount = state.projection.nodes.filter((node) => node.nodeClass === "MEMORY").length;
    byId("m3-empty").hidden = memoryCount > 0;
    byId("m3-graph").hidden = memoryCount === 0;
    byId("m3-title").textContent = "Project Memory Brain";
    byId("m3-subtitle").textContent =
      "Every node comes from canonical Memory or a real Workspace source; Pulse marks selected context, not reasoning.";
    updateCounts(state.projection.counts ?? {});
    renderPulse(state.projection.pulse);
    renderGraph();
    if (state.selectedId) void selectNode(state.selectedId, false);
    else clearInspector();
  }

  function updateCounts(counts) {
    byId("m3-conflicts").textContent = String(counts.CONFLICTED ?? 0);
    byId("m3-stale").textContent = String(counts.STALE ?? 0);
    byId("m3-noise").textContent = String(counts.NOISE_CANDIDATE ?? 0);
    byId("m3-archived").textContent = String(counts.ARCHIVED ?? 0);
  }

  function renderPulse(pulse) {
    byId("m3-pulse-card").dataset.active = String(Boolean(pulse));
    if (!pulse) {
      byId("m3-pulse-label").textContent = "No selected context yet";
      return;
    }
    const total =
      (pulse.selectedMemoryIds?.length ?? 0) + (pulse.selectedWorkspaceReferences?.length ?? 0);
    byId("m3-pulse-label").textContent =
      `${total} selected context reference${total === 1 ? "" : "s"} · ${new Date(pulse.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function positions(nodes) {
    const map = new Map();
    const project = nodes.find((node) => node.nodeClass === "PROJECT");
    if (project) map.set(project.id, { x: 0, y: 0 });
    const memory = nodes.filter((node) => node.nodeClass === "MEMORY");
    memory.forEach((node, index) => {
      const ring = Math.floor(index / 14);
      const count = Math.min(14, memory.length - ring * 14);
      const angle = ((index % 14) / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
      const radius = 170 + ring * 125;
      map.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    const sources = nodes.filter((node) => !["MEMORY", "PROJECT"].includes(node.nodeClass));
    sources.forEach((node, index) => {
      const angle = (index / Math.max(1, sources.length)) * Math.PI * 2 + Math.PI / 8;
      const radius = 360 + Math.floor(index / 18) * 100;
      map.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    return map;
  }

  function renderGraph() {
    const projection = state.projection;
    const points = positions(projection.nodes);
    const edgeLayer = byId("m3-edges");
    const nodeLayer = byId("m3-nodes");
    edgeLayer.replaceChildren();
    nodeLayer.replaceChildren();
    for (const edge of projection.edges ?? []) {
      const from = points.get(edge.from);
      const to = points.get(edge.to);
      if (!from || !to) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      for (const [name, value] of [
        ["x1", from.x],
        ["y1", from.y],
        ["x2", to.x],
        ["y2", to.y],
      ])
        line.setAttribute(name, String(value));
      line.setAttribute("class", `m3-edge relation-${edge.relation}`);
      edgeLayer.append(line);
    }
    for (const node of projection.nodes) renderNode(nodeLayer, node, points.get(node.id));
    applyTransform();
  }

  function renderNode(layer, node, point) {
    if (!point) return;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("transform", `translate(${point.x} ${point.y})`);
    group.setAttribute(
      "class",
      `m3-node node-${node.nodeClass.toLowerCase()} status-${String(node.status ?? "neutral").toLowerCase()}${node.activeInContext ? " in-context" : ""}${state.selectedId === node.id ? " selected" : ""}`,
    );
    group.dataset.nodeId = node.id;
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    const radius =
      node.nodeClass === "PROJECT"
        ? 29
        : node.nodeClass === "MEMORY"
          ? Math.max(10, Math.min(23, 10 + Number(node.importance ?? 30) * 0.13))
          : 9;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
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
      label.textContent = node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title;
      group.append(label);
    }
    const activate = () => void selectNode(node.id);
    group.addEventListener("click", activate);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    layer.append(group);
  }

  async function selectNode(id, fetchHistory = true) {
    const node = state.projection?.nodes.find((item) => item.id === id);
    if (!node) return;
    state.selectedId = id;
    for (const item of byId("m3-nodes").querySelectorAll(".m3-node"))
      item.classList.toggle("selected", item.dataset.nodeId === id);
    byId("m3-inspector-empty").hidden = true;
    byId("m3-inspector-content").hidden = false;
    byId("m3-node-class").textContent = node.nodeClass.replaceAll("_", " ");
    byId("m3-node-title").textContent = node.title;
    byId("m3-node-status").textContent = node.status ?? "SOURCE";
    byId("m3-node-status").dataset.status = node.status ?? "SOURCE";
    byId("m3-node-summary").textContent = node.summary ?? "Source node linked to canonical Memory.";
    renderMeta(node);
    renderRelations(node);
    renderActions(node);
    if (fetchHistory && node.nodeClass === "MEMORY") await loadHistory(node.id);
    else if (node.nodeClass !== "MEMORY") renderHistory([]);
  }

  function renderMeta(node) {
    const target = byId("m3-node-meta");
    target.replaceChildren();
    const rows = [
      ["Kind", node.memoryKind],
      ["Sensitivity", node.sensitivity],
      ["Source", node.sourceClass],
      ["Source version", node.sourceVersion],
      ["Updated", dateText(node.updatedAt)],
      ["Version", node.version],
      ["Uses", node.usageCount],
      ["Pinned", node.pinned === undefined ? undefined : node.pinned ? "Yes" : "No"],
      ["Reference", node.sourceReference],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = String(label);
      dd.textContent = String(value);
      target.append(dt, dd);
    }
  }

  function renderRelations(node) {
    const target = byId("m3-relations");
    target.replaceChildren();
    const edges = (state.projection?.edges ?? []).filter(
      (edge) => edge.from === node.id || edge.to === node.id,
    );
    if (!edges.length) return target.append(message("No graph relationships."));
    for (const edge of edges.slice(0, 24)) {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const other = state.projection.nodes.find((item) => item.id === otherId);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${edge.relation.replaceAll("_", " ")} · ${other?.title ?? otherId}`;
      button.onclick = () => void selectNode(otherId);
      target.append(button);
    }
  }

  function renderActions(node) {
    const target = byId("m3-node-actions");
    target.replaceChildren();
    if (node.nodeClass !== "MEMORY" || !node.version || !state.projectId) return;
    target.append(
      action(node.pinned ? "Unpin" : "Pin", () => signal(node, { pinned: !node.pinned })),
      action(node.status === "ARCHIVED" ? "Unarchive" : "Archive", () =>
        signal(node, { archived: node.status !== "ARCHIVED" }),
      ),
      action(
        "Clear content",
        async () => {
          if (!window.confirm("Clear this memory content? The audit tombstone will remain.")) return;
          await request(
            `/api/memory/projects/${encodeURIComponent(state.projectId)}/records/${encodeURIComponent(node.id)}`,
            { expectedVersion: node.version },
            "DELETE",
          );
          state.selectedId = null;
          await load({ preserveSelection: false });
        },
        "danger",
      ),
    );
  }

  async function signal(node, body) {
    await request(
      `/api/memory/projects/${encodeURIComponent(state.projectId)}/signals/${encodeURIComponent(node.id)}`,
      body,
    );
    await load();
  }

  function action(label, handler, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.onclick = async () => {
      button.disabled = true;
      try {
        await handler();
      } catch (error) {
        setStatus(error.message ?? "Memory action failed.", "error");
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }

  async function loadHistory(memoryId) {
    byId("m3-history").replaceChildren(message("Loading history…"));
    try {
      const data = await request(
        `/api/memory/projects/${encodeURIComponent(state.projectId)}/records/${encodeURIComponent(memoryId)}/history`,
      );
      renderHistory(data.history ?? []);
    } catch (error) {
      byId("m3-history").replaceChildren(message(error.message ?? "History unavailable."));
    }
  }

  function renderHistory(history) {
    const target = byId("m3-history");
    target.replaceChildren();
    byId("m3-history-count").textContent = String(history.length);
    if (!history.length) return target.append(message("No revision history available."));
    for (const revision of [...history].reverse().slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "m3-history-row";
      const label = document.createElement("strong");
      const time = document.createElement("time");
      label.textContent = `v${revision.version} · ${revision.action}`;
      time.textContent = dateText(revision.updatedAt) ?? "";
      row.append(label, time);
      target.append(row);
    }
  }

  function renderRetention(data) {
    const target = byId("m3-retention");
    const candidates = data?.plan?.candidates ?? [];
    target.hidden = candidates.length === 0;
    target.replaceChildren();
    if (!candidates.length) return;
    const copy = document.createElement("div");
    const list = document.createElement("div");
    copy.innerHTML = `<span class="m3-eyebrow">RETENTION REVIEW</span><h2>${candidates.length} candidate${candidates.length === 1 ? "" : "s"} need review</h2><p>Retention planning is advisory; no candidate is deleted automatically.</p>`;
    list.className = "m3-retention-list";
    for (const candidate of candidates.slice(0, 20)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${candidate.kind} · ${candidate.id}`;
      button.onclick = () => void selectNode(candidate.id);
      list.append(button);
    }
    target.append(copy, list);
  }

  function message(text) {
    const node = document.createElement("p");
    node.className = "m3-muted";
    node.textContent = text;
    return node;
  }

  function dateText(value) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : undefined;
  }

  function clearInspector() {
    byId("m3-inspector-empty").hidden = false;
    byId("m3-inspector-content").hidden = true;
  }

  function applyTransform() {
    byId("m3-viewport").setAttribute(
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

  const svg = byId("m3-graph");
  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".m3-node")) return;
    state.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.x,
      originY: state.y,
    };
    svg.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    state.x = state.drag.originX + event.clientX - state.drag.startX;
    state.y = state.drag.originY + event.clientY - state.drag.startY;
    applyTransform();
  });
  const endDrag = (event) => {
    if (state.drag?.pointerId === event.pointerId) state.drag = null;
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  byId("m3-fit").onclick = fit;
  byId("m3-zoom-in").onclick = () => zoom(1.2);
  byId("m3-zoom-out").onclick = () => zoom(0.82);
  byId("m3-refresh").onclick = () => void load();
  byId("m3-kind").onchange = () => void load({ preserveSelection: false });
  byId("m3-status").onchange = () => void load({ preserveSelection: false });
  byId("m3-close-inspector").onclick = () => {
    state.selectedId = null;
    clearInspector();
    for (const node of byId("m3-nodes").querySelectorAll(".m3-node"))
      node.classList.remove("selected");
  };
  byId("m3-search").oninput = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => void load({ preserveSelection: false }), 180);
  };

  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("#knowledge-view,[data-project-section='knowledge']");
    if (target) setTimeout(() => void load(), 0);
  });
  window.addEventListener("popstate", () => {
    if (!panel.hidden) void load();
  });
  window.addEventListener("odin:m2-location", () => {
    if (!panel.hidden) void load();
  });

  renderNoProject();
}
