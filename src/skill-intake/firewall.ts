import { createHash } from "node:crypto";
import {
  type CommunitySkillRegistry,
  type SkillIntakeDecision,
  SkillIntakeError,
  type SkillIntakeFileEvidence,
  type SkillIntakeFinding,
  type SkillIntakeLimits,
  type SkillIntakeManifest,
  type SkillIntakeReport,
  type SkillIntakeRequest,
  type SkillIntakeResult,
  type SkillIntakeSeverity,
  type SkillRiskRuleId,
  type SkillSourceLicense,
  type SkillSourceResolver,
} from "./types.js";

const MAX_REPOSITORY_LENGTH = 200;
const MAX_REF_LENGTH = 200;
const MAX_PATH_LENGTH = 1_000;
const MAX_LIMITATIONS = 64;
const MAX_LIMITATION_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 1_024;
const MAX_INSTRUCTION_BYTES = 128 * 1_024;

export const DEFAULT_SKILL_INTAKE_LIMITS: SkillIntakeLimits = Object.freeze({
  maxDepth: 16,
  maxFileBytes: 256 * 1_024,
  maxFiles: 256,
  maxFindings: 256,
  maxTotalBytes: 4 * 1_024 * 1_024,
});

interface ParsedManifest extends SkillIntakeManifest {
  readonly body: string;
}

interface NormalizedTextFile {
  readonly content: string;
  readonly kind: "text";
  readonly path: string;
  readonly sizeBytes: number;
}

interface NormalizedOpaqueFile {
  readonly kind: "binary" | "symlink";
  readonly path: string;
  readonly sizeBytes: number;
}

type NormalizedFile = NormalizedOpaqueFile | NormalizedTextFile;

interface NormalizedSnapshot {
  readonly commitSha: string;
  readonly files: readonly NormalizedFile[];
  readonly inventoryComplete: boolean;
  readonly license: SkillSourceLicense;
  readonly limitations: readonly string[];
  readonly ref: string;
  readonly repository: string;
  readonly skillPath: string;
}

interface InspectionResult {
  readonly manifest: ParsedManifest | null;
  readonly report: SkillIntakeReport;
}

interface FindingState {
  hitLimit: boolean;
}

interface LineRule {
  readonly id: SkillRiskRuleId;
  readonly message: string;
  readonly severity: SkillIntakeSeverity;
  matches(line: string): boolean;
}

