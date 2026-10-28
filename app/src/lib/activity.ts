import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { daysSince } from "./wiki";

const run = promisify(execFile);
const OWN = ["--exclude=mr/*", "--branches"];

// How much a codebase was worked on in the last four weeks, read live from git (every local branch except the
// Board's agent branches, mr/*, which aren't the owner's work until they merge them), so the overview is never older
// than the last commit. Weeks are rolling: week 4 is the last seven days, ending today.
export const WINDOW = 28;
export type Freshness = "moving" | "cooling" | "stale" | "old" | "none";
export type Activity = {
  days: number[]; // commits per day, oldest first, WINDOW long, the last entry is today
  weeks: number[]; // commits per rolling week, oldest first
  total: number; // commits in the window
  activeDays: number;
  last: string; // date of the newest commit anywhere, or ""
  idle: number | null; // days since `last`
  freshness: Freshness;
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function freshnessOf(idle: number | null): Freshness {
  if (idle === null) return "none";
  if (idle <= 7) return "moving";
  if (idle <= WINDOW) return "cooling";
  if (idle <= 90) return "stale";
  return "old";
}

// Commit dates (YYYY-MM-DD, one per commit, any order) → the four-week run ending `today`.
export function activityFrom(dates: string[], last: string, today = new Date()): Activity {
  const index = new Map<string, number>();
  for (let i = 0; i < WINDOW; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (WINDOW - 1 - i));
    index.set(iso(d), i);
  }
  const days = new Array(WINDOW).fill(0);
  for (const date of dates) {
    const i = index.get(date);
    if (i !== undefined) days[i]++;
  }
  const weeks = [0, 1, 2, 3].map((w) => days.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0));
  const idle = daysSince(last, today);
  return {
    days,
    weeks,
    total: weeks.reduce((a, b) => a + b, 0),
    activeDays: days.filter(Boolean).length,
    last,
    idle,
    freshness: freshnessOf(idle),
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    return (await run("git", ["-C", cwd, ...args], { timeout: 15000, maxBuffer: 4 << 20 })).stdout;
  } catch {
    return "";
  }
}

export type RepoRef = { path: string; subdir?: string | null };

// Several repos (or folders inside one) count together, as one project's work.
export async function getActivity(repos: RepoRef[]): Promise<Activity> {
  const today = new Date();
  const since = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - WINDOW));
  const results = await Promise.all(
    repos.map(async (r) => {
      const scope = r.subdir ? ["--", r.subdir] : [];
      const [recent, last] = await Promise.all([
        git(r.path, ["log", ...OWN, `--since=${since}`, "--format=%ad", "--date=short", ...scope]),
        git(r.path, ["log", ...OWN, "-1", "--format=%ad", "--date=short", ...scope]),
      ]);
      return { dates: recent.split("\n").filter(Boolean), last: last.trim() };
    }),
  );
  return activityFrom(
    results.flatMap((r) => r.dates),
    results.map((r) => r.last).sort().at(-1) || "",
    today,
  );
}

export const reposOf = (repos: unknown): RepoRef[] =>
  (Array.isArray(repos) ? repos : [])
    .map((r) => (typeof r === "string" ? { path: r } : (r as RepoRef)))
    .filter((r) => r && typeof r.path === "string" && r.path.startsWith("/"));

export type Commit = { sha: string; date: string; subject: string; repo: string };

// The newest commits across a project's repos, read live from git (same branches as the activity above).
export async function getCommits(repos: RepoRef[], limit = 8): Promise<Commit[]> {
  const lists = await Promise.all(
    repos.map(async (r) => {
      const scope = r.subdir ? ["--", r.subdir] : [];
      const out = await git(r.path, ["log", ...OWN, `-${limit}`, "--format=%h%x1f%ad%x1f%s", "--date=short", ...scope]);
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, date, subject] = line.split("\x1f");
          return { sha, date, subject, repo: r.path.split("/").pop() || "" };
        });
    }),
  );
  return lists.flat().sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
