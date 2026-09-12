const RECOVERY_KEY = "odin.auth.github-recovery";
const STATE_RETRY_KEY = "odin.auth.github-state-retry";
const LAST_EMAIL_KEY = "odin.auth.last-email";
const ATTEMPT_EMAIL_KEY = "odin.auth.github-attempt-email";
const RECOVERABLE_ERRORS = new Set([
  "account_not_linked",
  "email_not_verified",
  "email_not_verified_error",
]);

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value) return "/app";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/app"))
      return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Ignore malformed or cross-origin targets.
  }
  return "/app";
}

function setStatus(text, kind = "") {
  const target = document.getElementById("auth-status");
  if (!target) return;
  target.textContent = text;
  target.className = `status${kind ? ` ${kind}` : ""}`;
}

function recoveryPending() {
  try {
    return window.sessionStorage.getItem(RECOVERY_KEY) === "1";
  } catch {
    return false;
  }
}

function setRecoveryPending(value) {
  try {
    if (value) window.sessionStorage.setItem(RECOVERY_KEY, "1");
    else window.sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Recovery remains optional when browser storage is unavailable.
  }
}

function stateRetryUsed() {
  try {
    return window.sessionStorage.getItem(STATE_RETRY_KEY) === "1";
  } catch {
    return true;
  }
}

function setStateRetryUsed(value) {
  try {
    if (value) window.sessionStorage.setItem(STATE_RETRY_KEY, "1");
    else window.sessionStorage.removeItem(STATE_RETRY_KEY);
  } catch {
    // Fail closed: without session storage we do not auto-loop OAuth.
  }
}

function rememberEmail(email) {
  if (!email) return;
  try {
    window.sessionStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // Authentication must not depend on browser storage.
  }
}

function clearRememberedEmail() {
  try {
    window.sessionStorage.removeItem(LAST_EMAIL_KEY);
  } catch {
    // Authentication must not depend on browser storage.
  }
}

function rememberGitHubAttemptEmail(email) {
  try {
    if (email) window.sessionStorage.setItem(ATTEMPT_EMAIL_KEY, email);
    else window.sessionStorage.removeItem(ATTEMPT_EMAIL_KEY);
  } catch {
    // Authentication must not depend on browser storage.
  }
}

function githubAttemptEmail() {
  try {
    return window.sessionStorage.getItem(ATTEMPT_EMAIL_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message ?? "GitHub Login konnte nicht abgeschlossen werden.");
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

function verifiedAuthBase(config) {
  const value = config?.oauth?.github?.authBase;
  if (config?.oauth?.github?.available !== true || typeof value !== "string")
    throw new Error("GitHub Login ist nicht verfügbar.");
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

function verifiedRedirect(value, authBase) {
  if (typeof value !== "string") throw new Error("GitHub Login konnte nicht gestartet werden.");
  const target = new URL(value);
  const neon = new URL(authBase);
  const neonTarget =
    target.protocol === "https:" &&
    target.hostname === neon.hostname &&
    target.pathname.startsWith(neon.pathname);
  const githubTarget =
    target.protocol === "https:" &&
    target.hostname === "github.com" &&
    target.pathname === "/login/oauth/authorize";
  if ((!neonTarget && !githubTarget) || target.username || target.password || target.hash)
    throw new Error("Unsicheres Login-Ziel wurde blockiert.");
  return target.href;
}

async function restartGitHubOAuth() {
  const config = await jsonRequest("/api/auth/config", {
    method: "GET",
    credentials: "same-origin",
    headers: { "X-Odin-Request": "1" },
  });
  const authBase = verifiedAuthBase(config);
  const callback = new URL("/login", window.location.origin);
  callback.searchParams.set("returnTo", safeReturnTo());
  const errorCallback = new URL(callback.href);
  errorCallback.searchParams.set("oauth", "error");

  const data = await jsonRequest(`${authBase}/sign-in/social`, {
    method: "POST",
    credentials: "include",
    redirect: "manual",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "github",
      callbackURL: callback.href,
      errorCallbackURL: errorCallback.href,
      disableRedirect: true,
    }),
  });
  const target = verifiedRedirect(data.url, authBase);
  setRecoveryPending(false);
  window.location.assign(target);
}

async function recoverStateMismatchOnce() {
  if (stateRetryUsed()) {
    setStatus(
      "GitHub konnte die Login-Sitzung auch beim sicheren Wiederholungsversuch nicht bestätigen. Starte den GitHub-Login bitte erneut.",
      "error",
    );
    return;
  }
  setStateRetryUsed(true);
  setStatus("GitHub-Sitzung wird einmal sicher neu gestartet …");
  try {
    await restartGitHubOAuth();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "GitHub Login konnte nicht neu gestartet werden.",
      "error",
    );
  }
}

