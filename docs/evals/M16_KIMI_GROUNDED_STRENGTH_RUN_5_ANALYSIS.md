# M16 Kimi K3 grounded strength run 5 analysis

Updated: 2026-09-04.

## Evidence

Authorized workflow `33898932204` completed successfully after full repository verification, build, and a credential-free strength dry-run. It used the bounded 16/16 provider calls across four matched NVIDIA `moonshotai/kimi-k3` baseline-vs-grounded cases. Sanitized evidence is `docs/evals/m16-kimi-grounded-strength-run-5.json`.

## Measured outcome

All four matched pairs are complete. Neither arm completed a case, so quality/completion lift is 0 and this run is not a quality win. Grounded Odin nevertheless reduced total tokens from 9,420 to 5,457 (**42.07%**) and aggregate latency from 588,336 ms to 565,906 ms (**3.81%**) with the same 8 provider calls per side.

## Failure pattern

The new telemetry makes the next defect concrete. Two grounded repair calls ended with `finishReason=length`; the other two grounded cases reached deterministic non-accepting/no-change repair outcomes. The v1 wrapper still asks Kimi to emit complete replacement files, which spends output budget on unchanged text and makes repair truncation/no-change more likely even for surgical objectives.

## Next change

M16 v2 converts the model-facing plan and repair contract to a **surgical exact-edit protocol**: model output selects a trusted path and returns one verbatim `oldText` plus replacement `newText`. Odin requires exactly one match in trusted current content, rejects missing/ambiguous/no-op edits, then expands the bounded edit into the existing full-file M4 contract while binding SHA/task metadata itself. Quality and M5 gates remain unchanged.

Offline hardening workflow `33903431815` passed full `npm run verify`, build, and credential-free dry runs of both M16 suites before the verified v2 implementation was committed. Normal PR CI then passed and the surgical protocol was merged.

Before any new provider comparison, workflow `33903724465` separately verified the immutable evidence identity `m16-grounded-surgical-live-v2` with full repository verification, build, and both credential-free dry suites. This prevents the new surgical protocol from being numerically conflated with the earlier full-file profile.

A further live comparison is valid only after the profile-identity PR passes normal CI and merges. Numeric lift remains specific to Kimi K3 / this profile / these task suites.