const LINE_RULES: readonly LineRule[] = Object.freeze([
  {
    id: "PROMPT_INJECTION",
    message: "Instruction text attempts to override higher-priority or prior instructions.",
    severity: "CRITICAL",
    matches: (line) => {
      const text = line.toLowerCase();
      const override = ["ignore", "disregard", "override", "bypass"].some((word) =>
        text.includes(word),
      );
      const authority = [
        "previous instruction",
        "system prompt",
        "developer prompt",
        "higher-priority",
        "higher priority",
      ].some((phrase) => text.includes(phrase));
      return override && authority;
    },
  },
  {
    id: "REMOTE_EXECUTION",
    message: "Instruction text contains a download-and-execute shell pattern.",
    severity: "CRITICAL",
    matches: (line) => {
      const text = line.toLowerCase();
      const downloader = text.includes("curl ") || text.includes("wget ");
      const shell = ["| sh", "| bash", "| zsh", "<(curl", "<(wget"].some((phrase) =>
        text.includes(phrase),
      );
      return downloader && shell;
    },
  },
  {
    id: "EXFILTRATION",
    message: "Instruction text combines outbound transfer with credential-like material.",
    severity: "CRITICAL",
    matches: (line) => {
      const text = line.toLowerCase();
      const outbound = ["curl ", "wget ", "http://", "https://", "upload", "send ", "post "].some(
        (phrase) => text.includes(phrase),
      );
      const secret = ["api_key", "api key", "token", "password", "secret"].some((phrase) =>
        text.includes(phrase),
      );
      const transfer = ["--data", " -d ", "upload", "send ", "post ", "webhook"].some((phrase) =>
        text.includes(phrase),
      );
      return outbound && secret && transfer;
    },
  },
  {
    id: "PRIVILEGE_ESCALATION",
    message: "Instruction text requests elevated host privileges or globally permissive access.",
    severity: "CRITICAL",
    matches: (line) => {
      const text = line.toLowerCase();
      return (
        text.includes("sudo ") ||
        text.includes("chmod 777") ||
        text.includes("chmod -r 777") ||
        text.includes("run as root")
      );
    },
  },
  {
    id: "DESTRUCTIVE_WRITE",
    message:
      "Instruction text contains a destructive filesystem, repository, or database operation.",
    severity: "HIGH",
    matches: (line) => {
      const text = line.toLowerCase();
      return (
        text.includes("rm -rf") ||
        text.includes("git reset --hard") ||
        text.includes("git clean -fd") ||
        text.includes("drop database") ||
        text.includes("drop table")
      );
    },
  },
  {
    id: "CREDENTIAL_COLLECTION",
    message: "Instruction text requests, exports, or collects credential-like values.",
    severity: "HIGH",
    matches: (line) => {
      const text = line.toLowerCase();
      const secret = [
        "api key",
        "api_key",
        "access token",
        "auth token",
        "password",
        "secret key",
      ].some((phrase) => text.includes(phrase));
      const action = ["paste", "enter", "provide", "export", "collect", "supply", "set "].some(
        (phrase) => text.includes(phrase),
      );
      return secret && action;
    },
  },
  {
    id: "SELF_PROMOTION",
    message:
      "Instruction text attempts to install, activate, or promote itself into trusted behavior.",
    severity: "HIGH",
    matches: (line) => {
      const text = line.toLowerCase();
      const selfAction = ["install this skill", "activate this skill", "promote this skill"].some(
        (phrase) => text.includes(phrase),
      );
      const trustedFile = ["claude.md", "agents.md", "system prompt", "developer prompt"].some(
        (phrase) => text.includes(phrase),
      );
      const mutation = ["write", "append", "replace", "modify", "overwrite"].some((word) =>
        text.includes(word),
      );
      return selfAction || (trustedFile && mutation);
    },
  },
  {
    id: "MEMORY_POLICY_POISONING",
    message:
      "Instruction text attempts to persist into agent policy or durable instruction memory.",
    severity: "HIGH",
    matches: (line) => {
      const text = line.toLowerCase();
      const target = [
        "claude.md",
        "agents.md",
        "system prompt",
        "developer prompt",
        "agent memory",
      ].some((phrase) => text.includes(phrase));
      const action = ["write", "append", "persist", "store", "remember", "overwrite"].some((word) =>
        text.includes(word),
      );
      return target && action;
    },
  },
  {
    id: "DEPENDENCY_INSTALL",
    message: "Instruction text requests dependency installation.",
    severity: "MEDIUM",
    matches: (line) => {
      const text = line.toLowerCase();
      return (
        /\b(?:npm|pnpm|yarn)\s+(?:install|add)\b/u.test(text) ||
        /\bpip3?\s+install\b/u.test(text) ||
        /\buv\s+(?:pip\s+)?install\b/u.test(text) ||
        /\bcargo\s+add\b/u.test(text)
      );
    },
  },
  {
    id: "SHELL_EXECUTION",
    message: "Instruction text contains an explicit subprocess or shell-execution primitive.",
    severity: "MEDIUM",
    matches: (line) => {
      const text = line.toLowerCase();
      return (
        /\b(?:bash|sh|zsh|powershell)\s+-c\b/u.test(text) ||
        text.includes("subprocess.run(") ||
        text.includes("subprocess.popen(") ||
        text.includes("child_process") ||
        text.includes("os.system(")
      );
    },
  },
]);

const SEVERITY_RANK: Readonly<Record<SkillIntakeSeverity, number>> = Object.freeze({
  CRITICAL: 5,
  HIGH: 4,
  INFO: 1,
  LOW: 2,
  MEDIUM: 3,
});

export class SkillIntakeFirewall {
  readonly #resolver: SkillSourceResolver;
  readonly #registry: CommunitySkillRegistry;
  readonly #limits: SkillIntakeLimits;

