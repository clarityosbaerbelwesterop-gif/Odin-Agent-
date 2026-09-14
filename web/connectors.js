const connectorCss = document.createElement("link");
connectorCss.rel = "stylesheet";
connectorCss.href = "/connectors.css";
document.head.append(connectorCss);

const modelPanel = document.getElementById("models-panel");
const connectorRoot = document.createElement("section");
connectorRoot.className = "connector-hub";
connectorRoot.innerHTML = `<header><span class="welcome-tag">MCP CONNECTIONS</span><h2>Tools Odin can actually use.</h2><p>OAuth tokens stay server-side. External MCP text is untrusted; high-impact actions pause for your approval.</p></header><div id="connector-grid" class="connector-grid"></div><div id="connector-status" class="connector-status" role="status"></div>`;
modelPanel?.append(connectorRoot);

const cState = { catalog: [] };
function cNode(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}
async function cApi(path, body, method = body === undefined ? "GET" : "POST") {
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
  if (!response.ok) throw new Error(data.message ?? "Connector request failed.");
  return data;
}
function cStatus(text, error = false) {
  const target = document.getElementById("connector-status");
  target.textContent = text;
  target.dataset.state = error ? "error" : "ok";
}
function endpointInput(descriptor) {
  if (!descriptor.endpointRequired && descriptor.id !== "neon") return null;
  const input = cNode("input");
  input.type = "url";
  input.placeholder =
    descriptor.id === "neon"
      ? "Optional official Neon MCP override"
      : "https://your-mcp.example.com/mcp";
  input.autocomplete = "off";
  input.setAttribute("aria-label", `${descriptor.name} MCP endpoint`);
  return input;
}
function connectorCard(descriptor) {
  const card = cNode("article", undefined, "connector-card");
  const eyebrow = cNode(
    "span",
    `${descriptor.trust === "official" ? "OFFICIAL" : "COMMUNITY"} · ${descriptor.category}`,
    "connector-eyebrow",
  );
  const title = cNode("h3", descriptor.name);
  const copy = cNode("p", descriptor.description);
  const note = cNode(
    "small",
    descriptor.safetyNote ?? "External tool output remains untrusted.",
    "connector-note",
  );
  const endpoint = endpointInput(descriptor);
  const key = descriptor.authModes.includes("api_key") ? cNode("input") : null;
  if (key) {
    key.type = "password";
    key.autocomplete = "off";
    key.placeholder = "Optional bearer token / API key";
    key.setAttribute("aria-label", `${descriptor.name} bearer token`);
  }
  const actions = cNode("div", undefined, "connector-actions");
  const connected = descriptor.connections ?? [];
  if (connected.length) {
    for (const connection of connected) {
      const badge = cNode(
        "span",
        `${connection.status} · ${connection.authMode}`,
        "connector-connected",
      );
      const tools = cNode("button", "Refresh tools");
      tools.type = "button";
      tools.onclick = async () => {
        tools.disabled = true;
        try {
          const result = await cApi(
            `/api/connectors/connections/${encodeURIComponent(connection.id)}/refresh`,
            {},
          );
          cStatus(`${descriptor.name}: ${result.tools?.length ?? 0} tools available.`);
        } catch (error) {
          cStatus(error.message, true);
        } finally {
          tools.disabled = false;
        }
      };
      const disconnect = cNode("button", "Disconnect");
      disconnect.type = "button";
      disconnect.onclick = async () => {
        try {
          await cApi(
            `/api/connectors/connections/${encodeURIComponent(connection.id)}`,
            {},
            "DELETE",
          );
          await loadConnectors();
        } catch (error) {
          cStatus(error.message, true);
        }
      };
      actions.append(badge, tools, disconnect);
    }
  } else {
    if (descriptor.id === "neon") {
      const access = cNode("select");
      access.setAttribute("aria-label", "Neon access level");
      for (const [value, label] of [
        ["read", "Read-only (recommended)"],
        ["write", "Read + write (approval required)"],
      ]) {
        const option = cNode("option", label);
        option.value = value;
        access.append(option);
      }
      actions.append(access);
    }
    const connect = cNode("button", "Connect");
    connect.type = "button";
    connect.onclick = async () => {
      connect.disabled = true;
      try {
        const body = {};
        const customEndpoint = endpoint?.value.trim();
        if (customEndpoint) body.endpoint = customEndpoint;
        if (descriptor.id === "neon") {
          const access = actions.querySelector("select")?.value ?? "read";
          body.authMode = "oauth";
          body.endpoint =
            access === "write"
              ? "https://mcp.neon.tech/mcp"
              : "https://mcp.neon.tech/mcp?readonly=true";
          body.scopes = access === "write" ? ["read", "write"] : ["read"];
        } else if (descriptor.id === "linkedin") {
          body.authMode = key?.value ? "api_key" : "none";
          if (key?.value) body.apiKey = key.value;
        } else body.authMode = "oauth";
        const result = await cApi(
          `/api/connectors/${encodeURIComponent(descriptor.id)}/connect`,
          body,
        );
        if (result.authorization?.authorizationUrl)
          location.assign(result.authorization.authorizationUrl);
        else {
          cStatus(`${descriptor.name} connected.`);
          await loadConnectors();
        }
      } catch (error) {
        cStatus(error.message, true);
      } finally {
        connect.disabled = false;
      }
    };
    actions.append(connect);
  }
  card.append(eyebrow, title, copy);
  if (endpoint) card.append(endpoint);
  if (key) card.append(key);
  card.append(note, actions);
  return card;
}
async function loadConnectors() {
  const grid = document.getElementById("connector-grid");
  if (!grid) return;
  grid.replaceChildren(cNode("p", "Loading connections…", "muted"));
  try {
    const data = await cApi("/api/connectors");
    cState.catalog = data.connectors ?? [];
    grid.replaceChildren(...cState.catalog.map(connectorCard));
    cStatus(
      `${cState.catalog.filter((item) => item.connections?.length).length} connector types connected.`,
    );
  } catch (error) {
    grid.replaceChildren(cNode("p", error.message, "muted"));
  }
}

document.getElementById("models-view")?.addEventListener("click", () => void loadConnectors());
if (new URLSearchParams(location.search).get("connected") === "1") {
  setTimeout(() => document.getElementById("models-view")?.click(), 0);
}
