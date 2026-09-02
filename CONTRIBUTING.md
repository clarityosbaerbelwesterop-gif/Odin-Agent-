# Contributing

Odin is built as verified vertical slices rather than disconnected feature scaffolds.

Before implementation, create or update a task contract containing:

- objective and user-visible outcome;
- acceptance criteria;
- invariants and out-of-scope work;
- expected artifacts;
- risks and rollback strategy;
- exact verification gates.

Use a focused branch and conventional commit messages. Run `npm ci` after dependency changes and
commit the resulting lockfile. Run `npm run verify` before pushing. Pull requests must explain what
is verified, what remains unverified, security impact, and any intentionally deferred work.

Architecture changes require an ADR. An ADR records the observed problem, decision, alternatives,
trade-offs, and consequences; it does not serve as marketing material.
