import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readNote } from "./codebases";
import { getOwner } from "./owner";
import { parseDocument } from "./files";
import { repoRoot } from "./repository";
import { pidAlive } from "./threads";

const run = promisify(execFile);

// Builds written by tools/build.py, drawn as a board: each build is an epic (or a one-off task), each brief a
// subtask card. companies/<slug>/builds/<id>/ holds build.md (the owner's ask and status), the COO's briefs
// (NN-name.md), plan.md, review.md, and runs/NN.json + NN.log for each coding agent.
export type Event = { kind: "text" | "tool" | "result" | "prompt" | "error"; text: string; detail?: string };
export type AgentRun = {
  n: string;
  title: string;
  brief: string;
  status: string; // not started, running, waiting (usage limit), done, failed, stopped, merged, discarded
  retryAt: string; // waiting: when converse.py retry resumes it
  live: boolean;
  branch: string;
  worktree: string;
  session: string;
  model: string;
  commits: number;
  dirty: boolean;
  costUsd: number;
  report: string;
  events: Event[];
  diffStat: string;
  log: string[]; // commit subjects on the branch
  files: string;
  needs: string[];
  messages: { at: string; text: string }[]; // what the owner sent this agent, oldest first
  stackedOn: string;
  column: Column;
};
export const COLUMNS = ["proposed", "ready", "working", "review", "done"] as const;
export type Column = (typeof COLUMNS)[number];
export const columnLabels: Record<Column, string> = {
  proposed: "Proposed",
  ready: "Ready",
  working: "Working",
  review: "Review",
  done: "Done",
};
export type Build = {
  id: string;
  slug: string;
  title: string;
  goal: string;
  status: string; // planning, proposed, approved (ready), running, reviewing, review, failed
  kind: "epic" | "task";
  approved: boolean; // the owner said yes to the current subtasks (tools/build.py approve); nothing runs without it
  mode: string;
  directions: { at: string; text: string }[];
  finished: boolean;
  stage: Column; // where the epic itself sits on the board
  thread: string;
  created: string;
  error: string;
  plan: string;
  review: string;
  runs: AgentRun[];
  live: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const listed = (v: unknown) => (Array.isArray(v) ? v.join(", ") : str(v));
const read = (p: string) => readFile(p, "utf8").catch(() => "");

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    return (await run("git", ["-C", cwd, "-c", "core.fsmonitor=false", ...args], { timeout: 10000, maxBuffer: 8 << 20 })).stdout.trim();
  } catch {
    return "";
  }
}

// The last part of an agent's stream-json log, as a readable feed: what it said, which tools it used on what.
async function tail(file: string, bytes = 400_000): Promise<string[]> {
  try {
    const size = (await stat(file)).size;
    const fh = await open(file, "r");
    const buf = Buffer.alloc(Math.min(size, bytes));
    await fh.read(buf, 0, buf.length, Math.max(0, size - buf.length));
    await fh.close();
    return buf.toString("utf8").split("\n").slice(size > bytes ? 1 : 0);
  } catch {
    return [];
  }
}

// The owner's directions to one agent, from its log (tools/build.py say writes them as mr_prompt lines headed with
// the short name in local/owner.json; older logs retain the original owner heading).
export function messagesOf(lines: string[], who = ""): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  const names = [...new Set([who, "Owner"].filter(Boolean))].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const head = new RegExp(`^Direction from (?:${names.join("|")}):\\n\\n([\\s\\S]*?)\\n\\nContinue on this branch`);
  for (const line of lines) {
    if (!line.includes('"mr_prompt"')) continue;
    try {
      const ev = JSON.parse(line) as { type?: string; text?: string; at?: string };
      const m = str(ev.text).match(head);
      if (ev.type === "mr_prompt" && m) out.push({ at: str(ev.at), text: m[1].replace(/\r/g, "").trim() });
    } catch {}
  }
  return out;
}

export function eventsOf(lines: string[], limit = 40): Event[] {
  const out: Event[] = [];
  for (const line of lines) {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      if (line.trim()) out.push({ kind: "error", text: line.slice(0, 300) });
      continue;
    }
    if (ev.type === "mr_prompt") out.push({ kind: "prompt", text: str(ev.text).slice(-600) });
    if (ev.type === "result") out.push({ kind: "result", text: str(ev.result).slice(0, 1200) });
    if (ev.type !== "assistant") continue;
    const content = ((ev.message as { content?: unknown[] })?.content || []) as Record<string, unknown>[];
    for (const c of content) {
      if (c.type === "text" && str(c.text).trim()) out.push({ kind: "text", text: str(c.text).slice(0, 600) });
      if (c.type === "tool_use") {
        const input = (c.input || {}) as Record<string, unknown>;
        const target = str(input.file_path) || str(input.command) || str(input.pattern) || str(input.path) || str(input.description);
        // Paths inside the agent's own worktree read relative to it; the long worktree prefix says nothing.
        const detail = target
          .replace(/(?:\/Users\/[^/\s]+|~)\/\.master-repo\/worktrees\/[^/\s]+\/[^/\s]+\//g, "")
          .replace(/\/Users\/[^/\s]+/g, "~");
        out.push({ kind: "tool", text: str(c.name), detail: detail.slice(0, 240) });
      }
    }
  }
  return out.slice(-limit);
}

function columnOf(status: string, live: boolean, approved: boolean): Column {
  if (live || status === "stopping" || status === "waiting") return "working";
  if (status === "merged" || status === "discarded") return "done";
  if (["done", "failed", "stopped"].includes(status)) return "review";
  return approved ? "ready" : "proposed";
}

