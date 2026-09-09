import { createHash, randomBytes } from "node:crypto";
import type {
  QualityCommand,
  QualityCommandResult,
  QualityCommandRunner,
  RepositoryPatchResult,
  RepositoryReadResult,
  RepositorySearchMatch,
  RepositoryWorkspace,
} from "../tools/repository.js";
import { normalizeWorkspacePath } from "../tools/repository.js";
import type { NeonActorDatabase } from "./neon-database.js";
import type { ProductStore } from "./product-store.js";
import { ChatError } from "./types.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_OAUTH = "https://github.com/login/oauth";
const USER_AGENT = "Odin-Agent/1";
const MAX_REPOS = 300;

interface GitHubRepo {
  readonly id: number;
  readonly fullName: string;
  readonly private: boolean;
  readonly defaultBranch: string;
  readonly permissions: { readonly pull: boolean; readonly push: boolean };
}

function githubHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...githubHeaders(token), ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new ChatError("GITHUB_AUTH", "GitHub authorization is invalid or insufficient.", 401);
    if (response.status === 404)
      throw new ChatError("GITHUB_NOT_FOUND", "GitHub resource was not found.", 404);
    throw new ChatError("GITHUB_UPSTREAM", "GitHub request failed.", 502);
  }
  return (await response.json()) as T;
}

function oauthConfig(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID ?? "";
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]{8,200}$/u.test(clientId) || clientSecret.length < 16 || /[\r\n]/u.test(clientSecret))
    throw new ChatError("GITHUB_OAUTH_CONFIG", "GitHub OAuth is not configured for this deployment.", 503);
  return { clientId, clientSecret };
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function startGitHubOAuth(
  db: NeonActorDatabase,
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const { clientId } = oauthConfig(env);
  const state = randomBytes(32).toString("base64url");
  const redirectUri = `${origin}/api/github/callback`;
  await db.transaction(async (client) => {
    await client.query("DELETE FROM odin_api.oauth_states WHERE expires_at<=now()");
    await client.query(
      "INSERT INTO odin_api.oauth_states(state_hash,redirect_uri,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [stateHash(state), redirectUri],
    );
  });
  const url = new URL(`${GITHUB_OAUTH}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "repo read:user");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function finishGitHubOAuth(input: {
  db: NeonActorDatabase;
  store: ProductStore;
  code: string;
  state: string;
  origin: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ login: string }> {
  if (!/^[A-Za-z0-9_-]{8,300}$/u.test(input.code) || !/^[A-Za-z0-9_-]{20,200}$/u.test(input.state))
    throw new ChatError("GITHUB_OAUTH_STATE", "GitHub OAuth callback is invalid.", 400);
  const redirectUri = `${input.origin}/api/github/callback`;
  const consumed = await input.db.transaction(async (client) => {
    const row = (
      await client.query(
        "DELETE FROM odin_api.oauth_states WHERE state_hash=$1 AND redirect_uri=$2 AND expires_at>now() RETURNING state_hash",
        [stateHash(input.state), redirectUri],
      )
    ).rows[0];
    return !!row;
  });
  if (!consumed) throw new ChatError("GITHUB_OAUTH_STATE", "GitHub OAuth session expired or was already used.", 400);
  const { clientId, clientSecret } = oauthConfig(input.env);
  const response = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: "POST",
    headers: { ...githubHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!response.ok || token.length < 20 || payload.error)
    throw new ChatError("GITHUB_OAUTH_EXCHANGE", "GitHub authorization could not be completed.", 502);
  const user = await githubJson<{ id: number; login: string }>(`${GITHUB_API}/user`, token);
  const scopes = (response.headers.get("x-oauth-scopes") ?? "repo,read:user")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  await input.store.saveGitHubConnection({
    userId: user.id,
    login: user.login,
    token,
    scopes,
  });
  return { login: user.login };
}

export async function listGitHubRepositories(store: ProductStore): Promise<readonly GitHubRepo[]> {
  const token = await store.githubToken();
  if (!token) throw new ChatError("GITHUB_NOT_CONNECTED", "Connect GitHub first.", 409);
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const found = await githubJson<
      Array<{
        id: number;
        full_name: string;
        private: boolean;
        default_branch: string;
        permissions?: { pull?: boolean; push?: boolean };
      }>
    >(
      `${GITHUB_API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      token,
    );
    for (const repo of found) {
      if (
        Number.isSafeInteger(repo.id) &&
        repo.id > 0 &&
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo.full_name) &&
        repo.default_branch.length > 0 &&
        repo.default_branch.length <= 255
      ) {
        repos.push({
          id: repo.id,
          fullName: repo.full_name,
          private: repo.private === true,
          defaultBranch: repo.default_branch,
          permissions: {
            pull: repo.permissions?.pull !== false,
            push: repo.permissions?.push === true,
          },
        });
      }
    }
    if (found.length < 100 || repos.length >= MAX_REPOS) break;
  }
  return repos.slice(0, MAX_REPOS);
}