  constructor(
    resolver: SkillSourceResolver,
    registry: CommunitySkillRegistry,
    limits: Partial<SkillIntakeLimits> = {},
  ) {
    this.#resolver = resolver;
    this.#registry = registry;
    this.#limits = normalizeLimits({ ...DEFAULT_SKILL_INTAKE_LIMITS, ...limits });
  }

  async inspect(value: unknown): Promise<SkillIntakeReport> {
    const request = normalizeRequest(value);
    return (await this.#inspectNormalized(request)).report;
  }

  async intake(value: unknown): Promise<SkillIntakeResult> {
    const request = normalizeRequest(value);
    const inspected = await this.#inspectNormalized(request);
    if (
      inspected.report.decision !== "ACCEPT" ||
      inspected.report.completeness !== "COMPLETE" ||
      inspected.manifest === null
    ) {
      return Object.freeze({ report: inspected.report });
    }

    const candidate = this.#registry.registerCandidate({
      instructions: inspected.manifest.body,
      name: communitySkillName(
        inspected.report.repository,
        inspected.report.skillPath,
        inspected.manifest.name,
      ),
      provenance: {
        kind: "community",
        observedAt: inspected.report.observedAt,
        reference: communityReference(inspected.report),
      },
      requiredTools: [],
      summary: inspected.manifest.description,
      tags: ["community", "m14-intake"],
      testRefs: [`m14:${inspected.report.reportHash}`],
      trustClass: "community",
      version: `g${inspected.report.commitSha.slice(0, 12)}`,
    });

    return Object.freeze({ candidate, report: inspected.report });
  }

  async #inspectNormalized(request: SkillIntakeRequest): Promise<InspectionResult> {
    const rawSnapshot = await this.#resolver.resolve(request);
    const snapshot = normalizeSnapshot(rawSnapshot, request, this.#limits);
    return analyzeSnapshot(snapshot, request.observedAt, this.#limits);
  }
}

function analyzeSnapshot(
  snapshot: NormalizedSnapshot,
  observedAt: string,
  limits: SkillIntakeLimits,
): InspectionResult {
  const limitations = [...snapshot.limitations];
  if (!snapshot.inventoryComplete) limitations.push("SOURCE_INVENTORY_INCOMPLETE");
  if (snapshot.license.spdx === null) limitations.push("LICENSE_UNKNOWN");

  const fileEvidence: SkillIntakeFileEvidence[] = [];
  const findings: SkillIntakeFinding[] = [];
  const fingerprintSet = new Set<string>();
  const findingState: FindingState = { hitLimit: false };
  const inspectedText = new Map<string, string>();
  let analyzedBytes = 0;
  let analyzedFiles = 0;

  for (const file of snapshot.files) {
    if (findingState.hitLimit) break;
    if (file.kind !== "text") {
      limitations.push(`OPAQUE_${file.kind.toUpperCase()}:${file.path}`);
      continue;
    }
    if (file.sizeBytes > limits.maxFileBytes) {
      limitations.push(`FILE_BYTES_LIMIT:${file.path}`);
      continue;
    }
    if (analyzedBytes + file.sizeBytes > limits.maxTotalBytes) {
      limitations.push("TOTAL_BYTES_LIMIT");
      break;
    }
    if (containsNul(file.content)) {
      limitations.push(`TEXT_NUL:${file.path}`);
      continue;
    }

    analyzedBytes += file.sizeBytes;
    analyzedFiles += 1;
    inspectedText.set(file.path, file.content);
    fileEvidence.push(
      Object.freeze({
        contentHash: sha256(file.content),
        path: file.path,
        sizeBytes: file.sizeBytes,
      }),
    );
    scanFile(file, findings, fingerprintSet, findingState, limits.maxFindings);
  }

  if (findingState.hitLimit) limitations.push("FINDING_OUTPUT_LIMIT");

  const manifestPath = snapshot.skillPath === "." ? "SKILL.md" : `${snapshot.skillPath}/SKILL.md`;
  const manifestContent = inspectedText.get(manifestPath);
  let parsedManifest: ParsedManifest | null = null;
  if (manifestContent === undefined) {
    limitations.push("SKILL_MANIFEST_UNINSPECTED");
  } else {
    parsedManifest = parseManifest(manifestContent);
    if (parsedManifest === null) {
      limitations.push("SKILL_MANIFEST_INVALID");
    } else if (parsedManifest.instructionBytes > MAX_INSTRUCTION_BYTES) {
      limitations.push("SKILL_INSTRUCTIONS_TOO_LARGE_FOR_M10");
      parsedManifest = null;
    }
  }

  const normalizedLimitations = uniqueSorted(limitations);
  const normalizedEvidence = Object.freeze(
    fileEvidence.sort((left, right) => left.path.localeCompare(right.path)),
  );
  const normalizedFindings = Object.freeze(findings.sort(compareFindings));
  const completeness = normalizedLimitations.length === 0 ? "COMPLETE" : "PARTIAL";
  const decision = decisionFor(completeness, normalizedFindings);
  const publicManifest = publicManifestFrom(parsedManifest);
  const reportBase = {
    analyzedBytes,
    analyzedFiles,
    commitSha: snapshot.commitSha,
    completeness,
    decision,
    fileEvidence: normalizedEvidence,
    findings: normalizedFindings,
    license: Object.freeze({ ...snapshot.license }),
    limitations: Object.freeze(normalizedLimitations),
    manifest: publicManifest,
    observedAt,
    ref: snapshot.ref,
    repository: snapshot.repository,
    skillPath: snapshot.skillPath,
  } as const;
  const report: SkillIntakeReport = Object.freeze({
    ...reportBase,
    reportHash: stableHash(reportBase),
  });
  return { manifest: parsedManifest, report };
}

