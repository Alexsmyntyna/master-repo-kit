import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./repository";

// One line per agent turn, appended by tools/converse.py.
export type Run = {
  thread: string;
  scope: string;
  role: "ceo" | "coo";
  engine: string;
  model: string;
  started: string;
  seconds?: number;
  ok: boolean;
  error?: string;
  turns?: number;
  list_price_usd?: number;
  task?: string; // e.g. "screens-review"; thread is empty for those
  limit?: boolean; // it hit the usage limit and was queued, not failed (holding/retries.json)
  retry_at?: string;
};

// Runs waiting out the usage limit (holding/retries.json, kept by tools/converse.py): one per thread, or per Board
// subtask (`brief`). `converse.py retry --wait` runs each again at retry_at; its pid is in holding/retries.pid.
export type Retry = {
  thread: string;
  brief?: string;
  role: string;
  model: string;
  engine: string;
  retryAt: string;
  queued: string;
  attempts: number;
};

export async function getRetries(): Promise<Retry[]> {
  try {
    const items = JSON.parse(await readFile(path.join(repoRoot, "holding", "retries.json"), "utf8")) as unknown;
    if (!Array.isArray(items)) return [];
    return items
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof e.thread === "string")
      .map((e) => ({
        thread: String(e.thread),
        ...(e.brief ? { brief: String(e.brief) } : {}),
        role: String(e.role || ""),
        model: String(e.model || ""),
        engine: String(e.engine || "claude"),
        retryAt: String(e.retry_at || ""),
        queued: String(e.queued || ""),
        attempts: Number(e.attempts) || 1,
      }))
      .sort((a, b) => a.retryAt.localeCompare(b.retryAt));
  } catch {
    return [];
  }
}

// Whether a `retry --wait` is alive (a stale pid file doesn't count).
export async function retryWaiterAlive(): Promise<boolean> {
  const pid = Number((await readFile(path.join(repoRoot, "holding", "retries.pid"), "utf8").catch(() => "")).trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
// MASTER_REPO_ID names this install's log folder and check-in schedule; tools/master derives the same two names.
// MASTER_REPO_SCHEDULE_LABEL keeps an older install's launchd label; tools/master reads the same.
const repoId = process.env.MASTER_REPO_ID?.trim() || "master-repo";
export const logDir = path.join(os.homedir(), "Library", "Logs", repoId);
const scheduleLabel = process.env.MASTER_REPO_SCHEDULE_LABEL?.trim() || `local.${repoId}.checkins`;
export const schedulePlist = path.join(os.homedir(), "Library", "LaunchAgents", `${scheduleLabel}.plist`);

export async function getRuns(limit = 60): Promise<Run[]> {
  try {
    const lines = (await readFile(path.join(repoRoot, "holding", "runs.jsonl"), "utf8")).trim().split("\n");
    return lines
      .slice(-limit)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Run];
        } catch {
          return [];
        }
      })
      .reverse();
  } catch {
    return [];
  }
}

async function tail(file: string, lines: number): Promise<string[]> {
  try {
    return (await readFile(file, "utf8")).trimEnd().split("\n").slice(-lines);
  } catch {
    return [];
  }
}

export async function getSchedule() {
  const on = await stat(schedulePlist).then(
    () => true,
    () => false,
  );
  return { on, log: await tail(path.join(logDir, "checkins.log"), 40) };
}

// Runs started from the app write their output here (one file per start).
export async function getStartLogs(limit = 8) {
  const { readdir } = await import("node:fs/promises");
  try {
    const dir = path.join(logDir, "app-runs");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".log")).sort().reverse().slice(0, limit);
    return Promise.all(files.map(async (f) => ({ name: f, lines: await tail(path.join(dir, f), 12) })));
  } catch {
    return [];
  }
}