export async function selectGitHubRepository(
  store: ProductStore,
  repositoryId: number,
): Promise<GitHubRepo> {
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0)
    throw new ChatError("INVALID_REPOSITORY", "Choose a valid repository.");
  const repo = (await listGitHubRepositories(store)).find((candidate) => candidate.id === repositoryId);
  if (!repo || !repo.permissions.pull)
    throw new ChatError("REPOSITORY_DENIED", "The selected repository is not available.", 403);
  await store.savePreferences({
    selectedRepository: repo.fullName,
    selectedRepositoryId: repo.id,
    selectedRepositoryBranch: repo.defaultBranch,
  });
  return repo;
}

export async function disconnectGitHub(
  store: ProductStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const token = await store.githubToken();
  if (token) {
    try {
      const { clientId, clientSecret } = oauthConfig(env);
      const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      await fetch(`${GITHUB_API}/applications/${encodeURIComponent(clientId)}/token`, {
        method: "DELETE",
        headers: {
          ...githubHeaders(),
          Authorization: `Basic ${authorization}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: token }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      // Local deletion is still required; the UI tells the user how to revoke the grant externally if needed.
    }
  }
  await store.disconnectGitHub();
}

interface ContentResponse {
  readonly type: string;
  readonly content?: string;
  readonly encoding?: string;
  readonly sha: string;
}

function repoParts(fullName: string): { owner: string; repo: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(fullName);
  if (!match) throw new ChatError("INVALID_REPOSITORY", "Stored repository identity is invalid.", 500);
  return { owner: match[1] ?? "", repo: match[2] ?? "" };
}

export class GitHubRepositoryWorkspace implements RepositoryWorkspace, QualityCommandRunner {
  readonly #owner: string;
  readonly #repo: string;
  readonly #workBranch: string;
  #branchReady = false;

  constructor(
    readonly token: string,
    readonly fullName: string,
    readonly baseBranch: string,
    conversationId: string,
  ) {
    const parts = repoParts(fullName);
    this.#owner = parts.owner;
    this.#repo = parts.repo;
    if (!/^[A-Za-z0-9._/-]{1,255}$/u.test(baseBranch) || baseBranch.includes(".."))
      throw new ChatError("INVALID_REPOSITORY", "Stored repository branch is invalid.", 500);
    const suffix = conversationId.replaceAll("-", "").slice(0, 12);
    if (!/^[A-Za-z0-9]{8,12}$/u.test(suffix))
      throw new ChatError("INVALID_REPOSITORY", "Conversation identity cannot form a work branch.", 500);
    this.#workBranch = `odin/${suffix}`;
  }

  commands(): readonly QualityCommand[] {
    return [];
  }

  async run(_commandId: string, _signal: AbortSignal): Promise<QualityCommandResult> {
    throw new ChatError(
      "QUALITY_UNAVAILABLE",
      "Repository CI is not executed implicitly. Inspect the Odin branch and run the repository's trusted CI before merging.",
      409,
    );
  }

  async read(input: {
    path: string;
    maxBytes: number;
    signal: AbortSignal;
  }): Promise<RepositoryReadResult> {
    const path = normalizeWorkspacePath(input.path);
    let value: ContentResponse;
    try {
      value = await this.#content(path, this.#workBranch, input.signal);
    } catch (error) {
      if (!(error instanceof ChatError) || error.code !== "GITHUB_NOT_FOUND") throw error;
      value = await this.#content(path, this.baseBranch, input.signal);
    }
    if (value.type !== "file" || value.encoding !== "base64" || typeof value.content !== "string")
      throw new ChatError("REPOSITORY_FILE", "Only regular text files can be read.", 400);
    const bytes = Buffer.from(value.content.replaceAll("\n", ""), "base64");
    if (bytes.includes(0)) throw new ChatError("REPOSITORY_BINARY", "Binary files are not exposed to the model.", 400);
    const truncated = bytes.length > input.maxBytes;
    return {
      content: bytes.subarray(0, input.maxBytes).toString("utf8"),
      truncated,
      sha: value.sha,
    };
  }

  async search(input: {
    query: string;
    path: string;
    maxResults: number;
    signal: AbortSignal;
  }): Promise<readonly RepositorySearchMatch[]> {
    const root = normalizeWorkspacePath(input.path, true);
    const query = input.query.trim();
    if (!query || query.length > 500) throw new ChatError("INVALID_SEARCH", "Search query is invalid.");
    const q = [`${query}`, `repo:${this.fullName}`];
    if (root !== ".") q.push(`path:${root}`);
    const url = new URL(`${GITHUB_API}/search/code`);
    url.searchParams.set("q", q.join(" "));
    url.searchParams.set("per_page", String(Math.min(input.maxResults, 100)));
    const response = await fetch(url, {
      headers: {
        ...githubHeaders(this.token),
        Accept: "application/vnd.github.text-match+json",
      },
      signal: input.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new ChatError("GITHUB_AUTH", "GitHub repository search is not authorized.", 403);
      throw new ChatError("GITHUB_SEARCH", "GitHub repository search failed.", 502);
    }
    const payload = (await response.json()) as {
      items?: Array<{
        path?: string;
        text_matches?: Array<{ fragment?: string; matches?: Array<{ indices?: [number, number] }> }>;
      }>;
    };
    const matches: RepositorySearchMatch[] = [];
    for (const item of payload.items ?? []) {
      if (typeof item.path !== "string") continue;
      const text = item.text_matches?.[0]?.fragment ?? "Match in repository";
      const offset = item.text_matches?.[0]?.matches?.[0]?.indices?.[0] ?? 0;
      const line = Math.max(1, text.slice(0, offset).split("\n").length);
      matches.push({ path: item.path, line, preview: text.slice(0, 500) });
      if (matches.length >= input.maxResults) break;
    }
    return matches;
  }

  async patch(input: {
    path: string;
    expectedSha: string;
    content: string;
    signal: AbortSignal;
  }): Promise<RepositoryPatchResult> {
    const path = normalizeWorkspacePath(input.path);
    if (Buffer.byteLength(input.content) > 1_048_576)
      throw new ChatError("REPOSITORY_FILE", "Repository patch exceeds the file-size limit.");
    await this.#ensureBranch(input.signal);
    let current: ContentResponse;
    try {
      current = await this.#content(path, this.#workBranch, input.signal);
    } catch (error) {
      if (!(error instanceof ChatError) || error.code !== "GITHUB_NOT_FOUND") throw error;
      current = await this.#content(path, this.baseBranch, input.signal);
    }
    if (current.sha !== input.expectedSha)
      throw new ChatError("STALE_FILE", "Repository file changed; read it again before patching.", 409);
    const response = await githubJson<{ content?: { sha?: string } }>(
      `${GITHUB_API}/repos/${this.#owner}/${this.#repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      this.token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Odin: update ${path}`,
          content: Buffer.from(input.content, "utf8").toString("base64"),
          sha: current.sha,
          branch: this.#workBranch,
        }),
        signal: input.signal,
      },
    );
    const sha = response.content?.sha;
    if (typeof sha !== "string")
      throw new ChatError("GITHUB_UPSTREAM", "GitHub did not return the updated file identity.", 502);
    return { sha };
  }

  get workBranch(): string {
    return this.#workBranch;
  }

  async #content(path: string, ref: string, signal: AbortSignal): Promise<ContentResponse> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return githubJson<ContentResponse>(
      `${GITHUB_API}/repos/${this.#owner}/${this.#repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
      this.token,
      { signal },
    );
  }

  async #ensureBranch(signal: AbortSignal): Promise<void> {
    if (this.#branchReady) return;
    const ref = await githubJson<{ object: { sha: string } }>(
      `${GITHUB_API}/repos/${this.#owner}/${this.#repo}/git/ref/heads/${encodeURIComponent(this.baseBranch)}`,
      this.token,
      { signal },
    );
    const response = await fetch(`${GITHUB_API}/repos/${this.#owner}/${this.#repo}/git/refs`, {
      method: "POST",
      headers: { ...githubHeaders(this.token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${this.#workBranch}`, sha: ref.object.sha }),
      signal,
    });
    if (!response.ok && response.status !== 422) {
      if (response.status === 401 || response.status === 403)
        throw new ChatError("GITHUB_WRITE_DENIED", "GitHub repository write access is required.", 403);
      throw new ChatError("GITHUB_UPSTREAM", "Odin could not create its repository work branch.", 502);
    }
    this.#branchReady = true;
  }
}
