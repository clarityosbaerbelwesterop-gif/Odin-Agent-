import { createHash } from "node:crypto";
import type { EfficientContextResult } from "../context/efficient.js";
import { classifyFailure, ReliabilityController, type FailureRecoveryAuthority } from "../reliability/index.js";
import type { VerificationAuthority, VerificationGateResult } from "../verification/types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9._:/@-]{0,127}$/u;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 1_000_000;
const FORBIDDEN_PREFIXES = [".git", ".github/workflows", "node_modules"] as const;

export type MultiFileOperation = "CREATE" | "DELETE" | "REPLACE";

export interface MultiFileChange {
  readonly id: string;
  readonly path: string;
  readonly owner: string;
  readonly operation: MultiFileOperation;
  readonly dependsOn: readonly string[];
  readonly preimageHash: string | null;
  readonly postimageHash: string | null;
  readonly content: string | null;
  readonly verificationMethod: "quality_gate";
}

export interface MultiFileChangeSet {
  readonly missionId: string;
  readonly taskId: string;
  readonly contextResultHash: string;
  readonly changes: readonly MultiFileChange[];
}

export interface SpecialistChangeProposal {
  readonly specialistId: string;
  readonly changes: readonly MultiFileChange[];
}

export interface RuntimePreimage {
  readonly path: string;
  readonly content: string | null;
  readonly hash: string | null;
}

export interface StagedFileChange {
  readonly id: string;
  readonly path: string;
  readonly operation: MultiFileOperation;
  readonly content: string | null;
  readonly postimageHash: string | null;
}

export interface MultiFileWorkspace {
  canonicalize(path: string): Promise<string> | string;
  read(path: string): Promise<string | null> | string | null;
  validateStaged(changes: readonly StagedFileChange[]): Promise<void> | void;
  commit(
    changes: readonly StagedFileChange[],
    signal?: AbortSignal,
  ): Promise<{ readonly committedAt: string; readonly commitHash: string }>;
  restore(
    preimages: readonly RuntimePreimage[],
    signal?: AbortSignal,
  ): Promise<{ readonly restoredAt: string; readonly restorationHash: string }>;
}

export interface MultiFileQualityEvidence {
  readonly id: string;
  readonly observedAt: string;
  readonly contentHash: string;
  readonly status: "FAIL" | "PASS";
}

export interface MultiFileQualityRunner {
  run(input: {
    readonly missionId: string;
    readonly taskId: string;
    readonly changeSetHash: string;
    readonly signal?: AbortSignal;
  }): Promise<MultiFileQualityEvidence>;
}

export interface RestorationVerification {
  readonly status: "FAIL" | "PASS";
  readonly observedAt: string;
  readonly evidenceHash: string;
}

export interface MultiFileRestorationVerifier {
  verify(input: {
    readonly missionId: string;
    readonly taskId: string;
    readonly snapshotHash: string;
    readonly preimages: readonly RuntimePreimage[];
  }): Promise<RestorationVerification>;
}

export interface MultiFileRunResult {
  readonly status: "COMPLETED" | "ROLLED_BACK";
  readonly changeSetHash: string;
  readonly contextResultHash: string;
  readonly contextSavingsBps: number;
  readonly orderedChangeIds: readonly string[];
  readonly snapshotHash: string;
  readonly verificationResultHash: string | null;
  readonly rollbackVerificationHash: string | null;
}

export class MultiFileCodingError extends Error {
  readonly code:
    | "CANCELLED"
    | "INVALID_CHANGE_SET"
    | "ROLLBACK_FAILED"
    | "STALE_PREIMAGE"
    | "UNSAFE_PATH"
    | "VERIFICATION_FAILED";

  constructor(code: MultiFileCodingError["code"], message: string) {
    super(message);
    this.name = "MultiFileCodingError";
    this.code = code;
  }
}

export class MultiFileCodingCoordinator {
  readonly #workspace: MultiFileWorkspace;
  readonly #quality: MultiFileQualityRunner;
  readonly #verification: VerificationAuthority;
  readonly #restoration: MultiFileRestorationVerifier;
  readonly #reliability: FailureRecoveryAuthority;
  readonly #clock: () => string;

