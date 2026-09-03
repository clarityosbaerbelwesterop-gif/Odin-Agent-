import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CanonicalWorkspaceBoundary,
  SandboxError,
} from "../../src/sandbox/index.js";

async function withWorkspace(
  callback: (input: { readonly base: string; readonly root: string }) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "odin-m12-workspace-"));
  const root = join(base, "root");
  await mkdir(root);
  try {
    await callback({ base, root });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
}

test("canonical workspace accepts internal files and internal symlinks", async () => {
  await withWorkspace(async ({ root }) => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "safe.txt"), "safe");
    await symlink(join(root, "src", "safe.txt"), join(root, "safe-link"));
    const workspace = await CanonicalWorkspaceBoundary.create(root);

    const direct = await workspace.resolveExisting("src/safe.txt");
    const linked = await workspace.resolveExisting("safe-link");
    assert.equal(direct.canonicalPath, linked.canonicalPath);
    assert.equal(direct.relativePath, "src/safe.txt");
    assert.equal(linked.relativePath, "safe-link");
  });
});

test("canonical workspace rejects lexical traversal and absolute path forms", async () => {
  await withWorkspace(async ({ root }) => {
    const workspace = await CanonicalWorkspaceBoundary.create(root);
    for (const value of ["../outside", "/tmp/outside", "C:/outside", "a\\b", "a\u0000b"]) {
      await assert.rejects(
        workspace.resolveExisting(value),
        (error: unknown) => error instanceof SandboxError && error.code === "PATH_INVALID",
      );
    }
  });
});

test("symlinked file and directory escapes are denied for reads cwd and writes", async () => {
  await withWorkspace(async ({ base, root }) => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(root, "escape-dir"), "dir");
    await symlink(join(outside, "secret.txt"), join(root, "escape-file"));
    const workspace = await CanonicalWorkspaceBoundary.create(root);

    for (const operation of [
      () => workspace.resolveExisting("escape-file"),
      () => workspace.resolveExisting("escape-dir/secret.txt"),
      () => workspace.resolveDirectory("escape-dir"),
      () => workspace.resolveForWrite("escape-dir/new.txt"),
    ]) {
      await assert.rejects(
        operation(),
        (error: unknown) => error instanceof SandboxError && error.code === "PATH_ESCAPE",
      );
    }
  });
});

test("new write targets resolve through their nearest existing canonical parent", async () => {
  await withWorkspace(async ({ root }) => {
    await mkdir(join(root, "generated"));
    const workspace = await CanonicalWorkspaceBoundary.create(root);
    const target = await workspace.resolveForWrite("generated/deep/new.txt");
    assert.equal(target.relativePath, "generated/deep/new.txt");
    assert.equal(target.canonicalPath, join(root, "generated", "deep", "new.txt"));
  });
});

test("root prefix confusion cannot make a sibling directory appear contained", async () => {
  await withWorkspace(async ({ base, root }) => {
    const sibling = `${root}-evil`;
    await mkdir(sibling);
    await writeFile(join(sibling, "secret.txt"), "secret");
    await symlink(sibling, join(root, "prefix-link"), "dir");
    const workspace = await CanonicalWorkspaceBoundary.create(root);

    await assert.rejects(
      workspace.resolveExisting("prefix-link/secret.txt"),
      (error: unknown) => error instanceof SandboxError && error.code === "PATH_ESCAPE",
    );
    assert.equal(base.length > 0, true);
  });
});
