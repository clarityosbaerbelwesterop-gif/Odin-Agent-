# ADR-0004: Progressive, versioned skill system

- Status: accepted
- Date: 2026-09-02

## Context

Skills are valuable procedural memory, but loading all skills wastes context and autonomous mutation
can turn prompt injection or one-off mistakes into durable authority.

## Decision

Expose only compact skill metadata initially, then load instructions, references, examples, and tests
progressively. Skills carry provenance, trust class, permissions, token estimate, versions, and known
failure modes. Learned skills remain candidates until replayed, verified, staged, and promoted.
System-protected skills are immutable to agents.

## Consequences

Skill execution and skill installation are separately permissioned. A registry/index and promotion
evaluation are required before a marketplace is considered.

## Verification

M10 requires discovery precision, context-budget, trust-escalation denial, provenance, rollback,
compatibility, and poisoned-skill tests.