  constructor(input: {
    readonly workspace: MultiFileWorkspace;
    readonly quality: MultiFileQualityRunner;
    readonly verification: VerificationAuthority;
    readonly restoration: MultiFileRestorationVerifier;
    readonly reliability?: FailureRecoveryAuthority;
    readonly clock?: () => string;
  }) {
    this.#workspace = input.workspace;
    this.#quality = input.quality;
    this.#verification = input.verification;
    this.#restoration = input.restoration;
    this.#reliability = input.reliability ?? new ReliabilityController();
    this.#clock = input.clock ?? (() => new Date().toISOString());
  }

  async execute(input: {
    readonly changeSet: MultiFileChangeSet;
    readonly context: EfficientContextResult;
    readonly signal?: AbortSignal;
  }): Promise<MultiFileRunResult> {
    if (input.signal?.aborted === true) {
      throw new MultiFileCodingError("CANCELLED", "Multi-file coding was cancelled before staging.");
    }
    validateContextBinding(input.changeSet, input.context);
    const normalized = await normalizeChangeSet(input.changeSet, this.#workspace);
    const preimages = await readAndValidatePreimages(normalized.ordered, this.#workspace);
    const snapshotHash = hashJson(preimages);
    const staged = normalized.ordered.map(toStagedChange);
    await this.#workspace.validateStaged(staged);
    if (input.signal?.aborted === true) {
      throw new MultiFileCodingError("CANCELLED", "Multi-file coding was cancelled before commit.");
    }

    let commit: { readonly committedAt: string; readonly commitHash: string };
    try {
      commit = await this.#workspace.commit(staged, input.signal);
      assertHash(commit.commitHash, "commitHash");
      assertCanonicalTime(commit.committedAt, "committedAt");
    } catch (error) {
      return this.#rollbackAfterFailure({
        changeSet: normalized.changeSet,
        changeSetHash: normalized.changeSetHash,
        context: input.context,
        orderedChangeIds: normalized.ordered.map((change) => change.id),
        preimages,
        snapshotHash,
        reasonCode: "partial_apply",
        source: "runtime",
        verificationResultHash: null,
        signal: input.signal,
        originalError: error,
      });
    }

    if (input.signal?.aborted === true) {
      return this.#rollbackAfterFailure({
        changeSet: normalized.changeSet,
        changeSetHash: normalized.changeSetHash,
        context: input.context,
        orderedChangeIds: normalized.ordered.map((change) => change.id),
        preimages,
        snapshotHash,
        reasonCode: "cancelled_after_commit",
        source: "runtime",
        verificationResultHash: null,
        signal: undefined,
      });
    }

    const quality = await this.#quality.run({
      changeSetHash: normalized.changeSetHash,
      missionId: normalized.changeSet.missionId,
      signal: input.signal,
      taskId: normalized.changeSet.taskId,
    });
    validateQualityEvidence(quality);
    const evaluatedAt = this.#clock();
    assertCanonicalTime(evaluatedAt, "evaluatedAt");
    const gate = this.#verification.verify(
      verificationRequest(normalized.changeSet, normalized.changeSetHash, commit.committedAt, quality, evaluatedAt),
    );

    if (quality.status === "PASS" && gate.outcome === "PASS") {
      return Object.freeze({
        changeSetHash: normalized.changeSetHash,
        contextResultHash: input.context.resultHash,
        contextSavingsBps: input.context.savingsBps,
        orderedChangeIds: normalized.ordered.map((change) => change.id),
        rollbackVerificationHash: null,
        snapshotHash,
        status: "COMPLETED",
        verificationResultHash: gate.resultHash,
      });
    }

    return this.#rollbackAfterFailure({
      changeSet: normalized.changeSet,
      changeSetHash: normalized.changeSetHash,
      context: input.context,
      orderedChangeIds: normalized.ordered.map((change) => change.id),
      preimages,
      snapshotHash,
      reasonCode: quality.status === "FAIL" ? "quality_gate_failed" : "verification_failed",
      source: "verification",
      verificationResultHash: gate.resultHash,
      signal: input.signal,
    });
  }

  async #rollbackAfterFailure(input: {
    readonly changeSet: MultiFileChangeSet;
    readonly changeSetHash: string;
    readonly context: EfficientContextResult;
    readonly orderedChangeIds: readonly string[];
    readonly preimages: readonly RuntimePreimage[];
    readonly snapshotHash: string;
    readonly reasonCode: string;
    readonly source: "runtime" | "verification";
    readonly verificationResultHash: string | null;
    readonly signal?: AbortSignal;
    readonly originalError?: unknown;
  }): Promise<MultiFileRunResult> {
    const failure = classifyFailure({
      contradictoryEvidence: false,
      independentEvidence: false,
      missionId: input.changeSet.missionId,
      phase: "M19_APPLY",
      reasonCode: input.reasonCode,
      retryable: false,
      rollbackEvidenceHash: input.snapshotHash,
      sideEffect: "REVERSIBLE",
      source: input.source,
      taskId: input.changeSet.taskId,
    });
    const recovery = this.#reliability.decide({
      attempts: [],
      budget: {
        alternativePlansRemaining: 0,
        maxRepeatedStrategyFailures: 1,
        modelEscalationsRemaining: 0,
        repairsRemaining: 0,
        retriesRemaining: 0,
        rollbacksRemaining: 1,
        verifierEscalationsRemaining: 0,
      },
      capabilities: {
        contextReduction: input.context.savingsBps > 0,
        modelEscalation: false,
        verifierEscalation: false,
      },
      failure,
    });
    if (recovery.action !== "ROLLBACK") {
      throw new MultiFileCodingError(
        "ROLLBACK_FAILED",
        "Reliability policy did not authorize restoration of reversible multi-file writes.",
      );
    }

    await this.#workspace.restore(input.preimages, input.signal);
    const restoration = await this.#restoration.verify({
      missionId: input.changeSet.missionId,
      preimages: input.preimages,
      snapshotHash: input.snapshotHash,
      taskId: input.changeSet.taskId,
    });
    validateRestoration(restoration);
    if (restoration.status !== "PASS") {
      throw new MultiFileCodingError("ROLLBACK_FAILED", "Independent restoration verification failed.");
    }
    if (input.originalError instanceof MultiFileCodingError) throw input.originalError;
    return Object.freeze({
      changeSetHash: input.changeSetHash,
      contextResultHash: input.context.resultHash,
      contextSavingsBps: input.context.savingsBps,
      orderedChangeIds: [...input.orderedChangeIds],
      rollbackVerificationHash: restoration.evidenceHash,
      snapshotHash: input.snapshotHash,
      status: "ROLLED_BACK",
      verificationResultHash: input.verificationResultHash,
    });
  }
}

