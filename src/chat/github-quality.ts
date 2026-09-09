import type { QualityCommand, QualityCommandResult, QualityCommandRunner } from "../tools/repository.js";
import { ChatError } from "./types.js";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "Odin-Agent/1";

function parts(fullName: string): { owner: string; repo: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(fullName);
  if (!match) throw new ChatError("INVALID_REPOSITORY", "Stored repository identity is invalid.", 500);
  return { owner: match[1] ?? "", repo: match[2] ?? "" };
}

export class GitHubQualityRunner implements QualityCommandRunner {
  readonly #owner: string;
  readonly #repo: string;

  constructor(
    readonly token: string,
    readonly fullName: string,
    readonly branch: string,
  ) {
    const value = parts(fullName);
    this.#owner = value.owner;
    this.#repo = value.repo;
  }

  commands(): readonly QualityCommand[] {
    return [{ id: "github-checks", label: "GitHub branch checks" }];
  }

  async run(commandId: string, signal: AbortSignal): Promise<QualityCommandResult> {
    if (commandId !== "github-checks")
      throw new ChatError("QUALITY_COMMAND", "Unknown GitHub quality command.", 400);
    const ref = await this.#json<{ object?: { sha?: string } }>(
      `/repos/${this.#owner}/${this.#repo}/git/ref/heads/${encodeURIComponent(this.branch)}`,
      signal,
    );
    const sha = ref.object?.sha;
    if (typeof sha !== "string" || !/^[a-f0-9]{40}$/u.test(sha))
      return { exitCode: 1, output: "GitHub branch HEAD could not be resolved." };
    const checks = await this.#json<{
      total_count?: number;
      check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }>;
    }>(`/repos/${this.#owner}/${this.#repo}/commits/${sha}/check-runs?per_page=100`, signal);
    const runs = Array.isArray(checks.check_runs) ? checks.check_runs : [];
    if (!runs.length)
      return {
        exitCode: 1,
        output: `No GitHub checks are attached to ${sha.slice(0, 12)}. Odin will not mark the repository change verified without repository CI.`,
      };
    const pending = runs.filter((run) => run.status !== "completed");
    const failed = runs.filter(
      (run) => run.status === "completed" && run.conclusion !== "success" && run.conclusion !== "neutral" && run.conclusion !== "skipped",
    );
    const summary = runs
      .slice(0, 20)
      .map((run) => `${run.name ?? "check"}:${run.status ?? "unknown"}/${run.conclusion ?? "pending"}`)
      .join(", ");
    if (pending.length || failed.length)
      return {
        exitCode: 1,
        output: `GitHub checks are not green for ${sha.slice(0, 12)}. ${summary}`.slice(0, 16_000),
      };
    return {
      exitCode: 0,
      output: `GitHub checks passed for ${sha.slice(0, 12)}. ${summary}`.slice(0, 16_000),
    };
  }

  async #json<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
    });
    if (response.status === 401 || response.status === 403)
      throw new ChatError("GITHUB_AUTH", "GitHub authorization cannot read repository checks.", 403);
    if (!response.ok)
      throw new ChatError("GITHUB_QUALITY", "GitHub repository checks could not be loaded.", 502);
    return (await response.json()) as T;
  }
}
