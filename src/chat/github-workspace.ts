import { randomUUID } from "node:crypto";
import {
  normalizeWorkspacePath,
  type QualityCommandRunner,
  type RepositoryWorkspace,
} from "../tools/repository.js";
import { hashText, safeText } from "./safety.js";
import { type ChatChange, ChatError } from "./types.js";

type GitHubFile = {
  content?: string;
  encoding?: string;
  sha?: string;
  type?: string;
  path?: string;
};

export class GitHubWorkspace implements RepositoryWorkspace, QualityCommandRunner {
  #workBranch: string | undefined;
  constructor(
    readonly token: string,
    readonly repository: string,
    readonly defaultBranch: string,
    readonly changed: (change: ChatChange & { branch: string }) => Promise<void>,
    readonly request: typeof fetch = fetch,
  ) {}
  async #api(path: string, init: RequestInit = {}) {
    const response = await this.request(`https://api.github.com/repos/${this.repository}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "Odin-Agent",
        ...init.headers,
      },
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    const body = response.status === 204 ? {} : await response.json();
    if (!response.ok)
      throw new ChatError(
        response.status === 409 ? "STALE_FILE" : "GITHUB_UPSTREAM",
        "GitHub workspace request failed.",
        response.status === 404 ? 404 : 502,
      );
    return body as GitHubFile & Record<string, unknown>;
  }
  async #branch(signal: AbortSignal) {
    if (this.#workBranch) return this.#workBranch;
    const source = await this.#api(`/git/ref/heads/${encodeURIComponent(this.defaultBranch)}`, {
      signal,
    });
    const object = source.object as { sha?: string } | undefined;
    if (!object?.sha)
      throw new ChatError("GITHUB_UPSTREAM", "Default branch reference is invalid.", 502);
    const branch = `odin/${new Date().toISOString().slice(0, 10)}/${randomUUID().slice(0, 8)}`;
    await this.#api("/git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: object.sha }),
      signal,
    });
    this.#workBranch = branch;
    return branch;
  }
  async read(input: Parameters<RepositoryWorkspace["read"]>[0]) {
    const path = normalizeWorkspacePath(input.path);
    const data = await this.#api(
      `/contents/${path}?ref=${encodeURIComponent(this.#workBranch ?? this.defaultBranch)}`,
      { signal: input.signal },
    );
    if (
      data.type !== "file" ||
      data.encoding !== "base64" ||
      typeof data.content !== "string" ||
      typeof data.sha !== "string"
    )
      throw new ChatError("UNSAFE_FILE", "Only repository text files can be read.");
    const raw = Buffer.from(data.content.replace(/\n/gu, ""), "base64");
    if (raw.includes(0))
      throw new ChatError("BINARY_FILE", "Binary files cannot enter model context.");
    return {
      content: raw.subarray(0, input.maxBytes).toString("utf8"),
      truncated: raw.length > input.maxBytes,
      sha: data.sha,
    };
  }
  async search(input: Parameters<RepositoryWorkspace["search"]>[0]) {
    input.signal.throwIfAborted();
    const tree = await this.#api(
      `/git/trees/${encodeURIComponent(this.#workBranch ?? this.defaultBranch)}?recursive=1`,
      { signal: input.signal },
    );
    const entries = Array.isArray(tree.tree) ? tree.tree : [];
    const candidates = entries
      .filter(
        (entry: GitHubFile) =>
          entry.type === "blob" &&
          typeof entry.path === "string" &&
          (input.path === "." ||
            entry.path === input.path ||
            entry.path.startsWith(`${input.path}/`)),
      )
      .slice(0, 500);
    const matches = [];
    for (const entry of candidates) {
      if (matches.length >= input.maxResults) break;
      try {
        const file = await this.read({
          path: String(entry.path),
          maxBytes: 32768,
          signal: input.signal,
        });
        const lines = file.content.split("\n");
        const line = lines.findIndex((value) =>
          value.toLowerCase().includes(input.query.toLowerCase()),
        );
        if (line >= 0 || String(entry.path).toLowerCase().includes(input.query.toLowerCase()))
          matches.push({
            path: String(entry.path),
            line: line + 1 || 1,
            preview: (lines[Math.max(0, line)] ?? "").slice(0, 200),
          });
      } catch {
        input.signal.throwIfAborted();
      }
    }
    return matches;
  }
  async patch(input: Parameters<RepositoryWorkspace["patch"]>[0]) {
    const path = normalizeWorkspacePath(input.path);
    const content = safeText(input.content, 262144);
    let before: string | null = null;
    let currentSha: string | undefined;
    try {
      const current = await this.read({ path, maxBytes: 262144, signal: input.signal });
      before = current.content;
      currentSha = current.sha;
    } catch (error) {
      if (!(error instanceof ChatError) || error.status !== 404) throw error;
    }
    if ((currentSha ?? "absent") !== input.expectedSha)
      throw new ChatError("STALE_FILE", "File changed; read it again.", 409);
    const branch = await this.#branch(input.signal);
    const result = await this.#api(`/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Odin: update ${path}`,
        content: Buffer.from(content).toString("base64"),
        branch,
        ...(currentSha ? { sha: currentSha } : {}),
      }),
      signal: input.signal,
    });
    const file = result.content as { sha?: string } | undefined;
    if (!file?.sha)
      throw new ChatError("GITHUB_UPSTREAM", "GitHub did not confirm the file change.", 502);
    await this.changed({ path, before, after: content, sha: hashText(content), branch });
    return { sha: file.sha };
  }
  branchName(): string | null {
    return this.#workBranch ?? null;
  }
  commands() {
    return [{ id: "github-checks", label: "GitHub Actions checks on the isolated Odin branch" }];
  }
  async run(commandId: string, signal: AbortSignal) {
    if (commandId !== "github-checks")
      throw new ChatError("QUALITY_DENIED", "Unknown quality command.", 403);
    if (!this.#workBranch) return { exitCode: 1, output: "No Odin work branch exists." };
    const branch = await this.#api(`/commits/${encodeURIComponent(this.#workBranch)}/check-runs`, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
    });
    const runs = Array.isArray(branch.check_runs)
      ? (branch.check_runs as Array<{ name?: string; status?: string; conclusion?: string }>)
      : [];
    if (!runs.length)
      return {
        exitCode: 1,
        output:
          "Verification incomplete: this repository exposes no trusted checks for the Odin branch.",
      };
    const passed = runs.every(
      (run) =>
        run.status === "completed" &&
        ["success", "neutral", "skipped"].includes(String(run.conclusion)),
    );
    return {
      exitCode: passed ? 0 : 1,
      output: runs.map((run) => `${run.name}: ${run.status}/${run.conclusion}`).join("\n"),
    };
  }
}
