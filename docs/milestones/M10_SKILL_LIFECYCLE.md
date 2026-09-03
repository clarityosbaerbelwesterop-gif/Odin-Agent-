# M10 — Progressive skill lifecycle and synthesis

Status: implementation in progress. Updated: 2026-09-03.

## Objective

Add a first-class skill package boundary that lets Odin discover compact capabilities, progressively
load only relevant instructions, reuse learned procedures, and create new skill candidates from solved
work without ever allowing model output or a skill package to mint execution authority.

M10 turns repeated reasoning into reusable verified procedure while preserving the M3 policy boundary,
M5 independent verification, M6 context priorities, and M7 worker isolation. It is an architectural
capability amplifier, not a claim that a weaker model becomes AGI or universally matches a stronger
model.

## Design principles

1. **Progressive disclosure:** discovery exposes compact metadata only; full instructions load only
   after exact skill/version selection.
2. **Instructions are not authority:** a skill can declare required tools/capabilities but cannot grant
   them. M3 remains the only tool-execution policy boundary.
3. **Immutable versions:** skill identity and version are stable; package content is hash-addressed.
4. **Provenance first:** every package records origin, source reference, observation time, and trust
   class. Learned/community content is untrusted by default.
5. **Candidate before promotion:** synthesized skills start as candidates. They cannot self-promote.
6. **Independent promotion evidence:** learned/community skills require passing test evidence and an
   independently verified promotion record before activation.
7. **Rollback:** active versions can be superseded or revoked without deleting prior audit history.
8. **Bounded loading:** package sizes, capabilities, tags, test refs, and instruction bytes are bounded
   and validated before entering model context.

## Skill model

A package contains:

- stable `name` and `version`;
- compact summary, tags, and capability declarations;
- provenance and trust class (`builtin`, `project`, `learned`, `community`);
- bounded human/model-readable instructions;
- referenced tool names rather than executable handlers or credentials;
- test/evaluation references and content hash;
- lifecycle state (`CANDIDATE`, `VERIFIED`, `ACTIVE`, `REVOKED`).

Discovery returns only identity/version/summary/tags/required-tool names/trust/lifecycle. Full
instructions are resolved separately and only for `VERIFIED` or `ACTIVE` packages. Candidate packages
may be inspected by the trusted promotion path but are not normal runtime skills.

## Synthesized skill candidates

The runtime may accept a model- or worker-proposed skill candidate after a successfully solved task.
That proposal is untrusted data and must include bounded instructions, exact required tools, source
mission/task identity, and content provenance. Candidate creation performs no tool execution and grants
no permissions.

A candidate becomes `VERIFIED` only when an independent authority supplies evidence bound to the exact
package hash and version. Activation is a separate trusted promotion action. Learned/community skills
can never activate themselves merely by returning a success claim, test string, or capability-shaped
object.

## Acceptance criteria

### Package registry

- exact bounded validation for names, versions, summaries, tags, tool references, timestamps,
  provenance, lifecycle, test refs, and instruction size;
- deterministic compact discovery order and defensive immutable results;
- duplicate package identity/version conflicts fail closed;
- full instructions are not present in discovery summaries;
- unknown versions and malformed packages fail closed.

### Progressive loading

- normal resolution loads full instructions only for `VERIFIED`/`ACTIVE` packages;
- candidate/revoked packages cannot be loaded as normal runtime skills;
- loading is bounded by explicit maximum package/instruction sizes;
- a skill declaration never alters M3 capability grants or tool registrations.

### Promotion and rollback

- promotion evidence binds exact package name/version/content hash, producer class, timestamp, status,
  and evidence references;
- learned/community verification requires independent evidence and rejects self-authored runtime/model
  claims;
- activation requires trusted runtime/user promotion after verification;
- active version selection is deterministic and at most one version per skill name is active;
- revocation removes a package from active resolution without deleting immutable historical metadata;
- rollback to a previously verified version is explicit and auditable.

### Skill synthesis

- a solved-task proposal can create only a `CANDIDATE` package;
- source mission/task/provenance is mandatory;
- generated executable code is represented only as an artifact/tool reference and receives no direct
  host execution authority;
- exact duplicate candidate replay is idempotent; conflicting replay fails closed;
- no synthesized skill can bypass M3 tool policy, M5 completion verification, or M7 worker ownership.

### Tests

Required deterministic regressions include:

- compact discovery and progressive instruction loading;
- malformed/oversized/duplicate package rejection;
- candidate and revoked load denial;
- exact content-hash verification binding;
- independent learned/community promotion and self-promotion denial;
- activation, supersession, revocation, and rollback;
- synthesized candidate creation and conflicting replay;
- proof that required-tool declarations do not create a capability grant or tool handler;
- stable replay/order/hash behavior.

## AGI-bridge mapping from the expanded product research

M10 implements the reusable-skill part of the larger capability-amplification architecture. Existing
milestones already provide important pieces: M6 gives scoped memory/context and compression-friendly
context compilation; M7 gives bounded specialist decomposition/parallel work; M8 gives durable
long-running state; M5/M4 provide verification and repair loops.

Future milestones should extend, not duplicate, those foundations:

- **M11 adaptive reasoning/router:** empirical model routing, caching, concurrency, quality floors,
  multi-pass critique, bounded branch search, and escalation based on uncertainty/evidence.
- **M12 production hardening:** real process/container/worktree sandboxing, outbound-network controls,
  live-provider smoke/evals, load/recovery, observability, backups, and release gates.
- **Post-MVP learning/runtime track:** productionized hybrid memory retrieval/retention, post-task
  learning curation, event-driven schedulers/triggers, background mission service, and protocol-based
  MCP/Agent-Skills/omnichannel adapters behind the same permission model.

These mechanisms can substantially improve reliability, continuity, tool use, and effective output of
small/fast models, but Odin must measure that improvement empirically rather than claiming model-level
or AGI equivalence without evidence.

## Out of scope

- arbitrary Python or shell execution embedded inside a skill package;
- self-modifying policy or auto-granted credentials/capabilities;
- downloading/executing community skills from the public internet;
- production package signing/PKI and remote marketplace distribution;
- live MCP servers, browser automation, Docker/Modal/Vercel sandbox execution;
- autonomous background daemon/scheduler or messaging-channel integrations;
- live provider calls, production deployment, paid resources, or production migration.

M10 is `VERIFIED` only after implementation, requirement-derived tests, synchronized architecture/
security/roadmap/handover documentation, and final pull-request CI all pass.