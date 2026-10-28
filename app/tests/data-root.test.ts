import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// The app and the Python tools both read the data directory from MASTER_REPO_ROOT (see DATA.md). repository.ts
// reads it at import, so it's set before the dynamic imports below.
let root = "";
before(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "mr-data-")));
  await mkdir(path.join(root, "companies", "demo"), { recursive: true });
  await mkdir(path.join(root, "holding"));
  await mkdir(path.join(root, "local"));
  await writeFile(path.join(root, "companies", "demo", "company.json"), JSON.stringify({ id: "demo", name: "Demo" }));
  await writeFile(path.join(root, "local", "owner.json"), JSON.stringify({ name: "Dana Demo", short: "Dana" }));
  process.env.MASTER_REPO_ROOT = root;
});
after(async () => {
  delete process.env.MASTER_REPO_ROOT;
  await rm(root, { recursive: true, force: true });
});

test("the app reads projects and the owner from MASTER_REPO_ROOT", async () => {
  const repo = await import("../src/lib/repository");
  const { getOwner } = await import("../src/lib/owner");
  assert.equal(repo.repoRoot, root);
  assert.equal(repo.codeRoot, path.resolve(process.cwd(), ".."));
  assert.deepEqual((await repo.getCompanies()).map((c) => c.id), ["demo"]);
  assert.deepEqual(await getOwner(), { name: "Dana Demo", short: "Dana" });
  // The tools ship with the app; Python is told the same data directory.
  assert.equal(repo.toolPath("converse.py"), path.join(repo.codeRoot, "tools", "converse.py"));
  const python = execFileSync("python3", ["-c", "import paths, converse; print(paths.ROOT); print(converse.project_slugs())"], {
    cwd: path.dirname(repo.toolPath("paths.py")),
    env: repo.pythonEnv(),
  })
    .toString()
    .trim()
    .split("\n");
  assert.deepEqual(python, [root, "['demo']"]);
});

test("owner fallbacks", async () => {
  const { ownerOf } = await import("../src/lib/owner");
  assert.deepEqual(ownerOf(null), { name: "Owner", short: "You" });
  assert.deepEqual(ownerOf({ name: "Dana Demo" }), { name: "Dana Demo", short: "Dana" });
});

test("build directions match the owner's name and generic owner logs", async () => {
  const { messagesOf } = await import("../src/lib/builds");
  const line = (who: string, text: string) =>
    JSON.stringify({ type: "mr_prompt", at: "t", text: `Direction from ${who}:\n\n${text}\n\nContinue on this branch, commit.` });
  const got = messagesOf([line("Dana", "new"), line("Owner", "old"), line("Someone", "no")], "Dana");
  assert.deepEqual(got.map((m) => m.text), ["new", "old"]);
});
