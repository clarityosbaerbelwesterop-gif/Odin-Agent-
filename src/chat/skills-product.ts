import { createHash } from "node:crypto";
import { containsObviousSecret } from "../security/secret-text.js";
import { ChatError } from "./types.js";

export type ProductSkillScope = "global" | "project";
export type ProductSkillTrust =
  | "BUILT_IN_VERIFIED"
  | "FIRST_PARTY"
  | "EXTERNAL_COMMUNITY"
  | "PRIVATE_CUSTOM";
export type ProductSkillStatus =
  | "AVAILABLE"
  | "INSTALLED"
  | "DISABLED"
  | "REQUIRES_CONNECTION"
  | "UPDATE_AVAILABLE"
  | "QUARANTINED"
  | "INCOMPATIBLE";
export type ProductSkillConnection = "github";

export interface ProductSkillDescriptor {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly category: string;
  readonly version: string;
  readonly publisher: string;
  readonly trust: ProductSkillTrust;
  readonly source: string;
  readonly verification: "VERIFIED" | "CANDIDATE";
  readonly examples: readonly string[];
  readonly requiredTools: readonly string[];
  readonly requiredConnections: readonly ProductSkillConnection[];
  readonly permissions: readonly string[];
  readonly risk: "LOW" | "MEDIUM" | "HIGH";
  readonly supportedScopes: readonly ProductSkillScope[];
  readonly canonicalAuthority: string;
  readonly contentHash: string;
}

