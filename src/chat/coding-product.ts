import { MissionRuntime } from "../mission/runtime.js";
import { containsObviousSecret } from "../security/secret-text.js";
import { GitHubPullRequestClient } from "./github-delivery.js";
import { GitHubWorkspace, type GitHubWorkspaceRepositoryState } from "./github-workspace.js";
import type { ActorDatabase } from "./neon-database.js";
import { NeonChatStore, NeonMissionStore } from "./neon-store.js";
import { identifier, safeText } from "./safety.js";
import { ChatError, type ChatEvent } from "./types.js";

export interface CodingRepositoryConfig {
  readonly token: string;
  readonly repository: string;
  readonly defaultBranch: string;
}

export interface CodingChange {
  readonly path: string;
  readonly before: string | null;
  readonly after: string;
  readonly sha: string;
  readonly repository: string | null;
  readonly baseSha: string | null;
  readonly branch: string | null;
  readonly headSha: string | null;
  readonly diff: string;
}

export interface CodingQualityEvidence {
  readonly cursor: number;
  readonly passed: boolean;
  readonly commandId: string;
  readonly classification: "repository-checks" | "branch-integrity-only" | "failed";
  readonly summary: string;
}

export class CodingProductStore {
  readonly chat: NeonChatStore;
  readonly missions: MissionRuntime;

  constructor(
    readonly db: ActorDatabase,
    readonly userId: string,
    readonly github: CodingRepositoryConfig,
  ) {
    this.chat = new NeonChatStore(db);
    this.missions = new MissionRuntime(new NeonMissionStore(db));
  }

  async summary(projectId: string) {
    const project = identifier(projectId);
    await this.chat.conversation(project);
    const [turns, events] = await Promise.all([
      this.chat.turns(project),
      this.chat.events(project, 0, 1000),
    ]);
    const codingRuns = turns.filter((turn) => turn.mode === "coding" || turn.mode === "ultra");
    const latest = codingRuns.at(-1) ?? null;
    const latestView = latest
      ? {
          ...latest,
          state: (await this.missions.load(latest.id)).state,
        }
      : null;
    const scopedEvents = latest ? events.filter((event) => event.turnId === latest.id) : [];
    const changes = aggregateChanges(scopedEvents);
    const qualities = scopedEvents.filter((event) => event.type === "quality").map(qualityEvidence);
    const latestQuality = qualities.at(-1) ?? null;
    const repositoryState = await this.repositoryState(changes);
    return {
      projectId: project,
      repository: this.github.repository,
      baseBranch: this.github.defaultBranch,
      latestRun: latestView,
      repositoryState,
      changes: changes.map(({ after: _after, before: _before, ...change }) => change),
      quality: qualities,
      prReady: await this.prReadiness(
        latest?.id ?? null,
        scopedEvents,
        changes,
        latestQuality,
        repositoryState,
      ),
    };
  }

  async tree(projectId: string, query = "") {
    await this.chat.conversation(identifier(projectId));
    const workspace = await this.workspaceForProject(projectId);
    const entries = await workspace.tree(AbortSignal.timeout(15_000), 800);
    const needle = safeText(query, 200).trim().toLowerCase();
    return needle
      ? entries.filter((entry) => entry.path.toLowerCase().includes(needle)).slice(0, 250)
      : entries;
  }

  async file(projectId: string, path: string) {
    await this.chat.conversation(identifier(projectId));
    const workspace = await this.workspaceForProject(projectId);
    const file = await workspace.read({
      path: safeText(path, 400),
      maxBytes: 262_144,
      signal: AbortSignal.timeout(15_000),
    });
    return { path, ...file };
  }

  async search(projectId: string, query: string, path = ".") {
    await this.chat.conversation(identifier(projectId));
    const cleanQuery = safeText(query, 240).trim();
    if (!cleanQuery) return [];
    const workspace = await this.workspaceForProject(projectId);
    return workspace.search({
      query: cleanQuery,
      path: safeText(path, 400).trim() || ".",
      maxResults: 40,
      signal: AbortSignal.timeout(20_000),
    });
  }

