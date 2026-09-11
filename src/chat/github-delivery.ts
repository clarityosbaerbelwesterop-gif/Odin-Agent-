import { ChatError } from "./types.js";

export interface GitHubPullRequestDelivery {
  number: number;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  branch: string;
  baseBranch: string;
}

const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;

function validRepository(value: string): string {
  if (!REPOSITORY.test(value))
    throw new ChatError("GITHUB_REPOSITORY_INVALID", "Selected GitHub repository is invalid.");
  return value;
}

function validBranch(value: string): string {
  const clean = value.trim();
  const invalid =
    !clean ||
    clean.length > 240 ||
    clean.startsWith("/") ||
    clean.endsWith("/") ||
    clean.includes("..") ||
    clean.includes("//") ||
    [...clean].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || " ~^:?*[\\".includes(character);
    });
  if (invalid) throw new ChatError("GITHUB_BRANCH_INVALID", "GitHub branch is invalid.");
  return clean;
}

function safeText(value: string, max: number, label: string): string {
  const clean = value.trim();
  if (!clean || clean.length > max || [...clean].some((character) => character.charCodeAt(0) === 0))
    throw new ChatError("GITHUB_DELIVERY_INVALID", `${label} is invalid.`);
  return clean;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizePullRequest(
  value: unknown,
  branch: string,
  baseBranch: string,
): GitHubPullRequestDelivery {
  const item = object(value);
  const number = Number(item.number);
  const htmlUrl = typeof item.html_url === "string" ? item.html_url : "";
  const state = item.state === "closed" ? "closed" : item.state === "open" ? "open" : null;
  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    !/^https:\/\/github\.com\//u.test(htmlUrl) ||
    !state
  )
    throw new ChatError("GITHUB_UPSTREAM", "GitHub pull request response is invalid.", 502);
  return {
    number,
    url: htmlUrl,
    state,
    merged: item.merged === true || item.merged_at != null,
    branch,
    baseBranch,
  };
}

export class GitHubPullRequestClient {
  readonly repository: string;
  readonly baseBranch: string;

  constructor(
    readonly token: string,
    repository: string,
    baseBranch: string,
    readonly request: typeof fetch = fetch,
  ) {
    this.repository = validRepository(repository);
    this.baseBranch = validBranch(baseBranch);
  }

  async #api(path: string, init: RequestInit = {}): Promise<unknown> {
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
    if (!response.ok)
      throw new ChatError(
        response.status === 401 || response.status === 403
          ? "GITHUB_PERMISSION_DENIED"
          : response.status === 422
            ? "GITHUB_PR_CONFLICT"
            : "GITHUB_UPSTREAM",
        response.status === 401 || response.status === 403
          ? "GitHub permission is required to deliver this pull request."
          : response.status === 422
            ? "GitHub refused the pull request because its branch or base is no longer deliverable."
            : "GitHub pull request delivery failed.",
        response.status === 401 || response.status === 403
          ? 403
          : response.status === 422
            ? 409
            : 502,
      );
    if (response.status === 204) return {};
    return response.json();
  }

  async ensurePullRequest(input: {
    branch: string;
    title: string;
    body: string;
    signal?: AbortSignal;
  }): Promise<GitHubPullRequestDelivery> {
    const branch = validBranch(input.branch);
    const title = safeText(input.title, 240, "Pull request title");
    const body = safeText(input.body, 4000, "Pull request body");
    const owner = this.repository.split("/")[0] as string;
    const query = new URLSearchParams({
      state: "open",
      head: `${owner}:${branch}`,
      base: this.baseBranch,
      per_page: "10",
    });
    const existing = await this.#api(
      `/pulls?${query.toString()}`,
      input.signal ? { signal: input.signal } : {},
    );
    if (Array.isArray(existing) && existing.length > 0)
      return normalizePullRequest(existing[0], branch, this.baseBranch);

    const created = await this.#api("/pulls", {
      method: "POST",
      body: JSON.stringify({
        title,
        head: branch,
        base: this.baseBranch,
        body,
        maintainer_can_modify: true,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return normalizePullRequest(created, branch, this.baseBranch);
  }

  async status(number: number, signal?: AbortSignal): Promise<GitHubPullRequestDelivery> {
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new ChatError("GITHUB_PR_INVALID", "Pull request number is invalid.");
    const pull = await this.#api(`/pulls/${number}`, signal ? { signal } : {});
    const item = object(pull);
    const branch = typeof object(item.head).ref === "string" ? String(object(item.head).ref) : "";
    const base =
      typeof object(item.base).ref === "string" ? String(object(item.base).ref) : this.baseBranch;
    return normalizePullRequest(pull, validBranch(branch), validBranch(base));
  }
}
