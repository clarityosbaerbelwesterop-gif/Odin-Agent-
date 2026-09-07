# Chathub: local runtime and Neon/Vercel preview

The Chathub is a real client of the Odin mission runtime. It supports saved conversations, live activity
and event replay, steering, pause/resume/cancel, attributed research, workspace changes and an isolated
HTML preview. Model output is never substituted with fixture responses in the product.

## Local operation

Use Node 24+, `npm ci`, then `npm run verify`. Copy `odin.config.example.json` to `odin.config.json`.
Provide `ODIN_ACCESS_TOKEN` (at least 24 random characters) and the model credential through the process
environment. `npm start` serves the Chathub at `http://127.0.0.1:4318`. The example references the existing
NVIDIA Kimi K3 adapter and `NV_API_KEY`; unavailable credentials leave the model list empty.

The local access token authenticates a trusted operator, not multiple independent tenants. Browser
sessions use opaque random cookies. SQLite stores live mission state and conversations under `.odin`.
Restarted work pauses for explicit recovery. A missing tool outcome is recorded as unknown and is never
blindly replayed. Unknown provider usage remains unknown after resumption.

For local Coding, configure a `workspace` directory and `allowWorkspaceWrites: true`. Quality commands
must be explicitly registered as `SandboxCommandDefinition` entries; executing them additionally
requires `allowHostExecution: true`. The configured commands run with M12 path, process and output
bounds. This is trusted-host execution, not an OS/container isolation claim. Never mount credentials or
unrelated private repositories into that workspace. Without a passing registered quality check, changed
work is reported as unverified.

## Hosted operation

`api/index.ts` runs the same engine with awaited Postgres repositories. Vercel serves `dist/public`;
the previous `public`-directory failure is addressed by the build and explicit output directory. The
original reference interface remains at `/reference`. Functions request Frankfurt and a 300-second
ceiling. A worker stops after 240 seconds and can be resumed explicitly; the application is not an
unbounded background-job service.

Required server-side Vercel environment variables:

| Variable | Purpose |
| --- | --- |
| `ODIN_DATABASE_URL`, or `DATABASE_URL` / `POSTGRES_URL` | Connection to the intended Neon branch, with permission to assume `odin_runtime` |
| `NEON_AUTH_BASE_URL`, or `NEON_AUTH_URL` | Managed Better Auth URL of that same branch |
| `NV_API_KEY`, or `NVIDIA_API_KEY` | Existing NVIDIA model credential; never returned to the client |
| `ODIN_PUBLIC_ORIGIN` | Optional exact custom application origin; Vercel's deployment/branch/production origins are also accepted |

GitHub Actions secrets are not Vercel environment variables. The Neon integration and these values must
refer to the same branch; a connected integration alone is not evidence that every variable is present.
No credentials belong in `vercel.json`, repository files, build artifacts or browser storage.

Apply migrations `001_chathub_rls.sql` and `002_workspace_and_limits.sql` with a migration connection
before serving that database branch. The runtime assumes the non-owner, non-superuser, non-BYPASSRLS
role `odin_runtime`. Prefer a separate login role granted only membership in `odin_runtime`; keep the
migration credential out of the application environment. The integration-provided owner connection
is supported, but is more privileged than necessary even though every application transaction drops
to the restricted role.

For every request, the backend checks the live managed session and its EdDSA JWT signature, issuer,
audience, subject, age and expiry. Unverified email accounts are refused. Cookies are proxied on the
application origin for Safari compatibility and rewritten to Secure, HttpOnly, SameSite=Strict.
Passwords are forwarded only to the fixed Neon Auth origin and never stored by Odin. Login, signup,
email OTP verification, password reset and logout are exposed through an explicit route allowlist.
Register the exact application origins in the Auth branch's trusted domains. OAuth is not exposed in
this client. OTP email delivery requires the configured Neon mail service and remains a distinct live
acceptance check.

All eight application tables have ENABLE and FORCE RLS with owner checks on reads and writes.
Composite owner foreign keys protect child records. Identity comes exclusively from verified Auth;
client-supplied owner fields are rejected. Role and user context are transaction-local, including when
using the Neon pooler. Transactions never wrap model calls. Short advisory-locked transactions serialize
task mutations across workers; expiring leases and fencing reject duplicate or late worker writes.
Session revocation is checked on each API request and periodically during a running task.

Hosted Coding edits bounded, per-user, per-conversation HTML/CSS/JS/JSON/Markdown workspaces. JavaScript
and JSON syntax checks run on the server without evaluating generated code. Preview scripts run only
inside an opaque iframe with network, forms, frames and origin access blocked by the response CSP.
This supports interactive static pages; package installation, arbitrary backend execution, application
runtime tests and deployment of generated projects are not implemented by this hosted worker.

## Execution modes and evidence

| Mode | Actual behavior |
| --- | --- |
| Chat | Bounded response and arithmetic/plan tools |
| Coding | Scoped workspace read/patch, registered quality checks, separate review and revision |
| Thinking | Increased reasoning effort, bounded arithmetic, separate review and revision |
| Research | Live Wikipedia search/excerpts with attributed source IDs and checked citation identity |
| Ultra | Higher bounded call/tool/token ceilings, planning, workspace/research tools and separate review |

Model self-review and structural delivery validation do not prove factual correctness. Research currently
uses the configured Wikipedia language, not unrestricted web browsing. Modes never grant new host
permissions or raise the operator's global ceilings. Live events stream progress, tools, sources and
state; final responses are displayed after generation and validation.

`scripts/live-chathub-ab.mjs` compares raw Kimi without Odin to Kimi with the actual Thinking engine on
three exact-answer tasks. Each arm sees the same task and grading format. Odin has up to four calls;
the raw baseline has one. Actual tokens, calls, wall time and pacing time are recorded, so the comparison
does not imply equal compute. One acquisition, no hidden retry, 65-second global provider-start pacing.
Failures and missing usage remain incomplete. This small suite is not a general intelligence score.

The older M16 evidence under `docs/evals/paced-kimi-2026-09-07-summary.json` compares two coding protocols,
not a raw model with Odin. Both acquisitions remain preserved. It cannot validate newly added chat code.

The `Chathub live evidence` workflow uses only the fixed `preview-chathub-auth` branch for real Neon
integration tests. It creates synthetic accounts, verifies that unverified accounts are blocked, then
sets only those fixture accounts' verification flags for subsequent signed-session/API checks. This
does not attest real email delivery. All fixtures are removed after the test; secrets and raw upstream
responses are withheld from logs and artifacts. Provider transport in that integration job is a fixture;
the separate model A/B job uses real inference.

References: [Neon JWT verification](https://neon.com/docs/auth/guides/plugins/jwt),
[Neon Auth management API](https://neon.com/docs/auth/guides/manage-auth-api),
[Neon connection URI API](https://api-docs.neon.tech/reference/getconnectionuri).
