import type { QualityCommandRunner, RepositoryWorkspace } from "../tools/repository.js";
import { GitHubWorkspace } from "./github-workspace.js";
import type { ChatChange } from "./types.js";

export class GitHubWorkspaceSession implements QualityCommandRunner {
  #workspace: GitHubWorkspace | undefined;

  constructor(
    readonly token: string,
    readonly repository: string,
    readonly defaultBranch: string,
    readonly request: typeof fetch = fetch,
  ) {}

  workspace(onChange: (change: ChatChange) => Promise<void>): RepositoryWorkspace {
    this.#workspace ??= new GitHubWorkspace(
      this.token,
      this.repository,
      this.defaultBranch,
      async (change) => onChange(change),
      this.request,
    );
    return this.#workspace;
  }

  commands() {
    return new GitHubWorkspace(
      this.token,
      this.repository,
      this.defaultBranch,
      async () => {},
      this.request,
    ).commands();
  }

  async run(commandId: string, signal: AbortSignal) {
    if (!this.#workspace)
      return {
        exitCode: 1,
        output: "Verification incomplete: no isolated Odin work branch exists.",
      };
    return this.#workspace.run(commandId, signal);
  }

  branchName(): string | null {
    return this.#workspace?.branchName() ?? null;
  }
}
