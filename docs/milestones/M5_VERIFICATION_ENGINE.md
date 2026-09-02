# M5 — Independent verification and adversarial review

Status: implementation in progress. Updated: 2026-09-02.

## Objective

Add a verification authority that is independent from planner and coding-runtime self-assessment.
M5 consumes declared definitions of done plus typed evidence, validates freshness/provenance/binding,
and produces a deterministic verdict. A separate adversarial review pass attempts to falsify a passing
verdict before completion may continue.

M5 integrates with the verified M4 coding slice without granting the verifier repository mutation,
provider credentials, shell execution, or network authority.

## Acceptance criteria

- Verification contracts separate claims, evidence, verifier findings, adversarial findings, verdicts,
  and repair requests. Planner/runtime assertions are inputs, never verification facts.
- Every required definition of done must be bound to explicit typed evidence. Missing, duplicate,
  conflicting, stale, foreign-mission/task, malformed, or failed evidence prevents a passing verdict.
- Evidence carries stable ID, mission/task scope, evidence kind, subject, producer/provenance,
  observation time, content hash, and pass/fail status. Raw tool output is not required in the verdict.
- Evidence freshness is evaluated against an explicit verification time and configured maximum age;
  time parsing and impossible future timestamps fail closed.
- Verification is deterministic: identical normalized inputs produce the same verdict and findings.
- Passing requires every required claim to be satisfied by acceptable evidence and no blocking finding.
  A verifier cannot mark an unverifiable natural-language definition complete merely because the
  planner/runtime says it is complete.
- Adversarial review is a separate interface and execution step. It receives the verifier result plus
  evidence metadata and may return `ACCEPT`, `BLOCK`, or `REPAIR_REQUIRED` with typed findings.
- The built-in adversarial reviewer checks at least stale evidence, reused evidence across unrelated
  claims, weak/self-authored evidence, evidence collected before the claimed change, and contradictory
  pass/fail evidence for the same subject.
- A review `BLOCK` prevents completion. `REPAIR_REQUIRED` produces a bounded targeted repair request;
  it may not directly mutate mission state, repository files, policy, or evidence.
- M4 completion is gated by an injected M5 verification authority. The M4 fixture must prove a valid
  evidence package reaches completion, while false-positive/stale/contradictory evidence cannot.
- Verification decisions are evidence-mapped and hash-addressable without storing private chain of
  thought. Findings contain concise reasons and referenced evidence/claim IDs only.
- Tests cover valid pass, missing evidence, stale evidence, foreign scope, conflicting evidence,
  evidence reuse, adversarial block, repair-required review, deterministic replay, and M4 integration.
- CI uses deterministic in-memory evidence fixtures only. No live provider, network, arbitrary shell,
  deployment, production repository mutation, migration, or paid resource is used.

## Invariants

- Verification authority is distinct from the planner and from the component that performed the edit.
- A model cannot create a passing verdict by asserting that its own definition of done is satisfied.
- Evidence is immutable input to one verification evaluation; verifier/reviewer output cannot rewrite
  the supplied evidence set.
- Unknown evidence kinds, malformed hashes, unknown claim IDs, and malformed timestamps fail closed.
- Review findings are typed and bounded; free-form reviewer text is not executable authority.
- Verification/review may block or request repair but cannot invoke tools directly.
- Mission completion remains deterministic runtime authority. M5 supplies a gate verdict; it does not
  own the M2 state machine.

## Out of scope

- Live model-based judge calls or external judge providers.
- Formal proof systems or language-specific static-analysis engines.
- Production artifact storage, signatures, transparency logs, or remote attestations.
- M6 context/memory compiler and token-cache optimization.
- M7 specialist agents and cross-agent reconciliation.
- Production sandbox, process isolation, or network-capable tools.

## Verification strategy

Run `npm run verify`. M5 is `VERIFIED` only when the final pull-request CI checkpoint passes with
repository documentation synchronized to the observed evidence.
