import { copyFile, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
for (const directory of ["web", "public"]) {
  const target = join(root, "dist", directory);
  await mkdir(target, { recursive: true });
  await cp(join(root, "web"), target, { recursive: true });
  await copyFile(join(root, "web/index.html"), join(target, "reference.html"));
}
await copyFile(join(root, "web/chat.html"), join(root, "dist/public/index.html"));
