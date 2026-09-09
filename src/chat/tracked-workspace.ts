import type {
  RepositoryPatchResult,
  RepositoryReadResult,
  RepositorySearchMatch,
  RepositoryWorkspace,
} from "../tools/repository.js";
import type { ChatChange } from "./types.js";

export class TrackedRepositoryWorkspace implements RepositoryWorkspace {
  constructor(
    readonly inner: RepositoryWorkspace,
    readonly onChange: (change: ChatChange) => Promise<void>,
  ) {}

  search(input: {
    readonly query: string;
    readonly path: string;
    readonly maxResults: number;
    readonly signal: AbortSignal;
  }): Promise<readonly RepositorySearchMatch[]> {
    return this.inner.search(input);
  }

  read(input: {
    readonly path: string;
    readonly maxBytes: number;
    readonly signal: AbortSignal;
  }): Promise<RepositoryReadResult> {
    return this.inner.read(input);
  }

  async patch(input: {
    readonly path: string;
    readonly expectedSha: string;
    readonly content: string;
    readonly signal: AbortSignal;
  }): Promise<RepositoryPatchResult> {
    const before = await this.inner.read({
      path: input.path,
      maxBytes: 1_048_576,
      signal: input.signal,
    });
    const result = await this.inner.patch(input);
    await this.onChange({
      path: input.path,
      before: before.content,
      after: input.content,
      sha: result.sha,
    });
    return result;
  }
}
