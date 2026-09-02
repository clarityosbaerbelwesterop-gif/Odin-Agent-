# Odin Agent

Odin is a provider-independent runtime for complex, long-running AI missions. Its purpose is
to turn a model call into a controlled system with planning, task state, tools, verification,
repair, checkpoints, budgets, and auditable evidence.

Odin is at the **foundation stage**. The repository does not yet provide a production agent,
mobile client, hosted service, or finished provider integration. Current status and verified
capabilities are tracked in [ROADMAP.md](ROADMAP.md) and [HANDOVER.md](HANDOVER.md).

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

No provider key is required for foundation checks. Never put credentials in source, fixtures,
logs, prompts, or committed environment files.

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