export interface ProductSkillInstallation {
  readonly installationId: string;
  readonly skillId: string;
  readonly version: string;
  readonly contentHash: string;
  readonly scope: ProductSkillScope;
  readonly projectId: string | null;
  readonly enabled: boolean;
  readonly previousVersion: string | null;
  readonly previousContentHash: string | null;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface ProductSkillProjection extends ProductSkillDescriptor {
  readonly status: ProductSkillStatus;
  readonly installation: ProductSkillInstallation | null;
  readonly missingConnections: readonly ProductSkillConnection[];
  readonly executionAuthority: "M23_SKILL_OS_M25_TOOL_POLICY";
}

export interface ProductConnectionState {
  readonly github: boolean;
}

export interface CustomSkillDraftInput {
  readonly goal: string;
  readonly scope: ProductSkillScope;
  readonly projectId?: string | null;
}

export interface CustomSkillDraft {
  readonly name: string;
  readonly version: "0.1.0";
  readonly purpose: string;
  readonly procedure: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly requiredTools: readonly string[];
  readonly requiredConnections: readonly ProductSkillConnection[];
  readonly verificationPlan: readonly string[];
  readonly trust: "PRIVATE_CUSTOM";
  readonly verification: "CANDIDATE";
  readonly lifecycle: "DRAFT";
  readonly scope: ProductSkillScope;
  readonly projectId: string | null;
  readonly contentHash: string;
}

interface DescriptorSeed extends Omit<ProductSkillDescriptor, "contentHash"> {}

function descriptor(seed: DescriptorSeed): ProductSkillDescriptor {
  const frozen = {
    ...seed,
    examples: Object.freeze([...seed.examples]),
    requiredTools: Object.freeze([...seed.requiredTools]),
    requiredConnections: Object.freeze([...seed.requiredConnections]),
    permissions: Object.freeze([...seed.permissions]),
    supportedScopes: Object.freeze([...seed.supportedScopes]),
  };
  return Object.freeze({ ...frozen, contentHash: stableHash(frozen) });
}

export const PRODUCT_SKILL_CATALOG: readonly ProductSkillDescriptor[] = Object.freeze([
  descriptor({
    id: "product-planning",
    name: "Product Planning",
    purpose: "Turn a product goal into bounded requirements, non-goals, stages and verification criteria.",
    category: "Product",
    version: "1.0.0",
    publisher: "Odin",
    trust: "BUILT_IN_VERIFIED",
    source: "M10/M15 capability packs",
    verification: "VERIFIED",
    examples: ["Shape a feature request", "Create acceptance criteria"],
    requiredTools: [],
    requiredConnections: [],
    permissions: ["Read selected project context", "Write only through canonical Workspace authority when invoked by a Run"],
    risk: "LOW",
    supportedScopes: ["global", "project"],
    canonicalAuthority: "M23 Skill OS over verified M10/M15 packages",
  }),
  descriptor({
    id: "repository-coding",
    name: "Repository Coding",
    purpose: "Inspect a connected repository, make scoped changes and hand verification to Odin's canonical quality gates.",
    category: "Engineering",
    version: "1.0.0",
    publisher: "Odin",
    trust: "BUILT_IN_VERIFIED",
    source: "M4/M15 coding capability pack",
    verification: "VERIFIED",
    examples: ["Fix a failing test", "Implement a scoped feature in an existing repository"],
    requiredTools: ["repository.read", "repository.patch", "quality.run"],
    requiredConnections: ["github"],
    permissions: ["Repository reads require the selected repository", "Writes remain governed by workspace/tool/autonomy policy"],
    risk: "HIGH",
    supportedScopes: ["project"],
    canonicalAuthority: "M23 Skill OS + M25 Tool Ecosystem + GitHubWorkspace",
  }),
  descriptor({
    id: "research-evidence",
    name: "Research & Evidence",
    purpose: "Gather bounded sources and keep evidence separate from conclusions.",
    category: "Research",
    version: "1.0.0",
    publisher: "Odin",
    trust: "BUILT_IN_VERIFIED",
    source: "M14/M15 research capability pack",
    verification: "VERIFIED",
    examples: ["Research a market", "Compare current technical approaches"],
    requiredTools: ["research.retrieve"],
    requiredConnections: [],
    permissions: ["Network destinations remain governed by tool/network policy"],
    risk: "MEDIUM",
    supportedScopes: ["global", "project"],
    canonicalAuthority: "M23 Skill OS + M25 Tool Ecosystem",
  }),
  descriptor({
    id: "verification-review",
    name: "Verification & Review",
    purpose: "Bind claims to fresh evidence, surface failures and drive bounded repair instead of self-attested success.",
    category: "Quality",
    version: "1.0.0",
    publisher: "Odin",
    trust: "BUILT_IN_VERIFIED",
    source: "M5 verification engine / M11 independent review",
    verification: "VERIFIED",
    examples: ["Check a build before READY", "Review a repair against the failed gate"],
    requiredTools: ["quality.run"],
    requiredConnections: [],
    permissions: ["May inspect evidence; cannot manufacture PASS evidence"],
    risk: "LOW",
    supportedScopes: ["global", "project"],
    canonicalAuthority: "M5 Verification Engine",
  }),
  descriptor({
    id: "workspace-synthesis",
    name: "Workspace Synthesis",
    purpose: "Turn Run outputs into durable Workspace artifacts with canonical provenance.",
    category: "Workspace",
    version: "1.0.0",
    publisher: "Odin",
    trust: "FIRST_PARTY",
    source: "PRODUCT M2 Workspace OS",
    verification: "VERIFIED",
    examples: ["Create a report artifact", "Persist an implementation plan"],
    requiredTools: [],
    requiredConnections: [],
    permissions: ["Artifact writes stay inside M2 Workspace provenance and project scope"],
    risk: "LOW",
    supportedScopes: ["project"],
    canonicalAuthority: "PRODUCT M2 Workspace OS",
  }),
]);

export function productSkillById(id: string): ProductSkillDescriptor {
  const found = PRODUCT_SKILL_CATALOG.find((skill) => skill.id === id);
  if (!found) throw new ChatError("SKILL_NOT_FOUND", "Skill not found.", 404);
  return found;
}

export function projectSkillCatalog(
  installations: readonly ProductSkillInstallation[],
  connections: ProductConnectionState,
  projectId: string | null,
): readonly ProductSkillProjection[] {
  return PRODUCT_SKILL_CATALOG.map((skill) => {
    const installation = installationFor(skill.id, installations, projectId);
    const missingConnections = skill.requiredConnections.filter((name) => !connections[name]);
    let status: ProductSkillStatus = "AVAILABLE";
    if (missingConnections.length > 0) status = "REQUIRES_CONNECTION";
    if (installation) {
      if (installation.version !== skill.version || installation.contentHash !== skill.contentHash)
        status = "UPDATE_AVAILABLE";
      else if (!installation.enabled) status = "DISABLED";
      else if (missingConnections.length > 0) status = "REQUIRES_CONNECTION";
      else status = "INSTALLED";
    }
    return Object.freeze({
      ...skill,
      installation,
      missingConnections: Object.freeze(missingConnections),
      status,
      executionAuthority: "M23_SKILL_OS_M25_TOOL_POLICY" as const,
    });
  });
}

export function assertInstallRequest(
  skill: ProductSkillDescriptor,
  request: {
    version: unknown;
    contentHash: unknown;
    scope: unknown;
    projectId?: unknown;
  },
  connections: ProductConnectionState,
): { scope: ProductSkillScope; projectId: string | null } {
  if (request.version !== skill.version || request.contentHash !== skill.contentHash)
    throw new ChatError("SKILL_INTEGRITY", "Skill version or content hash no longer matches the verified catalog.", 409);
  const scope = parseScope(request.scope);
  if (!skill.supportedScopes.includes(scope))
    throw new ChatError("SKILL_SCOPE_DENIED", "This Skill is not available at the requested scope.", 403);
  const projectId = scope === "project" ? parseProjectId(request.projectId) : null;
  const missing = skill.requiredConnections.filter((name) => !connections[name]);
  if (missing.length)
    throw new ChatError("SKILL_CONNECTION_REQUIRED", `Connect ${missing.join(", ")} before enabling this Skill.`, 409);
  if (skill.verification !== "VERIFIED")
    throw new ChatError("SKILL_UNVERIFIED", "Only independently verified Skills can be installed.", 409);
  return { scope, projectId };
}

export function assertLifecycleTarget(
  skill: ProductSkillDescriptor,
  installation: ProductSkillInstallation | undefined,
  expectedContentHash: unknown,
): ProductSkillInstallation {
  if (!installation) throw new ChatError("SKILL_NOT_INSTALLED", "Skill is not installed.", 404);
  if (expectedContentHash !== installation.contentHash)
    throw new ChatError("SKILL_INTEGRITY", "Installed Skill changed since the action was requested.", 409);
  if (installation.skillId !== skill.id)
    throw new ChatError("SKILL_INTEGRITY", "Installation does not match the canonical Skill identity.", 409);
  return installation;
}

export function draftCustomSkill(input: CustomSkillDraftInput): CustomSkillDraft {
  const goal = input.goal.trim();
  if (goal.length < 8 || goal.length > 600)
    throw new ChatError("INVALID_SKILL", "Describe the custom Skill in 8–600 characters.");
  if (containsObviousSecret(goal))
    throw new ChatError("SECRET_SKILL_DENIED", "Secret-like content cannot be embedded in a Skill draft.");
  const scope = parseScope(input.scope);
  const projectId = scope === "project" ? parseProjectId(input.projectId) : null;
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 40) || "custom-skill";
  const body = {
    name: `private-${slug}`,
    version: "0.1.0" as const,
    purpose: goal,
    procedure: Object.freeze([
      "Receive bounded inputs from the canonical Mission Controller.",
      "Follow only the validated procedure and declared tool requirements.",
      "Return structured output and evidence without granting itself any authority.",
    ]),
    inputs: Object.freeze(["Task goal", "Selected project context"]),
    outputs: Object.freeze(["Structured result", "Verification evidence request"]),
    requiredTools: Object.freeze([] as string[]),
    requiredConnections: Object.freeze([] as ProductSkillConnection[]),
    verificationPlan: Object.freeze([
      "Validate manifest shape and scope.",
      "Review instructions for prompt injection and authority escalation.",
      "Run independent deterministic fixtures before activation.",
    ]),
    trust: "PRIVATE_CUSTOM" as const,
    verification: "CANDIDATE" as const,
    lifecycle: "DRAFT" as const,
    scope,
    projectId,
  };
  return Object.freeze({ ...body, contentHash: stableHash(body) });
}

export function parseScope(value: unknown): ProductSkillScope {
  if (value !== "global" && value !== "project")
    throw new ChatError("INVALID_SKILL_SCOPE", "Skill scope must be global or project.");
  return value;
}

export function parseProjectId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value))
    throw new ChatError("INVALID_PROJECT", "A valid Project is required for project-scoped Skills.");
  return value;
}

function installationFor(
  skillId: string,
  installations: readonly ProductSkillInstallation[],
  projectId: string | null,
): ProductSkillInstallation | null {
  if (projectId) {
    const project = installations.find(
      (item) => item.skillId === skillId && item.scope === "project" && item.projectId === projectId,
    );
    if (project) return project;
  }
  return installations.find((item) => item.skillId === skillId && item.scope === "global") ?? null;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
