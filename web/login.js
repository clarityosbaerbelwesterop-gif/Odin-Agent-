const $ = (id) => document.getElementById(id);
const allowedModes = new Set(["login", "signup", "verify", "forgot", "reset"]);
const VERIFIER_PARAM = "neon_auth_session_verifier";
const LAST_EMAIL_KEY = "odin.auth.last-email";
let mode = "login";
let authConfig = null;
let busy = false;

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value) return "/app";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/app"))
      return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Ignore malformed or cross-origin redirect targets.
  }
  return "/app";
}

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
    // Public auth errors must remain usable even if an upstream returns no JSON body.
  }
  if (!response.ok) {
    const error = new Error(data.message ?? "Anmeldung konnte nicht abgeschlossen werden.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

function githubAuthBase() {
  const value = authConfig?.oauth?.github?.authBase;
  if (typeof value !== "string") throw new Error("GitHub Login ist nicht verfügbar.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".neon.tech") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Unsichere Auth-Konfiguration wurde blockiert.");
  return url.href.replace(/\/$/u, "");
}

function githubRedirectTarget(value) {
  if (typeof value !== "string") throw new Error("GitHub Login konnte nicht gestartet werden.");
  const target = new URL(value);
  const authBase = new URL(githubAuthBase());
  const isNeonRedirect =
    target.protocol === "https:" &&
    target.hostname === authBase.hostname &&
    target.pathname.startsWith(authBase.pathname);
  const isGitHubAuthorize =
    target.protocol === "https:" &&
    target.hostname === "github.com" &&
    target.pathname === "/login/oauth/authorize";
  if ((!isNeonRedirect && !isGitHubAuthorize) || target.username || target.password || target.hash)
    throw new Error("Unsicheres Login-Ziel wurde blockiert.");
  return target.href;
}

async function neonAuth(path, init = {}) {
  return fetch(`${githubAuthBase()}${path}`, {
    credentials: "include",
    redirect: "manual",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
}

function status(text = "", kind = "") {
  $("auth-status").textContent = text;
  $("auth-status").className = `status${kind ? ` ${kind}` : ""}`;
}

function setBusy(next) {
  busy = next;
  $("auth-submit").disabled = next;
  $("github-signin").disabled = next;
  $("send-code").disabled = next;
  $("switch-mode").disabled = next;
  $("forgot-password").disabled = next;
  $("auth-submit").textContent = next ? "Bitte warten …" : submitLabel();
}

function submitLabel() {
  return {
    login: "Anmelden",
    signup: "Konto erstellen",
    verify: "E-Mail bestätigen",
    forgot: "Reset-Code anfordern",
    reset: "Neues Passwort speichern",
  }[mode];
}

function setFieldVisible(id, visible) {
  const field = $(id);
  field.hidden = !visible;
  field.style.display = visible ? "" : "none";
}

function renderMode() {
  const content = {
    login: [
      "WILLKOMMEN ZURÜCK",
      "Bei Odin anmelden",
      "Öffne deinen Workspace und setze deine Missionen fort.",
    ],
    signup: [
      "NEUES KONTO",
      "Odin Account erstellen",
      "Erstelle deine Identity. Danach bestätigst du deine E-Mail.",
    ],
    verify: [
      "E-MAIL BESTÄTIGEN",
      "Konto verifizieren",
      "Gib den sechsstelligen Code aus deiner E-Mail ein.",
    ],
    forgot: [
      "PASSWORT RESET",
      "Zugang wiederherstellen",
      "Wir senden einen Reset-Code, wenn für die Adresse ein Konto existiert.",
    ],
    reset: [
      "NEUES PASSWORT",
      "Passwort neu setzen",
      "Gib den Reset-Code und ein neues Passwort mit mindestens 14 Zeichen ein.",
    ],
  }[mode];
  $("form-eyebrow").textContent = content[0];
  $("login-title").textContent = content[1];
  $("form-copy").textContent = content[2];
  setFieldVisible("name-field", mode === "signup");
  setFieldVisible("code-field", ["verify", "reset"].includes(mode));
  setFieldVisible("password-field", !["verify", "forgot"].includes(mode));
  $("forgot-password").hidden = mode !== "login";
  $("send-code").hidden = mode !== "verify";
  $("auth-name").required = mode === "signup";
  $("auth-code").required = ["verify", "reset"].includes(mode);
  $("auth-password").required = !["verify", "forgot"].includes(mode);
  $("auth-password").minLength = ["signup", "reset"].includes(mode) ? 14 : 1;
  $("auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-submit").textContent = submitLabel();
  $("switch-row").firstChild.textContent =
    mode === "login" ? "Noch kein Konto? " : "Zurück zur Anmeldung? ";
  $("switch-mode").textContent = mode === "login" ? "Registrieren" : "Anmelden";
  status();
}

function applyMode(next) {
  if (!allowedModes.has(next)) return;
  mode = next;
  renderMode();
  if (mode === "verify") $("auth-code").focus();
  else $("auth-email").focus();
}

function setMode(next) {
  if (busy) return;
  applyMode(next);
}

function rememberEmail(email) {
  if (!email) return;
  try {
    window.sessionStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // Authentication must not depend on browser storage availability.
  }
}

function restoreRememberedEmail() {
  if ($("auth-email").value) return;
  try {
    const email = window.sessionStorage.getItem(LAST_EMAIL_KEY);
    if (email) $("auth-email").value = email;
  } catch {
    // Ignore unavailable session storage.
  }
}

async function clearIncompleteSession() {
  try {
    await request("/api/auth/logout", {});
  } catch {
    // A stale incomplete session must never prevent the login surface from recovering.
  }
}

async function sendVerificationCode(email) {
  await request("/api/auth/sendCode", { email });
  applyMode("verify");
  status("Bestätigungscode wurde angefordert. Prüfe dein Postfach.", "success");
}

async function handleUnverifiedEmail(email) {
  rememberEmail(email);
  await clearIncompleteSession();
  applyMode("verify");
  try {
    await request("/api/auth/sendCode", { email });
    status("Deine E-Mail ist noch nicht bestätigt. Wir haben einen neuen Code gesendet.", "error");
  } catch {
    status(
      "Deine E-Mail ist noch nicht bestätigt. Nutze „Code senden“, um einen neuen Code anzufordern.",
      "error",
    );
  }
}

async function restoreSession() {
  try {
    await request("/api/config");
    window.location.replace(safeReturnTo());
    return true;
  } catch (error) {
    if (error.code === "EMAIL_UNVERIFIED") {
      restoreRememberedEmail();
      const email = $("auth-email").value.trim();
      await clearIncompleteSession();
      applyMode("verify");
      if (email) {
        try {
          await request("/api/auth/sendCode", { email });
          status(
            "Deine E-Mail ist noch nicht bestätigt. Wir haben einen neuen Code gesendet.",
            "error",
          );
        } catch {
          status("Deine E-Mail ist noch nicht bestätigt. Fordere einen neuen Code an.", "error");
        }
      } else {
        status(
          "Deine E-Mail ist noch nicht bestätigt. Gib deine E-Mail ein und fordere einen Code an.",
          "error",
        );
      }
    } else if (error.status !== 401) {
      status(error.message, "error");
    }
    return false;
  }
}

async function restoreGitHubSession(requireVerifier = false) {
  const github = authConfig?.oauth?.github;
  if (github?.available !== true) return false;
  const params = new URLSearchParams(window.location.search);
  const verifier = params.get(VERIFIER_PARAM);
  if (requireVerifier && !verifier) return false;
  const route = verifier
    ? `/get-session?${encodeURIComponent(VERIFIER_PARAM)}=${encodeURIComponent(verifier)}`
    : "/get-session";
  const response = await neonAuth(route, { method: "GET" });
  if (!response.ok) {
    if (verifier) throw new Error("GitHub Login konnte nicht abgeschlossen werden.");
    return false;
  }
  let token = response.headers.get("set-auth-jwt");
  if (!token) {
    const tokenResponse = await neonAuth("/token", { method: "GET" });
    const tokenData = tokenResponse.ok ? await tokenResponse.json().catch(() => ({})) : {};
    token = tokenData?.token;
  }
  if (typeof token !== "string" || !token) {
    if (verifier) throw new Error("Neon hat keine gültige Login-Session zurückgegeben.");
    return false;
  }
  await request("/api/auth/github/finalize", { token });
  if (verifier) {
    const clean = new URL(window.location.href);
    clean.searchParams.delete(VERIFIER_PARAM);
    clean.searchParams.delete("oauth");
    clean.searchParams.delete("error");
    clean.searchParams.delete("error_description");
    window.history.replaceState(window.history.state, "", clean.href);
  }
  window.location.replace(safeReturnTo());
  return true;
}

function renderOAuthError(params) {
  if (params.get("oauth") !== "error") return;
  const code = params.get("error") ?? params.get("error_code") ?? "";
  if (["account_not_linked", "email_not_verified", "email_not_verified_error"].includes(code)) {
    restoreRememberedEmail();
    applyMode("verify");
    status(
      "Dieses GitHub-Konto gehört zu einem noch nicht bestätigten Odin-Konto. Bestätige zuerst deine E-Mail und starte GitHub danach erneut.",
      "error",
    );
    return;
  }
  if (code === "access_denied") {
    status("GitHub-Autorisierung wurde abgebrochen.", "error");
    return;
  }
  status(
    code ? `GitHub Login fehlgeschlagen (${code}).` : "GitHub Login wurde nicht abgeschlossen.",
    "error",
  );
}

async function initialize() {
  setBusy(true);
  try {
    authConfig = await request("/api/auth/config");
    restoreRememberedEmail();
    if (await restoreSession()) return;
    const params = new URLSearchParams(window.location.search);
    const explicitSignOut = params.get("signedOut") === "1";
    if (!explicitSignOut && params.has(VERIFIER_PARAM) && (await restoreGitHubSession(true)))
      return;
    const github = authConfig?.oauth?.github;
    if (github?.available === true) {
      $("github-note").textContent =
        "Melde dich mit GitHub an. Repository-Zugriff wird separat und nur bei Bedarf freigegeben.";
    } else {
      $("github-note").textContent =
        "GitHub Login ist für dieses Deployment nicht verfügbar. E-Mail Login funktioniert weiterhin.";
    }
    renderOAuthError(params);
  } catch (error) {
    status(error.message, "error");
  } finally {
    setBusy(false);
  }
}

$("github-signin").addEventListener("click", async () => {
  if (busy) return;
  const github = authConfig?.oauth?.github;
  if (github?.available !== true) {
    status("GitHub Login ist für dieses Deployment nicht verfügbar.", "error");
    return;
  }
  const email = $("auth-email").value.trim();
  rememberEmail(email);
  setBusy(true);
  status("GitHub wird geöffnet …");
  try {
    const callback = new URL("/login", window.location.origin);
    callback.searchParams.set("returnTo", safeReturnTo());
    const errorCallback = new URL(callback.href);
    errorCallback.searchParams.set("oauth", "error");
    const response = await neonAuth("/sign-in/social", {
      method: "POST",
      body: JSON.stringify({
        provider: "github",
        callbackURL: callback.href,
        errorCallbackURL: errorCallback.href,
        disableRedirect: true,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.url !== "string")
      throw new Error("GitHub Login konnte nicht gestartet werden.");
    window.location.assign(githubRedirectTarget(data.url));
  } catch (error) {
    status(error.message, "error");
    setBusy(false);
  }
});

$("switch-mode").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
$("forgot-password").addEventListener("click", () => setMode("forgot"));

$("send-code").addEventListener("click", async () => {
  if (busy) return;
  const email = $("auth-email").value.trim();
  if (!email || !$("auth-email").checkValidity()) {
    $("auth-email").reportValidity();
    return;
  }
  rememberEmail(email);
  setBusy(true);
  try {
    await sendVerificationCode(email);
  } catch (error) {
    status(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const otp = $("auth-code").value.trim();
  const name = $("auth-name").value.trim();
  for (const input of $("auth-form").querySelectorAll("input"))
    input.removeAttribute("aria-invalid");
  if (!$("auth-form").checkValidity()) {
    $("auth-form").reportValidity();
    return;
  }
  rememberEmail(email);
  setBusy(true);
  status();
  try {
    const body = { email };
    if (!["verify", "forgot"].includes(mode)) body.password = password;
    if (mode === "signup") body.name = name;
    if (["verify", "reset"].includes(mode)) body.otp = otp;
    await request(`/api/auth/${mode}`, body);
    if (mode === "login") {
      try {
        await request("/api/config");
        status("Angemeldet. Workspace wird geöffnet …", "success");
        window.location.replace(safeReturnTo());
      } catch (error) {
        if (error.code === "EMAIL_UNVERIFIED") await handleUnverifiedEmail(email);
        else throw error;
      }
      return;
    }
    if (mode === "signup") {
      $("auth-password").value = "";
      await clearIncompleteSession();
      applyMode("verify");
      try {
        await request("/api/auth/sendCode", { email });
        status("Konto erstellt. Der Bestätigungscode wurde per E-Mail gesendet.", "success");
      } catch {
        status(
          "Konto erstellt. Der Code konnte nicht automatisch gesendet werden. Nutze „Code senden“.",
          "error",
        );
      }
    } else if (mode === "forgot") {
      applyMode("reset");
      status("Wenn ein Konto existiert, wurde ein Reset-Code gesendet.", "success");
    } else if (mode === "verify") {
      $("auth-code").value = "";
      applyMode("login");
      status("E-Mail bestätigt. Du kannst dich jetzt anmelden.", "success");
    } else if (mode === "reset") {
      $("auth-password").value = "";
      $("auth-code").value = "";
      applyMode("login");
      status("Passwort aktualisiert. Du kannst dich jetzt anmelden.", "success");
    }
  } catch (error) {
    status(error.message, "error");
  } finally {
    setBusy(false);
  }
});

renderMode();
void initialize();
