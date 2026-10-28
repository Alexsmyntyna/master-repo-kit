"use server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { repoRoot } from "@/lib/repository";
import { parseAmount, parseMoney, parseSetup, productChanges, setGoals, toggleStep } from "@/lib/company";

// the owner's own edits on the Company pages: ticking a setup step (holding/setup.json) and the money goals and
// actuals (holding/money.json). Agents never call these; only a click or a form on the page does.
export type MoneyState = { error?: string; done?: string };

const today = () => new Date().toISOString().slice(0, 10);
const file = (name: "setup.json" | "money.json") => path.join(repoRoot, "holding", name);
const readRaw = async (name: "setup.json" | "money.json") => JSON.parse(await readFile(file(name), "utf8"));
// Keeps every key the file has (notes, fields the app doesn't know), changing only what the edit touched.
const save = (name: "setup.json" | "money.json", data: unknown) => writeFile(file(name), JSON.stringify(data, null, 2) + "\n");

export async function setStepDone(id: string, done: boolean): Promise<{ error?: string }> {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,80}$/.test(id) || typeof done !== "boolean") return { error: "Unknown step." };
  try {
    const raw = await readRaw("setup.json");
    const next = toggleStep(parseSetup(raw), id, done, today());
    // Write back into the raw file so unknown keys survive; only `done`, `done_on`, `done_by` (always owner here),
    // `evidence` (cleared on untick) and `updated` change.
    const step = next.groups.flatMap((g) => g.steps).find((s) => s.id === id)!;
    for (const g of raw.groups || [])
      for (const s of g.steps || [])
        if (s.id === id) {
          s.done = step.done;
          delete s.evidence;
          if (step.done) Object.assign(s, { done_on: step.done_on, done_by: "owner" });
          else {
            delete s.done_on;
            delete s.done_by;
          }
        }
    raw.updated = next.updated;
    await save("setup.json", raw);
  } catch (error) {
    return { error: (error as Error).message === "Unknown step" ? "Unknown step." : "Couldn’t save the checklist." };
  }
  revalidatePath("/company", "layout");
  return {};
}

const amounts = (form: FormData, ...names: string[]) => names.map((n) => parseAmount(String(form.get(n) ?? "")));

export async function saveGoals(_previous: MoneyState, form: FormData): Promise<MoneyState> {
  const [year, monthly] = amounts(form, "year", "monthly");
  if (year === undefined || monthly === undefined) return { error: "Amounts are plain numbers, like 1200 or 1,200.50." };
  try {
    const raw = await readRaw("money.json");
    const next = setGoals(parseMoney(raw), year, monthly, today());
    raw.goals = { ...(raw.goals || {}), year: next.goals.year, monthly: next.goals.monthly };
    raw.updated = next.updated;
    await save("money.json", raw);
  } catch {
    return { error: "Couldn’t save the goals." };
  }
  revalidatePath("/company", "layout");
  return { done: "Saved" };
}

// The products table's one Save: every row's goal and actual (`goal:<slug>`, `actual:<slug>`) in one write, of the
// products that changed.
export async function saveProducts(_previous: MoneyState, form: FormData): Promise<MoneyState> {
  const typed: Record<string, { goal: string; actual: string }> = {};
  for (const [name, value] of form.entries()) {
    const m = /^(goal|actual):([a-z0-9-]{1,80})$/.exec(name);
    if (m) (typed[m[2]] ??= { goal: "", actual: "" })[m[1] as "goal" | "actual"] = String(value);
  }
  try {
    const raw = await readRaw("money.json");
    const found = productChanges(parseMoney(raw), typed);
    if ("error" in found) return { error: found.error };
    if (!found.changes.length) return { done: "No changes" };
    for (const c of found.changes) raw.products[c.slug] = { ...raw.products[c.slug], goal_monthly: c.goal, actual_monthly: c.actual };
    raw.updated = today();
    await save("money.json", raw);
  } catch {
    return { error: "Couldn’t save the table." };
  }
  revalidatePath("/company", "layout");
  return { done: "Saved" };
}
