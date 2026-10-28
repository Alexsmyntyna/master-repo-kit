"use server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import matter from "gray-matter";
import { revalidatePath } from "next/cache";
import path from "node:path";
import { saveUploads } from "@/lib/attachments";
import { getMockupReview } from "@/lib/mockup-reviews";
import { cleanPins, notesMarkdown, typedNotes, type ReviewNotes } from "@/lib/mockups";
import { getOwner } from "@/lib/owner";
import { pythonEnv, repoRoot, toolPath } from "@/lib/repository";
import { getThreads } from "@/lib/threads";

const run = promisify(execFile);

// Review folders are agent-writable, so reads and writes there go through tools/safe_fs.py: it walks down from the
// repo with O_NOFOLLOW directory fds, reads only single-link regular files, and renames a fresh file into place,
// so no symlink, swapped folder or hard link can redirect them (Node has no openat to do this itself).
const reviewPath = (slug: string, id: string, name: string) => `companies/${slug}/mockups/${id}/${name}`;
async function readInReview(slug: string, id: string, name: string): Promise<string> {
  return (await run("python3", [toolPath("safe_fs.py"), "read", reviewPath(slug, id, name)], { env: pythonEnv(), maxBuffer: 8 << 20 })).stdout;
}
function writeInReview(slug: string, id: string, name: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("python3", [toolPath("safe_fs.py"), "write", reviewPath(slug, id, name)], { env: pythonEnv() }, (error) =>
      error ? reject(error) : resolve(),
    );
    child.stdin?.end(text);
  });
}
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

export type SaveState = { error?: string; done?: string };

// The `typed` map for notes.md (lib/mockups.ts typedNotes): what came with this save, lined up with the pins that
// cleanPins keeps, and, for a field saved again unchanged, what was kept for it last time.
function typedOf(
  input: { pins: unknown; typed?: { answers?: unknown; pins?: unknown; note?: unknown } },
  review: NonNullable<Awaited<ReturnType<typeof getMockupReview>>>,
  saved: Omit<ReviewNotes, "typed">,
) {
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 5000) : "");
  const at = (v: unknown, i: number) => (Array.isArray(v) ? text(v[i]) : "");
  const raw = Array.isArray(input.pins) ? input.pins : [];
  const kept = raw.flatMap((p, i) => (cleanPins([p], review.screens).length ? [i] : [])).slice(0, 60);
  const prev = review.notes;
  const before = (now: string, was: string | undefined, typed: string | undefined) => (now && now === was ? typed || "" : "");
  return typedNotes(
    {
      answers: saved.answers.map((a, i) => at(input.typed?.answers, i) || before(a, prev.answers[i], prev.typed?.answers?.[i])),
      pins: saved.pins.map(
        (p, j) => at(input.typed?.pins, kept[j]) || before(p.text, prev.pins[j]?.text, prev.typed?.pins?.[j]),
      ),
      note: text(input.typed?.note) || before(saved.note, prev.note, prev.typed?.note),
    },
    { answers: saved.answers, pins: saved.pins.map((p) => p.text), note: saved.note },
  );
}

// the owner's answers and pins go to notes.md in the review folder. The page saves this way on its own as they work
// (`done` false: notes.md only). Their Done/Send (`done` true) also marks the review answered and, when it came from a
// thread, posts the same notes there (tools/converse.py post) for the CEO to pick up.
export async function saveReview(input: {
  slug: string;
  id: string;
  answers: string[];
  pins: unknown;
  note: string;
  // What the owner typed where the spelling fixer changed it (components/mockup-review.tsx), index by index like the
  // fields; empty where nothing changed.
  typed?: { answers?: unknown; pins?: unknown; note?: unknown };
  done?: boolean;
}): Promise<SaveState> {
  const review = await getMockupReview(String(input.slug), String(input.id));
  if (!review) return { error: "That review doesn’t exist." };
  const base = {
    updated: today(),
    answers: review.questions.map((_, i) => String(input.answers?.[i] || "").trim().slice(0, 2000)),
    pins: cleanPins(input.pins, review.screens, today()),
    note: String(input.note || "").trim().slice(0, 5000),
  };
  // An autosave may empty notes saved before (the last pin deleted); a final save needs something in it.
  if (!base.pins.length && !base.note && !base.answers.some(Boolean) && (input.done || !review.notes.updated)) return { error: "Write an answer or drop a note first." };
  const typed = typedOf(input, review, base);
  const notes: ReviewNotes = { ...base, ...(typed ? { typed } : {}) };
  const body = notesMarkdown(review, notes, (await getOwner()).short);
  try {
    await writeInReview(review.slug, review.id, "notes.md", matter.stringify(body, notes));
    if (!input.done) return { done: "Saved" };
    // Only the status lines change: the agent's review.md stays as it wrote it.
    const raw = await readInReview(review.slug, review.id, "review.md");
    const end = raw.indexOf("\n---", 3);
    if (raw.startsWith("---") && end > 0) {
      const head = raw
        .slice(0, end)
        .split("\n")
        .filter((l) => !/^(status|answered):/.test(l))
        .concat("status: answered", `answered: "${review.answered || today()}"`)
        .join("\n");
      await writeInReview(review.slug, review.id, "review.md", head + raw.slice(end));
    }
  } catch (error) {
    console.error("Unable to save review notes", error);
    return { error: "Couldn’t save the notes" };
  }
  revalidatePath(`/companies/${review.slug}`, "layout");
  if (!review.thread) return { done: "Saved" };
  const thread = (await getThreads()).find((t) => t.path === review.thread);
  if (!thread) return { done: "Saved; the thread is gone" };
  if (thread.running?.alive) return { done: "Saved; post again when the agent is done" };
  try {
    await run(
      "python3",
      [toolPath("converse.py"), "post", review.thread, "--as", "owner", "--to", "ceo", "--kind", "reply",
        "--subject", `Notes on the mockup: ${review.title}`.slice(0, 140), "--body", body],
      { cwd: repoRoot, env: pythonEnv(), timeout: 30000 },
    );
  } catch (error) {
    console.error("Unable to post review notes", error);
    return { done: "Saved; posting failed" };
  }
  revalidatePath("/", "layout");
  return { done: "Saved and posted" };
}

// Images attached to a pin: saved like thread attachments (holding/uploads/<date>/), returned repo-relative.
export async function uploadPinImages(form: FormData): Promise<{ paths?: string[]; error?: string }> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.type.startsWith("image/"));
  if (!files.length) return { error: "Pick an image." };
  if (files.length > 4) return { error: "Attach at most 4 images to a note." };
  try {
    return { paths: (await saveUploads(files)).map((f) => path.relative(repoRoot, f).split(path.sep).join("/")) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the image." };
  }
}

