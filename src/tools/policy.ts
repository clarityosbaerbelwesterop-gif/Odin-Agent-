import {
  type CapabilityGrant,
  type PolicyAuthorization,
  type ToolPolicyRequest,
  ToolRuntimeError,
} from "./types.js";

export interface CapabilityPolicy {
  authorizeAndConsume(request: ToolPolicyRequest): PolicyAuthorization;
}

export class InMemoryCapabilityPolicy implements CapabilityPolicy {
  readonly #grants = new Map<string, CapabilityGrant>();
  readonly #usedCalls = new Map<string, number>();

  constructor(grants: readonly CapabilityGrant[] = []) {
    for (const grant of grants) this.register(grant);
  }

  register(grant: CapabilityGrant): void {
    validateGrant(grant);
    if (this.#grants.has(grant.grantId)) {
      throw new ToolRuntimeError("conflict", `Capability grant ${grant.grantId} already exists.`, false);
    }
    this.#grants.set(grant.grantId, Object.freeze(structuredClone(grant)));
    this.#usedCalls.set(grant.grantId, 0);
  }

  authorizeAndConsume(request: ToolPolicyRequest): PolicyAuthorization {
    validatePolicyRequest(request);
    const candidates = [...this.#grants.values()].filter(
      (grant) =>
        grant.missionId === request.missionId &&
        grant.taskId === request.taskId &&
        grant.tool === request.tool &&
        grant.operation === request.operation &&
        resourceMatches(grant.resourcePrefix, request.resource),
    );

    if (candidates.length === 0) {
      return { decision: "DENY", reason: "No scoped capability grant matches the request." };
    }

    const now = Date.parse(request.now);
    const grant = candidates
      .filter((candidate) => Date.parse(candidate.expiresAt) > now)
      .sort((left, right) => left.grantId.localeCompare(right.grantId))
      .find((candidate) => (this.#usedCalls.get(candidate.grantId) ?? 0) < candidate.maxCalls);

    if (grant === undefined) {
      return { decision: "DENY", reason: "Matching capability grants are expired or exhausted." };
    }

    if (request.riskClass === "high" && !approvalMatches(request)) {
      return {
        decision: "REQUIRE_APPROVAL",
        grantId: grant.grantId,
        reason: "High-impact tool execution requires matching approval evidence.",
      };
    }

    this.#usedCalls.set(grant.grantId, (this.#usedCalls.get(grant.grantId) ?? 0) + 1);
    return { decision: "ALLOW", grantId: grant.grantId, reason: "Scoped capability grant accepted." };
  }

  callsUsed(grantId: string): number {
    return this.#usedCalls.get(grantId) ?? 0;
  }
}

function approvalMatches(request: ToolPolicyRequest): boolean {
  const approval = request.approval;
  if (approval === undefined) return false;
  if (approval.approvalId.trim() === "" || Number.isNaN(Date.parse(approval.expiresAt))) return false;
  return (
    approval.missionId === request.missionId &&
    approval.taskId === request.taskId &&
    approval.tool === request.tool &&
    Date.parse(approval.expiresAt) > Date.parse(request.now)
  );
}

function resourceMatches(prefix: string, resource: string): boolean {
  if (prefix === "*") return true;
  if (prefix === ".") return resource === "." || !resource.startsWith("../");
  if (resource === prefix) return true;
  return resource.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

function validateGrant(grant: CapabilityGrant): void {
  for (const [name, value] of [
    ["grantId", grant.grantId],
    ["missionId", grant.missionId],
    ["taskId", grant.taskId],
    ["tool", grant.tool],
    ["resourcePrefix", grant.resourcePrefix],
  ] as const) {
    if (value.trim() === "") throw new TypeError(`${name} must be non-empty.`);
  }
  if (!Number.isSafeInteger(grant.maxCalls) || grant.maxCalls < 1) {
    throw new TypeError("Capability maxCalls must be a positive safe integer.");
  }
  if (Number.isNaN(Date.parse(grant.expiresAt))) {
    throw new TypeError("Capability expiresAt must be a parseable timestamp.");
  }
}

function validatePolicyRequest(request: ToolPolicyRequest): void {
  for (const value of [request.missionId, request.taskId, request.tool, request.resource]) {
    if (value.trim() === "") throw new TypeError("Tool policy identifiers must be non-empty.");
  }
  if (Number.isNaN(Date.parse(request.now))) {
    throw new TypeError("Tool policy time must be a parseable timestamp.");
  }
}
