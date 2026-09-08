const $ = (id) => document.getElementById(id);
let config = null;
let authProvider = "local";
const runningRequests = new Set();
let conversationId = null;
let active = null;
let stream = null;
let cursor = 0;
let sending = false;
let pendingRequest = null;
const changes = new Map();
const sources = new Map();
const terminal = new Set(["COMPLETED", "CANCELLED", "BLOCKED", "FAILED"]);

async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Odin-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message ?? "Request failed");
    error.status = response.status;
    if (response.status === 401 && !$("login").open) {
      resetSession();
      $("login").showModal();
    }
    throw error;
  }
  return data;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function errorBanner(error) {
  $("error-banner").textContent = error.message;
  $("error-banner").hidden = false;
}
function clearError() {
  $("error-banner").hidden = true;
}
function link(url, text) {
  const node = element("a", text);
  try {
    const parsed = new URL(url);
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
      node.href = parsed.href;
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    }
  } catch {
    /* Render invalid links as text. */
  }
  return node;
}
function inline(node, text, turnId) {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[S(\d+)\]|\*\*([^*]+)\*\*|`([^`]+)`/gu;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(document.createTextNode(text.slice(last, match.index)));
    if (match[1]) node.append(link(match[2], match[1]));
    else if (match[3]) {
      const source = sources.get(`${turnId}:S${match[3]}`);
      node.append(source ? link(source.url, `[S${match[3]}]`) : document.createTextNode(match[0]));
    } else if (match[4]) node.append(element("strong", match[4]));
    else node.append(element("code", match[5]));
    last = match.index + match[0].length;
  }
  node.append(document.createTextNode(text.slice(last)));
}
function markdown(text, turnId) {
  const fragment = document.createDocumentFragment();
  let code = null;
  let list = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      if (code) {
        fragment.append(code);
        code = null;
      } else code = element("pre", "");
      list = null;
      continue;
    }
    if (code) {
      code.textContent += `${line}\n`;
      continue;
    }
    if (/^[-*] /u.test(line)) {
      if (!list) {
        list = element("ul");
        fragment.append(list);
      }
      const item = element("li");
      inline(item, line.slice(2), turnId);
      list.append(item);
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    const node = element(heading ? "h3" : "p");
    inline(node, heading ? heading[2] : line, turnId);
    fragment.append(node);
  }
  if (code) fragment.append(code);
  return fragment;
}
function message(text, kind, turnId) {
  $("welcome").hidden = true;
  const nearBottom =
    $("messages").scrollHeight - $("messages").scrollTop - $("messages").clientHeight < 180;
  const article = element("article", undefined, `message ${kind}`);
  const label = element(
    "div",
    kind === "user" ? "You" : kind === "steering" ? "Your instruction" : "ODIN",
    "message-label",
  );
  article.append(label);
  if (kind === "assistant") article.append(markdown(text, turnId));
  else article.append(element("p", text));
  $("messages").append(article);
  if (nearBottom || kind === "user") $("messages").scrollTop = $("messages").scrollHeight;
}
function activity(text, at, failed = false) {
  $("activity-empty").hidden = true;
  const item = element("div", text, `activity-item${failed ? " failed" : ""}`);
  const date = new Date(at);
  item.append(element("time", date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
  $("activity").append(item);
  if ($("activity").children.length > 150) $("activity").firstElementChild.remove();
}
function updateControls() {
  const running = active && !terminal.has(active.state);
  $("task-controls").hidden = !running;
  $("pause").hidden = active?.state === "PAUSED";
  $("resume").hidden = active?.state !== "PAUSED";
  $("active-state").textContent =
    active?.state === "PAUSED"
      ? "Paused · progress saved"
      : "Working · send a message to steer the task";
  $("send").disabled = sending || !config?.models.length;
  $("send").setAttribute("aria-label", running ? "Send steering instruction" : "Send message");
  $("mode").disabled = running;
  $("model").disabled = running;
}
function renderEvent(event) {
  if (event.cursor <= cursor) return;
  cursor = event.cursor;
  const data = event.data;
  if (event.type === "message.user") message(data.text, "user");
  else if (event.type === "steering") message(data.text, "steering");
  else if (event.type === "answer") message(data.text, "assistant", event.turnId);
  else if (event.type === "state") {
    active = data;
    updateControls();
  } else if (event.type === "plan") {
    $("plan").replaceChildren();
    $("activity-empty").hidden = true;
    for (const step of data.steps ?? []) {
      const row = element("li", undefined, step.status);
      row.append(
        element(
          "span",
          step.status === "done" ? "✓" : step.status === "active" ? "→" : "·",
          "step-marker",
        ),
        element("span", step.title),
      );
      $("plan").append(row);
    }
  } else if (event.type === "activity") activity(data.message, event.createdAt);
  else if (event.type === "model.start") {
    $("call-count").textContent = `${data.call} / ${data.maxCalls} calls`;
    activity(
      data.role === "reviewer"
        ? "Independent review context"
        : `Generating · ${data.effort} effort`,
      event.createdAt,
    );
  } else if (event.type === "tool.start") activity(`Using ${data.name}`, event.createdAt);
  else if (event.type === "tool.end" && data.status === "failed")
    activity(data.message ?? "Tool failed", event.createdAt, true);
  else if (event.type === "error") {
    activity(data.message, event.createdAt, true);
    errorBanner(new Error(data.message));
  } else if (event.type === "usage") {
    $("token-count").textContent = data.totalTokens.toLocaleString();
    $("cost-status").textContent = "Cost not reported";
  } else if (event.type === "quality")
    activity(
      `Quality check ${data.passed ? "passed" : "failed"}: ${data.commandId}`,
      event.createdAt,
      !data.passed,
    );
  else if (event.type === "review") {
    const details = element("details");
    details.append(element("summary", "Review findings"), element("p", data.text));
    details.className = "activity-item";
    $("activity").append(details);
  } else if (event.type === "verification") {
    $("verification").hidden = false;
    $("verification").classList.toggle("failed", data.outcome !== "PASS");
    $("verification").textContent =
      `${data.outcome === "PASS" ? "Checks passed" : "Verification incomplete"}. ${data.scope}${data.failures?.length ? `. ${data.failures.join(". ")}` : ""}`;
  } else if (event.type === "source") {
    if (!sources.size) $("sources").append(element("h3", "Sources"));
    sources.set(`${event.turnId}:${data.id}`, data);
    const source = link(data.url, `${data.id} · ${data.title}`);
    source.className = "source-link";
    source.append(element("small", new URL(data.url).hostname));
    $("sources").append(source);
  } else if (event.type === "file.changed") {
    changes.set(data.path, data);
    renderFiles();
  }
}
function renderFiles() {
  $("files").replaceChildren();
  $("preview-file").replaceChildren(element("option", "Choose an HTML file"));
  for (const [path, change] of changes) {
    const button = element("button", path, "file-button");
    button.type = "button";
    button.onclick = () => {
      $("diff").textContent = `--- ${path} (before)\n${(change.before ?? "")
        .split("\n")
        .map((line) => `- ${line}`)
        .join("\n")}\n+++ ${path} (after)\n${change.after
        .split("\n")
        .map((line) => `+ ${line}`)
        .join("\n")}`;
    };
    $("files").append(button);
    if (/\.html?$/iu.test(path)) {
      const option = element("option", path);
      option.value = path;
      $("preview-file").append(option);
    }
  }
}
async function loadConversations() {
  const data = await api("/api/conversations");
  $("conversation-list").replaceChildren();
  $("conversation-count").textContent = data.conversations.length;
  for (const item of data.conversations) {
    const button = element(
      "button",
      item.title,
      `conversation-link${item.id === conversationId ? " current" : ""}`,
    );
    button.type = "button";
    button.onclick = () => openConversation(item.id).catch(errorBanner);
    $("conversation-list").append(button);
  }
  return data.conversations;
}
function resetConversation() {
  stream?.close();
  stream = null;
  cursor = 0;
  active = null;
  changes.clear();
  sources.clear();
  for (const child of [...$("messages").children]) if (child.id !== "welcome") child.remove();
  $("welcome").hidden = false;
  $("activity-empty").hidden = false;
  for (const id of ["activity", "plan", "sources", "files"]) $(id).replaceChildren();
  $("verification").hidden = true;
  $("diff").textContent = "";
  $("preview").removeAttribute("srcdoc");
  $("preview").removeAttribute("src");
  $("call-count").textContent = "—";
  $("token-count").textContent = "0";
  updateControls();
}
function resetSession() {
  config = null;
  resetConversation();
  conversationId = null;
  pendingRequest = null;
  $("conversation-list").replaceChildren();
  $("prompt").value = "";
  $("page-title").textContent = "Odin";
  $("connection").textContent = "Sign in required";
  $("connection-details").close();
}
async function openConversation(id) {
  document.querySelector(".shell").classList.remove("show-history");
  clearError();
  resetConversation();
  conversationId = id;
  showChat();
  const data = await api(`/api/conversations/${id}`);
  if (conversationId !== id) return;
  active = data.turns.at(-1) ?? null;
  $("page-title").textContent = data.conversation.title;
  stream = new EventSource(`/api/conversations/${id}/events?after=0`);
  stream.onopen = () => {
    $("connection").textContent = "Connected";
  };
  stream.onerror = () => {
    $("connection").textContent = "Reconnecting";
  };
  stream.onmessage = (event) => {
    if (conversationId === id) {
      try {
        renderEvent(JSON.parse(event.data));
      } catch {
        errorBanner(
          new Error("A live event could not be displayed. Reopen the conversation to resync."),
        );
      }
    }
  };
  updateControls();
  if (active?.state === "CREATED") startExecution(active);
  await loadConversations();
}
function showChat() {
  $("benchmarks").hidden = true;
  $("chat-layout").hidden = false;
  $("chat-view").classList.add("selected");
  $("benchmark-view").classList.remove("selected");
}
async function initialize() {
  config = await api("/api/config");
  $("model").replaceChildren();
  if (!config.models.length) {
    const option = element("option", "No model connected");
    option.value = "";
    $("model").append(option);
  }
  for (const model of config.models) {
    const option = element("option", model.label);
    option.value = model.id;
    $("model").append(option);
  }
  $("workspace-status").textContent = config.workspace
    ? config.workspace.writable
      ? "Workspace connected"
      : "Workspace · read only"
    : "No workspace connected";
  $("connection").textContent = "Connected";
  updateControls();
  updateMode();
  const conversations = await loadConversations();
  if (conversations.length) await openConversation(conversationId ?? conversations[0].id);
}
function updateMode() {
  $("mode-description").textContent =
    config?.modes.find((mode) => mode.id === $("mode").value)?.description ??
    "Choose how Odin approaches the work.";
}

$("composer").onsubmit = async (event) => {
  event.preventDefault();
  if (sending) return;
  const text = $("prompt").value.trim();
  if (!text) return;
  sending = true;
  clearError();
  updateControls();
  try {
    if (active && !terminal.has(active.state)) await api(`/api/turns/${active.id}/steer`, { text });
    else {
      if (!conversationId) {
        const item = await api("/api/conversations", { title: text.slice(0, 90) });
        await openConversation(item.id);
      }
      const identity = JSON.stringify({
        conversationId,
        text,
        mode: $("mode").value,
        modelId: $("model").value,
      });
      if (pendingRequest?.identity !== identity)
        pendingRequest = { identity, requestId: crypto.randomUUID() };
      active = await api(`/api/conversations/${conversationId}/turns`, {
        text,
        mode: $("mode").value,
        modelId: $("model").value,
        requestId: pendingRequest.requestId,
      });
      pendingRequest = null;
      startExecution(active);
    }
    $("prompt").value = "";
  } catch (error) {
    errorBanner(error);
  } finally {
    sending = false;
    updateControls();
  }
};
$("prompt").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
};
$("new-chat").onclick = () => {
  conversationId = null;
  pendingRequest = null;
  resetConversation();
  showChat();
  $("page-title").textContent = "Chathub";
  $("prompt").focus();
};
$("chat-view").onclick = showChat;
$("mode").onchange = updateMode;
for (const button of document.querySelectorAll("[data-prompt]"))
  button.onclick = () => {
    $("mode").value = button.dataset.mode;
    $("prompt").value = button.dataset.prompt;
    updateMode();
    $("prompt").focus();
  };
for (const command of ["pause", "resume", "cancel"])
  $(command).onclick = async () => {
    if (!active) return;
    clearError();
    try {
      active = await api(`/api/turns/${active.id}`);
      active = await api(`/api/turns/${active.id}/control`, {
        command,
        expectedVersion: active.version,
      });
      if (command === "resume") startExecution(active);
      updateControls();
    } catch (error) {
      errorBanner(error);
    }
  };
$("activity-toggle").onclick = () => {
  const mobile = matchMedia("(max-width: 900px)").matches;
  $("chat-layout").classList.toggle(mobile ? "show-mobile-inspector" : "hide-inspector");
  if (!mobile) $("inspector").hidden = $("chat-layout").classList.contains("hide-inspector");
  $("activity-toggle").setAttribute(
    "aria-expanded",
    String(
      mobile
        ? $("chat-layout").classList.contains("show-mobile-inspector")
        : !$("inspector").hidden,
    ),
  );
};
for (const button of document.querySelectorAll("[data-tab]"))
  button.onclick = () => {
    for (const tab of document.querySelectorAll("[data-tab]")) {
      const selected = tab === button;
      tab.setAttribute("aria-selected", String(selected));
      $(`${tab.dataset.tab}-panel`).hidden = !selected;
    }
  };
$("preview-file").onchange = () => {
  const change = changes.get($("preview-file").value);
  if (!change) {
    $("preview").removeAttribute("srcdoc");
    $("preview").removeAttribute("src");
    return;
  }
  $("preview").removeAttribute("srcdoc");
  $("preview").src =
    `/api/conversations/${conversationId}/preview?file=${encodeURIComponent($("preview-file").value)}`;
};
$("settings").onclick = () => {
  $("details-body").replaceChildren(
    element(
      "p",
      config?.workspace
        ? `Workspace ${config.workspace.writable ? "read and write" : "read only"}. Quality checks: ${config.quality.map((command) => command.label).join(", ") || "none configured"}.`
        : "No workspace is connected.",
    ),
    element("p", `Research: ${config?.research ?? "not connected"}.`),
    element(
      "p",
      `Models: ${config?.models.map((model) => model.label).join(", ") || "none configured; provider credentials must be configured on the server"}.`,
    ),
  );
  $("connection-details").showModal();
};
$("close-details").onclick = () => $("connection-details").close();
$("sign-out").onclick = async () => {
  try {
    await api("/api/session", {}, "DELETE");
    resetSession();
    $("login").showModal();
  } catch (error) {
    errorBanner(error);
  }
};
$("login").addEventListener("cancel", (event) => event.preventDefault());
function updateAuthForm() {
  const neon = authProvider === "neon";
  const action = $("auth-action").value;
  $("neon-auth-fields").hidden = !neon;
  $("auth-email").required = neon;
  $("auth-help").textContent = neon
    ? "Your account is protected by Neon Auth. Verify your email to continue."
    : "Enter the access token for your Odin server.";
  $("password-label").textContent = neon ? "Password" : "Server access token";
  const password = !neon || ["login", "signup", "reset"].includes(action);
  $("auth-password-field").hidden = !password;
  $("access-token").required = password;
  $("access-token").disabled = !password;
  $("access-token").minLength = neon && ["signup", "reset"].includes(action) ? 14 : 1;
  $("access-token").autocomplete = action === "login" ? "current-password" : "new-password";
  $("auth-name-field").hidden = action !== "signup";
  $("auth-code-field").hidden = !["verify", "reset"].includes(action);
  $("auth-code").required = ["verify", "reset"].includes(action);
  $("auth-code").disabled = !$("auth-code").required;
  $("auth-send-code").hidden = action !== "verify";
  $("auth-submit").textContent = neon
    ? $("auth-action").selectedOptions[0].textContent
    : "Open workspace";
}
$("auth-action").onchange = updateAuthForm;
$("auth-send-code").onclick = async () => {
  try {
    await api("/api/auth/sendCode", { email: $("auth-email").value });
    $("login-error").textContent = "Check your inbox for the verification code.";
  } catch (error) {
    $("login-error").textContent = error.message;
  }
};
$("login-form").onsubmit = async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  $("auth-submit").disabled = true;
  try {
    if (authProvider === "neon") {
      const action = $("auth-action").value;
      const body = { email: $("auth-email").value };
      if (["login", "signup", "reset"].includes(action)) body.password = $("access-token").value;
      if (action === "signup") body.name = $("auth-name").value;
      if (["verify", "reset"].includes(action)) body.otp = $("auth-code").value;
      await api(`/api/auth/${action}`, body);
      $("access-token").value = "";
      $("auth-code").value = "";
      if (action !== "login") {
        $("auth-action").value =
          action === "signup" ? "verify" : action === "forgot" ? "reset" : "login";
        updateAuthForm();
        $("login-error").textContent =
          action === "signup"
            ? "Account created. Request an email code to verify it."
            : action === "forgot"
              ? "If an account exists, a reset code will arrive by email."
              : "Done. You can now sign in.";
        return;
      }
    } else await api("/api/session", { token: $("access-token").value });
    $("access-token").value = "";
    await initialize();
    $("login").close();
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally {
    $("auth-submit").disabled = false;
  }
};
function startExecution(turn) {
  if (
    config?.execution !== "request" ||
    runningRequests.has(turn.id) ||
    terminal.has(turn.state) ||
    turn.state === "PAUSED"
  )
    return;
  runningRequests.add(turn.id);
  api(`/api/turns/${turn.id}/run`, {})
    .catch((error) => {
      if (error.status !== 409) errorBanner(error);
    })
    .finally(() => runningRequests.delete(turn.id));
}
$("history-toggle").onclick = () => {
  const open = document.querySelector(".shell").classList.toggle("show-history");
  $("history-toggle").setAttribute("aria-expanded", String(open));
};
$("benchmark-view").onclick = async () => {
  $("chat-layout").hidden = true;
  $("benchmarks").hidden = false;
  $("page-title").textContent = "Benchmarks";
  $("benchmark-view").classList.add("selected");
  $("chat-view").classList.remove("selected");
  try {
    const evidence = await api("/api/benchmarks");
    const target = $("benchmark-content");
    target.replaceChildren();
    const comparison = evidence.modelComparison;
    target.append(element("h2", "Kimi alone and Kimi with Odin"));
    if (comparison?.summary) {
      const summary = comparison.summary;
      const complete = comparison.cases.filter(
        (item) => item.baseline.complete && item.odin.complete,
      );
      const tokens = (arm) =>
        complete.reduce((total, item) => total + item[arm].usage.totalTokens, 0);
      target.append(
        element(
          "p",
          `${comparison.status} · ${summary.completePairs} of ${summary.totalCases} complete task pairs.`,
          "muted",
        ),
        element(
          "p",
          `Correct answers: Kimi ${summary.baselinePassed}/${summary.completePairs}; Kimi with Odin ${summary.odinPassed}/${summary.completePairs}.`,
        ),
        element(
          "p",
          `Tokens on complete pairs: Kimi ${tokens("baseline").toLocaleString()}; Odin ${tokens("odin").toLocaleString()}. One baseline call versus up to four Odin calls per task.`,
        ),
        element(
          "p",
          "This acquisition shows no accuracy improvement. The third pair was blocked by provider limits. Three small exact-answer tasks cannot establish general coding or reasoning performance.",
          "muted",
        ),
      );
      const modelTable = element("table");
      const modelHead = element("tr");
      for (const label of ["Task", "Kimi alone", "Kimi with Odin"])
        modelHead.append(element("th", label));
      modelTable.append(modelHead);
      for (const item of comparison.cases) {
        const row = element("tr");
        row.append(element("td", item.id));
        for (const arm of [item.baseline, item.odin])
          row.append(
            element(
              "td",
              arm.complete ? (arm.passed ? "Correct" : "Incorrect") : `Not measured (${arm.state})`,
            ),
          );
        modelTable.append(row);
      }
      target.append(
        modelTable,
        link(
          `https://github.com/clarityosbaerbelwesterop-gif/Odin-Agent-/actions/runs/${comparison.runId}`,
          "Open model comparison run",
        ),
      );
    } else target.append(element("p", "No measured model comparison is available.", "muted"));
    target.append(element("h2", "Earlier M16 coding protocol comparison"));
    const result = evidence.protocolComparison;
    if (!result?.selectedSummary) {
      target.append(element("p", "No historical protocol evidence is available.", "muted"));
      return;
    }
    const value = result.selectedSummary;
    const grid = element("div", undefined, "benchmark-grid");
    for (const [title, metric, detail] of [
      [
        "Tasks completed",
        `${value.candidateCompleted} / ${value.completePairs}`,
        `M16 baseline: ${value.baselineCompleted} / ${value.completePairs}`,
      ],
      [
        "Fewer tokens",
        `${(value.tokenReductionBps / 100).toFixed(1)}%`,
        "Matched measurable tasks only",
      ],
      [
        "Quality difference",
        `+${(value.qualityLiftBps / 100).toFixed(1)} pp`,
        "Small coding protocol comparison",
      ],
    ]) {
      const card = element("div", undefined, "metric-card");
      card.append(element("span", title), element("strong", metric), element("small", detail));
      grid.append(card);
    }
    target.append(
      grid,
      element(
        "p",
        "Scope: the older M16 full-file protocol versus Odin's grounded surgical edits, using Kimi. This is not a model-alone benchmark and does not validate the new Chathub or all intelligence domains.",
        "muted",
      ),
    );
    const table = element("table");
    const heading = element("tr");
    for (const label of ["Acquisition", "Status", "Complete pairs", "Provider calls"])
      heading.append(element("th", label));
    table.append(heading);
    for (const attempt of result.attempts ?? []) {
      const row = element("tr");
      for (const value of [
        attempt.acquisition,
        attempt.summary.status,
        attempt.summary.completePairs,
        attempt.providerCalls,
      ])
        row.append(element("td", String(value)));
      table.append(row);
    }
    target.append(
      table,
      element(
        "p",
        `Both acquisitions are retained. Total provider calls: ${result.totalProviderCalls}. Selected by a fixed first-complete acquisition rule. Routing and skill promotion remain disabled for this evidence.`,
        "muted",
      ),
      link(
        `https://github.com/clarityosbaerbelwesterop-gif/Odin-Agent-/actions/runs/${result.source.runId}`,
        "Open original GitHub run",
      ),
    );
  } catch (error) {
    errorBanner(error);
  }
};

const requestedMode = new URLSearchParams(window.location.search).get("mode");
if (["chat", "coding", "thinking", "research", "ultra"].includes(requestedMode))
  $("mode").value = requestedMode;
updateControls();
api("/api/auth/config")
  .then((result) => {
    authProvider = result.provider;
    updateAuthForm();
    return initialize();
  })
  .catch((error) => {
    $("connection").textContent =
      error.status === 401 ? "Sign in required" : "Connection unavailable";
    updateControls();
    if (error.status !== 401) errorBanner(error);
  });
