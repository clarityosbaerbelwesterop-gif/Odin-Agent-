# Odin Agent

Odin is a provider-independent runtime for complex, long-running AI missions. Its purpose is
to turn a model call into a controlled system with planning, task state, tools, verification,
repair, checkpoints, budgets, and auditable evidence.

Odin is at the **early core stage**. Repository foundation, the provider-neutral inference boundary,
the deterministic mission runtime, the fail-closed tool-control boundary, a fixture-backed coding
vertical slice, and independent evidence verification are implemented and contract-tested. The
repository does not yet provide a production coding agent, OS-level sandbox, durable database
persistence, mobile client, or hosted service, and no live-provider smoke test has been claimed.
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

The M5 verification authority maps every persisted definition of done to typed, scoped, fresh
evidence and runs a separate adversarial review before M4 may report completion. Missing, stale,
foreign, malformed, failed, contradictory, weak, or self-authored evidence blocks completion or
returns a bounded repair request. Verifier output carries deterministic hashes, not private reasoning.

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
synthetic responses. Never put credentials in source, fixtures, logs, prompts, or committed
environment files.

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
