"use server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { getCompany, repoRoot } from "@/lib/repository";
import { pageContext, type PageContext } from "@/lib/page-context";
import { readThread, type Role } from "@/lib/threads";
import { ensureRetryWaiter, startRun } from "@/lib/spawn";
import { existingPaths } from "@/lib/attachments";
import type { AttachmentRef } from "@/lib/attachment-refs";
import { isModel, type Model } from "@/lib/models";
import { readDefaultModels, writeDefaultModels } from "@/lib/models-file";

// The chat dock (components/dock/): one conversation per project, plus one for the parent company's pages,
// in <scope>/threads/chat/ (tools/converse.py chat). Each message carries the page it was sent from.
const run = promisify(execFile);
const converse = path.join(repoRoot, "tools", "converse.py");

export type DockMessage = {
  from: Role;
  body: string; // their words, without the attachment record lines (those are `refs`)
  date: string;
  page?: { url: string; title: string };
  attachments: string[];
  refs: AttachmentRef[];
  typed?: string; // what the owner typed when the spelling fixer changed `body` (app/DESIGN.md, Spelling)
  fixes?: number;
};
export type DockChat = {
  scope: string;
  id: string;
  path: string;
  running?: { role: Role; model: string; since: string; alive: boolean };
  failed: string;
  waiting?: { role: Role; retryAt: string; message: string }; // the last turn hit the usage limit; queued to retry
  next: string; // who answers next: ceo | coo, or "" when it's the owner's turn
  models: Partial<Record<"ceo" | "coo", string>>; // the model each role sticks to in this chat (converse.py --model)
  messages: DockMessage[];
  // The CEO asking a project's COO mid-turn (tools/converse.py consult); `feeds` is the message number it went into.
  consults: { feeds: number; project: string; name: string; status: string; question: string; answer: string; error: string }[];
};
// `defaults`: each role's model when the chat hasn't chosen one (holding/models.json, else converse.py's defaults).
export type Dock = { ctx: PageContext; chat?: DockChat; defaults: Record<"ceo" | "coo", Model> };
export type SendResult = { error?: string; ok?: boolean };

export async function loadDock(url: string): Promise<Dock | undefined> {
  const ctx = await pageContext(String(url).slice(0, 500));
  if (!ctx) return undefined;
  const [t, defaults] = await Promise.all([readThread(repoRoot, ctx.scope, "chat"), readDefaultModels(), ensureRetryWaiter()]);
  if (!t) return { ctx, defaults };
  const next = t.messages.at(-1)?.to;
  return {
    ctx,
    defaults,
    chat: {
      scope: t.scope,
      id: t.id,
      path: t.path,
      running: t.running && { role: t.running.role, model: t.running.model, since: t.running.since, alive: t.running.alive },
      failed: t.failed?.error || "",
      waiting: t.waiting && { role: t.waiting.role, retryAt: t.waiting.retryAt, message: t.waiting.message },
      next: next === "ceo" || next === "coo" ? next : "",
      models: { ceo: t.models.ceo, coo: t.models.coo },
      messages: t.messages.map((m) => ({
        from: m.from,
        body: m.body,
        date: m.date,
        page: m.page?.url ? { url: m.page.url, title: m.page.title } : undefined,
        attachments: m.attachments.map((a) => a.path),
        refs: m.refs,
        ...(m.typed ? { typed: m.typed, fixes: m.fixes } : {}),
      })),
      consults: await Promise.all(
        t.consults.map(async (c) => ({
          feeds: c.feeds,
          project: c.project,
          name: (await getCompany(c.project))?.name || c.project,
          status: c.status,
          question: c.question,
          answer: c.answer,
          error: c.error,
        })),
      ),
    },
  };
}

// One message from the dock: saved to the scope's chat (created on the first), then the agent answers it.
export async function sendChat(form: FormData): Promise<SendResult> {
  const ctx = await pageContext(String(form.get("url") || "").slice(0, 500));
  if (!ctx) return { error: "This page can't be used as context." };
  const body = String(form.get("body") || "").trim();
  if (body.length > 5000) return { error: "Write a message (under 5,000 characters)." };
  // What they typed, when the spelling fixer changed the body (components/dock/dock.tsx); converse.py keeps it as `typed`.
  const typed = String(form.get("typed") || "").trim();
  const keepTyped = typed && typed !== body && typed.length <= 5000 ? [`--typed=${typed}`] : [];
  const usePage = form.get("page") !== "off";
  const title = String(form.get("title") || "").replace(/\s+/g, " ").trim().slice(0, 120) || ctx.label;
  const current = await readThread(repoRoot, ctx.scope, "chat");
  if (current?.running?.alive) return { error: "Still answering the last message." };
  // Paths picked with @, and files pasted or dropped (already saved to holding/uploads by uploadFiles). converse.py
  // numbers them and records each as a line after the body; with no words, the body is just those lines.
  let attached: string[];
  try {
    attached = await existingPaths(form.getAll("attach").map(String).filter(Boolean).slice(0, 20));
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (!body && !attached.length) return { error: "Write a message (under 5,000 characters)." };
  const model = String(form.get("model") || ""),
    cooModel = String(form.get("coo_model") || "");
  if ((model && !isModel(model)) || (cooModel && !isModel(cooModel))) return { error: "Choose a model." };
  const models = [...(model ? [`--model=${model}`] : []), ...(cooModel ? [`--coo-model=${cooModel}`] : [])];
  const page = usePage ? ["--page-url", ctx.url, `--page-title=${title}`, ...(ctx.file ? ["--page-file", ctx.file] : [])] : [];
  let threadPath: string;
  try {
    const { stdout } = await run(
      "python3",
      [converse, "chat", ctx.scope, `--body=${body}`, ...keepTyped, "--json", ...models, ...page, ...(attached.length ? ["--attach", ...attached] : [])],
      { cwd: repoRoot, timeout: 30000 },
    );
    threadPath = (JSON.parse(stdout) as { path: string }).path;
  } catch (error) {
    console.error("chat", error);
    return { error: "The message couldn't be saved." };
  }
  await startRun(threadPath, `chat-${ctx.scope}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// "Use as default" in the dock's model menu: writes holding/models.json (a plain file write; agents can't write holding/).
export async function saveDefaultModels(
  models: Partial<Record<"ceo" | "coo", string>>,
): Promise<{ error?: string; defaults?: Record<"ceo" | "coo", Model> }> {
  try {
    const defaults = await writeDefaultModels(models);
    revalidatePath("/", "layout");
    return { defaults };
  } catch (error) {
    const message = (error as Error).message;
    return { error: message.startsWith("Unknown") ? message : "Couldn't save the defaults." };
  }
}
