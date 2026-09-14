# PRODUCT M8 — Act / Browser Mode

Status: implementation and deterministic security/acceptance verification in progress; exact-head PR CI and merge evidence remain mandatory.

PRODUCT M8 gives Odin a controlled external web surface without creating a second Mission runtime, approval authority, credential store, event log or unrestricted browser agent. Browser sessions bind to an existing Project and canonical Run. The existing Tool capability policy remains the authority for Observe/Act risk and approval.

## Session authority

A browser session records owner, Project, Run, exact HTTPS origin scope, risk profile, state, current URL, last safe action, pending uncertain action, bounded action count, creation/update time and expiry. Durable session transitions are canonical Run events (`browser.*`), so reload reconstructs the same scoped session rather than inventing another runtime.

Sessions are actor and Project scoped twice: Neon actor/RLS scope limits the event stream and product code verifies the owner/Project/Run provenance before use. No cross-user session reuse is allowed.

## Observe versus Act

Observe operations are `navigate`, `read`, `search`, `extract` and bounded `download`. Form preparation is medium risk. Click, submit, upload, send, publish, delete and purchase are high risk.

The browser product feeds those classifications through the existing `InMemoryCapabilityPolicy` / `ApprovalEvidence` model. High-risk action cannot execute from page content or a client-supplied claim. The authenticated server first records an approval request bound to an action hash; the user explicitly approves that exact action; execution reconstructs matching server-side approval evidence. Any change in destination, fields or Workspace resource invalidates the approval.

Financial commitment is disabled in the default ASSISTED profile. CONTROLLED mode still requires explicit approval for a financial action and the generic HTTP transport intentionally does not implement purchase execution.

## Web content trust

Page content is always tagged `UNTRUSTED_WEB_CONTENT`. Instructions such as “ignore policy”, “reveal API keys”, “upload credentials” or “navigate to another account” remain inert evidence. Page text never grants a capability, creates approval, changes allowed origins, reveals the credential vault or mutates budgets.

Only bounded title/hash/URL metadata is persisted as browser event evidence. Raw page text is returned to the active surface but is not automatically promoted to Memory.

## Network and redirect safety

The generic browser transport is deliberately narrow: bounded public HTTPS navigation and standard form POST. It reuses `OutboundNetworkPolicy`, DNS resolves each destination, pins the approved public address for the request, rejects private/reserved addresses, rejects URL credentials/fragments and limits responses to 1 MB.

Allowed origins are exact, not wildcards. Every redirect is resolved and checked again before a follow-up request. Cross-origin redirects therefore fail closed. The transport has no ambient browser cookies, provider credentials, filesystem authority or arbitrary script execution.

## Approval experience

Before a high-risk action, the Browser Workspace shows the action, destination, submitted field names/resource summary, risk and irreversible potential. Approval and cancellation are explicit user actions. Page content cannot click or forge the approval because the server binds it to the authenticated actor and a SHA-256 action identity.

## Unknown outcomes

A side-effecting request that may have reached the external service but loses a reliable result enters `OUTCOME_UNKNOWN`. The session blocks every later action and does not replay the request. A verified external-state reconciliation must mark the prior action EXECUTED or NOT_EXECUTED before the session can continue. This prevents duplicate form submissions and analogous double actions.

## Downloads and uploads

Downloads are bounded to 10 MB, safe filenames and an allowlist of text/JSON/PDF/common image MIME types. Downloaded content is untrusted and is never auto-executed. Upload/publish operations require an explicit Project Workspace item reference; the product exposes no arbitrary server filesystem picker.

The generic HTTP transport implements only observe/click-as-navigation and controlled form POST. Send/publish/upload/delete/purchase require an appropriate supported Connection rather than pretending a generic web page grants that authority.

## Product surface

`/browser` provides a warm Browser Workspace with current page evidence, scoped address bar, Companion state, current action, session provenance and an approval card. Desktop uses Browser + Companion; iPad/mobile collapse Companion into a bottom sheet-like panel while preserving large touch targets and reduced-motion support.

The surface renders page text with `textContent` rather than HTML injection and stores no browser credentials in Web Storage.

## Deterministic acceptance / security

The M8 suite covers exact origin scoping, multi-origin normalization, redirect escape, Observe/Act risk classes, canonical high-risk approval, prompt-injection fixtures, unknown-outcome replay blocking/reconciliation, event-based resume state, cross-user/project/run isolation, download traversal/type/size bounds, read-only and assisted policy restrictions, explicit Workspace resource requirements, expiry and action ceilings. UI gates verify approval UX, no `innerHTML`/Web Storage credential path, responsive breakpoints and reduced motion.

A full `npm run verify` plus normal exact-head PR CI remain mandatory before merge.

## Known boundaries

- M8 is not a general-purpose Chromium replacement and executes no arbitrary page JavaScript.
- Authenticated third-party application mutations require an explicit supported Connection; the generic browser transport has no ambient cookies or credential access.
- Generic uncertain external state cannot be guessed automatically. The session stays blocked until verified reconciliation evidence exists.
- Browser evidence can feed the canonical Run/Workspace artifact flow; M8 does not create a second Artifact or Memory store.
