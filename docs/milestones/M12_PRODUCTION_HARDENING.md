# M12 — Production hardening and release proof

Status: **PARTIALLY_VERIFIED** — M12-A/B local hardening verified; M12-C/live infrastructure evidence remains open. Updated: 2026-09-03.

## Objective

Turn Odin's existing policy boundaries into enforceable local execution/release boundaries before any
public service or production rollout. M12 hardens workspace resolution, subprocess execution, outbound
network policy, observability, recovery/load evidence, and release gates without weakening M3 tool
policy, M5 verification, M8 durability, or M11 quality/budget policy.

M12 distinguishes three evidence levels explicitly:

1. **local deterministic enforcement** — may be implemented and tested without external credentials;
2. **host/container integration evidence** — requires an actually available isolation runtime;
3. **live production/provider evidence** — requires explicit user approval for credentials, traffic,
   deployment, migration, or paid resources.

A lower evidence level must never be documented as a higher one.

## M12-A — Canonical workspace and bounded process boundary

### Canonical workspace

- canonicalize the trusted workspace root through the host filesystem before use;
- reject absolute paths, traversal, NUL/backslash ambiguity, and empty file targets;
- resolve existing targets through `realpath` and require them to remain inside the canonical root;
- for new writes, resolve the nearest existing parent and require it to remain inside the root;
- reject symlink escapes for read/write/cwd resolution;
- do not follow a repository symlink outside the trusted root merely because the lexical path is safe;
- return normalized relative identity plus canonical absolute path only to the trusted execution layer;
- tests must cover direct traversal, nested symlink escape, symlinked directory escape, safe internal
  symlink resolution, missing-parent behavior, and root-prefix confusion (`/root-a` vs `/root-ab`).

This local boundary reduces path/symlink risk but does not claim kernel-level TOCTOU immunity. A future
container/worktree implementation should use stronger mount/namespace/dirfd-style primitives where
available.

### Process runner

- models/workers select only stable command IDs; they never provide shell strings or executable paths;
- command definitions are trusted runtime configuration with immutable executable/fixed argument data;
- execution uses `shell: false`;
- cwd must resolve through the canonical workspace boundary;
- child environment is deny-by-default and receives only explicit allowlisted variables plus fixed
  runtime-owned values;
- timeout and cooperative cancellation terminate the child; implementation must not treat late success
  as success after cancellation;
- stdout/stderr collection is independently byte-bounded; overflow terminates execution and returns a
  typed limit outcome;
- exit/signal/timeout/cancel/output-limit outcomes are normalized without leaking the host environment;
- no raw credential environment is inherited by default;
- process concurrency is bounded by runtime configuration.

A host subprocess is **not** a container sandbox. Filesystem visibility outside the workspace and
network isolation require stronger host/container enforcement before arbitrary/untrusted code is
production-safe.

## M12-B — Outbound network and provider-dependent sandbox boundary

Before a production network-capable worker exists, define and test a fail-closed destination policy:

- HTTPS by default; explicit development override only in trusted configuration;
- no URL credentials, fragments, control characters, or ambiguous host syntax;
- explicit hostname/port allowlists or scoped destination grants;
- IP literals and resolved addresses are classified; loopback, link-local, private, multicast,
  unspecified, and other reserved destinations are denied by default;
- DNS resolution is injected/testable and all returned addresses must satisfy policy;
- a successful policy decision includes the exact normalized destination and resolution evidence needed
  by a future transport to prevent DNS-rebinding/time-of-check-time-of-use bypass;
- redirects require a fresh policy decision and never inherit approval for a different destination.

M12-B also provides the runtime contract for Hermes-style provider/model-dependent sandbox selection:

- exact `provider + model + profileVersion` identity selects a runtime-owned sandbox backend;
- M11 primary/escalation routing passes the selected exact model profile into sandbox allocation;
- provider API credentials resolve from exact provider/model context in the trusted control plane;
- sandbox credentials remain behind runtime-owned credential references and are never exposed in model,
  worker, client, projection, or public binding metadata;