export function reconcileMultiFileProposals(
  proposals: readonly SpecialistChangeProposal[],
): readonly MultiFileChange[] {
  if (!Array.isArray(proposals) || proposals.length === 0 || proposals.length > MAX_FILES) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", "Specialist proposal count is invalid.");
  }
  const specialists = new Set<string>();
  const merged: MultiFileChange[] = [];
  for (const proposal of proposals) {
    assertIdentifier(proposal.specialistId, "specialistId");
    if (specialists.has(proposal.specialistId)) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Specialist proposal identity is duplicated.");
    }
    specialists.add(proposal.specialistId);
    if (!Array.isArray(proposal.changes) || proposal.changes.length === 0) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Specialist proposal has no changes.");
    }
    for (const change of proposal.changes) {
      if (change.owner !== proposal.specialistId) {
        throw new MultiFileCodingError("INVALID_CHANGE_SET", "Specialist proposal cannot claim another owner.");
      }
      merged.push(change);
    }
  }
  if (merged.length > MAX_FILES) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", "Multi-file proposal exceeds 100 target files.");
  }
  const sorted = [...merged].sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
  for (let index = 0; index < sorted.length; index += 1) {
    for (let other = index + 1; other < sorted.length; other += 1) {
      const left = sorted[index];
      const right = sorted[other];
      if (left !== undefined && right !== undefined && pathsOverlap(left.path, right.path)) {
        throw new MultiFileCodingError("INVALID_CHANGE_SET", "Specialist proposals contain overlapping target paths.");
      }
    }
  }
  return Object.freeze(sorted.map((change) => Object.freeze({ ...change, dependsOn: [...change.dependsOn] })));
}

