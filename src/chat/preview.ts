import { posix } from "node:path";
import { type DefaultTreeAdapterMap, parse, serialize } from "parse5";
import { normalizeWorkspacePath } from "../tools/repository.js";
import { ChatError } from "./types.js";

export const PREVIEW_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/** Render saved HTML with local assets. The response MUST use PREVIEW_CSP and an opaque iframe. */
export function assemblePreview(
  files: readonly { path: string; content: string }[],
  path: string,
): string {
  const file = files.find((entry) => entry.path === normalizeWorkspacePath(path));
  if (!file || !/\.html?$/u.test(file.path))
    throw new ChatError("NOT_FOUND", "HTML preview not found.", 404);
  const document = parse(file.content);
  const walk = (node: DefaultTreeAdapterMap["node"]): void => {
    if ("tagName" in node) {
      const attribute = node.tagName === "script" ? "src" : node.tagName === "link" ? "href" : null;
      const reference = node.attrs.find((attr) => attr.name === attribute)?.value;
      if (attribute && reference && !/^[a-z]+:|^\/\//iu.test(reference)) {
        const path = posix.normalize(
          posix.join(
            reference.startsWith("/") ? "." : posix.dirname(file.path),
            reference.replace(/^\//u, "").split(/[?#]/u)[0] ?? "",
          ),
        );
        const target = files.find((entry) => entry.path === path);
        if (
          target &&
          (node.tagName === "script" ||
            node.attrs.some((attr) => attr.name === "rel" && attr.value === "stylesheet"))
        ) {
          if (node.tagName === "link") node.tagName = "style";
          node.attrs = node.attrs.filter(
            (attr) => attr.name !== attribute && attr.name !== "integrity" && attr.name !== "rel",
          );
          node.childNodes = [{ nodeName: "#text", value: target.content, parentNode: node }];
        }
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child);
  };
  walk(document);
  return serialize(document);
}
