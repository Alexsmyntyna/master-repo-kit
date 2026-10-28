import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./repository";

const home = os.homedir();
export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Pasted or dropped files (images or anything else) are saved under holding/uploads/<date>/ (kept out of git)
// and attached by path, so agents can read them like any other file.
export async function saveUploads(files: File[]): Promise<string[]> {
  const picked = files.filter((f) => f.size > 0);
  if (picked.length > MAX_IMAGES) throw new Error(`Attach at most ${MAX_IMAGES} files at once.`);
  const dir = path.join(repoRoot, "holding", "uploads", new Date().toISOString().slice(0, 10));
  await mkdir(dir, { recursive: true });
  const saved: string[] = [];
  for (const f of picked) {
    if (f.size > MAX_IMAGE_BYTES) throw new Error(`${f.name} is over 10 MB.`);
    const ext =
      path.extname(f.name).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10) ||
      (f.type.startsWith("image/") ? `.${f.type.split("/")[1]}` : ".bin");
    const base = path.basename(f.name, path.extname(f.name)).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 40) || "file";
    const file = path.join(dir, `${Date.now().toString(36)}-${base}${ext}`);
    await writeFile(file, new Uint8Array(await f.arrayBuffer()));
    saved.push(file);
  }
  return saved;
}

// Path suggestions for the attach field: entries under the typed folder, inside the home folder only.
export async function listPaths(input: string): Promise<{ path: string; dir: boolean }[]> {
  const typed = input.trim().replace(/^~(?=\/|$)/, home) || home + "/";
  const resolved = path.resolve(typed);
  if (resolved !== home && !resolved.startsWith(home + path.sep)) return [];
  const [dir, prefix] = typed.endsWith("/") ? [resolved, ""] : [path.dirname(resolved), path.basename(resolved)];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith(".") && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 12)
      .map((e) => ({ path: path.join(dir, e.name), dir: e.isDirectory() }));
  } catch {
    return [];
  }
}

export async function existingPaths(paths: string[]): Promise<string[]> {
  const ok: string[] = [];
  for (const p of paths) {
    const resolved = path.resolve(p.replace(/^~(?=\/|$)/, home));
    if (!resolved.startsWith(home + path.sep)) throw new Error(`${p} isn't inside your home folder.`);
    await stat(resolved).catch(() => {
      throw new Error(`${p} doesn't exist.`);
    });
    ok.push(resolved);
  }
  return ok;
}
