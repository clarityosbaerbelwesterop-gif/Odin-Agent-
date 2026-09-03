import { decodeClientStateResponse } from "./protocol.js";
import { type ClientReducerState, ClientProtocolError } from "./types.js";

const MAX_TRACKED_EVENT_HASHES = 512;

export function reduceClientState(
  current: ClientReducerState | null,
  value: unknown,
): ClientReducerState {
  const response = decodeClientStateResponse(value);
  if (current === null) {
    return Object.freeze({
      cursor: response.nextCursor,
      missionId: response.missionId,
      projection: structuredClone(response.projection),
      recentEventHashes: boundedHashes({}, response.events),
      sessionId: response.sessionId,
    });
  }

  if (current.missionId !== response.missionId || current.sessionId !== response.sessionId) {
    throw new ClientProtocolError("RESYNC_REQUIRED", "Client response crossed mission/session scope.");
  }
  if (response.projection.version < current.projection.version) {
    throw new ClientProtocolError("RESYNC_REQUIRED", "Client projection version moved backwards.");
  }
  if (response.fromCursor > current.cursor) {
    throw new ClientProtocolError("RESYNC_REQUIRED", "Client cursor continuity was lost.");
  }

  if (response.fromCursor < current.cursor) {
    for (const event of response.events) {
      if (event.cursor > current.cursor) {
        throw new ClientProtocolError("RESYNC_REQUIRED", "Replayed page overlaps unseen events.");
      }
      const knownHash = current.recentEventHashes[String(event.cursor)];
      if (knownHash === undefined || knownHash !== event.eventHash) {
        throw new ClientProtocolError("RESYNC_REQUIRED", "Replayed lifecycle event is unknown or changed.");
      }
    }
    return Object.freeze({
      ...current,
      projection: structuredClone(response.projection),
    });
  }

  return Object.freeze({
    cursor: response.nextCursor,
    missionId: current.missionId,
    projection: structuredClone(response.projection),
    recentEventHashes: boundedHashes(current.recentEventHashes, response.events),
    sessionId: current.sessionId,
  });
}

function boundedHashes(
  existing: Readonly<Record<string, string>>,
  events: readonly { readonly cursor: number; readonly eventHash: string }[],
): Readonly<Record<string, string>> {
  const entries = new Map<number, string>();
  for (const [cursor, hash] of Object.entries(existing)) {
    const parsed = Number(cursor);
    if (Number.isSafeInteger(parsed) && parsed >= 0) entries.set(parsed, hash);
  }
  for (const event of events) entries.set(event.cursor, event.eventHash);
  const kept = [...entries.entries()]
    .sort((left, right) => right[0] - left[0])
    .slice(0, MAX_TRACKED_EVENT_HASHES)
    .sort((left, right) => left[0] - right[0]);
  return Object.freeze(Object.fromEntries(kept.map(([cursor, hash]) => [String(cursor), hash])));
}
