# FreeLLMAPI: connection and commercial readiness

Reviewed 2026-09-08 for the requested Odin preview and possible Pro offering.

## What the repository supplies

[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) is an MIT-licensed, self-hosted router. It
combines the operator's own provider keys. The catalog's aggregate free-tier figures are not credits
allocated to Odin. A `fla_` license unlocks catalog updates, not inference. A router-generated
`freellmapi-…` key needs the operator's running router URL. Compatibility with an OpenAI or Anthropic
API format does not mean the underlying model is an OpenAI or Anthropic model.

Primary implementation/API references:

- [API reference](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/api/01-rest-api.md)
- [Architecture and limitations](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/architecture/00-high-level-index.md)

The upstream router is deliberately single-user, lacks per-user billing, and does not supply an SLA.
Its own personal-use terms review is not a commercial redistribution approval from each provider.
No Pro price, unlimited-token claim, payment flow or paid upstream purchase is enabled in this delivery.

## Current result: BLOCKED on endpoint identity

The preview configuration workflow checks the presence/type of `FREE_API_KEY` without printing it.
Run **34254459226** returned `UNRECOGNIZED_PROVIDER_ENDPOINT_REQUIRED`: the value does not use either
documented FreeLLM prefix. That does not establish that it is invalid; it may belong to another provider.
It has not been sent to an inferred URL, catalog server, frontend or deployment. The missing input is
the intended API base URL and provider/model identity. Do not paste the key into chat.

The local Odin model configuration already supports explicitly configured provider adapter base URLs
and server-only credential environment names. This is transport capability, not proof of compatibility
with an untested router. No FreeLLM model is currently advertised in the hosted model picker.

## Acceptance checks before enabling it

1. Obtain the operator-approved HTTPS base URL and exact provider/model selection. Reject private
   network endpoints, embedded URL credentials and redirects. A local laptop URL is not reachable by
   the Vercel worker.
2. Use `GET /v1/models?available=true` to inspect actual readiness, not the entire catalog. Router
   aliases may be listed even without usable provider credentials; do not expose them as ready models.
3. Pin and verify model identity using the response model and `X-Routed-Via`; inspect upstream fallback
   attempts. Disable cross-model/provider fallbacks and hidden retry/key-rotation work for fixed-identity
   benchmark runs. Upstream routing must not raise Odin's call/token or data-sharing boundaries.
4. Test the existing normalized provider contract, tool calls, cancellation, bounded responses, unknown
   usage, 429 handling and an actual restricted end-to-end conversation. Keep measured failures.
5. Review commercial use, redistribution, privacy, retention and per-provider quota terms for the
   selected providers before a paid Pro launch. Free catalog totals are never user entitlements.

Until these checks pass, the existing configured NVIDIA evaluation connection remains separate and
the FreeLLM integration is **not enabled**. A catalog license alone cannot satisfy these requirements.
