"use server";
import { revalidatePath } from "next/cache";
import { toolPath } from "@/lib/repository";
import { startDetached } from "@/lib/spawn";

// "Recheck" on the Board, a project card or a thread: tools/recheck.py run has a Sonnet agent read the commits since
// the question was asked and answer resolved, rephrase or valid. `--all` takes every flagged item, one after another.
export type RecheckState = { error?: string; done?: string };
const REF = /^companies\/[a-z0-9-]+\/(threads\/[a-z0-9-]+|builds\/[a-z0-9-]+|card\.json#(blocker|next))$/;

export async function startRecheck(_previous: RecheckState, form: FormData): Promise<RecheckState> {
  const ref = String(form.get("ref") || "").trim();
  const all = ref === "--all";
  if (!all && !REF.test(ref)) return { error: "Nothing to recheck there." };
  const label = all ? "recheck-all" : `recheck-${ref.split("/")[1]}`;
  startDetached(label, [toolPath("recheck.py"), "run", ...(all ? ["--all"] : ["--", ref])]);
  await new Promise((r) => setTimeout(r, 1500)); // the run writes its recheck_running marker first
  revalidatePath("/", "layout");
  return { done: all ? "Rechecking" : "Agent started" };
}
