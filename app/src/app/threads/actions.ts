"use server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCompanies, getCompany, pythonEnv, repoRoot, toolPath } from "@/lib/repository";
import { getThread, getThreads } from "@/lib/threads";
import { startDetached, startRun } from "@/lib/spawn";
import { existingPaths, listPaths } from "@/lib/attachments";
import { isModel } from "@/lib/models";

// Writes go through tools/converse.py so the CLI and the app share one thread format.
const run = promisify(execFile);
const converse = toolPath("converse.py");
const portfolio = toolPath("portfolio.py");
const slug = /^[a-z0-9-]+$/;
export type ThreadState = { error?: string; done?: string };

const field = (form: FormData, name: string) => String(form.get(name) || "").trim();

// What the owner typed when the spelling fixer changed their text before sending (lib/use-spell-fix.ts), as converse.py's
// `--typed`, which stores it beside the fixed text. `wrap` builds the message around it the same way as the body.
function typedArg(form: FormData, text: string, wrap = (t: string) => t): string[] {
  const typed = field(form, "typed");
  return typed && typed !== text && typed.length <= 5000 ? [`--typed=${wrap(typed)}`] : [];
}

// Model for the agent the message goes to (sticks for that role in the thread), and helpers on/off.
function modelArgs(form: FormData): string[] | undefined {
  const model = field(form, "model");
  if (model && !isModel(model)) return undefined;
  return [...(model ? ["--model", model] : []), ...(form.get("no_helpers") === "on" ? ["--no-helpers"] : [])];
}

// Paths typed or picked in the attach field, and files pasted or dropped (already saved to holding/uploads by
// uploadFiles). converse.py numbers them and records each as a line after the body (DESIGN.md, Attachments).
async function attachments(form: FormData): Promise<string[]> {
  return existingPaths(form.getAll("attach").map(String).filter(Boolean).slice(0, 20));
}

export async function suggestPaths(input: string) {
  return listPaths(String(input || "").slice(0, 500));
}

async function findThread(form: FormData) {
  const scope = field(form, "scope"),
    id = field(form, "id");
  return slug.test(scope) && slug.test(id) ? getThread(scope, id) : undefined;
}

// A decision can make the owner's other open questions moot or wrong: the CEO checks them in the background,
// withdrawing or recomputing (tools/converse.py reconcile). Answers and new directions do this inside the CEO's turn.
function reconcileAfter(threadPath: string, scope: string) {
  startDetached(`reconcile-${scope}`, [converse, "reconcile", threadPath]);
}

const letAgentsWork = startRun;

export async function respond(_previous: ThreadState, form: FormData): Promise<ThreadState> {
  const thread = await findThread(form);
  if (!thread) return { error: "That thread doesn’t exist." };
  const intent = field(form, "intent"),
    body = field(form, "body"),
    to = "ceo", // the owner talks to one counterpart; the CEO consults the project COOs itself (converse.py consult)
    kind = field(form, "kind") || "directive",
    subject = field(form, "subject");
  if (body.length > 5000) return { error: "Keep messages under 5,000 characters." };
  if (thread.running?.alive) return { error: "An agent is still working on it" };
  let args: string[];
  if (intent === "approve") {
    args = ["approve", thread.path, "--note", body || "Approved.", ...(body ? typedArg(form, body) : [])];
  } else {
    if (!["ceo", "coo"].includes(to)) return { error: "Choose who it goes to." };
    if (!["directive", "question", "reply"].includes(kind)) return { error: "Choose what kind of message it is." };
    let attached: string[];
    try {
      attached = await attachments(form);
    } catch (error) {
      return { error: (error as Error).message };
    }
    // An attachment may go alone: the body is then just its record line.
    if (!body && !attached.length) return { error: "Write the message first." };
    const models = modelArgs(form);
    if (!models) return { error: "Choose Haiku, Sonnet, Opus or Fable." };
    args = ["post", thread.path, "--as", "owner", "--to", to, "--kind", kind, `--body=${body}`, ...typedArg(form, body), ...models];
    if (subject) args.push("--subject", subject.slice(0, 140));
    if (attached.length) args.push("--attach", ...attached);
  }
  try {
    await run("python3", [converse, ...args], { cwd: repoRoot, env: pythonEnv(), timeout: 30000 });
  } catch (error) {
    console.error("Unable to write to thread", error);
    return { error: "Couldn’t save the message" };
  }
  if (intent !== "approve" && form.get("run") === "on") await letAgentsWork(thread.path, `${thread.scope}-${to}`);
  if (intent === "approve") reconcileAfter(thread.path, thread.scope);
  revalidatePath("/", "layout");
  return {
    done: intent === "approve" ? "Approved." : form.get("run") === "on" ? `Sent to the ${to.toUpperCase()}` : "Sent.",
  };
}

