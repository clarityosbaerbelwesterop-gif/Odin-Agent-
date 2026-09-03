import { cp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await cp(join(root, "web"), join(root, "dist", "web"), {
  recursive: true,
});
