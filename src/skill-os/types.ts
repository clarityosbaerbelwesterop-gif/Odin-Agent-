import type { CapabilityDomain } from "../capability-packs/types.js";
import type { SkillPackage } from "../skills/types.js";

export type SkillOsActor = "trusted_runtime" | "user_approved";
export type SkillOsHistoryAction = "PINNED" | "ROLLED_BACK";

export interface SkillOsPackSummary {
  readonly contextBytes: number;
  readonly domain: CapabilityDomain;
  readonly id: string;
  readonly memberCount: number;
  readonly packHash: string;
  readonly taskClasses: readonly string[];
  readonly version: string;
}

export interface SkillOsPackSource {
  listSummaries(): readonly SkillOsPackSummary[];
  resolveMember(
    packId: string,
    packVersion: string,
    name: string,
    version: string,
  ): SkillPackage;
}

export interface SkillOsPackMemberRef {
  readonly contentHash: string;
  readonly name: string;
  readonly taskClasses: readonly string[];
  readonly version: string;
}

export interface SkillOsPackRegistration extends SkillOsPackSummary {
  readonly members: readonly SkillOsPackMemberRef[];
}

export interface SkillOsDiscoveryRequest {
  readonly domain: CapabilityDomain;
  readonly maxContextBytes?: number;
  readonly taskClass: string;
}

export interface SkillOsSelectionRequest extends SkillOsDiscoveryRequest {
  readonly maxMembers?: number;
}

export interface SkillOsSelection {
  readonly contextBytes: number;
  readonly domain: CapabilityDomain;
  readonly issuedAt: string;
  readonly memberCount: number;
  readonly packHash: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly selectionHash: string;
  readonly taskClass: string;
}

export interface SkillOsLoadedSelection {
  readonly packages: readonly SkillPackage[];
  readonly selection: SkillOsSelection;
}

export interface SkillOsPinRequest {
  readonly actor: SkillOsActor;
  readonly domain: CapabilityDomain;
  readonly packHash: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly taskClass: string;
}

export interface SkillOsRollbackRequest extends SkillOsPinRequest {}

export interface SkillOsHistoryEvent {
  readonly action: SkillOsHistoryAction;
  readonly actor: SkillOsActor;
  readonly domain: CapabilityDomain;
  readonly occurredAt: string;
  readonly packHash: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly sequence: number;
  readonly taskClass: string;
}

export interface SkillOsLimits {
  readonly maxContextBytes: number;
  readonly maxMembers: number;
  readonly maxPacks: number;
  readonly maxTaskClasses: number;
}

export type SkillOsErrorCode = "CONFLICT" | "DENIED" | "INVALID_INPUT" | "NOT_FOUND";

export class SkillOsError extends Error {
  readonly code: SkillOsErrorCode;

  constructor(code: SkillOsErrorCode, message: string) {
    super(message);
    this.name = "SkillOsError";
    this.code = code;
  }
}
