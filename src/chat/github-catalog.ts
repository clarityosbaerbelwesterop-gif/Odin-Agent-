import { ChatError } from "./types.js";

export interface GitHubRepositorySummary {
  readonly fullName: string;
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly updatedAt: string | null;
}

export interface GitHubBranchSummary {
  readonly name: string;
  readonly protected: boolean;
  readonly commitSha: string;
}

type JsonObject = Record<string, unknown>;

export class GitHubCatalog {
  constructor(
    readonly token: string,
    readonly request: typeof fetch = fetch,
  ) {
    if (!token || token.length > 16_000 || /[\r\n]/u.test(token))
      throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
  }

  async repositories(signal?: AbortSignal): Promise<GitHubRepositorySummary[]> {
    const rows = await this.#pages(
      "/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated",
      signal,
    );
    return rows.map(repositorySummary).filter((item): item is GitHubRepositorySummary => !!item);
  }

  async branches(repository: string, signal?: AbortSignal): Promise<GitHubBranchSummary[]> {
    const route = repositoryRoute(repository);
    const rows = await this.#pages(`${route}/branches?per_page=100`, signal);
    return rows.map(branchSummary).filter((item): item is GitHubBranchSummary => !!item);
  }

  async verifySelection(
    repository: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<{ repository: GitHubRepositorySummary; branch: GitHubBranchSummary }> {
    const route = repositoryRoute(repository);
    const selectedBranch = branchName(branch);
    const [repo, selected] = await Promise.all([
      this.#json(route, signal),
      this.#json(`${route}/branches/${encodeURIComponent(selectedBranch)}`, signal),
    ]);
    const repositoryValue = repositorySummary(repo);
    const branchValue = branchSummary(selected);
    if (!repositoryValue || !branchValue || branchValue.name !== selectedBranch)
      throw new ChatError(
        "GITHUB_SELECTION_INVALID",
        "GitHub returned an invalid repository or branch response.",
        502,
      );
    return { repository: repositoryValue, branch: branchValue };
  }

  async #pages(path: string, signal?: AbortSignal): Promise<unknown[]> {
    const values: unknown[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < 5; page++) {
      const response = await this.#response(next, signal);
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body))
        throw new ChatError("GITHUB_UPSTREAM", "GitHub returned an invalid list response.", 502);
      values.push(...body);
      next = nextPage(response.headers.get("link"));
    }
    return values;
  }

  async #json(path: string, signal?: AbortSignal): Promise<JsonObject> {
    const response = await this.#response(path, signal);
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ChatError("GITHUB_UPSTREAM", "GitHub returned an invalid response.", 502);
    return body as JsonObject;
  }

  async #response(path: string, signal?: AbortSignal): Promise<Response> {
    const target = path.startsWith("https://api.github.com/")
      ? new URL(path)
      : new URL(path, "https://api.github.com");
    if (target.origin !== "https://api.github.com")
      throw new ChatError("GITHUB_UPSTREAM", "GitHub pagination target was rejected.", 502);
    const response = await this.request(target.href, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "Odin-Agent",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (response.ok) return response;
    if (response.status === 401)
      throw new ChatError(
        "GITHUB_TOKEN_EXPIRED",
        "GitHub connection expired. Reconnect GitHub.",
        401,
      );
    if (response.status === 403)
      throw new ChatError(
        "GITHUB_PERMISSION_DENIED",
        "GitHub denied repository access. Review the Odin GitHub permission and reconnect if needed.",
        403,
      );
    if (response.status === 404)
      throw new ChatError(
        "GITHUB_REPOSITORY_UNAVAILABLE",
        "Repository or branch is unavailable to this GitHub account.",
        404,
      );
    if (response.status === 429)
      throw new ChatError("GITHUB_RATE_LIMIT", "GitHub is rate limiting requests. Try again shortly.", 429);
    throw new ChatError("GITHUB_UPSTREAM", "GitHub request failed.", 502);
  }
}

function repositoryRoute(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value))
    throw new ChatError("INVALID_REPOSITORY", "Choose a valid GitHub repository.");
  const [owner, name] = value.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function branchName(value: string): string {
  if (
    !value ||
    value.length > 200 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("..") ||
    value.includes("//") ||
    /[~^:?*[\\\u0000-\u001f\u007f]/u.test(value)
  )
    throw new ChatError("INVALID_BRANCH", "Choose a valid Git branch.");
  return value;
}

function repositorySummary(value: unknown): GitHubRepositorySummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as JsonObject;
  if (
    typeof item.full_name !== "string" ||
    typeof item.name !== "string" ||
    typeof item.default_branch !== "string"
  )
    return null;
  const owner = item.owner as JsonObject | undefined;
  if (!owner || typeof owner.login !== "string") return null;
  return {
    fullName: item.full_name,
    owner: owner.login,
    name: item.name,
    private: item.private === true,
    archived: item.archived === true,
    defaultBranch: item.default_branch,
    updatedAt: typeof item.updated_at === "string" ? item.updated_at : null,
  };
}

function branchSummary(value: unknown): GitHubBranchSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as JsonObject;
  const commit = item.commit as JsonObject | undefined;
  if (typeof item.name !== "string" || !commit || typeof commit.sha !== "string") return null;
  return { name: item.name, protected: item.protected === true, commitSha: commit.sha };
}

function nextPage(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const value of header.split(",")) {
    const match = /<([^>]+)>;\s*rel="([^"]+)"/u.exec(value.trim());
    if (match?.[2] === "next") return match[1];
  }
  return undefined;
}