function scanFile(
  file: NormalizedTextFile,
  findings: SkillIntakeFinding[],
  fingerprints: Set<string>,
  state: FindingState,
  maxFindings: number,
): void {
  const lowerPath = file.path.toLowerCase();
  if (
    lowerPath.startsWith(".github/workflows/") ||
    lowerPath.includes("/hooks/") ||
    lowerPath.endsWith("/hooks.json")
  ) {
    addFinding(
      findings,
      fingerprints,
      state,
      maxFindings,
      "HOOK_WORKFLOW",
      "HIGH",
      file.path,
      1,
      file.path,
      "Bundle contains an automatic hook or workflow execution surface.",
    );
  }
  if (
    lowerPath.endsWith(".mcp.json") ||
    lowerPath.endsWith("/mcp.json") ||
    lowerPath.endsWith("/mcp-config.json")
  ) {
    addFinding(
      findings,
      fingerprints,
      state,
      maxFindings,
      "MCP_TOOL_POISONING",
      "HIGH",
      file.path,
      1,
      file.path,
      "Bundle contains MCP/tool-server configuration that may introduce execution authority.",
    );
  }
  if (isExecutableSurface(lowerPath)) {
    addFinding(
      findings,
      fingerprints,
      state,
      maxFindings,
      "SHELL_EXECUTION",
      "MEDIUM",
      file.path,
      1,
      file.path,
      "Bundle contains executable script/source content; intake never executes it.",
    );
  }
  if (state.hitLimit) return;

  const lines = file.content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    for (const rule of LINE_RULES) {
      if (!rule.matches(line)) continue;
      addFinding(
        findings,
        fingerprints,
        state,
        maxFindings,
        rule.id,
        rule.severity,
        file.path,
        index + 1,
        line,
        rule.message,
      );
      if (state.hitLimit) return;
    }
  }
}

function addFinding(
  findings: SkillIntakeFinding[],
  fingerprints: Set<string>,
  state: FindingState,
  maxFindings: number,
  ruleId: SkillRiskRuleId,
  severity: SkillIntakeSeverity,
  filePath: string,
  line: number,
  evidence: string,
  message: string,
): void {
  const evidenceHash = sha256(evidence.trim());
  const fingerprint = stableHash({ evidenceHash, filePath, line, ruleId, severity });
  if (fingerprints.has(fingerprint)) return;
  if (findings.length >= maxFindings) {
    state.hitLimit = true;
    return;
  }
  fingerprints.add(fingerprint);
  findings.push(
    Object.freeze({ evidenceHash, filePath, fingerprint, line, message, ruleId, severity }),
  );
}

