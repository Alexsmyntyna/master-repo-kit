import { readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { splitAttachmentRefs, type AttachmentRef } from "./attachment-refs";
import { parseDocument, readContent } from "./files";
import { recheckOf, type Recheck } from "./cards";
import { recordOf } from "./model";
import { getCompanies, repoRoot } from "./repository";

// Threads are written by tools/converse.py: <scope>/threads/<id>/thread.md plus 001-<from>.md messages.
export type Role = "owner" | "alex" | "ceo" | "coo";
export type Message = {
  path: string;
  from: Role;
  to: Role;
  kind: string;
  subject: string;
  date: string;
  // The message text. converse.py ends a message that had attachments with one record line each
  // ("[image #3](holding/uploads/…)"); those are `refs` and left out of `body`, so `body` is only what was written.
  body: string;
  refs: AttachmentRef[];
  usage: Record<string, unknown>;
  attachments: { path: string; kind: "file" | "folder" | "image" | "pasted" }[];
  page?: { url: string; file: string; title: string }; // the app page a chat message was sent from
  // What the owner typed when the spelling fixer changed it before saving (`body` is the fixed text, their words), and how
  // many words it changed. src/lib/spell-marks.ts `diffWords(typed, body)` finds them for underlining.
  typed?: string;
  fixes?: number;
};
export type Thread = {
  scope: string; // a company slug, or "holding"
  id: string;
  path: string;
  title: string;
  status: string;
  staleSince?: string; // set by tools/refresh.py when a thread waited on the owner 14 days; still answerable
  recheck?: Recheck; // tools/recheck.py: commits since the owner was asked, an agent rechecking, or its last verdict
  summary: string;
  decision: string;
  participants: Role[]; // the CEO only sits on focus projects, or when the owner brings it in
  checkin: boolean; // a scheduled check-in from tools/portfolio.py
  talk: boolean; // a conversation (ideas, revisions), not a run toward a decision
  chat: boolean; // the chat dock's one conversation for this project (threads/chat)
  projects: string[]; // every project the thread is about: its scope plus any others the owner named
  models: Record<string, string>; // the owner's model choice per role on this thread
  helpers: boolean;
  supersededBy: string; // the thread whose answer made the CEO withdraw this one (tools/converse.py reconcile)
  running?: Running; // an agent turn in progress (alive: false means the process died mid-turn)
  failed?: { role: Role; at: string; error: string }; // the last turn crashed
  waiting?: Waiting; // the last turn hit the usage limit; tools/converse.py retry runs it again at retryAt
  started: string;
  updated: string;
  messages: Message[];
  consults: Consult[];
};
// The CEO's questions to project COOs inside one of its turns (tools/converse.py consult); `feeds` is the
// number of the message the answer went into.
export type Consult = {
  path: string;
  project: string;
  feeds: number;
  model: string;
  status: "running" | "done" | "failed";
  question: string;
  answer: string;
  error: string;
  started: string;
  usage: Record<string, unknown>;
};
export type Running = { role: Role; model: string; since: string; pid: number; alive: boolean };
// A turn that hit the subscription's usage limit (thread.md `waiting`), queued in holding/retries.json.
export type Waiting = { reason: string; retryAt: string; message: string; role: Role };

// tools/converse.py writes the pid of a running turn into thread.md; signal 0 checks it without touching it.
export function pidAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const roleNames: Record<Role, string> = {
  owner: "You", alex: "You",
  ceo: "CEO",
  coo: "COO",
};
export const statusOrder = ["awaiting-alex", "awaiting-owner", "talking", "open", "decided", "closed"];
export const statusLabels: Record<string, string> = {
  "awaiting-alex": "Waiting on you",
  "awaiting-owner": "Waiting on you",
  talking: "Your turn",
  open: "Agents talking",
  decided: "Decided",
  closed: "Closed",
  stale: "Stale",
};
const str = (v: unknown) => (typeof v === "string" ? v : v instanceof Date ? v.toISOString().slice(0, 10) : "");
const role = (v: unknown): Role => (v === "owner" || v === "ceo" || v === "coo" ? v : "alex");

async function dirs(root: string, relative: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readThread(root: string, scope: string, id: string): Promise<Thread | undefined> {
  const base = `${scope === "holding" ? "holding" : `companies/${scope}`}/threads/${id}`;
  let head;
  try {
    head = parseDocument(`${base}/thread.md`, await readContent(root, `${base}/thread.md`));
  } catch {
    return undefined;
  }
  const files = (await readdir(path.join(root, base))).filter((f) => /^\d{3}-[a-z]+\.md$/.test(f)).sort();
  const messages = await Promise.all(
    files.map(async (f): Promise<Message> => {
      const doc = parseDocument(`${base}/${f}`, await readContent(root, `${base}/${f}`));
      const { text, refs } = splitAttachmentRefs(doc.content);
      return {
        path: doc.path,
        from: role(doc.meta.from),
        to: role(doc.meta.to),
        kind: str(doc.meta.kind) || "reply",
        subject: str(doc.meta.subject),
        date: str(doc.meta.date),
        body: text,
        refs,
        usage: recordOf(doc.meta.usage),
        attachments: (Array.isArray(doc.meta.attachments) ? doc.meta.attachments : []).map((a) => {
          const r = recordOf(a);
          return { path: str(r.path), kind: r.kind === "folder" || r.kind === "image" || r.kind === "pasted" ? r.kind : "file" };
        }),
        ...(typeof doc.meta.typed === "string" && doc.meta.typed.trim()
          ? { typed: doc.meta.typed.replace(/\n$/, ""), fixes: Math.max(1, Number(doc.meta.fixes) || 0) }
          : {}),
        ...(doc.meta.page && typeof doc.meta.page === "object"
          ? (() => {
              const pg = recordOf(doc.meta.page);
              return { page: { url: str(pg.url), file: str(pg.file), title: str(pg.title) } };
            })()
          : {}),
      };
    }),
  );
  const consultFiles = await readdir(path.join(root, base, "consults")).catch(() => [] as string[]);
  const consults = await Promise.all(
    consultFiles
      .filter((f) => /^\d{3}-[a-z0-9-]+\.md$/.test(f))
      .sort()
      .map(async (f): Promise<Consult> => {
        const doc = parseDocument(`${base}/consults/${f}`, await readContent(root, `${base}/consults/${f}`));
        const status = doc.meta.status === "done" || doc.meta.status === "failed" ? doc.meta.status : "running";
        return {
          path: doc.path,
          project: str(doc.meta.project),
          feeds: Number(doc.meta.feeds) || 0,
          model: str(doc.meta.model),
          status,
          question: str(doc.meta.question),
          answer: doc.content,
          error: str(doc.meta.error),
          started: str(doc.meta.started),
          usage: recordOf(doc.meta.usage),
        };
      }),
  );
  return {
    scope,
    id,
    path: base,
    title: head.title,
    status: str(head.meta.status) || "open",
    staleSince: str(head.meta.stale_since),
    recheck: recheckOf(head.meta),
    summary: str(head.meta.summary),
    decision: str(head.meta.decision),
    checkin: head.meta.checkin === true,
    talk: head.meta.mode === "talk" || head.meta.mode === "chat",
    chat: head.meta.mode === "chat",
    projects: [
      ...(scope === "holding" ? [] : [scope]),
      ...(Array.isArray(head.meta.projects) ? head.meta.projects.map(String).filter((p) => p !== scope) : []),
    ],
    models: Object.fromEntries(Object.entries(recordOf(head.meta.models)).map(([k, v]) => [k, String(v)])),
    helpers: head.meta.helpers !== false,
    supersededBy: str(head.meta.superseded_by),
    running: head.meta.running
      ? (() => {
          const r = recordOf(head.meta.running);
          return { role: role(r.role), model: str(r.model), since: str(r.since), pid: Number(r.pid), alive: pidAlive(r.pid) };
        })()
      : undefined,
    failed: head.meta.failed
      ? (() => {
          const f = recordOf(head.meta.failed);
          return { role: role(f.role), at: str(f.at), error: str(f.error) };
        })()
      : undefined,
    waiting: head.meta.waiting
      ? (() => {
          const w = recordOf(head.meta.waiting);
          return { reason: str(w.reason) || "limit", retryAt: str(w.retry_at), message: str(w.message), role: role(w.role) };
        })()
      : undefined,
    participants: (["owner", "alex", "ceo", "coo"] as Role[]).filter(
      (r) =>
        (Array.isArray(head.meta.participants) ? head.meta.participants : ["owner", "alex", "ceo", "coo"]).includes(r) ||
        messages.some((m) => m.from === r || m.to === r),
    ),
    started: str(head.meta.started),
    updated: str(head.meta.updated),
    messages,
    consults,
  };
}

export async function listThreads(root: string, scopes: string[]): Promise<Thread[]> {
  const all = await Promise.all(
    scopes.map(async (scope) => {
      const base = scope === "holding" ? "holding/threads" : `companies/${scope}/threads`;
      return Promise.all((await dirs(root, base)).map((id) => readThread(root, scope, id)));
    }),
  );
  return all
    .flat()
    .filter((t): t is Thread => !!t)
    .sort(
      (a, b) =>
        statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || b.updated.localeCompare(a.updated),
    );
}

export const threadHref = (t: Pick<Thread, "scope" | "id">) => `/threads/${t.scope}/${t.id}`;

// Cached accessors for pages, rooted at the repo.
export const getThreads = cache(async () =>
  listThreads(repoRoot, ["holding", ...(await getCompanies()).map((c) => c.id)]),
);
export const getThread = cache(async (scope: string, id: string) => readThread(repoRoot, scope, id));
