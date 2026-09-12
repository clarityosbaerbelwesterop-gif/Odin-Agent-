# PRODUCT M1 migration matrix

Date: 2026-09-12. Odin wins where its implementation already owns trust, durability or verification.
SCP means `clarityosbaerbelwesterop-gif/swarm-compute-protocol-`; BYB means
`clarityosbaerbelwesterop-gif/Build-your-Buissness`.

| Feature | Odin status | SCP status | BYB status | Authoritative source | Action | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| Provider protocol | Mature normalized adapters | Routing experiments and provider config | Model configuration concepts | Odin | KEEP_ODIN | Odin has typed capabilities, failures, usage and secret boundaries. |
| OpenRouter | Implemented | Implemented/configured | Partial | Odin | KEEP_ODIN | Existing adapter and credential name already match. |
| Groq | Compatible endpoint possible, no named product | Named support | Not material | Odin provider boundary | DEFER | Needs provider/product review; no duplicate provider system. |
| Model routing | Empirical and policy bounded | Experimental routing | Simplified selection | Odin | KEEP_ODIN | Source routing cannot weaken quality floors or authority. |
| Mission/run lifecycle | Durable M2/M8 state machine | Simulation-oriented jobs | Auftrag/chat flow | Odin | KEEP_ODIN | Mission state remains canonical. |
| Structured task plan | Canonical task DAG | Agent/work decomposition concepts | Planner UX | Odin + BYB copy | EXTEND_ODIN | Present the real DAG in plain language. |
| Verification and repair | M5 evidence authority and repair contracts | Audit ideas | Verify step and approval UX | Odin | KEEP_ODIN | Evidence, not confidence, controls completion. |
| Projects | Conversations persisted with tenant scope | Separate project/job concepts | Auftrag/project experience | Odin persistence | EXTEND_ODIN | `/api/projects` is a product projection over the existing store, not a second model. |
| Workspace | Scoped repository/workspace contracts | Legacy workspace UI | Workspace/build UX | Odin + BYB | COMBINE | Preserve execution isolation; use simpler product language. |
| Companion | Mission state available | Agent visualizations | Status-oriented assistant UX | Odin state | EXTEND_ODIN | Animation and copy derive from canonical mission state. |
| Activity | Durable structured events | Logs/audit concepts | Human-readable activity | Odin events + BYB copy | COMBINE | Raw events remain canonical; labels are reversible projections. |
| Memory | Scoped/versioned M6/M24 with provenance | Duplicated state ideas | Product memory concepts | Odin | KEEP_ODIN | A second memory system would break authority and provenance. |
| Skills | Verified lifecycle and Skill OS | Agent capability ideas | Simple skill discovery | Odin | EXTEND_ODIN | Simplify discovery while M10/M23 retain lifecycle and permission limits. |
| Tool registry | M3 authority and M25 catalog | Connector functions | Connector actions | Odin | KEEP_ODIN | All external actions must pass Odin policy and schemas. |
| Connections UX | Encrypted provider/GitHub status is scattered | Connector config | Connector hub/resource picker | Odin control plane + BYB UX | COMBINE | Consolidate status and resource choice without moving secrets to clients. |
| GitHub | OAuth, repository selection, isolated branch writes, MCP reads | Integration | Strong connector/build concept | Odin | HARDEN_ODIN | Existing implementation is stronger and tenant scoped. |
| Vercel | Deployment project/config present; connection UX incomplete | Preview/deploy helpers | Preview/publish workflow | Odin + source policy | ADAPT_SOURCE | Adopt preview-first/publication approval in a future adapter. |
| Neon/database | Transaction-scoped actor and forced RLS | Weaker/local persistence | Neon/RLS work | Odin | KEEP_ODIN | Existing database boundary prevents cross-user access. |
| Authentication | Neon Auth plus local dev mode | Weaker/alternate auth | Auth flows | Odin | KEEP_ODIN | No second session or account authority. |
| Stripe/entitlements | Signed ordered webhooks and exact prices | Tier concepts | Subscription UX | Odin | KEEP_ODIN | Checkout redirects never mint entitlement. |
| Rate and concurrency limits | Durable server-side quota/rate policies | Useful limit concepts | Partial | Odin | KEEP_ODIN | Client or JSON ledgers are weaker. |
| Usage accounting | Checkpoint and quota based | Local JSON ledger | Partial | Odin | REJECT | Source ledger duplicates weaker state. |
| Approval boundaries | M3 grants and explicit approval evidence | Audit ideas | User owns risk/budget/publication/resources | Odin + BYB | COMBINE | Keep policy enforcement and improve decision presentation. |
| Product shell | Fragmented technical Chathub | Legacy UI | Clearer nontechnical flow | New Odin product shell | REWRITE | Product experience needed redesign while runtime stays intact. |
| Fake swarm/agent counts | Absent | Present in demos | Absent | Odin | REJECT | Decorative simulations cannot represent production work. |
| Benchmarks | Preserved evidence infrastructure | Uplift claims/experiments | Limited | Odin | KEEP_ODIN | PRODUCT M1 makes no intelligence uplift claim. |
| Local JSON persistence | SQLite/Neon are canonical | Present | Present in prototypes | Odin | REJECT | Would create weaker duplicate durability. |

