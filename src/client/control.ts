import type { DurableJobStatus, JobLifecycleEvent } from "../durable/types.js";
import {
  type EventAppendItem,
  type EventStore,
  EventStoreConflictError,
  type StoredEvent,
} from "../events/store.js";
import {
  MissionDomainError,
  type MissionEventData,
  type MissionSnapshot,
  projectMission,
  transitionEvent,
} from "../mission/runtime.js";
import {
  buildClientProjection,
  decodeClientCommandRequest,
  decodeClientStateRequest,
  decodeClientStateResponse,
  normalizeCapabilityGrant,
  normalizeLifecycleEvent,
} from "./protocol.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCapabilityGrant,
  type ClientCommandName,
  type ClientCommandRequest,
  type ClientCommandResponse,
  ClientProtocolError,
  type ClientStateResponse,
  type ClientVerificationSummary,
} from "./types.js";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface ClientCapabilityPolicy {
  resolve(capabilityId: string): ClientCapabilityGrant | null;
}

export class InMemoryClientCapabilityPolicy implements ClientCapabilityPolicy {
  readonly #grants = new Map<string, ClientCapabilityGrant>();

  constructor(grants: readonly ClientCapabilityGrant[]) {
    for (const value of grants) {
      const grant = normalizeCapabilityGrant(value);
      if (this.#grants.has(grant.id)) {
        throw new ClientProtocolError("MALFORMED", `Duplicate client capability ${grant.id}.`);
      }
      this.#grants.set(grant.id, grant);
    }
  }

  resolve(capabilityId: string): ClientCapabilityGrant | null {
    const grant = this.#grants.get(capabilityId);
    return grant === undefined ? null : structuredClone(grant);
  }
}

export interface ClientActivitySource {
  jobCounts(missionId: string): Promise<Readonly<Record<DurableJobStatus, number>>>;
  readJobEvents(
    missionId: string,
    afterCursor: number,
    limit: number,
  ): Promise<readonly JobLifecycleEvent[]>;
}

export interface ClientVerificationSource {
  summary(missionId: string): Promise<ClientVerificationSummary>;
}

export class UnavailableVerificationSource implements ClientVerificationSource {
  async summary(_missionId: string): Promise<ClientVerificationSummary> {
    return Object.freeze({ evidenceRefs: Object.freeze([]), status: "UNAVAILABLE" });
  }
}

export interface MissionCommandAuthority {
  execute(request: ClientCommandRequest): Promise<MissionSnapshot>;
}

export class EventStoreMissionCommandAuthority implements MissionCommandAuthority {
  readonly #store: EventStore<MissionEventData>;

  constructor(store: EventStore<MissionEventData>) {
    this.#store = store;
  }

  async execute(request: ClientCommandRequest): Promise<MissionSnapshot> {
    const events = await this.#store.load(request.missionId);
    if (request.expectedVersion > events.length || request.expectedVersion < 1) {
      throw new ClientProtocolError("STALE_VERSION", "Command mission version is unavailable.");
    }
    const prefix = events.slice(0, request.expectedVersion);
    let workingEvents = [...prefix];
    let snapshot: MissionSnapshot;
    try {
      snapshot = projectMission(workingEvents);
    } catch {
      throw new ClientProtocolError(
        "CONFLICT",
        "Command cannot project its expected mission state.",
      );
    }
    if (snapshot.id !== request.missionId || snapshot.version !== request.expectedVersion) {
      throw new ClientProtocolError("STALE_VERSION", "Command mission version does not match.");
    }

    const targets = commandTargets(request.command, snapshot);
    const items: EventAppendItem<MissionEventData>[] = [];
    const scopedIdempotencyKey = `client:${request.sessionId}:${request.idempotencyKey}`;
    for (const target of targets) {
      let data: MissionEventData;
      try {
        data = transitionEvent(snapshot, target);
      } catch (error) {
        if (error instanceof MissionDomainError) {
          throw new ClientProtocolError("CONFLICT", "Command is not valid for the mission state.");
        }
        throw error;
      }
      items.push({ data, occurredAt: request.issuedAt });
      const sequence = workingEvents.length + 1;
      const synthetic: StoredEvent<MissionEventData> = {
        aggregateVersion: sequence,
        data,
        idempotencyKey: scopedIdempotencyKey,
        missionId: request.missionId,
        occurredAt: request.issuedAt,
        sequence,
      };
      workingEvents = [...workingEvents, synthetic];
      snapshot = projectMission(workingEvents);
    }

    try {
      await this.#store.append(
        request.missionId,
        request.expectedVersion,
        scopedIdempotencyKey,
        items,
      );
    } catch (error) {
      if (error instanceof EventStoreConflictError) {
        const code = error.message.toLowerCase().includes("idempotency")
          ? "CONFLICT"
          : "STALE_VERSION";
        throw new ClientProtocolError(code, "Command conflicts with canonical mission state.");
      }
      throw error;
    }
    return projectMission(await this.#store.load(request.missionId));
  }
}