function decisionFor(
  completeness: SkillIntakeReport["completeness"],
  findings: readonly SkillIntakeFinding[],
): SkillIntakeDecision {
  if (findings.some((finding) => finding.severity === "CRITICAL")) return "REJECT";
  if (completeness !== "COMPLETE" || findings.some((finding) => finding.severity === "HIGH")) {
    return "QUARANTINE";
  }
  return "ACCEPT";
}

function normalizeRequest(value: unknown): SkillIntakeRequest {
  const object = exactObject(
    value,
    ["observedAt", "ref", "repository", "skillPath"],
    "intake request",
  );
  return Object.freeze({
    observedAt: canonicalTimestamp(object.observedAt, "observedAt"),
    ref: gitRef(object.ref),
    repository: repositoryName(object.repository),
    skillPath: relativePath(
      object.skillPath,
      "skillPath",
      true,
      DEFAULT_SKILL_INTAKE_LIMITS.maxDepth,
    ),
  });
}

function normalizeSnapshot(
  value: unknown,
  request: SkillIntakeRequest,
  limits: SkillIntakeLimits,
): NormalizedSnapshot {
  const object = exactObject(
    value,
    [
      "commitSha",
      "files",
      "inventoryComplete",
      "license",
      "limitations",
      "ref",
      "repository",
      "skillPath",
    ],
    "source snapshot",
    ["limitations"],
  );
  const repository = repositoryName(object.repository);
  const ref = gitRef(object.ref);
  const skillPath = relativePath(object.skillPath, "snapshot.skillPath", true, limits.maxDepth);
  if (repository !== request.repository || ref !== request.ref || skillPath !== request.skillPath) {
    throw new SkillIntakeError(
      "CONFLICT",
      "Resolved source identity does not match the intake request.",
    );
  }
  const commitSha = commitHash(object.commitSha);
  if (typeof object.inventoryComplete !== "boolean") {
    throw new SkillIntakeError("INVALID_INPUT", "inventoryComplete must be boolean.");
  }
  const license = normalizeLicense(object.license, limits.maxDepth);
  const sourceLimitations = normalizeLimitations(object.limitations);
  if (!Array.isArray(object.files)) {
    throw new SkillIntakeError("INVALID_INPUT", "source snapshot files must be an array.");
  }
  if (object.files.length > limits.maxFiles) {
    return Object.freeze({
      commitSha,
      files: Object.freeze([]),
      inventoryComplete: false,
      license,
      limitations: Object.freeze(uniqueSorted([...sourceLimitations, "FILE_COUNT_LIMIT"])),
      ref,
      repository,
      skillPath,
    });
  }

  const files = object.files.map((entry) => normalizeFile(entry, skillPath, limits.maxDepth));
  files.sort((left, right) => left.path.localeCompare(right.path));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1]?.path === files[index]?.path) {
      throw new SkillIntakeError("INVALID_INPUT", "source snapshot contains duplicate file paths.");
    }
  }
  return Object.freeze({
    commitSha,
    files: Object.freeze(files),
    inventoryComplete: object.inventoryComplete,
    license,
    limitations: Object.freeze(sourceLimitations),
    ref,
    repository,
    skillPath,
  });
}

function normalizeFile(value: unknown, skillPath: string, maxDepth: number): NormalizedFile {
  const object = exactObject(
    value,
    ["byteLength", "content", "kind", "path", "target"],
    "snapshot file",
    ["byteLength", "content", "target"],
  );
  const path = relativePath(object.path, "file.path", false, maxDepth);
  if (!isWithinSkillPath(path, skillPath)) {
    throw new SkillIntakeError("CONFLICT", "Snapshot file escapes the selected skill path.");
  }
  if (object.kind === "text") {
    if (typeof object.content !== "string" || object.target !== undefined) {
      throw new SkillIntakeError(
        "INVALID_INPUT",
        "Text snapshot files require content and no target.",
      );
    }
    const sizeBytes = Buffer.byteLength(object.content, "utf8");
    if (object.byteLength !== undefined && object.byteLength !== sizeBytes) {
      throw new SkillIntakeError(
        "CONFLICT",
        "Text snapshot byteLength conflicts with exact content.",
      );
    }
    return Object.freeze({ content: object.content, kind: "text", path, sizeBytes });
  }
  if (object.kind === "binary") {
    if (
      object.content !== undefined ||
      object.target !== undefined ||
      !Number.isSafeInteger(object.byteLength) ||
      (object.byteLength as number) < 0
    ) {
      throw new SkillIntakeError(
        "INVALID_INPUT",
        "Binary snapshot files require only a byteLength.",
      );
    }
    return Object.freeze({ kind: "binary", path, sizeBytes: object.byteLength as number });
  }
  if (object.kind === "symlink") {
    if (object.content !== undefined || typeof object.target !== "string") {
      throw new SkillIntakeError(
        "INVALID_INPUT",
        "Symlink snapshot files require a target and no content.",
      );
    }
    boundedPrintable(object.target, "symlink target", MAX_PATH_LENGTH);
    return Object.freeze({ kind: "symlink", path, sizeBytes: 0 });
  }
  throw new SkillIntakeError("INVALID_INPUT", "Snapshot file kind is unsupported.");
}