async function normalizeChangeSet(
  value: MultiFileChangeSet,
  workspace: MultiFileWorkspace,
): Promise<{ readonly changeSet: MultiFileChangeSet; readonly changeSetHash: string; readonly ordered: readonly MultiFileChange[] }> {
  assertIdentifier(value.missionId, "missionId");
  assertIdentifier(value.taskId, "taskId");
  assertHash(value.contextResultHash, "contextResultHash");
  if (!Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > MAX_FILES) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", "Multi-file change set must target 1 to 100 files.");
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  const normalized: MultiFileChange[] = [];
  for (const change of value.changes) {
    assertIdentifier(change.id, "change id");
    assertIdentifier(change.owner, "change owner");
    if (ids.has(change.id)) throw new MultiFileCodingError("INVALID_CHANGE_SET", "Change id is duplicated.");
    ids.add(change.id);
    assertSafePath(change.path);
    const canonical = await workspace.canonicalize(change.path);
    if (canonical !== change.path) {
      throw new MultiFileCodingError("UNSAFE_PATH", "Target path is not in canonical workspace form.");
    }
    if (isForbiddenPath(change.path)) {
      throw new MultiFileCodingError("UNSAFE_PATH", "Target path is forbidden for multi-file coding.");
    }
    if (paths.has(change.path)) throw new MultiFileCodingError("INVALID_CHANGE_SET", "Target path is duplicated.");
    paths.add(change.path);
    if (!Array.isArray(change.dependsOn) || new Set(change.dependsOn).size !== change.dependsOn.length) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Change dependencies are malformed or duplicated.");
    }
    for (const dependency of change.dependsOn) assertIdentifier(dependency, "dependency");
    if (!new Set(["CREATE", "DELETE", "REPLACE"]).has(change.operation)) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Change operation is unsupported.");
    }
    if (change.verificationMethod !== "quality_gate") {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Change verification method is unsupported.");
    }
    validateOperationShape(change);
    normalized.push(Object.freeze({ ...change, dependsOn: [...change.dependsOn] }));
  }
  for (let index = 0; index < normalized.length; index += 1) {
    for (let other = index + 1; other < normalized.length; other += 1) {
      const left = normalized[index];
      const right = normalized[other];
      if (left !== undefined && right !== undefined && pathsOverlap(left.path, right.path)) {
        throw new MultiFileCodingError("INVALID_CHANGE_SET", "Target paths overlap.");
      }
    }
  }
  for (const change of normalized) {
    for (const dependency of change.dependsOn) {
      if (!ids.has(dependency) || dependency === change.id) {
        throw new MultiFileCodingError("INVALID_CHANGE_SET", "Change dependency is missing or self-referential.");
      }
    }
  }
  const ordered = topologicalOrder(normalized);
  const changeSet = Object.freeze({
    changes: normalized,
    contextResultHash: value.contextResultHash,
    missionId: value.missionId,
    taskId: value.taskId,
  });
  return Object.freeze({ changeSet, changeSetHash: hashJson(changeSet), ordered });
}

async function readAndValidatePreimages(
  ordered: readonly MultiFileChange[],
  workspace: MultiFileWorkspace,
): Promise<readonly RuntimePreimage[]> {
  const preimages: RuntimePreimage[] = [];
  for (const change of ordered) {
    const current = await workspace.read(change.path);
    const currentHash = current === null ? null : hashText(current);
    if (change.operation === "CREATE") {
      if (current !== null) throw new MultiFileCodingError("STALE_PREIMAGE", "Create target already exists.");
    } else if (current === null || currentHash !== change.preimageHash) {
      throw new MultiFileCodingError("STALE_PREIMAGE", "Multi-file preimage is stale or missing.");
    }
    preimages.push(Object.freeze({ content: current, hash: currentHash, path: change.path }));
  }
  return Object.freeze(preimages.sort((left, right) => left.path.localeCompare(right.path)));
}

function validateContextBinding(changeSet: MultiFileChangeSet, context: EfficientContextResult): void {
  if (context.resultHash !== changeSet.contextResultHash) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", "M18 context result does not match the M19 change set.");
  }
  if (!Number.isSafeInteger(context.savingsBps) || context.savingsBps < 0 || context.savingsBps > 10_000) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", "M18 context savings metadata is invalid.");
  }
  const priorities = new Set(context.full.sections.map((section) => section.priority));
  for (const required of ["P0", "P1", "P2"] as const) {
    if (!priorities.has(required)) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "M18 context omitted mandatory P0-P2 authority context.");
    }
  }
}

function validateOperationShape(change: MultiFileChange): void {
  if (change.operation === "CREATE") {
    if (change.preimageHash !== null || change.content === null || change.postimageHash === null) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Create operation shape is invalid.");
    }
  } else if (change.operation === "DELETE") {
    if (change.preimageHash === null || change.content !== null || change.postimageHash !== null) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Delete operation shape is invalid.");
    }
  } else if (change.preimageHash === null || change.content === null || change.postimageHash === null) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", "Replace operation shape is invalid.");
  }
  if (change.preimageHash !== null) assertHash(change.preimageHash, "preimageHash");
  if (change.postimageHash !== null) assertHash(change.postimageHash, "postimageHash");
  if (change.content !== null) {
    if (Buffer.byteLength(change.content, "utf8") > MAX_FILE_BYTES) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Proposed file exceeds the M19 byte bound.");
    }
    if (hashText(change.content) !== change.postimageHash) {
      throw new MultiFileCodingError("INVALID_CHANGE_SET", "Proposed postimage hash does not match content.");
    }
  }
}

