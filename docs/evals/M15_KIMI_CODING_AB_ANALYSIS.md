# M15 Kimi K3 coding A/B — evidence interpretation

Updated: 2026-09-04.

## Evidence source

The authorized post-merge live run was GitHub Actions run `33870210502` on branch
`agent/m15-kimi-postmerge-evidence`. The workflow completed successfully as an execution pipeline and
committed the sanitized raw result as `docs/evals/m15-kimi-coding-ab.json` in commit `42f9f28`.

The run used provider `nvidia`, model `moonshotai/kimi-k3`, ten provider calls, and three matched coding
cases. The one-shot workflow was removed after the result was committed.

## Interpretation

The raw result must **not** be interpreted as a measured zero-lift outcome.

All six arms (`baseline` and `candidate` for all three cases) have
`measurementComplete: false`. Therefore there are zero complete baseline/candidate pairs from which a
quality delta can be established. The numeric zeroes in the historical raw `summary` were produced by
the original summarizer after incomplete arms were conservatively assigned failing measurements; they
do not establish that the candidate and baseline are equally capable.

Evidence state for this run:

- matched cases: 3;
- complete matched pairs: 0;
- incomplete matched pairs: 3;
- provider calls: 10 of the configured maximum 12;
- result: **INCONCLUSIVE**;
- measured baseline quality: unavailable;
- measured candidate quality: unavailable;
- measured lift: unavailable;
- M10/M15 promotion consequence: none.

No distilled coding capability may be promoted, activated, or advertised as improving Kimi K3 on the
basis of this run.

## Sanitized failure shape

Five arms terminated with `MissionDomainError`; one baseline arm terminated with `ProviderError`. The
historical evidence intentionally stores only bounded error class, latency, provider-call count,
measurement completeness, verification state, and content hashes. It does not contain raw provider
errors or private reasoning, so those historical failures cannot be assigned a more specific root cause
without a separately authorized diagnostic rerun or independently available evidence.

The result does show that the comparison harness preserved fail-closed behavior: incomplete arms were
not allowed to become PASS evidence, and no candidate was promoted.

## Corrective action

The post-run hardening on this branch adds two deterministic protections for future live comparisons:

1. zero complete matched pairs are summarized as `INCONCLUSIVE` with `null` quality/lift fields instead
   of a misleading numeric zero-lift result; partial comparisons score only complete matched pairs;
2. live failures are converted into bounded non-secret diagnostic codes (`provider_*`, `budget_*`, and
   allowlisted mission-domain codes) without persisting raw exception text.

These changes are deterministic and make no provider request. A new Kimi K3 live rerun is a separate
external action and remains unperformed by this correction.

## Verification state

One-shot governance/verification run `33878406947` synchronized ROADMAP, ARCHITECTURE, SECURITY, the
M15 milestone, and HANDOVER after the corrective code was added. Its repository verification step
passed before the helper files were removed and the synchronized checkpoint was pushed. A normal
pull-request CI on the resulting exact head remains the final verification gate for PR #21.
