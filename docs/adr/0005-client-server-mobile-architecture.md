# ADR-0005: Client/server architecture for long-running missions

- Status: accepted
- Date: 2026-09-02

## Context

Mobile operating systems cannot be assumed to keep a heavy coding runtime alive for hours. Missions
also need consistent state across phone, tablet, desktop, web, and IDE clients.

## Decision

Canonical work runs in a local host, home server, or managed tenant cell. Clients connect through a
versioned API and durable event stream, resume from offsets, and may observe the same mission
concurrently. Device-node capabilities are optional, explicit, and scoped.

## Consequences

Offline/degraded/local-fallback states must be visible. Protocol negotiation, pairing, revocation,
push notification privacy, and reconnect tests are product requirements. Web precedes native clients
to validate the protocol without treating web code as the runtime state owner.

## Verification

M8/M9 require multi-observer ordering, reconnect/catch-up, revocation, protocol mismatch, background
mission continuity, and cross-device interruption tests.
