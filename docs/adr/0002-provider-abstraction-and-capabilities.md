# ADR-0002: Provider abstraction and capability profiles

- Status: accepted
- Date: 2026-09-02

## Context

Odin must support OpenAI, Anthropic, OpenRouter, NVIDIA, and compatible endpoints without leaking
provider payloads into planning, mission, tool, or verification logic. Model names alone are not
reliable capability contracts.

## Decision

Define one normalized model request/response/stream/error/usage contract. Adapters own wire formats.
Versioned capability profiles record source and timestamp, permit local overrides, and later absorb
empirical eval results. HTTP transport and clock are injected for deterministic, zero-cost tests.

## Consequences

Provider-specific features require explicit normalized extensions or capability checks. Lowest-common-
denominator design is rejected: unsupported capabilities fail before a charged request.

## Verification

M1 requires contract fixtures for every adapter, abort/timeout/rate-limit/malformed-output cases,
stream reconstruction, tool calls, usage mapping, capability overrides, and secret-safe errors.
