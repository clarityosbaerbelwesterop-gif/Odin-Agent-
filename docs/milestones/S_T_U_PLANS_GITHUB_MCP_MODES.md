# S–U product contract — plans, GitHub MCP and coding modes

Status: ACTIVE delivery contract for `agent/stu-plans-github-mcp-modes`.
Base: `1f2e4f77f834b5ff9c9324f606375d41a719e375`.

This tranche contains exactly three phases. It extends the existing P–R hosted product and does not create new mission, tool, routing, verification, credential or workspace authorities.

## Phase S — four-tier billing and entitlements

Plans are ordered `free < pro < developer < ultra`.

- Free: baseline chat and explicitly Free/BYOK models.
- Pro: Free plus Thinking and Research and models whose minimum plan is Pro.
- Developer: Pro plus Coding Mode, GitHub-connected repository work and models whose minimum plan is Developer.
- Ultra: Developer plus Ultra Mode and models whose minimum plan is Ultra.

Public monthly prices are operator-approved as USD 9.99 Pro, USD 19.99 Developer and USD 49.99 Ultra. Free has no Stripe price.

Stripe Checkout and Portal remain hosted. Signed webhook state remains the billing authority. A browser return from Checkout never grants access. Paid access is effective only for an allowlisted active subscription status; canceled, past_due, unpaid, incomplete, incomplete_expired and paused state fail closed to Free. Stored plan/status remain auditable even when effective access is lower.

Acceptance:

- database constraint accepts exactly free/pro/developer/ultra;
- Checkout and webhook mapping support all three paid plans;
- mode and model minimum-plan requirements compose using the stricter requirement;
- inactive paid subscriptions cannot use paid modes/models;
- public product UI shows the three approved monthly prices without fabricated guarantees.

## Phase T — GitHub OAuth + MCP

GitHub OAuth remains the user-authorized credential source. The OAuth token stays encrypted at rest and server-only.

GitHub MCP is an augmentation of M3, never a parallel tool authority. Odin may expose only a fixed, reviewed subset of the official remote GitHub MCP server through local M3 tool registrations. Initial MCP scope is read/context/CI oriented: code search, file context, pull-request reads and Actions reads. MCP responses are untrusted data, response size/time are bounded, and the model cannot choose the MCP host, mint tools, expand OAuth scope or receive raw credentials.

Repository mutation remains on the existing `GitHubWorkspace` contract, which creates an isolated `odin/*` branch and observes GitHub checks as quality evidence. Remote MCP write tools are not exposed in this tranche.

MCP is available only when the account has Developer-or-higher effective access and GitHub OAuth is connected. Ultra inherits this capability.

Acceptance:

- fixed official HTTPS MCP endpoint or an exact allowlisted override only;
- bounded Streamable HTTP/JSON-RPC client with injected transport tests and no live token in tests;
- only curated tool identities are registered through M3;
- Coding/Ultra may discover those tools; other modes cannot;
- no remote MCP write operation is exposed;
- OAuth/GitHub disconnect removes MCP availability.

## Phase U — Coding and Ultra product semantics

Coding Mode is the Odin equivalent of a Claude Code/Codex workflow: the user selects an authorized repository and a configured model, then Odin may inspect, edit and verify that repository through the existing controlled workspace. Developer is the minimum plan.

Ultra Mode requires Ultra and combines the capabilities already implemented by Odin for repository work, research, maximum supported reasoning effort, independent review and bounded repair. This tranche does not claim multi-model or subagent execution unless the runtime actually performs it; M11 remains sole routing authority and M7 remains specialist-coordination authority.

Acceptance:

- Chat minimum Free;
- Thinking minimum Pro;
- Research minimum Pro;
- Coding minimum Developer and requires a connected repository workspace;
- Ultra minimum Ultra;
- model selector capabilities expose their minimum plan and backend enforcement cannot be bypassed by client input;
- UI copy accurately distinguishes plan/mode capabilities.

## Standing authority and security constraints

- M3 is the only tool execution authority.
- M5 is completion/evidence authority.
- M11 is model-routing/quality-floor authority.
- M2/M8 remain canonical mission state.
- GitHub OAuth, provider credentials, Stripe secrets and MCP bearer tokens never enter model context, client payloads, normal worker environments, logs or artifacts.
- Repository/MCP/provider output is untrusted input.
- No production billing claim is complete until live Stripe products/prices, webhook configuration and a bounded end-to-end subscription state transition are observed.
- No MCP claim is live until one authenticated bounded remote call is observed through Odin.

## Verification plan

Each phase receives focused deterministic tests, then repository-wide `npm run verify`. A Vercel exact-head build is supporting deployment evidence, not a substitute for the repository verification suite. GitHub Actions that fail before executing a step remain infrastructure-blocked and are never relabeled green.