  async pullRequest(projectId: string, turnId: string, title?: string) {
    const project = identifier(projectId);
    const run = identifier(turnId);
    const turn = await this.chat.turn(run);
    if (turn.conversationId !== project)
      throw new ChatError(
        "CODING_RUN_SCOPE",
        "The selected Run does not belong to this Project.",
        409,
      );
    const snapshot = await this.missions.load(run);
    if (snapshot.state !== "COMPLETED")
      throw new ChatError(
        "CODING_RUN_UNVERIFIED",
        "Only a completed verified Coding Run can open a PR.",
        409,
      );

    const events = (await this.chat.events(project, 0, 1000)).filter(
      (event) => event.turnId === run,
    );
    const changes = aggregateChanges(events);
    if (!changes.length)
      throw new ChatError(
        "CODING_NO_CHANGES",
        "This Run has no repository changes to deliver.",
        409,
      );
    const qualities = events.filter((event) => event.type === "quality").map(qualityEvidence);
    const latestQuality = qualities.at(-1) ?? null;
    const state = await this.repositoryState(changes);
    const readiness = await this.prReadiness(run, events, changes, latestQuality, state);
    if (!readiness.ready)
      throw new ChatError(
        "CODING_PR_NOT_READY",
        readiness.reason ?? "Pull request is not ready.",
        409,
      );

    for (const change of changes) {
      if (change.repository !== this.github.repository || !change.branch)
        throw new ChatError(
          "CODING_SCOPE_MISMATCH",
          "Repository change scope cannot be verified.",
          409,
        );
      if (containsObviousSecret(change.after))
        throw new ChatError(
          "CODING_SECRET_DENIED",
          "Secret-like repository output cannot be delivered.",
          400,
        );
    }
    const branch = changes.at(-1)?.branch;
    if (!branch)
      throw new ChatError("CODING_BRANCH_MISSING", "Verified Odin work branch is missing.", 409);

    const prTitle = safeText(title ?? objectiveTitle(turn.objective), 220).trim();
    const description = pullRequestBody(turn.objective, changes, latestQuality, state);
    const delivery = await new GitHubPullRequestClient(
      this.github.token,
      this.github.repository,
      this.github.defaultBranch,
    ).ensurePullRequest({ branch, title: prTitle, body: description });
    await this.emit(project, run, "coding.pull_request", {
      number: delivery.number,
      url: delivery.url,
      branch: delivery.branch,
      baseBranch: delivery.baseBranch,
      verification: latestQuality?.classification ?? "failed",
      changedFiles: changes.map((change) => change.path),
    });
    return { delivery, description };
  }

  async review(projectId: string, number: number) {
    await this.chat.conversation(identifier(projectId));
    const client = new GitHubPullRequestClient(
      this.github.token,
      this.github.repository,
      this.github.defaultBranch,
    );
    const [status, files] = await Promise.all([client.status(number), client.files(number)]);
    return { status, files };
  }

  private async workspaceForProject(projectId: string) {
    const events = await this.chat.events(identifier(projectId), 0, 1000);
    const changes = aggregateChanges(events);
    const latest = changes.filter((change) => change.repository === this.github.repository).at(-1);
    return new GitHubWorkspace(
      this.github.token,
      this.github.repository,
      this.github.defaultBranch,
      async () => {},
      fetch,
      latest?.branch ?? undefined,
      changes
        .filter((change) => change.branch === latest?.branch)
        .map((change) => ({ path: change.path, sha: change.sha })),
      latest?.baseSha ?? undefined,
    );
  }

  private async repositoryState(
    changes: readonly CodingChange[],
  ): Promise<GitHubWorkspaceRepositoryState> {
    const latest = [...changes]
      .reverse()
      .find((change) => change.repository === this.github.repository);
    const workspace = new GitHubWorkspace(
      this.github.token,
      this.github.repository,
      this.github.defaultBranch,
      async () => {},
      fetch,
      latest?.branch ?? undefined,
      changes
        .filter((change) => change.branch === latest?.branch)
        .map((change) => ({ path: change.path, sha: change.sha })),
      latest?.baseSha ?? undefined,
    );
    return workspace.repositoryState(AbortSignal.timeout(15_000));
  }

  private async prReadiness(
    runId: string | null,
    events: readonly ChatEvent[],
    changes: readonly CodingChange[],
    quality: CodingQualityEvidence | null,
    state: GitHubWorkspaceRepositoryState,
  ) {
    if (!runId) return { ready: false, reason: "No Coding Run exists yet." };
    const snapshot = await this.missions.load(runId);
    if (snapshot.state !== "COMPLETED")
      return { ready: false, reason: `Run is ${snapshot.state}; verified completion is required.` };
    if (!changes.length)
      return { ready: false, reason: "No repository changes exist for this Run." };
    const lastChangeCursor = Math.max(
      ...events.filter((event) => event.type === "file.changed").map((event) => event.cursor),
      0,
    );
    const lastQualityEvent = [...events].reverse().find((event) => event.type === "quality");
    if (!quality?.passed || !lastQualityEvent || lastQualityEvent.cursor <= lastChangeCursor)
      return {
        ready: false,
        reason: "A passing repository quality check after the final change is required.",
      };
    const latest = changes.at(-1);
    if (!latest?.branch || !latest.baseSha || latest.repository !== this.github.repository)
      return { ready: false, reason: "Isolated branch provenance is incomplete." };
    if (state.currentBaseSha !== latest.baseSha)
      return {
        ready: false,
        reason: "Base branch moved after this Coding Run. Reconcile divergence first.",
      };
    if (state.workBranch !== latest.branch || !state.headSha)
      return { ready: false, reason: "The verified Odin work branch is unavailable." };
    return { ready: true, reason: null };
  }

