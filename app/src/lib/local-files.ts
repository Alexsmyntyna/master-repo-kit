import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { looksLikePath } from "./file-paths";
import { repoRoot } from "./repository";

// Clicking a file path in a summary opens it on this Mac. The path is only ever looked up inside the folders the
// summary belongs to (a build's worktrees, the project's repos, Master-Repo), and a path or symlink that leads
// anywhere else is refused. Pages, images and PDFs open in their default app; everything else opens in Zed.
// Nothing that could run (apps, scripts) is ever handed to `open`.
const run = promisify(execFile);
const ID = /^[a-z0-9-]+$/;
const VIEW = new Set([".html", ".htm", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);
const WORKTREES = path.join(os.homedir(), ".master-repo", "worktrees");

async function inside(file: string, root: string): Promise<string | undefined> {
  try {
    const [real, base] = await Promise.all([realpath(file), realpath(root)]);
    return real === base || real.startsWith(base + path.sep) ? real : undefined;
  } catch {
    return undefined;
  }
}

async function projectRepos(slug: string): Promise<string[]> {
  try {
    const company = JSON.parse(await readFile(path.join(repoRoot, "companies", slug, "company.json"), "utf8"));
    return ((company.repos || []) as { path?: string }[]).map((r) => r.path || "").filter((p) => p.startsWith("/"));
  } catch {
    return [];
  }
}

export async function rootsOf(scope: string): Promise<string[]> {
  const [kind, slug, bid] = scope.split(":");
  if (kind === "master") return [repoRoot];
  if (!ID.test(slug || "")) return [];
  const repos = await projectRepos(slug);
  if (kind === "project") return [...repos, repoRoot];
  if (kind !== "build" || !ID.test(bid || "")) return [];
  const runs = path.join(repoRoot, "companies", slug, "builds", bid, "runs");
  const worktrees: string[] = [];
  for (const f of await readdir(runs).catch(() => [] as string[])) {
    if (!/^\d\d\.json$/.test(f)) continue;
    try {
      const wt = String(JSON.parse(await readFile(path.join(runs, f), "utf8")).worktree || "");
      if (wt.startsWith(path.join(WORKTREES, slug) + path.sep)) worktrees.push(wt);
    } catch {}
  }
  return [...worktrees, ...repos, repoRoot];
}

// Finds the file in the scope's folders, first match wins.
export async function resolveIn(scope: string, given: string): Promise<string | undefined> {
  const clean = given.trim().replace(/(:\d+)+$/, "").replace(/^~(?=\/)/, os.homedir());
  const roots = await rootsOf(scope);
  for (const root of roots) {
    const candidate = path.isAbsolute(clean) ? clean : path.join(root, clean);
    const found = await inside(candidate, root);
    if (found) return found;
  }
  return undefined;
}

export async function openLocal(scope: string, given: string): Promise<{ ok?: string; error?: string }> {
  if (!looksLikePath(given)) return { error: "That isn't a file path." };
  const file = await resolveIn(scope, given);
  if (!file) return { error: "Not found in this project's folders." };
  const info = await stat(/* turbopackIgnore: true */ file);
  const view = info.isFile() && VIEW.has(path.extname(file).toLowerCase());
  await run("open", view ? [file] : ["-a", "Zed", file], { timeout: 10000 });
  return { ok: view ? "Opened" : "Opened in Zed" };
}
