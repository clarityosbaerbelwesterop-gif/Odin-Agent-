# PRODUCT M1 integration and credential audit

Date: 2026-09-12. Values were neither read nor recorded. Odin's existing configuration and encrypted
credential control plane remain authoritative. `ADD_MISSING` means a future, separately reviewed Odin
contract; it does not authorize secret provisioning.

| Capability | Source | Odin already has it? | Existing Odin variable | Source variable | Action | Target module |
| --- | --- | --- | --- | --- | --- | --- |
| OpenRouter models | SCP | Yes | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` | USE_ODIN_EXISTING | `src/providers/openrouter.ts` |
| OpenAI models | SCP / BYB | Yes | `OPENAI_API_KEY` or encrypted BYOK | `OPENAI_API_KEY` | USE_ODIN_EXISTING | `src/providers/openai.ts`, hosted BYOK |
| Anthropic models | BYB | Yes | `ANTHROPIC_API_KEY` or encrypted BYOK | `ANTHROPIC_API_KEY` | USE_ODIN_EXISTING | `src/providers/anthropic.ts`, hosted BYOK |
| Gemini models | SCP | Yes, through the compatible provider boundary | `GOOGLE_API_KEY` or encrypted BYOK | `GEMINI_API_KEY` | USE_ODIN_EXISTING | compatible provider / hosted BYOK |
| NVIDIA shared capacity | Odin | Yes | `NVIDIA_PRODUCTION_API_KEY*`, authorization flag | None | USE_ODIN_EXISTING | `src/chat/server-models.ts` |
| Groq models | SCP | No named hosted integration; compatible adapter exists | None | `GROQ_API_KEY` | DEFER | `src/providers/compatible.ts` after product/provider review |
| GitHub OAuth | SCP / BYB | Yes | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub client id/secret | USE_ODIN_EXISTING | existing hosted product control plane |
| GitHub repository work | SCP / BYB | Yes, stronger scoped branch workspace | encrypted connection; `GITHUB_MCP_URL` for reads | GitHub token variables | USE_ODIN_EXISTING | `src/chat/github-workspace.ts`, M3 |
| Vercel deployment | SCP / BYB | Repository deployment contract exists | Vercel platform-managed deployment environment | Vercel token/team/project variables | ADAPT_SOURCE | future connection adapter; preview-first policy |
| Neon database | BYB | Yes | `ODIN_DATABASE_URL` | Neon/Postgres URL variables | USE_ODIN_EXISTING | `src/chat/neon-*`, `api/index.mjs` |
| Neon Auth | BYB | Yes | `NEON_AUTH_BASE_URL` | auth URL variables | USE_ODIN_EXISTING | existing hosted auth boundary |
| Stripe billing | SCP / BYB | Yes | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, exact price ids | Stripe secret/webhook/price variables | USE_ODIN_EXISTING | existing product/entitlement modules |
| Google services beyond models | BYB concept | No product connection yet | None | Google OAuth variables | DEFER | future `connections` adapter after scope design |
| Credential encryption | Odin | Yes | `ODIN_CREDENTIAL_ENCRYPTION_KEY` | source-specific encryption variables | USE_ODIN_EXISTING | existing encrypted credential store |
| Public callback origin | Odin / sources | Yes | `ODIN_PUBLIC_ORIGIN` | source app URL variables | USE_ODIN_EXISTING | hosted auth and OAuth callbacks |
| Rate limiting | SCP / BYB | Yes, database-backed hosted rate boundary | no new secret | no credential | USE_ODIN_EXISTING | `src/chat/hosted.ts` |
| Concurrency quotas | SCP | Yes, plan-scoped OCU and mission ceilings | `ODIN_QUOTA_*` | source plan/limit variables | USE_ODIN_EXISTING | quota/product runtime |
| Usage accounting | SCP | Yes, durable runtime usage and product quotas | no new secret | no credential | USE_ODIN_EXISTING | chat checkpoints and quota store |
| Local JSON account or usage state | SCP | Stronger Odin durability exists | None | None | REJECT | no target |
| Source repository secret aliases | SCP / BYB | Canonical equivalents already exist | variables above | aliases in source repositories | REJECT | no target |

## Decisions

- No environment variable was renamed, duplicated, populated, or removed.
- Gemini naming stays on Odin's `GOOGLE_API_KEY` contract. A source repository's alternative name does
  not justify duplicating the credential.
- Groq is technically compatible with Odin's explicit OpenAI-compatible boundary, but enabling a named
  public/provider product requires endpoint, model-catalog, quota, commercial and privacy review. It is
  deferred rather than represented as configured.
- Source Vercel workflows contribute the preview-before-publication product rule. They do not replace
  the existing deployment configuration or authorize production publication.
- GitHub, Neon, Auth and Stripe stay on Odin's existing tenant, RLS, encryption and entitlement paths.