function normalizeLicense(value: unknown, maxDepth: number): SkillSourceLicense {
  const object = exactObject(value, ["path", "spdx"], "source license");
  const path =
    object.path === null ? null : relativePath(object.path, "license.path", false, maxDepth);
  const spdx = object.spdx === null ? null : boundedPrintable(object.spdx, "license.spdx", 120);
  return Object.freeze({ path, spdx });
}

function normalizeLimitations(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIMITATIONS) {
    throw new SkillIntakeError("INVALID_INPUT", "Source limitations exceed the allowed bound.");
  }
  return uniqueSorted(
    value.map((entry, index) =>
      boundedPrintable(entry, `limitations[${index}]`, MAX_LIMITATION_LENGTH),
    ),
  );
}

function parseManifest(content: string): ParsedManifest | null {
  const lines = content.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closing < 0) return null;
  const closeIndex = closing + 1;
  const header = lines.slice(1, closeIndex);
  const name = frontmatterScalar(header, "name");
  const description = frontmatterScalar(header, "description");
  if (name === null || description === null) return null;
  const normalizedName = manifestName(name);
  const normalizedDescription = boundedPrintable(
    description,
    "manifest description",
    MAX_DESCRIPTION_LENGTH,
  );
  const body = lines
    .slice(closeIndex + 1)
    .join("\n")
    .trim();
  if (body.length === 0) return null;
  const instructionBytes = Buffer.byteLength(body, "utf8");
  return Object.freeze({
    body,
    description: normalizedDescription,
    instructionBytes,
    instructionHash: sha256(body),
    name: normalizedName,
  });
}

function frontmatterScalar(lines: readonly string[], key: string): string | null {
  const prefix = `${key}:`;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.startsWith(" ") || line.startsWith("\t")) continue;
    if (!line.startsWith(prefix)) continue;
    const raw = line.slice(prefix.length).trim();
    if (raw === ">" || raw === "|" || raw === ">-" || raw === "|-") {
      const block: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const next = lines[cursor];
        if (next === undefined) break;
        if (next.trim() === "") {
          block.push("");
          continue;
        }
        if (!next.startsWith(" ") && !next.startsWith("\t")) break;
        block.push(next.trim());
      }
      const joined = raw.startsWith(">") ? block.join(" ") : block.join("\n");
      return joined.trim() || null;
    }
    return decodeScalar(raw);
  }
  return null;
}

function decodeScalar(value: string): string | null {
  if (value.length === 0) return null;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);
      return typeof decoded === "string" ? decoded : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function publicManifestFrom(manifest: ParsedManifest | null): SkillIntakeManifest | null {
  if (manifest === null) return null;
  return Object.freeze({
    description: manifest.description,
    instructionBytes: manifest.instructionBytes,
    instructionHash: manifest.instructionHash,
    name: manifest.name,
  });
}

function compareFindings(left: SkillIntakeFinding, right: SkillIntakeFinding): number {
  return (
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.fingerprint.localeCompare(right.fingerprint)
  );
}

function isExecutableSurface(path: string): boolean {
  return [".bash", ".js", ".mjs", ".py", ".ps1", ".sh", ".ts"].some((suffix) =>
    path.endsWith(suffix),
  );
}

function isWithinSkillPath(path: string, skillPath: string): boolean {
  return skillPath === "." || path.startsWith(`${skillPath}/`);
}

