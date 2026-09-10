import assert from "node:assert/strict";
import test from "node:test";
import { GitHubCatalog } from "../../src/chat/github-catalog.js";
import { ChatError } from "../../src/chat/types.js";

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("GitHub catalog lists accessible repositories and follows bounded pagination", async () => {
  const calls: string[] = [];
  const catalog = new GitHubCatalog("token", async (url) => {
    calls.push(String(url));
    if (calls.length === 1)
      return response(
        [
          {
            full_name: "acme/private-app",
            name: "private-app",
            private: true,
            archived: false,
            default_branch: "main",
            updated_at: "2026-09-10T10:00:00Z",
            owner: { login: "acme" },
          },
        ],
        200,
        {
          link: '<https://api.github.com/user/repos?page=2&per_page=100>; rel="next", <https://api.github.com/user/repos?page=2&per_page=100>; rel="last"',
        },
      );
    return response([
      {
        full_name: "person/tools",
        name: "tools",
        private: false,
        archived: false,
        default_branch: "trunk",
        updated_at: "2026-09-09T10:00:00Z",
        owner: { login: "person" },
      },
    ]);
  });
  const repositories = await catalog.repositories();
  assert.equal(repositories.length, 2);
  assert.deepEqual(repositories[0], {
    fullName: "acme/private-app",
    owner: "acme",
    name: "private-app",
    private: true,
    archived: false,
    defaultBranch: "main",
    updatedAt: "2026-09-10T10:00:00Z",
  });
  assert.match(calls[1] ?? "", /^https:\/\/api\.github\.com\/user\/repos\?page=2/u);
});

test("GitHub catalog returns real branches with commit identity", async () => {
  const catalog = new GitHubCatalog("token", async (url) => {
    assert.match(String(url), /\/repos\/acme\/private-app\/branches\?per_page=100/u);
    return response([
      { name: "main", protected: true, commit: { sha: "a".repeat(40) } },
      { name: "feature/mobile", protected: false, commit: { sha: "b".repeat(40) } },
    ]);
  });
  assert.deepEqual(await catalog.branches("acme/private-app"), [
    { name: "main", protected: true, commitSha: "a".repeat(40) },
    { name: "feature/mobile", protected: false, commitSha: "b".repeat(40) },
  ]);
});

test("repository selection is verified against GitHub before persistence", async () => {
  const calls: string[] = [];
  const catalog = new GitHubCatalog("token", async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/branches/feature%2Fmobile"))
      return response({ name: "feature/mobile", protected: false, commit: { sha: "c".repeat(40) } });
    return response({
      full_name: "acme/private-app",
      name: "private-app",
      private: true,
      archived: false,
      default_branch: "main",
      owner: { login: "acme" },
    });
  });
  const selection = await catalog.verifySelection("acme/private-app", "feature/mobile");
  assert.equal(selection.repository.fullName, "acme/private-app");
  assert.equal(selection.branch.name, "feature/mobile");
  assert.equal(calls.length, 2);
});

test("GitHub failures become actionable public product errors", async () => {
  for (const [status, code] of [
    [401, "GITHUB_TOKEN_EXPIRED"],
    [403, "GITHUB_PERMISSION_DENIED"],
    [404, "GITHUB_REPOSITORY_UNAVAILABLE"],
    [429, "GITHUB_RATE_LIMIT"],
  ] as const) {
    const catalog = new GitHubCatalog("token", async () => response({}, status));
    await assert.rejects(
      () => catalog.repositories(),
      (error: unknown) => error instanceof ChatError && error.code === code && error.status === status,
    );
  }
});

test("repository and branch names fail closed before any request", async () => {
  let calls = 0;
  const catalog = new GitHubCatalog("token", async () => {
    calls++;
    return response([]);
  });
  await assert.rejects(() => catalog.branches("https://github.com/acme/repo"), /valid GitHub repository/u);
  await assert.rejects(
    () => catalog.verifySelection("acme/repo", "../main"),
    /valid Git branch/u,
  );
  assert.equal(calls, 0);
});
