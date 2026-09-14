# PRODUCT M10 — Release, Billing, Security, Mobile and Onboarding

Status: implementation candidate; merge requires canonical CI on the exact PR head.

Base: merged PRODUCT M9 (`1f1fa05d433cb917cb197900df00b795fb6b4cd5`).

## Objective

Finish the M1–M10 product transformation without creating parallel billing, auth, runtime, memory, tool or automation systems. PRODUCT M10 hardens the existing Odin product for release and makes the public shell installable on mobile while keeping authenticated state server-authoritative.

## Implemented release boundaries

- Production entitlements fail closed. `ODIN_PRESTRIPE_TEST_MODE` is explicit, preview/local only, and is ignored in production.
- Stripe entitlement still comes from verified webhook/database state; checkout return state never grants a plan.
- Release configuration is projected by `productReleaseReadiness` as booleans/status labels only. Secret values are never returned or logged.
- Release readiness checks HTTPS origin, database, Neon Auth, credential encryption, Stripe secret/webhook/exact prices, repository OAuth and actual hosted model capacity.
- Existing Neon/Postgres owner isolation remains canonical. M10 does not create a second persistence or authorization layer.
- Vercel transport headers add HSTS, DNS-prefetch disabling and same-origin opener isolation on top of the existing CSP, no-sniff, referrer and permissions policy.
- The PWA caches only the public landing shell. `/api`, `/login`, `/app`, `/browser` and `/bot` are network-only so authenticated workspace, account, billing and tool state do not enter the service-worker cache.
- The existing Home welcome, task suggestions, Connections/System surfaces and Settings dialog remain the onboarding path; M10 keeps onboarding derived from real backend capabilities rather than browser-owned entitlement state.

## Acceptance gates

1. Canonical `npm run verify` passes on the exact PR head.
2. Line coverage remains at or above the repository threshold; the threshold is not reduced for M10.
3. Production cannot receive Ultra merely because Stripe configuration is absent.
4. Stripe price substitution, invalid webhook signatures and inactive paid states remain fail closed.
5. Product account/credential/GitHub/OAuth/Stripe tables continue to use owner-scoped RLS/FORCE RLS and PUBLIC revocation through the existing migrations.
6. The service worker contains no credential store and does not cache authenticated/API routes.
7. PWA manifest and public app mark are emitted by the canonical web asset build.
8. Release-readiness output contains no secret values.
9. M10 is not described as live-production verified unless external Stripe/Neon/Vercel/mobile evidence has actually been observed.

## Evidence boundary

A green repository gate proves source, type, unit/integration/UI and build acceptance under CI. It does **not** by itself prove live Stripe checkout/webhooks, production Neon migrations, domain/DNS, e-mail delivery, third-party provider capacity, legal approval or physical-device install behavior. Those remain explicit external launch checks until observed.
