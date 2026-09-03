import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type CanonicalWorkspacePath, SandboxError } from "./types.js";

const MAX_RELATIVE_PATH_LENGTH = 2_048;

export class CanonicalWorkspaceBoundary {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static async create(root: string): Promise<CanonicalWorkspaceBoundary> {
    if (typeof root !== "string" || root.trim() === "") {
      throw new SandboxError("PATH_INVALID", "Workspace root must be a non-empty path.");
    }
    const canonicalRoot = await canonicalizeHostPath(resolve(root), "workspace root");
    const metadata = await stat(canonicalRoot);
    if (!metadata.isDirectory()) {
      throw new SandboxError("PATH_INVALID", "Workspace root must resolve to a directory.");
    }
    return new CanonicalWorkspaceBoundary(canonicalRoot);
  }

  get canonicalRoot(): string {
    return this.#root;
  }

  async resolveExisting(
    value: string,
    options: { readonly allowRoot?: boolean; readonly requireDirectory?: boolean } = {},
  ): Promise<CanonicalWorkspacePath> {
    const relativePath = normalizeRelativePath(value, options.allowRoot === true);
    const candidate = relativePath === "." ? this.#root : join(this.#root, relativePath);
    const canonicalPath = await canonicalizeHostPath(candidate, "workspace target");
    this.#assertInside(canonicalPath);
    if (options.requireDirectory === true) {
      const metadata = await stat(canonicalPath);
      if (!metadata.isDirectory()) {
        throw new SandboxError("PATH_INVALID", "Workspace target must resolve to a directory.");
      }
    }
    return Object.freeze({ canonicalPath, relativePath });
  }

  async resolveDirectory(value = "."): Promise<CanonicalWorkspacePath> {
    return this.resolveExisting(value, { allowRoot: true, requireDirectory: true });
  }

  async resolveForWrite(value: string): Promise<CanonicalWorkspacePath> {
    const relativePath = normalizeRelativePath(value, false);
    const candidate = join(this.#root, relativePath);

    try {
      const canonicalPath = await realpath(candidate);
      this.#assertInside(canonicalPath);
      return Object.freeze({ canonicalPath, relativePath });
    } catch (error: unknown) {
      if (!isMissingPath(error)) {
        throw normalizeFilesystemError(error, "workspace write target");
      }
    }

    let ancestor = dirname(candidate);
    while (true) {
      try {
        const canonicalAncestor = await realpath(ancestor);
        this.#assertInside(canonicalAncestor);
        const remainder = relative(ancestor, candidate);
        if (remainder === "" || isAbsolute(remainder) || escapesLexically(remainder)) {
          throw new SandboxError("PATH_ESCAPE", "Write target escaped its existing ancestor.");
        }
        return Object.freeze({
          canonicalPath: join(canonicalAncestor, remainder),
          relativePath,
        });
      } catch (error: unknown) {
        if (!isMissingPath(error)) {
          if (error instanceof SandboxError) throw error;
          throw normalizeFilesystemError(error, "workspace write parent");
        }
      }

      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new SandboxError("PATH_ESCAPE", "No existing workspace parent could be resolved.");
      }
      ancestor = parent;
    }
  }

  #assertInside(candidate: string): void {
    const difference = relative(this.#root, candidate);
    if (difference === "") return;
    if (isAbsolute(difference) || escapesLexically(difference)) {
      throw new SandboxError("PATH_ESCAPE", "Canonical path escapes the workspace root.");
    }
  }
}

export function normalizeRelativePath(value: string, allowRoot = false): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SandboxError("PATH_INVALID", "Workspace path must be non-empty.");
  }
  if (value.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new SandboxError("PATH_INVALID", "Workspace path exceeds the configured bound.");
  }
  if (value.includes("\u0000") || value.includes("\\")) {
    throw new SandboxError("PATH_INVALID", "Workspace path contains an ambiguous character.");
  }
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) {
    throw new SandboxError("PATH_INVALID", "Absolute workspace paths are not allowed.");
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new SandboxError("PATH_INVALID", "Workspace traversal is not allowed.");
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized === "") {
    if (allowRoot) return ".";
    throw new SandboxError("PATH_INVALID", "A workspace file path is required.");
  }
  return normalized;
}

function escapesLexically(value: string): boolean {
  return value === ".." || value.startsWith(`..${sep}`);
}

async function canonicalizeHostPath(value: string, label: string): Promise<string> {
  try {
    return await realpath(value);
  } catch (error: unknown) {
    throw normalizeFilesystemError(error, label);
  }
}

function normalizeFilesystemError(error: unknown, label: string): SandboxError {
  if (error instanceof SandboxError) return error;
  if (isMissingPath(error)) {
    return new SandboxError("PATH_INVALID", `${label} does not exist.`);
  }
  return new SandboxError("PATH_INVALID", `${label} could not be resolved.`);
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
