import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const testRoot = join(root, "dist", "test");

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTests(path)));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(path);
    }
  }

  return files.sort();
}

await rm(join(root, "dist"), { force: true, recursive: true });

{
  const compiler = spawn(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  const compileExitCode = await new Promise((resolve, reject) => {
    compiler.once("error", reject);
    compiler.once("exit", (code) => resolve(code ?? 1));
  });

  if (compileExitCode !== 0) {
    process.exitCode = compileExitCode;
  } else {
    const tests = await findTests(testRoot);
    if (tests.length === 0) {
      throw new Error("No compiled test files were found.");
    }

    const runner = spawn(
      process.execPath,
      [
        "--test",
        "--experimental-test-coverage",
        "--test-coverage-branches=60",
        "--test-coverage-functions=80",
        "--test-coverage-lines=80",
        ...tests,
      ],
      {
        cwd: root,
        stdio: "inherit",
      },
    );
    const testExitCode = await new Promise((resolve, reject) => {
      runner.once("error", reject);
      runner.once("exit", (code) => resolve(code ?? 1));
    });
    process.exitCode = testExitCode;
  }
}
