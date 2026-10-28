import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pythonEnv, repoRoot, toolPath } from "./repository";
import { getRetries, logDir, retryWaiterAlive } from "./runs";

// Agent runs take minutes, so the app starts them detached and the pages follow along through thread.md.
// Output goes to ~/Library/Logs/<MASTER_REPO_ID or master-repo>/app-runs/<time>-<label>.log. Args start with the
// tool's absolute path (toolPath), so the code can live apart from the data.
export function startDetached(label: string, args: string[]): string {
  const dir = path.join(logDir, "app-runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.log`);
  const out = openSync(file, "a");
  const env = pythonEnv(); // MASTER_REPO_ROOT, so the tool reads the same data as the app
  delete env.ANTHROPIC_API_KEY; // run on the subscription, never the API
  const child = spawn("python3", args, { cwd: repoRoot, detached: true, stdio: ["ignore", out, out], env });
  child.unref();
  return file;
}

// Let the agents take their turns on a thread (tools/converse.py run). The run writes its `running` marker into
// thread.md a moment after starting; wait for it (up to ~5s) so what renders next shows the agent working.
export async function startRun(threadPath: string, label: string): Promise<void> {
  startDetached(label, [toolPath("converse.py"), "run", threadPath]);
  const file = path.join(repoRoot, threadPath, "thread.md");
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (/^running:/m.test(await readFile(file, "utf8").catch(() => ""))) return;
  }
}

// Runs that hit the usage limit wait in holding/retries.json for `converse.py retry --wait`, which the run itself
// starts. A Mac that slept or restarted loses that waiter, so any render of a thread, the dock or the Overview
// starts one again when the queue has entries and none is alive (the tool's own lock keeps it to one).
let lastArm = 0;
export async function ensureRetryWaiter(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (Date.now() - lastArm < 10_000) return; // a burst of renders starts it once
  if (!(await getRetries()).length || (await retryWaiterAlive())) return;
  lastArm = Date.now();
  startDetached("retry-wait", [toolPath("converse.py"), "retry", "--wait"]);
}

// the owner's "Retry now" on a thread waiting out the limit: run its queued turn at once (converse.py retry <thread>).
// Like startRun, wait (up to ~5s) for the turn's `running` marker, or for the limit to answer again.
export async function startRetry(threadPath: string, label: string): Promise<void> {
  const file = path.join(repoRoot, threadPath, "thread.md");
  const before = await readFile(file, "utf8").catch(() => "");
  startDetached(label, [toolPath("converse.py"), "retry", threadPath]);
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const now = await readFile(file, "utf8").catch(() => "");
    if (/^running:/m.test(now) || (now !== before && /^waiting:/m.test(now))) return;
  }
}
