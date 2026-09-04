# M15 Kimi K3 coding A/B — corrected rerun 2 analysis

Date: 2026-09-04  
Run: `33879714040`  
Provider/model: `nvidia` / `moonshotai/kimi-k3`  
Candidate: `odin-coding-discipline@m15v1` (`378ccd1f73f12820afd14866ac38112a03a410faf00d74c5b44bfcb58948f95a`)

## Evidence state

The workflow completed successfully and preserved a sanitized result at
`docs/evals/m15-kimi-coding-ab-rerun-2.json`. It used **9** of the configured **12** maximum provider
calls across the same three matched coding cases used by the first post-merge comparison.

The result is **INCONCLUSIVE**:

- cases: 3;
- complete matched pairs: 0;
- incomplete pairs: 3;
- baseline quality: not measurable (`null`);
- candidate quality: not measurable (`null`);
- lift: not measurable (`null`).

No M10 verification, pack population, activation, public benchmark claim, or AGI/model-superiority
claim may be derived from this run.

## What the second run established

Every baseline and candidate arm ended with the bounded diagnostic
`ProviderError / provider_timeout`. The failure position is nevertheless different between arms:

| Case | Baseline | Candidate overlay |
| --- | --- | --- |
| `canonical-user-id` | 2 provider calls, 297753 ms, mutation observed | 1 call, 180003 ms, no mutation |
| `retry-429-surgical` | 2 provider calls, 353314 ms, mutation observed | 1 call, 180001 ms, no mutation |
| `safe-trim-existing-api` | 2 provider calls, 351350 ms, mutation observed | 1 call, 180002 ms, no mutation |

For every candidate arm the final target-file hash equals the fixture's initial target-file hash. The
candidate therefore timed out during its first model/planning call before any repository mutation.

For every baseline arm a target-file mutation occurred before the timeout and the resulting hash does
not equal the deterministic expected target content. The first planning call therefore completed,
produced a non-accepting change, the quality gate failed, and the second repair-model call later timed
out. This is useful failure-position evidence, but it is not a quality comparison because neither side
completed a matched case.

## Measurement-design defect found

The v1 live harness used the same **180000 ms** value for both:

1. provider request timeout; and
2. candidate latency acceptance ceiling.

That makes the latency requirement non-measurable at its boundary: an arm that needs more than the
acceptance ceiling is aborted by the transport before it can finish and be recorded as a complete
latency failure. The outcome becomes `INCONCLUSIVE` instead of a valid measured FAIL.

This is a harness defect, not evidence that the candidate is better, worse, or equal to baseline.

## Verified offline repair

After preserving the immutable rerun evidence, the harness was hardened without another provider call.
A versioned runtime-owned live execution profile now separates measurement from acceptance:

- profile: `m15-kimi-coding-ab-v2`;
- candidate acceptance latency: **180000 ms**;
- provider measurement timeout: **240000 ms**;
- minimum enforced timeout headroom: **30000 ms**;
- per-arm call ceiling: 2;
- total call ceiling: 12;
- reasoning effort: `high`;
- temperature: 1.

The profile constructor rejects malformed identities, unsafe ceilings, timeout/acceptance overlap,
oversized measurement timeouts, invalid call ceilings, unsupported reasoning effort, and invalid
temperature. The A/B evidence identity now also includes the execution-profile version, and sanitized
results expose the bounded profile metadata so measurements from different profiles cannot be silently
mixed.

One-shot offline hardening run `33882837781` passed **329/329 tests**, Biome, strict TypeScript, build,
secret-free Kimi dry smoke, and a credential-free A/B profile dry run. Aggregate coverage was **89.92%
lines / 77.25% branches / 95.88% functions**; the new live-profile module reached **91.84% lines /
88.89% branches / 100% functions**.

## Next evidence gate

A future live comparison must be explicitly authorized as a new external-provider action. If approved,
it must use the v2 profile and preserve the same provider/model/task-class/candidate identity while
recording the new profile version. A result is eligible for curation only if complete matched pairs
exist and the normal M15 quality, safety, authority, token, and latency gates pass.