// The epic moves along as its subtasks do: Proposed until the owner approves, Ready until one starts, Working while
// any agent (or the COO) works or cards are still waiting to run, Review once every card has run, Done when
// every card is merged or discarded.
export function stageOf(runs: AgentRun[], approved: boolean, busy = false): Column {
  if (!approved) return "proposed";
  if (runs.some((r) => r.live || r.status === "waiting") || busy) return "working";
  if (runs.length && runs.every((r) => r.column === "done")) return "done";
  if (runs.every((r) => r.column === "ready")) return "ready";
  return runs.some((r) => r.column === "ready") ? "working" : "review";
}

async function readRun(dir: string, n: string, briefFile: string, approved: boolean): Promise<AgentRun> {
  const s = JSON.parse((await read(path.join(dir, "runs", `${n}.json`))) || "{}") as Record<string, unknown>;
  const note = readNote(await read(path.join(dir, briefFile))); // agent-written frontmatter: read tolerantly
  const brief = { title: str(note.meta.title) || briefFile.replace(/\.md$/, ""), content: note.body, meta: note.meta };
  const worktree = str(s.worktree);
  const lines = await tail(path.join(dir, "runs", `${n}.log`), 2_000_000);
  const live = (s.status === "running" || s.status === "stopping") && pidAlive(s.pid);
  const status = live ? "running" : s.status === "running" ? "failed" : str(s.status) || "not started";
  // Read from the main repo by branch, never by running git inside the agent's worktree (its .git pointer is
  // agent-writable territory; see tools/build.py verify).
  const base = str(s.base_sha),
    repo = str(s.repo),
    branch = str(s.branch);
  const ok = /^[0-9a-f]{7,40}$/.test(base) && /^mr\/[a-z0-9-]+$/.test(branch) && repo.startsWith("/");
  const [diffStat, log] = ok
    ? await Promise.all([git(repo, ["diff", "--stat", `${base}..${branch}`]), git(repo, ["log", "--format=%s", `${base}..${branch}`])])
    : ["", ""];
  return {
    n,
    title: str(s.title) || brief.title,
    brief: brief.content,
    status,
    retryAt: status === "waiting" ? str((s.waiting as Record<string, unknown> | null)?.retry_at) : "",
    live,
    branch: str(s.branch),
    worktree,
    session: str(s.session),
    model: str(s.model),
    commits: log ? log.split("\n").length : Number(s.commits) || 0,
    dirty: !!s.dirty,
    costUsd: Number(s.cost_usd) || 0,
    report: str(s.report),
    events: eventsOf(lines),
    messages: messagesOf(lines, (await getOwner()).short),
    diffStat,
    log: log ? log.split("\n") : [],
    files: listed(brief.meta.files),
    needs: (listed(brief.meta.needs).match(/\d\d/g) || []).filter((x) => x !== n),
    stackedOn: str(s.stacked_on).replace(/^mr\/.*-(\d\d)$/, "$1"),
    column: columnOf(status, live, approved),
  };
}

export async function getBuilds(slug: string): Promise<Build[]> {
  if (!/^[a-z0-9-]+$/.test(slug)) return [];
  const root = path.join(repoRoot, "companies", slug, "builds");
  const ids = (await readdir(root).catch(() => [] as string[])).filter((id) => /^[a-z0-9-]+$/.test(id)).sort().reverse();
  const builds = await Promise.all(
    ids.map(async (id): Promise<Build | undefined> => {
      const dir = path.join(root, id);
      const raw = await read(path.join(dir, "build.md"));
      if (!raw) return undefined;
      const doc = parseDocument(`companies/${slug}/builds/${id}/build.md`, raw);
      const files = (await readdir(dir)).filter((f) => /^\d\d-[a-z0-9-]+\.md$/.test(f)).sort();
      const plan = readNote(await read(path.join(dir, "plan.md")));
      const status = str(doc.meta.status);
      const approved = !!str(doc.meta.approved) && !["planning", "proposed"].includes(status);
      const runs = await Promise.all(files.map((f) => readRun(dir, f.slice(0, 2), f, approved)));
      const planning = status === "planning" && pidAlive(doc.meta.planning_pid);
      const reviewing = status === "reviewing" && pidAlive(doc.meta.runner_pid);
      return {
        id,
        slug,
        title: str(plan.meta.title) || doc.title, // the COO names the epic; the owner's first line otherwise
        goal: doc.content,
        status: status === "planning" && !planning ? "failed" : status === "ready" ? "approved" : status,
        kind: doc.meta.kind === "task" ? "task" : "epic",
        approved,
        mode: str(doc.meta.mode),
        directions: Array.isArray(doc.meta.directions)
          ? (doc.meta.directions as Record<string, unknown>[]).map((x) => ({ at: str(x.at), text: str(x.text) }))
          : [],
        finished: runs.length > 0 && runs.every((r) => r.column === "done"),
        stage: stageOf(runs, approved, planning || reviewing),
        thread: str(doc.meta.thread),
        created: str(doc.meta.created),
        error: str(doc.meta.error),
        plan: plan.body,
        review: parseDocument("review.md", await read(path.join(dir, "review.md"))).content,
        runs,
        live: planning || reviewing || runs.some((r) => r.live),
      };
    }),
  );
  return builds.filter((b): b is Build => !!b);
}
