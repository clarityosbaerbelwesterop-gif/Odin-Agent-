# Odin Agent

Odin is a provider-independent runtime for complex, long-running AI missions. Its purpose is
to turn a model call into a controlled system with planning, task state, tools, verification,
repair, checkpoints, budgets, durable recovery, and auditable evidence.

Odin is at the **early core stage**. Repository foundation, the provider-neutral inference boundary,
the deterministic mission runtime, the fail-closed tool-control boundary, a fixture-backed coding
vertical slice, independent evidence verification, scoped memory/context, bounded specialist
coordination, and a local SQLite durable-mission/job slice are implemented and contract-tested.
The repository does not yet provide a production coding agent, OS-level sandbox, arbitrary shell
execution, external network tools, mobile client, hosted service, distributed worker queue, or
live-provider end-to-end smoke proof.
Current status and verified capabilities are tracked in [ROADMAP.md](ROADMAP.md) and
[HANDOVER.md](HANDOVER.md).

## Product contract

Odin will never equate model confidence with correctness. Important work can reach `COMPLETED`
only after the applicable verification gates have produced evidence. Unsupported or unverified
features remain visibly marked as such.

The target flow is:

```text
Request -> Understand -> Plan -> Risk check -> Execute -> Observe
        -> Verify -> Repair when needed -> Checkpoint -> Final audit
```

The language model proposes reasoning and actions. The runtime owns state transitions,
permissions, budgets, timeouts, retries, cancellation, and completion.

## Architecture direction

The first production slice is intentionally narrow: a user supplies a workspace and a coding
task; Odin creates a task graph, finds relevant files, applies a scoped change, runs repository
quality gates, repairs failures, persists mission state, resumes after interruption, and reports
evidence plus usage.

Core boundaries:

- trusted control plane: identity, policy, missions, budgets, events, secrets;
- cognitive runtime: planner, context compiler, model router, verifier, repair loop;
- execution plane: isolated workers, tools, sandboxes, browsers, repository workspaces;
- knowledge plane: artifacts, project memory, user memory, skills, evaluations;
- clients: web first, followed by native mobile/desktop clients over one versioned protocol.

The current M3 tool runtime is a control boundary, not a sandbox claim. It validates tool schemas,
scoped capability grants, approval evidence, idempotency, retry/timeout behavior, and secret-safe
audit records before calling injected repository adapters. Arbitrary shell commands and external
network tools remain unavailable.

The M5 verification authority maps persisted definitions of done to typed, scoped, fresh evidence
and runs a separate adversarial review before M4 may report completion. Missing, stale, foreign,
malformed, failed, contradictory, weak, or self-authored evidence blocks completion or returns a
bounded repair request. Verifier output carries deterministic hashes, not private reasoning.

The M6 knowledge slice stores versioned, provenance-bearing working/project/user/episodic/semantic
memory behind an asynchronous contract and retrieves it within exact user/project/mission boundaries.
Its context compiler preserves mandatory P0 system, P1 mission, and P2 task context, gives current
repository evidence authority over memory/history, applies deterministic token estimates and budgets,
and excludes sensitive compilations from its bounded cache. M6 memory remains an in-memory contract;
its session snapshot hash is not a durability or authentication claim.

The M7 coordination slice discovers specialists through compact role/capability metadata, reserves
expiring repository/resource/state ownership before execution, and sends each injected worker one
immutable assignment. Results remain untrusted proposals and require runtime evidence attestation.
M7 ownership is still a single-process logical-lock contract; it is not an OS sandbox or distributed
lock service.

The M8 durable slice adds Node 24 built-in SQLite storage for canonical M2 mission events, validated
checkpoints, and worker jobs. Event append/idempotency survives close/reopen. Jobs use bounded attempts,
deterministic claim order, expiring fenced leases, hashed lease tokens, retry/cancellation settlement,
mission-scoped lifecycle cursors, and runtime-owned heartbeat/timeout handling. Recovery tests reopen
the same SQLite file, reclaim expired work at a higher generation, reject stale completion, resume the
cursor, and drain a 32-job fixture. This is **local at-least-once durability**, not a hosted queue,
exactly-once external effects, cross-host fencing, or distributed availability.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current architecture map and
[SECURITY.md](SECURITY.md) for the trust boundaries.

## Development

Requirements:

- Node.js 24 or newer;
- npm 11 or newer.

```bash
npm ci
npm run verify
```

No provider key is required for verification; provider protocol tests use injected transports and
synthetic responses. Durable tests use only temporary local SQLite files and injected handlers. Never
put credentials in source, fixtures, logs, prompts, or committed environment files.

## Engineering priorities

1. Correctness
2. Security
3. Recoverability
4. Maintainability
5. Observability
6. Performance
7. Verified quality per cost
8. Feature quantity

This repository follows the cycle described in [AGENTS.md](AGENTS.md): understand, plan,
implement the smallest coherent unit, test, verify, review, repair, and checkpoint.
