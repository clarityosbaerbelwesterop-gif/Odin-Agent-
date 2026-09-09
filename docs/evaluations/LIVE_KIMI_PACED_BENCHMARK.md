# Paced Kimi live benchmark recovery

Status: **IMPLEMENTATION_VERIFIED — live rerun pending**.

## Why this exists

Final post-merge Kimi K3 evaluation run `34098959982` completed technically but produced no complete matched pairs. After the first two live provider attempts, subsequent attempts were predominantly classified as `provider_rate_limit`; one baseline response was also `provider_malformed_response`. Under the existing M22/M16 evidence semantics those infrastructure-ambiguous arms remain incomplete, so no quality/token/latency lift may be inferred from that run.

This change hardens only the live evaluation control plane. It does not change normal Odin provider routing, M11/M21 quality floors, M22 matched-arm semantics, Phase F routing/promotion eligibility, tool authority, completion authority, or production execution behavior.

## Recovery protocol

- All live provider starts in the M16 grounded evaluator share one global pacer.
- Provider starts are separated by at least **65,000 ms**.
- The first attempt is not delayed.
- Pacing is serialized even if a future caller attempts concurrent starts.
- Cancellation before a paced attempt does not consume an attempt.
- The existing per-arm and total provider-call ceilings remain unchanged; pacing creates no hidden retries.
- Control-plane pacing delay is recorded separately and subtracted from measured task latency, so benchmark latency does not reward or punish arm ordering because of the cooldown.
- Sanitized evidence records the pacing policy and observed wait total.
- Rate-limit, malformed-response, timeout, network, unavailable, authentication, quota, and other existing infrastructure classifications keep their previous M16/M22 semantics. Pacing does not relabel incomplete evidence into a measured result.

## Acceptance gate

Repository implementation is acceptable only when:

1. pacer unit tests cover first-attempt behavior, serialized spacing, cancellation, bounds, and non-advancing-clock failure;
2. full `npm run verify` passes;
3. `npm run build` passes;
4. one normal PR CI passes on the exact implementation head;
5. a separately authorized bounded live rerun uses the configured NVIDIA Kimi K3 credential and emits sanitized evidence;
6. any reported benchmark percentage is based only on complete matched pairs. Zero complete pairs remains `INCONCLUSIVE`.

The user authorized this bounded recovery rerun on 2026-09-07. No paid tier, production deployment, billing change, public traffic, new provider/model integration, or new credential is authorized.