export async function createThread(_previous: ThreadState, form: FormData): Promise<ThreadState> {
  const scope = field(form, "scope"),
    to = "ceo", // the owner talks to one counterpart; the CEO consults the project COOs itself (converse.py consult)
    kind = field(form, "kind") || "directive",
    title = field(form, "title"),
    body = field(form, "body");
  if (scope !== "holding" && !(slug.test(scope) && (await getCompany(scope)))) return { error: "Choose a project." };
  if (!["ceo", "coo"].includes(to) || (scope === "holding" && to !== "ceo"))
    return { error: "The parent company has only a CEO" };
  const talk = field(form, "mode") === "talk";
  if (!(talk ? ["reply", "question"] : ["directive", "question"]).includes(kind))
    return { error: "Choose what kind of message it is." };
  const companies = await getCompanies();
  const about = form
    .getAll("about")
    .map(String)
    .filter((p) => slug.test(p) && p !== scope && companies.some((c) => c.id === p))
    .slice(0, 12);
  if (!title || title.length > 120) return { error: "Give it a short subject (under 120 characters)." };
  let created: { scope: string; id: string; path: string };
  let attached: string[];
  try {
    attached = await attachments(form);
  } catch (error) {
    return { error: (error as Error).message };
  }
  if ((!body && !attached.length) || body.length > 5000) return { error: "Write the message (under 5,000 characters)." };
  try {
    const { stdout } = await run(
      "python3",
      [
        converse, "new", scope, title, `--body=${body}`, ...typedArg(form, body), "--to", to, "--kind", kind, "--json",
        ...(modelArgs(form) || []),
        ...(talk ? ["--talk"] : []), ...(talk && about.length ? ["--about", ...about] : []),
        ...(attached.length ? ["--attach", ...attached] : []),
      ],
      { cwd: repoRoot, env: pythonEnv(), timeout: 30000 },
    );
    created = JSON.parse(stdout);
  } catch (error) {
    console.error("Unable to start thread", error);
    return { error: "The thread couldn’t be created." };
  }
  if (form.get("run") === "on") await letAgentsWork(created.path, `${scope}-${to}`);
  revalidatePath("/", "layout");
  redirect(`/threads/${created.scope}/${created.id}`);
}

export async function continueThread(_previous: ThreadState, form: FormData): Promise<ThreadState> {
  const thread = await findThread(form);
  if (!thread) return { error: "That thread doesn’t exist." };
  if (thread.running?.alive) return { error: "An agent is already working on it." };
  const next = thread.messages.at(-1)?.to;
  if (next !== "ceo" && next !== "coo") return { error: "It’s waiting on you, not on an agent." };
  await letAgentsWork(thread.path, `${thread.scope}-${next}`);
  revalidatePath("/", "layout");
  return { done: `Started. The ${next.toUpperCase()} is working.` };
}

export async function startCheckin(_previous: ThreadState, form: FormData): Promise<ThreadState> {
  const target = field(form, "slug");
  if (target === "due") {
    startDetached("checkins-due", [portfolio, "checkin", "--due", "--run", "--limit", "4"]);
  } else {
    if (!slug.test(target) || !(await getCompany(target))) return { error: "Unknown project." };
    startDetached(`checkin-${target}`, [portfolio, "checkin", target, "--run"]);
  }
  // The thread appears within a second; give it a moment so the redirect lands on a page that shows it.
  await new Promise((r) => setTimeout(r, 1500));
  revalidatePath("/", "layout");
  return { done: target === "due" ? "Check-ins started" : "Check-in started." };
}