export class ClientProtocolGateway {
  readonly #events: EventStore<MissionEventData>;
  readonly #activity: ClientActivitySource;
  readonly #capabilities: ClientCapabilityPolicy;
  readonly #commands: MissionCommandAuthority;
  readonly #verification: ClientVerificationSource;
  readonly #clock: () => string;

  constructor(input: {
    readonly events: EventStore<MissionEventData>;
    readonly activity: ClientActivitySource;
    readonly capabilities: ClientCapabilityPolicy;
    readonly commands?: MissionCommandAuthority;
    readonly verification?: ClientVerificationSource;
    readonly clock?: () => string;
  }) {
    this.#events = input.events;
    this.#activity = input.activity;
    this.#capabilities = input.capabilities;
    this.#commands = input.commands ?? new EventStoreMissionCommandAuthority(input.events);
    this.#verification = input.verification ?? new UnavailableVerificationSource();
    this.#clock = input.clock ?? (() => new Date().toISOString());
  }

  async state(value: unknown): Promise<ClientStateResponse> {
    const request = decodeClientStateRequest(value);
    const now = this.#runtimeNow();
    this.#authorize(request.capabilityId, request.sessionId, request.missionId, null, now);
    this.#assertRequestTime(request.requestedAt, now);

    const events = await this.#events.load(request.missionId);
    const snapshot = projectMission(events);
    const [jobCounts, verification, rawPage] = await Promise.all([
      this.#activity.jobCounts(request.missionId),
      this.#verification.summary(request.missionId),
      this.#activity.readJobEvents(request.missionId, request.afterCursor, request.limit + 1),
    ]);
    const normalized = rawPage.map(normalizeLifecycleEvent);
    if (normalized.some((event) => event.missionId !== request.missionId)) {
      throw new ClientProtocolError("RESYNC_REQUIRED", "Activity source crossed mission scope.");
    }
    const hasMore = normalized.length > request.limit;
    const page = normalized.slice(0, request.limit);
    const response: ClientStateResponse = {
      emittedAt: now,
      events: page,
      fromCursor: request.afterCursor,
      hasMore,
      missionId: request.missionId,
      nextCursor: page.at(-1)?.cursor ?? request.afterCursor,
      projection: buildClientProjection(snapshot, jobCounts, verification),
      protocol: CLIENT_PROTOCOL_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
    };
    return decodeClientStateResponse(response);
  }

  async command(value: unknown): Promise<ClientCommandResponse> {
    const request = decodeClientCommandRequest(value);
    const now = this.#runtimeNow();
    this.#authorize(
      request.capabilityId,
      request.sessionId,
      request.missionId,
      request.command,
      now,
    );
    this.#assertRequestTime(request.issuedAt, now);
    const snapshot = await this.#commands.execute(request);
    const [jobCounts, verification] = await Promise.all([
      this.#activity.jobCounts(request.missionId),
      this.#verification.summary(request.missionId),
    ]);
    return Object.freeze({
      command: request.command,
      emittedAt: now,
      missionId: request.missionId,
      projection: buildClientProjection(snapshot, jobCounts, verification),
      protocol: CLIENT_PROTOCOL_VERSION,
      requestId: request.requestId,
      sessionId: request.sessionId,
    });
  }

  #authorize(
    capabilityId: string,
    sessionId: string,
    missionId: string,
    command: ClientCommandName | null,
    now: string,
  ): void {
    const grant = this.#capabilities.resolve(capabilityId);
    if (
      grant === null ||
      grant.sessionId !== sessionId ||
      grant.missionId !== missionId ||
      Date.parse(grant.expiresAt) <= Date.parse(now)
    ) {
      throw new ClientProtocolError("DENIED", "Client capability is missing, foreign, or expired.");
    }
    if (command === null) {
      if (!grant.canRead)
        throw new ClientProtocolError("DENIED", "Client read capability is denied.");
      return;
    }
    if (!grant.commands.includes(command)) {
      throw new ClientProtocolError("DENIED", "Client command is outside its capability grant.");
    }
  }

  #assertRequestTime(value: string, now: string): void {
    if (Math.abs(Date.parse(value) - Date.parse(now)) > MAX_CLOCK_SKEW_MS) {
      throw new ClientProtocolError("DENIED", "Client request timestamp exceeds the allowed skew.");
    }
  }

  #runtimeNow(): string {
    const now = this.#clock();
    const parsed = Date.parse(now);
    if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== now) {
      throw new ClientProtocolError("MALFORMED", "Runtime clock must return canonical UTC time.");
    }
    return now;
  }
}

function commandTargets(command: ClientCommandName, snapshot: MissionSnapshot) {
  if (command === "mission.pause") return ["PAUSING", "PAUSED"] as const;
  if (command === "mission.cancel") return ["CANCELLING", "CANCELLED"] as const;
  if (snapshot.state !== "PAUSED" || snapshot.resumeState === null) {
    throw new ClientProtocolError(
      "CONFLICT",
      "Mission cannot resume without a captured pause state.",
    );
  }
  return ["RESUMING", snapshot.resumeState] as const;
}
