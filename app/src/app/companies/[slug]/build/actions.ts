"use server";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { getCompany, pythonEnv, repoRoot, toolPath } from "@/lib/repository";
import { startDetached } from "@/lib/spawn";

// Everything goes through tools/build.py, so the CLI and the app share one build format.
const run = promisify(execFile);
const tool = toolPath("build.py");
export type BuildState = { error?: string; done?: string };
const field = (form: FormData, name: string) => String(form.get(name) || "").trim();
const ID = /^[a-z0-9-]+$/;
const N = /^\d\d$/;

async function target(form: FormData, needBuild = true, needBrief = false) {
  const slug = field(form, "slug"),
    build = field(form, "build"),
    brief = field(form, "brief");
  if (!ID.test(slug) || !(await getCompany(slug))) return { error: "No such project." };
  if ((needBuild || build) && !ID.test(build)) return { error: "No such build." };
  if ((needBrief || brief) && !N.test(brief)) return { error: "No such brief." };
  return { slug, build, brief };
}

async function now(args: string[]): Promise<BuildState | undefined> {
  try {
    await run("python3", [tool, ...args], { cwd: repoRoot, env: pythonEnv(), timeout: 60000 });
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string };
    return { error: (e.stderr || e.stdout || String(error)).trim().split("\n").at(-1) || "That didn't work." };
  }
}

const settle = (slug: string) => revalidatePath(`/companies/${slug}/build`);
const wait = () => new Promise((r) => setTimeout(r, 1200));

export async function planBuild(_p: BuildState, form: FormData): Promise<BuildState> {
  const t = await target(form, false);
  if ("error" in t) return t;
  const goal = field(form, "goal").slice(0, 6000);
  if (goal.length < 10) return { error: "Say what to build" };
  const model = field(form, "model");
  const models = ["sonnet", "opus"].includes(model) ? ["--model", model] : [];
  // What they typed, when the spelling fixer changed the goal (components/build.tsx): build.md keeps it as `typed`.
  const typed = field(form, "typed").slice(0, 6000);
  if (typed && typed !== goal) models.push(`--typed=${typed}`);
  if (field(form, "kind") === "task") {
    // A one-off: no COO plan, one agent straight from the owner's words.
    startDetached(`build-${t.slug}`, [tool, "task", ...models, ...(form.get("run") === "on" ? ["--run"] : []), "--", t.slug, goal]);
    await wait();
    settle(t.slug);
    return { done: form.get("run") === "on" ? "An agent is on it." : "Added" };
  }
  const thread = field(form, "thread");
  if (thread && !/^(companies\/[a-z0-9-]+|holding)\/threads\/[a-z0-9-]+$/.test(thread)) return { error: "Bad thread." };
  // Options first, then `--`, so a goal that starts with a dash is never read as a flag.
  startDetached(`build-${t.slug}`, [
    tool, "plan",
    ...models,
    ...(thread ? ["--thread", thread] : []),
    ...(form.get("run") === "on" ? ["--run"] : []),
    "--", t.slug, goal,
  ]);
  await wait();
  settle(t.slug);
  return { done: "The COO is planning" };
}

export async function startBuild(_p: BuildState, form: FormData): Promise<BuildState> {
  const t = await target(form);
  if ("error" in t) return t;
  const mode = field(form, "mode") === "sequence" ? "sequence" : "parallel";
  startDetached(`build-${t.slug}`, [tool, "run", "--mode", mode, ...(t.brief ? ["--brief", t.brief] : []), "--", t.slug, t.build]);
  await wait();
  settle(t.slug);
  return { done: t.brief ? "Agent started." : mode === "sequence" ? "Running in sequence." : "Agents started." };
}

// the owner approves the COO's proposed subtasks, or sends the epic in a new direction (the COO re-plans what hasn't run).
export async function shapeEpic(_p: BuildState, form: FormData): Promise<BuildState> {
  const t = await target(form);
  if ("error" in t) return t;
  if (field(form, "intent") === "approve") {
    const failed = await now(["approve", t.slug, t.build]);
    settle(t.slug);
    return failed || { done: "Approved" };
  }
  const text = field(form, "direction").slice(0, 4000);
  if (!text) return { error: "Write the new direction first." };
  startDetached(`build-${t.slug}`, [tool, "replan", "--", t.slug, t.build, text]);
  await wait();
  settle(t.slug);
  return { done: "The COO is re-planning" };
}

export async function direct(_p: BuildState, form: FormData): Promise<BuildState> {
  const t = await target(form, true, true);
  if ("error" in t) return t;
  const text = (field(form, "text") || field(form, "preset")).slice(0, 4000);
  if (!text) return { error: "Write the direction first." };
  startDetached(`build-${t.slug}`, [tool, "say", "--", t.slug, t.build, t.brief, text]);
  await wait();
  settle(t.slug);
  return { done: "Sent" };
}

export async function control(_p: BuildState, form: FormData): Promise<BuildState> {
  const action = field(form, "action");
  if (!["stop", "merge", "discard"].includes(action)) return { error: "Unknown action." };
  const t = await target(form, true, action !== "stop");
  if ("error" in t) return t;
  const failed = await now([action, t.slug, t.build, ...(t.brief ? [t.brief] : [])]);
  settle(t.slug);
  return failed || { done: action === "merge" ? "Merged into main." : action === "stop" ? "Stopped." : "Discarded." };
}

// Opens the repo (or a build's worktree) in Zed, or Ghostty running claude with the owner's prompt.
export async function openCode(_p: BuildState, form: FormData): Promise<BuildState> {
  const t = await target(form, false);
  if ("error" in t) return t;
  const how = field(form, "how");
  if (!["zed", "terminal", "resume"].includes(how)) return { error: "Open how?" };
  const args = ["open", t.slug, ...(t.build ? ["--build", t.build, "--brief", t.brief] : [])];
  if (how === "zed") args.push("--zed");
  else {
    args.push("--terminal");
    if (how === "resume") args.push("--resume");
    const prompt = field(form, "prompt").slice(0, 8000);
    if (prompt) {
      const dir = await mkdtemp(path.join(os.tmpdir(), "mr-prompt-"));
      await writeFile(path.join(dir, "prompt.md"), prompt);
      args.push("--prompt-file", path.join(dir, "prompt.md"));
    }
  }
  return (await now(args)) || { done: how === "zed" ? "Opened in Zed." : "Opened in Ghostty." };
}