// The decisions desk: pick an option, or ask for a trade-off card when the agent didn't write one.
// The recommended option approves the decision as proposed; any other option goes back to the agent
// that proposed it as a directive to replan around that choice, so a check-in's release card is never
// applied for an option the owner didn't pick.
export async function decide(_previous: ThreadState, form: FormData): Promise<ThreadState> {
  const thread = await findThread(form);
  if (!thread) return { error: "That thread doesn’t exist." };
  if (!["awaiting-alex", "awaiting-owner"].includes(thread.status) && thread.status !== "stale") return { error: "This one isn’t waiting on you anymore." };
  if (thread.running?.alive) return { error: "An agent is still working on it" };
  const last = thread.messages.at(-1);
  const sender = last?.from === "ceo" || last?.from === "coo" ? last.from : undefined;
  const intent = field(form, "intent"),
    choice = field(form, "choice").slice(0, 200),
    note = field(form, "note").slice(0, 2000);
  let args: string[];
  let runAfter = false;
  // The note may have gone through the spelling fixer: each message is built the same way around what they typed.
  const typed = (wrap: (n: string) => string) => (note ? typedArg(form, note, (t) => wrap(t.slice(0, 2000))) : []);
  if (intent === "approve" && last?.kind === "decision") {
    const approval = (n: string) => [choice && `Going with ${choice}.`, n].filter(Boolean).join(" ") || "Approved.";
    args = ["approve", thread.path, "--note", approval(note), ...typed(approval)];
  } else if ((intent === "redirect" || intent === "approve") && sender && choice) {
    const redirect = (n: string) =>
      `I'm going with ${choice} instead.${n ? ` ${n}` : ""} Replan around that and bring it back as a decision with an options block.`;
    args = ["post", thread.path, "--as", "owner", "--to", "ceo", "--kind", "directive", "--body", redirect(note), ...typed(redirect)];
    runAfter = true;
  } else if (intent === "steer" && sender) {
    // A change of direction is never an approval: the proposal goes back to be rethought around it.
    if (!note) return { error: "Write the direction first." };
    const steer = (n: string) =>
      `${n}\n\nThis is a change of direction, not an approval of the proposal. Rethink it around this (ask the COOs what you need), and bring it back with options, and mockups where it changes what people see.`;
    args = ["post", thread.path, "--as", "owner", "--to", "ceo", "--kind", "directive", "--body", steer(note), ...typed(steer)];
    runAfter = true;
  } else if (intent === "answer" && sender) {
    if (!note) return { error: "Write your answer first." };
    args = ["post", thread.path, "--as", "owner", "--to", "ceo", "--kind", "reply", "--body", note, ...typed((n) => n)];
    runAfter = true;
  } else if (intent === "card" && sender) {
    const body =
      "Restate this so I can decide at a glance: end your message with an ```options block (ask, 2–3 options with time, complexity, growth and costs, `*` on your recommendation, and revisit). Keep the decision the same unless the restating changes your mind.";
    args = ["post", thread.path, "--as", "owner", "--to", "ceo", "--kind", "question", "--body", body];
    runAfter = true;
  } else {
    return { error: "Choose an option first." };
  }
  try {
    await run("python3", [converse, ...args], { cwd: repoRoot, env: pythonEnv(), timeout: 30000 });
  } catch (error) {
    console.error("Unable to record the decision", error);
    return { error: "Couldn’t save it" };
  }
  if (runAfter) await letAgentsWork(thread.path, `${thread.scope}-${sender}`);
  if (args[0] === "approve") reconcileAfter(thread.path, thread.scope);
  revalidatePath("/", "layout");
  return {
    done:
      args[0] === "approve"
        ? "Decided."
        : intent === "card"
          ? `Asked the ${sender!.toUpperCase()} to lay it out.`
          : intent === "steer"
            ? `Direction sent. The CEO is rethinking it; nothing was approved.`
            : intent === "answer"
            ? `Answered. The ${sender!.toUpperCase()} is on it.`
            : `Sent back. The ${sender!.toUpperCase()} is replanning.`,
  };
}

// A project's COO builds or refreshes its market file (converse.py market-check), then reports up.
export async function startMarketCheck(_previous: ThreadState, form: FormData): Promise<ThreadState> {
  const target = field(form, "slug");
  if (!slug.test(target) || !(await getCompany(target))) return { error: "Unknown project." };
  const open = (await getThreads()).find(
    (t) => t.scope === target && t.title.startsWith("Market check") && !["decided", "closed"].includes(t.status),
  );
  if (open) return { error: "A market check is already open" };
  startDetached(`market-${target}`, [converse, "market-check", target, "--run"]);
  await new Promise((r) => setTimeout(r, 1500));
  revalidatePath("/", "layout");
  return { done: "Market check started" };
}
