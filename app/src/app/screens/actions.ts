"use server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { pythonEnv, repoRoot, toolPath } from "@/lib/repository";
import { getScreens } from "@/lib/screens";
import { startDetached } from "@/lib/spawn";

const run = promisify(execFile);
const tool = toolPath("screens.py");
export type ScreensState = { error?: string; done?: string };
const field = (form: FormData, name: string) => String(form.get(name) || "").trim();

export async function addNote(_previous: ScreensState, form: FormData): Promise<ScreensState> {
  const slug = field(form, "slug"),
    surface = field(form, "surface"),
    severity = field(form, "severity"),
    body = field(form, "text"),
    capture = field(form, "capture");
  const screens = await getScreens(slug);
  if (!screens) return { error: "Unknown project." };
  if (!["issue", "needs-evaluation", "suggestion"].includes(severity)) return { error: "Choose a kind." };
  if (!body || body.length > 2000) return { error: "Write the note (under 2,000 characters)." };
  const args = [tool, "note", slug, "--surface", surface, "--severity", severity, "--text", body, "--author", "owner"];
  if (capture) args.push("--capture", capture);
  try {
    await run("python3", args, { cwd: repoRoot, env: pythonEnv(), timeout: 15000 });
  } catch {
    return { error: "The note couldn’t be saved." };
  }
  revalidatePath(`/companies/${slug}/screens`);
  return { done: "Noted." };
}

export async function resolveNote(_previous: ScreensState, form: FormData): Promise<ScreensState> {
  const slug = field(form, "slug"),
    note = field(form, "note");
  if (!(await getScreens(slug)) || !/^[a-f0-9]{4,}$/.test(note)) return { error: "Unknown note." };
  try {
    await run("python3", [tool, "resolve", slug, "--note", note, "--text", field(form, "text") || "Resolved."], {
      cwd: repoRoot,
      env: pythonEnv(),
      timeout: 15000,
    });
  } catch {
    return { error: "Couldn’t resolve it." };
  }
  revalidatePath(`/companies/${slug}/screens`);
  return { done: "Resolved." };
}

export async function startScreens(_previous: ScreensState, form: FormData): Promise<ScreensState> {
  const slug = field(form, "slug"),
    task = field(form, "task"),
    surface = field(form, "surface");
  if (!(await getScreens(slug))) return { error: "Unknown project." };
  if (surface && !/^[A-Za-z0-9._-]+$/.test(surface)) return { error: "Unknown screen." };
  const extra = surface ? ["--surfaces", surface] : [];
  if (task === "capture") startDetached(`screens-capture-${slug}`, [tool, "capture", slug, ...extra, "--apply"]);
  else if (task === "analyze") startDetached(`screens-review-${slug}`, [tool, "analyze", slug, ...extra, "--apply"]);
  else if (task === "sync") await run("python3", [tool, "sync", slug], { cwd: repoRoot, env: pythonEnv(), timeout: 60000 });
  else return { error: "Unknown task." };
  revalidatePath(`/companies/${slug}/screens`);
  return {
    done:
      task === "sync"
        ? "Synced the latest captures."
        : task === "capture"
          ? "Capture started. It shows up under Runs."
          : "Review started",
  };
}
