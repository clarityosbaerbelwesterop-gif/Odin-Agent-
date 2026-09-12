# Odin — Personal Agentic Workspace

Odin is a personal agentic workspace built on a provider-independent runtime for complex, long-running
AI missions. A user starts with a goal; Odin keeps the project, plan, run, workspace and evidence
together while its runtime controls tools, verification, repair, budgets and durable recovery.

The historical engineering milestones M0–M28 describe the runtime's evolution and remain valid. The
separate product roadmap uses names such as **PRODUCT M1**. PRODUCT M1 adds the coherent product shell,
Companion, persistent Projects, Workspace foundation and Activity projections without replacing those
runtime authorities. See the [PRODUCT M1 contract](docs/milestones/PRODUCT_M1_PRODUCT_TRANSFORMATION.md).

The repository does **not** yet claim kernel/container isolation, a live hosted sandbox adapter,
arbitrary shell execution, native mobile binaries, a distributed worker queue, or proof for a live
environment unless separate external evidence is recorded. Current status and verified capabilities
are tracked in [ROADMAP.md](ROADMAP.md) and [HANDOVER.md](HANDOVER.md).

## Product contract

Odin will never equate model confidence with correctness. Important work can reach `COMPLETED` only
after the applicable verification gates have produced evidence. Unsupported or unverified features
remain visibly marked as such.

The target flow is:

```text
Request -> Understand -> Plan -> Risk check -> Execute -> Observe
        -> Verify -> Repair when needed -> Checkpoint -> Final audit
```

The language model proposes reasoning and actions. The runtime owns state transitions, permissions,
budgets, timeouts, retries, cancellation, model/sandbox routing, and completion. Clients observe
canonical runtime state and request narrowly scoped control actions; they do not become mission
authority.

## Architecture direction

The first production slice is intentionally narrow: a user supplies a provider key, workspace, and
coding task; Odin creates a task graph, finds relevant files, selects an eligible model profile, applies
scoped changes through controlled tools/execution, runs repository quality gates, repairs failures,
persists mission state, resumes after interruption, and reports evidence plus usage.

Core boundaries:

- trusted control plane: identity, policy, missions, budgets, events, secrets, provider/sandbox config;
- cognitive runtime: planner, context compiler, model router, verifier, repair loop;
- execution plane: M3 tool authority plus M12 workspace/process/network/sandbox boundaries;
- knowledge plane: artifacts, project/user memory, skills, evaluations;
- clients: one versioned protocol for the responsive web client and later native mobile/desktop apps.

### Tool and execution authority

M3 is the tool/capability authority. It validates strict schemas, scoped capability grants, approvals,
idempotency, retry/timeout behavior, and secret-safe audit records before calling adapters. A model
cannot provide an arbitrary shell string, executable path, capability grant, or network destination and
have it become authority.

M12-A/B adds `src/sandbox` around that authority:

- canonical root and symlink-escape protection for read/write/cwd;
- runtime-owned command IDs with fixed executable/arguments and `shell: false`;
- deny-by-default child environment plus bounded output, timeout, cancellation, and concurrency;
- fail-closed HTTPS/host/port/address policy with injected DNS evidence and redirect re-authorization;
- exact `provider + model + profileVersion` sandbox backend binding;
- M11 primary/escalation routing feeding the exact selected model identity into sandbox allocation;
- deterministic remote create idempotency, concurrent replay collapse, required cleanup, idempotent
  release, and released-session reuse denial.

Different routed models may therefore be configured to use different provider keys and different
sandbox backends, Hermes-style, while raw model-provider and sandbox-provider credentials remain in the
trusted control plane rather than prompts, workers, clients, or public binding metadata.

These are local/provider-neutral contracts. A host process is **not** a kernel/container sandbox, the
network policy alone is **not** transport-level DNS pinning, and no paid hosted sandbox provider has
been exercised.

### Verification and recovery

M5 maps definitions of done to typed, scoped, fresh evidence and runs a separate adversarial review.
Missing, stale, foreign, malformed, failed, contradictory, weak, or self-authored evidence blocks
completion or returns bounded repair.

M8 adds local Node 24 SQLite durability for canonical mission events, validated checkpoints, durable
worker jobs, lifecycle cursors, fenced leases, hashed lease tokens, timeout/heartbeat/cancellation, and
reopen recovery. This is local at-least-once durability, not exactly-once external effects or a
distributed queue.

### Memory, specialists, clients, skills, and routing

M6 provides scoped versioned memory and P0–P6 context compilation with current-source precedence and
sensitive-cache exclusion. Its memory adapter remains in-memory.

M7 coordinates bounded specialists with logical ownership and runtime evidence attestation. Its
ownership is single-process logical coordination, not a distributed lock or sandbox.

M9 provides strict client codecs, exact mission/session capabilities, pause/resume/cancel control,
durable reconnect semantics, privacy filtering, and a responsive static web fixture. It is not a
public API/auth/realtime deployment.

M10 provides hash-addressed progressive skills, independent verification/promotion, rollback/revocation,
and candidate-only learned skill synthesis. Skills do not create tool authority or arbitrary execution.

M11 provides empirical quality-floor-first model routing, bounded escalation/critique/repair/branching,
explicit call/cost/concurrency/token ceilings, sensitive cache policy, and an offline evaluation
harness. Cost/latency optimization occurs only after required quality is satisfied.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the architecture map and [SECURITY.md](SECURITY.md) for the
trust boundaries.

## Development

Requirements:

- Node.js 24 or newer;
- npm 11 or newer.

```bash
npm ci
npm run verify
```

No provider or sandbox key is required for repository verification; protocol/sandbox tests use injected
transports/backends and synthetic responses. Durable/client tests use temporary local SQLite files and
injected runtime boundaries. Never put credentials in source, fixtures, logs, prompts, client payloads,
sandbox metadata, or committed environment files.

## Current verification

M12-A/B normal pull-request CI run `33794095989` passed with **237/237 tests**, 0 failures, and aggregate
coverage **89.43% lines / 76.28% branches / 95.37% functions**. M12 remains partially verified because
M12-C release/observability/recovery proof and all live infrastructure evidence are still open.

## Engineering priorities

1. Correctness
2. Security
3. Recoverability
4. Maintainability
5. Observability
6. Performance
7. Verified quality per cost
8. Feature quantity

This repository follows the cycle described in [AGENTS.md](AGENTS.md): understand, plan, implement the
smallest coherent unit, test, verify, review, repair, and checkpoint.
