import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { CanonicalWorkspaceBoundary } from "../sandbox/workspace.js";
import type { RepositorySearchMatch, RepositoryWorkspace } from "../tools/repository.js";
import { hashText, safeText } from "./safety.js";
import { type ChatChange, ChatError } from "./types.js";

const EXCLUDED = new Set([
  ".git",
  ".odin",
  ".ssh",
  ".aws",
  ".github",
  "node_modules",
  "dist",
  "coverage",
  ".next",
]);
const PROTECTED = new Set(["AGENTS.md", "CLAUDE.md", "odin.config.json", "package-lock.json"]);

export class LocalChatWorkspace implements RepositoryWorkspace {
  readonly #boundary: CanonicalWorkspaceBoundary;
  readonly #write: boolean;
  readonly #onChange: (change: ChatChange) => void | Promise<void>;
  private constructor(
    boundary: CanonicalWorkspaceBoundary,
    write: boolean,
    onChange: (change: ChatChange) => void | Promise<void>,
  ) {
    this.#boundary = boundary;
    this.#write = write;
    this.#onChange = onChange;
  }
  static async create(
    root: string,
    write: boolean,
    onChange: (change: ChatChange) => void | Promise<void> = () => {},
  ) {
    return new LocalChatWorkspace(await CanonicalWorkspaceBoundary.create(root), write, onChange);
  }
  async #path(path: string, write = false): Promise<string> {
    assertPath(path, write);
    const resolved = write
      ? await this.#boundary.resolveForWrite(path)
      : await this.#boundary.resolveExisting(path);
    assertPath(
      relative(this.#boundary.canonicalRoot, resolved.canonicalPath).split("\\").join("/"),
      write,
    );
    return resolved.canonicalPath;
  }
  async read(input: Parameters<RepositoryWorkspace["read"]>[0]) {
    input.signal.throwIfAborted();
    const path = await this.#path(input.path);
    const meta = await lstat(path);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 1_048_576)
      throw new ChatError("FILE_LIMIT", "File is not an eligible bounded text file.");
    const data = await readFile(path);
    input.signal.throwIfAborted();
    if (data.includes(0))
      throw new ChatError("BINARY_FILE", "Binary files cannot enter text context.");
    const text = safeText(data.toString("utf8"), 1_048_576);
    return {
      content: Buffer.from(text).subarray(0, input.maxBytes).toString("utf8"),
      truncated: data.length > input.maxBytes,
      sha: hashText(text),
    };
  }
  async search(
    input: Parameters<RepositoryWorkspace["search"]>[0],
  ): Promise<readonly RepositorySearchMatch[]> {
    input.signal.throwIfAborted();
    const base = input.path === "." ? this.#boundary.canonicalRoot : await this.#path(input.path);
    const matches: RepositorySearchMatch[] = [];
    let visited = 0;
    let bytes = 0;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 12 || visited >= 2000 || bytes > 8_000_000 || matches.length >= input.maxResults)
        return;
      const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const entry of entries) {
        input.signal.throwIfAborted();
        if (++visited > 2000 || bytes > 8_000_000 || matches.length >= input.maxResults) return;
        if (entry.isSymbolicLink() || EXCLUDED.has(entry.name) || entry.name.startsWith(".env"))
          continue;
        const path = relative(this.#boundary.canonicalRoot, `${directory}/${entry.name}`)
          .split("\\")
          .join("/");
        if (entry.isDirectory()) {
          await walk(`${directory}/${entry.name}`, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const result = await this.read({ path, maxBytes: 32_768, signal: input.signal });
          bytes += Buffer.byteLength(result.content);
          const line = result.content
            .split("\n")
            .findIndex((text) => text.toLowerCase().includes(input.query.toLowerCase()));
          if (line >= 0 || path.toLowerCase().includes(input.query.toLowerCase())) {
            matches.push({
              path,
              line: line + 1 || 1,
              preview: (result.content.split("\n")[Math.max(0, line)] ?? "").slice(0, 200),
            });
          }
        } catch (error) {
          if (input.signal.aborted) throw error;
        }
      }
    };
    if ((await lstat(base)).isDirectory()) await walk(base, 0);
    else {
      const file = await this.read({ path: input.path, maxBytes: 32_768, signal: input.signal });
      file.content.split("\n").forEach((line, i) => {
        if (matches.length < input.maxResults && line.includes(input.query))
          matches.push({ path: input.path, line: i + 1, preview: line.slice(0, 200) });
      });
    }
    return matches;
  }
  async patch(input: Parameters<RepositoryWorkspace["patch"]>[0]) {
    if (!this.#write)
      throw new ChatError("READ_ONLY", "Workspace writes are disabled by the operator.", 403);
    input.signal.throwIfAborted();
    const path = await this.#path(input.path, true);
    const content = safeText(input.content, 262_144);
    let before: string | null = null;
    try {
      const meta = await lstat(path);
      if (!meta.isFile() || meta.isSymbolicLink() || meta.nlink > 1)
        throw new ChatError("UNSAFE_FILE", "Linked or non-regular write targets are denied.");
      before = safeText(await readFile(path, "utf8"), 262_144);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if ((before === null ? "absent" : hashText(before)) !== input.expectedSha)
      throw new ChatError(
        "STALE_FILE",
        "File changed; read its current content before editing.",
        409,
      );
    if (before === content) return { sha: hashText(content) };
    await mkdir(dirname(path), { recursive: true });
    const fresh = await this.#path(input.path, true);
    if (fresh !== path) throw new ChatError("STALE_PATH", "Workspace path changed.", 409);
    const temporary = `${path}.odin-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
      input.signal.throwIfAborted();
      let current: string | null = null;
      try {
        current = await readFile(path, "utf8");
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      if (current !== before)
        throw new ChatError("STALE_FILE", "Concurrent workspace change detected.", 409);
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    const sha = hashText(content);
    await this.#onChange({ path: input.path, before, after: content, sha });
    return { sha };
  }
}

function assertPath(path: string, write: boolean): void {
  const segments = path.split("/");
  if (
    segments.some((segment) => EXCLUDED.has(segment) || segment.startsWith(".env")) ||
    /\.(?:pem|key|p12|pfx|sqlite|db)(?:-|$)/iu.test(path)
  ) {
    throw new ChatError("PROTECTED_PATH", "Path contains private or protected state.", 403);
  }
  if (write && segments.some((segment) => PROTECTED.has(segment)))
    throw new ChatError(
      "PROTECTED_PATH",
      "Runtime instructions and configuration are protected.",
      403,
    );
}
function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