- remote sandbox create uses a deterministic allocation/idempotency key;
- exact sequential replay and concurrent identical allocation collapse to one provider create;
- conflicting replay fails closed rather than silently creating a differently configured sandbox;
- remote backends must implement deterministic cleanup;
- release is scoped and idempotent and a released session cannot silently become usable again;
- optional provider expiry metadata remains structurally optional and validated when present.

These are provider-neutral contracts tested through injected adapters. No hosted sandbox provider has
been called. Outbound policy tests alone do not prove transport-level DNS pinning; a production
transport must consume and enforce the decision rather than independently resolving again.

## Verified M12-A/B repository evidence

Normal pull-request CI run `33794095989` passed on human-authored head
`661510592ffa7e9c2370d8d0097f8355ea9f34fc` with **237 tests, 237 passes, 0 failures** and aggregate
coverage **89.43% lines / 76.28% branches / 95.37% functions**. Foundation validation, Biome, strict
TypeScript, and the complete repository suite passed.

The verified local tranche includes canonical workspace enforcement, bounded host-process execution,
outbound destination policy, exact provider/model/profile sandbox-backend binding, model-specific
provider credential context, M11 route-to-sandbox selection, deterministic remote allocation
idempotency, concurrent replay collapse, required remote cleanup, idempotent release, and
released-session reuse denial. Remote adapters are injected contracts only; no hosted sandbox provider
was called and no paid resource was created.

## M12-C — Observability, load/recovery, and release gates

Still open after the M12-A/B merge:

- structured security/runtime events use typed reason codes, hashes, bounded metadata, and timestamps;
- no private chain-of-thought, raw credentials, full environment, or unbounded process output in logs;
- deterministic load/recovery fixtures cover cancellation races, output pressure, timeout, lease/reopen,
  sandbox lifecycle replay/cleanup, and bounded concurrency;
- release evidence records exact commit, configuration profile, test/eval suite identity, and hashes;
- a release gate fails closed when required local, integration, security, recovery, or live-eval evidence
  is missing;
- backup/recovery evidence is explicit and scoped to what was actually exercised;
- live-provider compatibility/quality claims require an explicitly authorized live smoke/eval run;
- deployment/public-auth/realtime claims require separately verified production infrastructure.

## Acceptance regressions for the verified local tranche

- canonical workspace accepts a normal internal path and rejects lexical traversal;
- a symlink inside the workspace pointing outside is denied for file and cwd resolution;
- an internal symlink whose canonical target remains inside is accepted;
- trusted command IDs execute with `shell: false` through an injected/Node process adapter;
- unknown command IDs and caller-supplied executable/shell text are structurally impossible or denied;
- inherited secret-like environment variables are absent unless explicitly allowlisted;
- timeout, cancellation, non-zero exit, signal exit, and output-limit outcomes are typed and bounded;
- process output limits apply before unbounded buffering;
- process concurrency is reserved before async path resolution and released on failure;
- outbound policy rejects localhost/private/reserved literals and injected private DNS answers;
- redirect/destination changes require re-authorization;
- exact model-profile routing selects the exact sandbox binding without leaking credentials;
- exact and concurrent allocation replay cannot multiply remote sandbox creation;
- remote backends without cleanup fail closed at registration;
- cleanup replay is idempotent and released sessions cannot be reused.

## Out of scope without separate authorization

- spending money on hosted sandboxes, provider calls, load generators, queues, databases, or deployment;
- production migration;
- enabling billing;
- public traffic or customer data;
- using user/provider credentials for live smoke tests;
- claiming Docker/Kubernetes/VM isolation unless that runtime is actually integrated and tested;
- claiming DNS-rebinding resistance unless the network transport enforces the resolved decision.

M12 remains `PARTIALLY_VERIFIED` while M12-C and live/infrastructure evidence remain open. It becomes
fully `VERIFIED` only when every ROADMAP M12 claim has matching evidence at the correct enforcement
level.
