# Client protocol strategy

Status: M9 implementation strategy, 2026-09-03.

Odin uses one versioned client protocol for the responsive web shell and future native clients on
iOS, iPadOS, macOS, and Android. Clients observe and request bounded control operations; they never
host canonical mission execution or become completion authority.

## Authority model

Canonical mission state remains in the trusted runtime and durable store. A client receives a derived
mission projection plus paged lifecycle activity. Pause, resume, and cancel are requests that must pass
server-side protocol decoding, exact mission/session capability policy, request-time checks,
optimistic mission versions, M2 transition validation, and durable idempotency.

A capability identifier is opaque client data. The actual grant is resolved by runtime-owned policy;
a browser or native app cannot mint permissions by sending an object that claims them.

## Reconnect model

Clients persist only the minimum reconnect cursor and transient rendered state. The M8 lifecycle
cursor is global, while lifecycle reads are mission-scoped, so numeric cursor gaps can legitimately be
caused by other missions. Continuity is therefore defined by request/response `afterCursor` chaining,
strictly increasing delivered events, mission identity, and event hashes—not by requiring cursor + 1.

On reconnect, a client asks for state strictly after its last accepted cursor. Every response also
contains a fresh canonical mission projection, so mission state, tasks, budgets, and verification can
advance even when no worker lifecycle event was emitted. A stale, foreign, changed, or overlapping
unknown replay causes a full bootstrap rather than silent repair in the client.

## Transport independence

M9 defines data and state semantics, not a public transport. A later service can map the same contract
to HTTPS bootstrap/commands plus SSE or WebSocket delivery without changing mission authority.
Native clients use the same protocol types and reconnect cursor; platform UI code does not implement a
second scheduler or mission state machine.

Mobile background suspension is expected. Long-running work continues in the trusted runtime and the
client reconnects from its cursor when foregrounded. Push notification delivery, device sessions,
public authentication, offline writes, and conflict-free mutation are later work.

## Versioning

Protocol major versions are incompatible and fail closed. A client may send an older minor version
within the supported major only when the runtime decoder explicitly accepts it. Unknown fields and
unsupported commands fail closed; compatibility is never inferred from JavaScript tolerance.

## Privacy and storage

Never place provider keys, lease bearer tokens, repository contents, private reasoning, raw worker
exceptions, or hidden policy internals into client payloads. Identifiers and cursors are not secret
containers. The M9 reference web shell does not persist mission data in `localStorage` and does not put
capabilities in URLs.

## M9 boundary

The checked-in web shell is a responsive fixture/reference client only. It performs no live network
request and has no production authentication or hosting claim. Native application binaries, app-store
packaging, real-time transport, production CSP/security headers, and background push are out of M9.