function markRecoverableOAuthFailure() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("oauth") !== "error") return;
  const code = params.get("error") ?? params.get("error_code") ?? "";
  if (code === "state_mismatch") {
    void recoverStateMismatchOnce();
    return;
  }
  if (RECOVERABLE_ERRORS.has(code)) {
    setRecoveryPending(true);
    const attemptEmail = githubAttemptEmail();
    if (attemptEmail) {
      rememberEmail(attemptEmail);
      const emailInput = document.getElementById("auth-email");
      if (emailInput && !emailInput.value) emailInput.value = attemptEmail;
    } else {
      clearRememberedEmail();
      const emailInput = document.getElementById("auth-email");
      if (emailInput) {
        emailInput.value = "";
        emailInput.placeholder = "E-Mail des bestehenden Odin-Kontos";
      }
    }
  } else if (code === "access_denied") {
    setRecoveryPending(false);
  }
}

async function requestRecoveryCode(event) {
  if (!recoveryPending()) return;
  const emailInput = document.getElementById("auth-email");
  const email = emailInput?.value.trim() ?? "";
  if (!email || !emailInput?.checkValidity()) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  rememberEmail(email);
  const button = document.getElementById("send-code");
  if (button) button.disabled = true;
  setStatus("Code wird für das bestehende Odin-Konto angefordert …");

  try {
    await jsonRequest("/api/auth/sendCode", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Odin-Request": "1" },
      body: JSON.stringify({ email }),
    });
    setStatus(
      "Wenn diese Adresse exakt zu deinem bestehenden, noch unbestätigten Odin-Konto gehört, wurde ein Code angefordert. Unbekannte oder andere Adressen erhalten absichtlich keine E-Mail.",
      "success",
    );
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Bestätigungscode konnte nicht angefordert werden.",
      "error",
    );
  } finally {
    if (button) button.disabled = false;
  }
}

async function completeRecovery(event) {
  if (!recoveryPending()) return;
  const codeField = document.getElementById("code-field");
  const emailInput = document.getElementById("auth-email");
  const otpInput = document.getElementById("auth-code");
  if (!codeField || codeField.hidden || codeField.style.display === "none") return;
  const email = emailInput?.value.trim() ?? "";
  const otp = otpInput?.value.trim() ?? "";
  if (!email || !/^\d{6}$/u.test(otp)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  rememberEmail(email);
  const submit = document.getElementById("auth-submit");
  if (submit) submit.disabled = true;
  setStatus("E-Mail wird bestätigt. Danach wird GitHub automatisch fortgesetzt …");

  try {
    await jsonRequest("/api/auth/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Odin-Request": "1" },
      body: JSON.stringify({ email, otp }),
    });
    setStatus("E-Mail bestätigt. GitHub wird erneut geöffnet …", "success");
    await restartGitHubOAuth();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "GitHub Login konnte nicht fortgesetzt werden.",
      "error",
    );
    if (submit) submit.disabled = false;
  }
}

const githubButton = document.getElementById("github-signin");
if (githubButton) {
  githubButton.addEventListener(
    "click",
    () => {
      setStateRetryUsed(false);
      const email = document.getElementById("auth-email")?.value.trim() ?? "";
      rememberGitHubAttemptEmail(email);
    },
    { capture: true },
  );
}

markRecoverableOAuthFailure();
const sendCodeButton = document.getElementById("send-code");
if (sendCodeButton)
  sendCodeButton.addEventListener("click", requestRecoveryCode, { capture: true });
const form = document.getElementById("auth-form");
if (form) form.addEventListener("submit", completeRecovery, { capture: true });