function communitySkillName(repository: string, skillPath: string, manifest: string): string {
  const scope = sha256(`${repository}:${skillPath}`).slice(0, 8);
  const slug = manifest
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 48);
  const safeSlug = slug.length === 0 ? "skill" : slug;
  return `ext.${scope}.${safeSlug}`;
}

function communityReference(report: SkillIntakeReport): string {
  return `github:${report.repository}@${report.commitSha}:${report.skillPath}#${report.reportHash}`;
}

function manifestName(value: string): string {
  const name = boundedPrintable(value, "manifest name", 128).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
    throw new SkillIntakeError(
      "INCOMPLETE",
      "Manifest name is not a bounded Agent-Skills identifier.",
    );
  }
  return name;
}

function normalizeLimits(value: SkillIntakeLimits): SkillIntakeLimits {
  const bounds: ReadonlyArray<readonly [keyof SkillIntakeLimits, number, number]> = [
    ["maxDepth", 1, 64],
    ["maxFileBytes", 1_024, 16 * 1_024 * 1_024],
    ["maxFiles", 1, 10_000],
    ["maxFindings", 1, 10_000],
    ["maxTotalBytes", 1_024, 64 * 1_024 * 1_024],
  ];
  for (const [key, minimum, maximum] of bounds) {
    const entry = value[key];
    if (!Number.isSafeInteger(entry) || entry < minimum || entry > maximum) {
      throw new SkillIntakeError("INVALID_INPUT", `${key} is outside the allowed intake bound.`);
    }
  }
  if (value.maxFileBytes > value.maxTotalBytes) {
    throw new SkillIntakeError("INVALID_INPUT", "maxFileBytes cannot exceed maxTotalBytes.");
  }
  return Object.freeze({ ...value });
}

function repositoryName(value: unknown): string {
  const repository = boundedPrintable(value, "repository", MAX_REPOSITORY_LENGTH);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new SkillIntakeError(
      "INVALID_INPUT",
      "repository must be an owner/name GitHub identifier.",
    );
  }
  return repository;
}

function gitRef(value: unknown): string {
  const ref = boundedPrintable(value, "ref", MAX_REF_LENGTH);
  if (
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.includes("\\") ||
    ref.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new SkillIntakeError("INVALID_INPUT", "ref contains an unsafe Git reference shape.");
  }
  return ref;
}

function commitHash(value: unknown): string {
  const commitSha = boundedPrintable(value, "commitSha", 40);
  if (!/^[a-f0-9]{40}$/u.test(commitSha)) {
    throw new SkillIntakeError(
      "INVALID_INPUT",
      "Resolved source must use an exact 40-hex commit SHA.",
    );
  }
  return commitSha;
}

function relativePath(value: unknown, label: string, allowRoot: boolean, maxDepth: number): string {
  const path = boundedPrintable(value, label, MAX_PATH_LENGTH);
  if (allowRoot && path === ".") return path;
  if (
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new SkillIntakeError("INVALID_INPUT", `${label} must be a normalized relative path.`);
  }
  if (path.split("/").length > maxDepth) {
    throw new SkillIntakeError("INVALID_INPUT", `${label} exceeds the configured path depth.`);
  }
  return path;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const timestamp = boundedPrintable(value, label, 64);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== timestamp) {
    throw new SkillIntakeError("INVALID_INPUT", `${label} must be canonical UTC ISO-8601.`);
  }
  return timestamp;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SkillIntakeError("INVALID_INPUT", `${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new SkillIntakeError("INVALID_INPUT", `${label} contains unknown field ${key}.`);
    }
  }
  const optionalSet = new Set(optional);
  for (const key of keys) {
    if (!optionalSet.has(key) && !(key in record)) {
      throw new SkillIntakeError("INVALID_INPUT", `${label} is missing ${key}.`);
    }
  }
  return record;
}

function boundedPrintable(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new SkillIntakeError("INVALID_INPUT", `${label} is empty or outside its length bound.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      throw new SkillIntakeError("INVALID_INPUT", `${label} contains a control character.`);
    }
  }
  return value;
}

function containsNul(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0) return true;
  }
  return false;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  return value;
}