function topologicalOrder(changes: readonly MultiFileChange[]): readonly MultiFileChange[] {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const indegree = new Map(changes.map((change) => [change.id, change.dependsOn.length]));
  const dependents = new Map<string, string[]>();
  for (const change of changes) {
    for (const dependency of change.dependsOn) {
      const list = dependents.get(dependency) ?? [];
      list.push(change.id);
      dependents.set(dependency, list);
    }
  }
  const ready = [...changes]
    .filter((change) => indegree.get(change.id) === 0)
    .sort(compareChange);
  const ordered: MultiFileChange[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    ordered.push(current);
    for (const dependentId of (dependents.get(current.id) ?? []).sort()) {
      const next = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, next);
      if (next === 0) {
        const dependent = byId.get(dependentId);
        if (dependent !== undefined) {
          ready.push(dependent);
          ready.sort(compareChange);
        }
      }
    }
  }
  if (ordered.length !== changes.length) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", "Multi-file dependency graph contains a cycle.");
  }
  return Object.freeze(ordered);
}

function verificationRequest(
  changeSet: MultiFileChangeSet,
  changeSetHash: string,
  committedAt: string,
  quality: MultiFileQualityEvidence,
  evaluatedAt: string,
) {
  const suffix = changeSetHash.slice(0, 20);
  const claimId = `m19-claim-${suffix}`;
  const evidenceId = `m19-quality-${suffix}`;
  return {
    bindings: [{ claimId, evidenceIds: [evidenceId] }],
    claims: [
      {
        definitionOfDone: `Apply and verify bounded multi-file change set ${suffix}`,
        id: claimId,
        missionId: changeSet.missionId,
        requiredAfter: committedAt,
        requiredEvidenceKinds: ["quality_gate" as const],
        taskId: changeSet.taskId,
      },
    ],
    evaluatedAt,
    evidence: [
      {
        contentHash: quality.contentHash,
        id: evidenceId,
        kind: "quality_gate" as const,
        missionId: changeSet.missionId,
        observedAt: quality.observedAt,
        producer: { class: "independent_tool" as const, id: quality.id },
        status: quality.status,
        subject: `m19:${changeSetHash}`,
        taskId: changeSet.taskId,
      },
    ],
    missionId: changeSet.missionId,
  };
}

function validateQualityEvidence(value: MultiFileQualityEvidence): void {
  assertIdentifier(value.id, "quality evidence id");
  assertHash(value.contentHash, "quality contentHash");
  assertCanonicalTime(value.observedAt, "quality observedAt");
  if (value.status !== "PASS" && value.status !== "FAIL") {
    throw new MultiFileCodingError("VERIFICATION_FAILED", "Quality evidence status is invalid.");
  }
}

function validateRestoration(value: RestorationVerification): void {
  assertHash(value.evidenceHash, "restoration evidenceHash");
  assertCanonicalTime(value.observedAt, "restoration observedAt");
  if (value.status !== "PASS" && value.status !== "FAIL") {
    throw new MultiFileCodingError("ROLLBACK_FAILED", "Restoration verification status is invalid.");
  }
}

function toStagedChange(change: MultiFileChange): StagedFileChange {
  return Object.freeze({
    content: change.content,
    id: change.id,
    operation: change.operation,
    path: change.path,
    postimageHash: change.postimageHash,
  });
}

function compareChange(left: MultiFileChange, right: MultiFileChange): number {
  return left.path.localeCompare(right.path) || left.id.localeCompare(right.id);
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function isForbiddenPath(path: string): boolean {
  if (path === ".env" || path.startsWith(".env.")) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function assertSafePath(path: string): void {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 500 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path)
  ) {
    throw new MultiFileCodingError("UNSAFE_PATH", "Target path is not a safe workspace-relative path.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new MultiFileCodingError("UNSAFE_PATH", "Target path contains ambiguous segments.");
  }
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", `${label} is malformed.`);
  }
}

function assertHash(value: string, label: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", `${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertCanonicalTime(value: string, label: string): void {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new MultiFileCodingError("INVALID_CHANGE_SET", `${label} must be canonical UTC.`);
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}
