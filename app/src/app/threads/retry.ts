"use server";
import { revalidatePath } from "next/cache";
import { getThread } from "@/lib/threads";
import { startRetry } from "@/lib/spawn";

const slug = /^[a-z0-9-]+$/;

// "Retry now" on a thread (or the dock's chat) waiting out the usage limit: tools/converse.py retry <thread> runs
// its queued turn at once. If the limit is still there, the thread goes back to waiting with the CLI's new time.
export async function retryNow(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const scope = String(form.get("scope") || ""),
    id = String(form.get("id") || "");
  const thread = slug.test(scope) && slug.test(id) ? await getThread(scope, id) : undefined;
  if (!thread) return { error: "That thread doesn’t exist." };
  if (thread.running?.alive) return { error: "An agent is already working on it." };
  if (!thread.waiting) return { error: "It isn’t waiting on a limit." };
  await startRetry(thread.path, `retry-${scope}`);
  revalidatePath("/", "layout");
  return {};
}
