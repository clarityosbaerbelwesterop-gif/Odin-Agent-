# Engineering handover

Updated: 2026-09-02.

## Current state

- Repository: `clarityosbaerbelwesterop-gif/Odin-Agent-` (private).
- Default branch baseline: `main` at `fbc79820b6de36f94289d46df967a173d50e8f37`.
- Work branch: `agent/odin-foundation`, initially at the same baseline.
- The original repository contained only `README.md` with `# Odin-Agent-`.
- No prior code, tests, CI, dependency files, security rules, ADRs, or provider configuration existed.
- The supplied Hermes/OpenClaw project report was read in full before design work. Its derived
  decisions are recorded under `docs/research/HERMES_OPENCLAW_DECISIONS.md` so research observations
  are not confused with Odin's implementation state.

## Active milestone

M0 repository foundation. The intended checkpoint contains governance, target architecture, security
boundaries, research decisions, locked development tooling, and a deterministic CI baseline. It does
not claim a functioning agent runtime.

## Verified evidence

Local M0 baseline:

```bash
npm ci
npm run verify
```

Result on 2026-09-02: dependency installation succeeded; foundation validation passed with all
required files; Biome formatting/lint checks passed with no findings; `git diff --check` passed; a
targeted high-confidence secret-pattern scan returned no findings. Pull-request CI remains pending
until this checkpoint is pushed.

## Decisions

- Start as a TypeScript strict modular monolith on Node.js 24; split deployments only for proven
  isolation or scaling needs.
- Use append-only mission events plus projections/checkpoints; chat is not canonical state.
- Keep provider-specific behavior behind adapters and use injected transports for zero-cost tests.
- Make sandboxing, network denial, capability checks, and secret isolation defaults.
- Deliver the coding workflow as the first vertical product slice before mobile breadth or a large
  skill marketplace.

## Open risks

- None of the product runtime is implemented yet.
- Provider semantics must be checked against current primary documentation during M1.
- The initial branch has no protection; merge policy and required checks remain repository settings.
- Managed sandbox selection, persistence library, and web stack remain deliberately undecided until
  their milestone supplies concrete requirements.

## Exact next action

Finish M0 verification and PR checkpoint. Then create the M1 provider task contract, confirm current
provider protocols from primary documentation, implement normalized contracts/adapters with mocked
HTTP tests, and update this handover with exact evidence.