  private async emit(
    projectId: string,
    turnId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    const turn = await this.chat.turn(turnId);
    if (turn.conversationId !== projectId)
      throw new ChatError("CODING_RUN_SCOPE", "Run scope changed while recording delivery.", 409);
    return this.chat.emit(turn, type, data);
  }
}

export function aggregateChanges(events: readonly ChatEvent[]): CodingChange[] {
  const byPath = new Map<string, CodingChange>();
  for (const event of events) {
    if (event.type !== "file.changed") continue;
    const path = typeof event.data.path === "string" ? event.data.path : "";
    const after = typeof event.data.after === "string" ? event.data.after : "";
    const sha = typeof event.data.sha === "string" ? event.data.sha : "";
    if (!path || !sha) continue;
    const prior = byPath.get(path);
    const before =
      prior?.before ?? (typeof event.data.before === "string" ? event.data.before : null);
    const repository =
      typeof event.data.repository === "string"
        ? event.data.repository
        : (prior?.repository ?? null);
    const baseSha =
      typeof event.data.baseSha === "string" ? event.data.baseSha : (prior?.baseSha ?? null);
    const branch =
      typeof event.data.branch === "string" ? event.data.branch : (prior?.branch ?? null);
    const headSha =
      typeof event.data.headSha === "string" ? event.data.headSha : (prior?.headSha ?? null);
    byPath.set(path, {
      path,
      before,
      after,
      sha,
      repository,
      baseSha,
      branch,
      headSha,
      diff: unifiedDiff(path, before, after),
    });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function qualityEvidence(event: ChatEvent): CodingQualityEvidence {
  const passed = event.data.passed === true;
  const commandId = typeof event.data.commandId === "string" ? event.data.commandId : "unknown";
  const raw = typeof event.data.output === "string" ? event.data.output : "";
  const branchOnly = /branch-integrity-only|build\/test correctness remains unverified/iu.test(raw);
  return {
    cursor: event.cursor,
    passed,
    commandId,
    classification: !passed ? "failed" : branchOnly ? "branch-integrity-only" : "repository-checks",
    summary: !passed
      ? "Repository quality gate failed."
      : branchOnly
        ? "Isolated-branch writes were verified; application tests are unavailable."
        : "Repository quality checks passed.",
  };
}

export function unifiedDiff(path: string, before: string | null, after: string): string {
  const oldLines = (before ?? "").split("\n");
  const newLines = after.split("\n");
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  )
    suffix++;
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");
}

function objectiveTitle(objective: string): string {
  const clean = objective.replace(/\s+/gu, " ").trim();
  return clean.length <= 72 ? clean : `${clean.slice(0, 69)}...`;
}

function pullRequestBody(
  objective: string,
  changes: readonly CodingChange[],
  quality: CodingQualityEvidence | null,
  state: GitHubWorkspaceRepositoryState,
): string {
  const verification =
    quality?.classification === "branch-integrity-only"
      ? "Branch integrity passed; this repository exposes no CI checks, so application tests are not claimed."
      : quality?.passed
        ? `Repository quality gate \`${quality.commandId}\` passed.`
        : "Required verification is unavailable.";
  return [
    "## What changed",
    ...changes.map((change) => `- \`${change.path}\``),
    "",
    "## Why",
    objective.trim().slice(0, 1000),
    "",
    "## Verification",
    verification,
    "",
    "## Security / scope",
    `- Isolated Odin branch: \`${state.workBranch ?? "unavailable"}\``,
    `- Base branch: \`${state.baseBranch}\` at \`${state.storedBaseSha ?? state.currentBaseSha}\``,
    "- Changed output passed Odin's secret-like content screening before PR delivery.",
    "- No direct write to the canonical base branch was performed.",
    "",
    "## Known limitations",
    quality?.classification === "branch-integrity-only"
      ? "- Repository CI is not configured; build/test correctness is not claimed."
      : "- Only the checks exposed by the selected repository/Run are claimed.",
  ].join("\n");
}
