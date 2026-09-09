# P–R — Live product completion

Status: ACTIVE
Base: `81504da1754b07441268d219df1299053bbd7c0d`
Branch: `agent/pqr-live-product-subscriptions-integrations`

This package contains exactly three phases. It completes product infrastructure and user-facing control
surfaces; it does not modify Odin benchmark acceptance, M11 quality floors, M3 execution authority, M5
completion authority, or claim frontier-model equivalence.

## Phase P — Production identity and GitHub workspace

Objective: make production identity and per-user repository connection real rather than preview-only.

Acceptance criteria:

- production Postgres has the canonical `odin_api` schema with FORCE RLS and the restricted runtime role;
- managed Neon Auth login/signup/email verification/reset/logout remains session-cookie based and
  production trusted-domain configuration is verified;
- GitHub repository connection uses an OAuth flow owned by the trusted server, stores no raw OAuth token
  in browser/client payloads, binds state to the authenticated Odin user and short expiry, and supports
  connect/status/list-repositories/disconnect;
- GitHub repository identity is persisted per Odin user and only the selected repository is exposed to
  mission/workspace policy;
- when GitHub OAuth operator credentials are not configured, the API and UI fail closed with a precise
  configuration state rather than pretending to be connected;
- cross-user database and integration isolation has deterministic regression coverage.

Production migration is approval-gated: prepare and test on a Neon temporary branch first, then apply to
the production branch only after explicit approval as required by the database-control boundary.

## Phase Q — Billing and entitlements

Objective: provide server-authoritative Free/Pro/Ultra subscriptions with Stripe Billing.

Acceptance criteria:

- Free is an internal zero-cost entitlement and never requires a Stripe object;
- Pro/Ultra use Stripe Checkout subscription mode and configured immutable Price IDs; no price amount is
  invented in source or client state;
- Customer Portal is available for an authenticated Stripe customer;
- verified Stripe webhook events are the source of truth for paid entitlement changes and are processed
  idempotently;
- subscription/customer/event state is isolated by Odin user and stored in Postgres;
- model/mode/usage eligibility is decided server-side from the current entitlement, not from UI claims;
- the browser receives only public plan metadata and billing status, never Stripe secrets;
- Stripe Tax remains disabled until registrations are explicitly verified.

If live Pro/Ultra Price IDs are absent, the integration remains production-safe but upgrade actions must
fail closed as `billing_not_configured`; the package must not invent commercial pricing.

## Phase R — BYOK and model control

Objective: make provider connections and model selection usable from the live app.

Acceptance criteria:

- authenticated users can connect, test, replace and remove supported provider credentials;
- credentials are encrypted before database persistence with a server-only key and are never returned to
  the browser after submission, logged, placed in model context, or made available to ordinary workers;
- provider adapters remain the only provider-payload boundary; BYOK does not create a second router;
- the live model catalog is the intersection of plan eligibility, platform-managed credentials and the
  user's successfully configured provider credentials;
- model selection is persisted per user and validated server-side on every mission submission;
- Free/Pro/Ultra model/mode quotas are enforced server-side and denial is explicit;
- Settings exposes account, plan, billing, GitHub connection, provider connections, model selection and
  security/legal information as real controls rather than documentation-only cards;
- deterministic tests cover redaction, encryption/tamper rejection, plan gates, selection persistence,
  GitHub OAuth state, webhook idempotency, and cross-user isolation.

## Shared security constraints

- Raw secrets never enter repository commits, logs, events, artifacts, benchmark evidence, client payloads
  or model context.
- OAuth `state` is random, user-bound, expiring, one-time and exact redirect origins are allowlisted.
- All external writes are server-owned and idempotent where the provider supports it.
- No network model call holds an open database write transaction.
- Unknown/malformed billing, OAuth, secret, provider or entitlement state fails closed.
- Production claims require exact-head build/runtime evidence; configuration absence is reported as a
  blocker, never relabeled as success.

## Verification sequence

For each phase: focused tests -> `npm run verify` -> diff/security review. After R: package-wide adversarial
review -> governance sync -> fresh exact-head verification -> Vercel preview -> production merge only when
explicitly authorized and all non-waived gates pass. Live Stripe writes, production database migration,
and paid resource creation remain separately approval-gated where the provider/tool requires it.
