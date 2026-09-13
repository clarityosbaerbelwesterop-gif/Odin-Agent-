import { parse as parseJavaScript } from "acorn";
import { type DefaultTreeAdapterMap, parse as parseHtml } from "parse5";
import {
  normalizeWorkspacePath,
  type QualityCommandRunner,
  type RepositoryWorkspace,
} from "../tools/repository.js";
import type { ActorDatabase } from "./neon-database.js";
import { assemblePreview } from "./preview.js";
import { hashText, safeText } from "./safety.js";
import { type ChatChange, ChatError } from "./types.js";

type Node = DefaultTreeAdapterMap["node"];
type File = { path: string; content: string; sha: string };
export class NeonWorkspace implements RepositoryWorkspace, QualityCommandRunner {
  constructor(
    readonly db: ActorDatabase,
    readonly conversationId: string,
    readonly changed: (change: ChatChange) => Promise<void>,
  ) {}
  async files(): Promise<File[]> {
    return this.db.transaction(
      async (c) =>
        (
          await c.query(
            "SELECT path,content,sha FROM odin_api.workspace_files WHERE conversation_id=$1 ORDER BY path LIMIT 200",
            [this.conversationId],
          )
        ).rows as File[],
    );
  }
  async search(input: Parameters<RepositoryWorkspace["search"]>[0]) {
    input.signal.throwIfAborted();
    const root = normalizeWorkspacePath(input.path, true);
    const query = input.query.toLowerCase();
    return (await this.files())
      .filter(
        (f) =>
          (root === "." || f.path === root || f.path.startsWith(`${root}/`)) &&
          (f.path.toLowerCase().includes(query) || f.content.toLowerCase().includes(query)),
      )
      .slice(0, input.maxResults)
      .map((f) => ({ path: f.path, line: 1, preview: f.content.slice(0, 600) }));
  }
  async read(input: Parameters<RepositoryWorkspace["read"]>[0]) {
    input.signal.throwIfAborted();
    const path = eligible(input.path);
    const file = (await this.files()).find((f) => f.path === path);
    if (!file) throw new ChatError("NOT_FOUND", "Workspace file not found.", 404);
    if (hashText(file.content) !== file.sha)
      throw new ChatError("INTEGRITY_FAILURE", "Workspace hash mismatch.", 500);
    return {
      content: Buffer.from(file.content).subarray(0, input.maxBytes).toString("utf8"),
      sha: file.sha,
      truncated: Buffer.byteLength(file.content) > input.maxBytes,
    };
  }
  async patch(input: Parameters<RepositoryWorkspace["patch"]>[0]) {
    input.signal.throwIfAborted();
    const path = eligible(input.path);
    const content = safeText(input.content, 262144);
    const sha = hashText(content);
    const before = await this.db.transaction(async (c) => {
      // Lock the conversation to serialize file-count/size bounds and CAS creation.
      const owner = (
        await c.query("SELECT id FROM odin_api.conversations WHERE id=$1 FOR UPDATE", [
          this.conversationId,
        ])
      ).rows[0];
      if (!owner) throw new ChatError("NOT_FOUND", "Workspace not found.", 404);
      const files = (
        await c.query(
          "SELECT path,content,sha FROM odin_api.workspace_files WHERE conversation_id=$1",
          [this.conversationId],
        )
      ).rows as File[];
      const previous = files.find((f) => f.path === path);
      if ((previous?.sha ?? "absent") !== input.expectedSha)
        throw new ChatError("STALE_FILE", "File changed; read it again.", 409);
      if (
        (!previous && files.length >= 200) ||
        files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) -
          Buffer.byteLength(previous?.content ?? "") +
          Buffer.byteLength(content) >
          10000000
      )
        throw new ChatError("STORAGE_LIMIT", "Workspace size limit reached.", 409);
      await c.query(
        `INSERT INTO odin_api.workspace_files
          (conversation_id,path,content,sha,kind,title,mime_type,origin)
         VALUES($1,$2,$3,$4,'GENERATED_ARTIFACT',$5,$6,'runtime')
         ON CONFLICT(owner_id,conversation_id,path) DO UPDATE SET
           content=excluded.content,
           sha=excluded.sha,
           version=odin_api.workspace_files.version+1,
           updated_at=now()`,
        [this.conversationId, path, content, sha, basename(path), mime(path)],
      );
      return previous?.content ?? null;
    });
    await this.changed({ path, before, after: content, sha });
    return { sha };
  }
  commands() {
    return [{ id: "web-syntax", label: "HTML, JavaScript and JSON syntax (no execution test)" }];
  }
  async run(commandId: string, signal: AbortSignal) {
    if (commandId !== "web-syntax")
      throw new ChatError("QUALITY_DENIED", "Unknown quality command.", 403);
    const files = await this.files();
    const errors: string[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      try {
        if (/\.(m?js)$/u.test(file.path))
          parseJavaScript(file.content, { ecmaVersion: "latest", sourceType: "module" });
        if (file.path.endsWith(".json")) JSON.parse(file.content);
        if (/\.html?$/u.test(file.path)) {
          const html = parseHtml(file.content);
          walk(html, (node) => {
            if (
              "tagName" in node &&
              node.tagName === "script" &&
              !node.attrs.some((a) => a.name === "src")
            ) {
              const text = node.childNodes
                .filter((n) => "value" in n)
                .map((n) => ("value" in n ? n.value : ""))
                .join("");
              const type = node.attrs.find((a) => a.name === "type")?.value;
              if (!type || type === "module" || /(?:java|ecma)script/u.test(type))
                parseJavaScript(text, {
                  ecmaVersion: "latest",
                  sourceType: type === "module" ? "module" : "script",
                });
            }
          });
        }
      } catch {
        errors.push(`${file.path}: syntax check failed`);
      }
    }
    return {
      exitCode: errors.length ? 1 : 0,
      output:
        errors.join("\n") ||
        `Syntax checked ${files.length} files. Browser behaviour and application tests were not executed.`,
    };
  }
  async preview(path: string): Promise<string> {
    const files = await this.files();
    return assemblePreview(files, eligible(path));
  }
}
function eligible(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  if (
    normalized.split("/").some((p) => p.startsWith(".")) ||
    !/\.(?:html?|css|m?js|json|md)$/u.test(normalized)
  )
    throw new ChatError(
      "FILE_TYPE",
      "Hosted workspaces support HTML, CSS, JavaScript, JSON and Markdown files.",
    );
  return normalized;
}
function basename(path: string): string {
  return path.split("/").at(-1) || "Generated artifact";
}
function mime(path: string): string {
  if (/\.html?$/iu.test(path)) return "text/html";
  if (/\.css$/iu.test(path)) return "text/css";
  if (/\.m?js$/iu.test(path)) return "text/javascript";
  if (/\.json$/iu.test(path)) return "application/json";
  if (/\.md$/iu.test(path)) return "text/markdown";
  return "text/plain";
}
function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  if ("childNodes" in node) for (const child of node.childNodes) walk(child, visit);
}
