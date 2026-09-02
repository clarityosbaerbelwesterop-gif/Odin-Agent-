# Hermes/OpenClaw research decisions

Source reviewed in full: the user-supplied `deep-research-report.md`, dated 2026-09-02. This file
records engineering consequences; it is not an assertion that Odin implements them yet.

## KEEP

| Observation | Odin decision |
|---|---|
| Hermes programmatic tool calling keeps mechanical intermediate data outside model context. | Build a bounded workflow worker whose tool stubs use RPC and return only explicitly emitted results. |
| Hermes progressively reveals tools and skills. | Keep a compact capability registry in base context and load schemas, instructions, references, and examples only on demand. |
| Hermes separates compact memory facts from reusable procedural skills. | Maintain distinct working, project, user, episodic, and skill stores with provenance. |
| Hermes delegates into isolated sessions and returns compact structured results. | Specialists receive task contracts and return result, evidence, artifacts, assumptions, risks, and remaining work. |
| OpenClaw treats the gateway as a trusted control plane and execution as untrusted. | Keep identity, policy, secrets, canonical state, and budgets in a minimal control plane; isolate workers and plugins. |
| OpenClaw models sessions, devices, channels, automation, and execution targets as platform concerns. | Use one durable mission/event protocol for web, native clients, IDEs, and reconnecting observers. |
| OpenClaw openly distinguishes safe filesystem helpers from real sandboxing. | Treat path guards as defense in depth, never as an execution-isolation claim. |

## IMPROVE

| Existing idea | Weakness observed | Odin improvement |
|---|---|---|
| Context compression | Summaries can fail, grow, lose facts, or interact badly with locked persistence. | Preserve raw events/artifacts and construct typed, budgeted context views; summaries are rebuildable projections. |
| SQLite local state | Long writes can serialize unrelated work, especially around network calls. | Use WAL, short optimistic transactions, job leases, and never hold a write transaction across external I/O. |
| Self-modifying skills | One poisoned observation can become durable procedure. | Candidate/promotion pipeline with provenance, replay tests, trust classes, independent verification, and rollback. |
| Multi-agent execution | Concurrent writers can conflict or corrupt shared assumptions. | Dependency/file/resource analysis, explicit ownership, isolated worktrees, reconciliation, and full integration tests. |
| Provider breadth | Names alone do not express capabilities or observed reliability. | Versioned capability profiles combine provider metadata, local overrides, and eval observations with provenance. |
| Mobile companion nodes | Requiring a visible host complicates the product experience. | Offer local, home-server, or managed runtime cells behind one secure account and clearly expose connection mode. |

## REPLACE

| Existing approach | Odin replacement |
|---|---|
| Long conversation plus periodic destructive summarization as operational state. | Append-only mission events, versioned projections, content-addressed artifacts, and resumable checkpoints. |
| Model-controlled free-running loop. | Closed runtime state machine with transition preconditions, budgets, cancellation, typed failures, and circuit breakers. |
| Tool allowlist as the primary authority model. | Short-lived capability grants bound to tenant, mission, task, tool, resource, operation, call count, and expiry. |
| In-process native extension execution. | Signed/pinned packages in separately permissioned workers over versioned RPC. |
| Builder decides its own work is complete. | Acceptance contract plus independently contextualized verifier and evidence mapping. |
| One large gateway as cross-tenant isolation. | Tenant/runtime cells as isolation boundaries; a gateway is one trust domain, not a hostile multi-tenant sandbox. |

## AVOID

- Sandboxing or command approvals disabled by default.
- Raw secrets in model prompts, normal child environments, logs, or artifacts.
- Network model calls while database write locks are held.
- Single-viewer live sessions that lose state on device handoff.
- Permanent skills or memories learned directly from untrusted content.
- Endless retry loops repeating the same failure, fix, or hypothesis.
- Frontier models and independent reviewers on every trivial task.
- Giant static prompts containing every tool, skill, file, or prior message.
- Fake progress percentages, mocked product claims, disabled tests, and placeholder core behavior.
- A wide integration marketplace before a verified coding vertical slice exists.

## Odin invariants derived from the report

1. Model output is a proposal and untrusted input to the runtime.
2. Verification status is evidence-derived and uses named states, never invented confidence numbers.
3. Raw mission facts survive context reduction and process restart.
4. Security policy fails closed; convenience requires explicit scoped grants.
5. Context and verification effort are proportional to task risk and difficulty.
6. A cheaper model is amplified through structure and evidence; equivalence to a stronger model is
   never promised.
7. Any orchestration complexity must demonstrate quality, recovery, or cost value in reproducible
   evals.
