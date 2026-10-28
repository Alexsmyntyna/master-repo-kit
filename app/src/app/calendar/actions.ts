"use server";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { repoRoot, getCompanies } from "@/lib/repository";
import {
  CADENCES,
  addEntry,
  entryFromFields,
  markDone,
  moveToDay,
  parseCalendar,
  removeEntry,
  replaceEntry,
  serializeCalendar,
  setCadence,
  setEntryDone,
  setWorkday,
  todayLocal,
  toggleCalendarStep,
  type Cadence,
  type Calendar,
  type EntryFields,
} from "@/lib/calendar";

// the owner's edits on /calendar. Every one is a change to the parsed Calendar, written back by serializeCalendar so keys
// the app doesn't know survive (tools/calendar.py, the agents' way in, writes the same file the same way).
const file = () => path.join(repoRoot, "holding", "calendar.json");
const ID = /^[a-z0-9-]{1,80}$/;
type Result = { error?: string; done?: string; id?: string };

async function edit(change: (cal: Calendar, today: string) => Calendar): Promise<void> {
  const raw = JSON.parse(await readFile(file(), "utf8"));
  const cal = parseCalendar(raw);
  const next = change(cal, todayLocal());
  if (next === cal) return; // nothing to write (the form said why)
  const tmp = `${file()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(serializeCalendar(raw, next), null, 2) + "\n");
  await rename(tmp, file());
  revalidatePath("/", "layout");
}
async function attempt(run: () => Promise<void>, fail = "Couldn’t save."): Promise<Result> {
  try {
    await run();
    return {};
  } catch {
    return { error: fail };
  }
}

export const markCheckDone = async (id: string): Promise<Result> =>
  ID.test(id) ? attempt(() => edit((cal, today) => markDone(cal, id, today))) : { error: "Unknown entry." };

export async function changeCadence(id: string, cadence: string): Promise<Result> {
  const value = cadence === "" ? null : (cadence as Cadence);
  if (!ID.test(id) || (value && !CADENCES.includes(value))) return { error: "Unknown entry." };
  return attempt(() => edit((cal, today) => setCadence(cal, id, value, today)));
}

export const markEntryDone = async (id: string, done: boolean): Promise<Result> =>
  ID.test(id) && typeof done === "boolean"
    ? attempt(() => edit((cal, today) => setEntryDone(cal, id, done, today)))
    : { error: "Unknown entry." };

// A drag on the grids: to `date`, at `time` (undefined keeps it, null makes it untimed), in front of `before`.
export async function moveEntry(id: string, date: string, time?: string | null, before?: string): Promise<Result> {
  const ok =
    ID.test(id) &&
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    (time === undefined || time === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) &&
    (before === undefined || ID.test(before));
  if (!ok) return { error: "Unknown entry." };
  return attempt(() => edit((cal, today) => moveToDay(cal, id, date, today, { time, before })), "Couldn’t move it.");
}

// The Hours form: start and finish (HH:MM) and the days worked (0 Sunday … 6 Saturday).
export async function saveWorkday(_: Result, form: FormData): Promise<Result> {
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  const days = form.getAll("days").map(Number);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start)
    return { error: "The day ends after it starts." };
  if (!days.length) return { error: "Pick at least one day." };
  const run = await attempt(() => edit((cal, today) => setWorkday(cal, { start, end, days }, today)));
  return run.error ? run : { done: "Saved" };
}

export async function setStep(id: string, stepId: string, done: boolean): Promise<Result> {
  if (!ID.test(id) || !ID.test(stepId) || typeof done !== "boolean") return { error: "Unknown step." };
  return attempt(() => edit((cal, today) => toggleCalendarStep(cal, id, stepId, done, today)));
}

export const deleteEntry = async (id: string): Promise<Result> =>
  ID.test(id) ? attempt(() => edit((cal, today) => removeEntry(cal, id, today))) : { error: "Unknown entry." };

// The add/edit form (useActionState). `id` set means edit that entry; what the owner types is theirs (source owner).
export async function saveEntry(_: Result, form: FormData): Promise<Result> {
  const id = String(form.get("id") || "");
  if (id && !ID.test(id)) return { error: "Unknown entry." };
  const fields: EntryFields = {};
  for (const k of ["title", "kind", "date", "time", "end", "cadence", "project", "about", "note", "steps", "type", "auto", "spread", "hours"] as const) {
    const v = form.get(k);
    if (typeof v === "string") fields[k] = v.slice(0, 4000);
  }
  const projects = (await getCompanies()).map((c) => c.id);
  let made: Result = {};
  const run = await attempt(() =>
    edit((cal, today) => {
      const prev = id ? cal.entries.find((e) => e.id === id) : undefined;
      if (id && !prev) throw new Error("Unknown entry");
      const r = entryFromFields(fields, {
        today,
        taken: cal.entries.map((e) => e.id),
        projects,
        prev,
        source: { source: "owner", ref: "Typed on /calendar", date: today },
      });
      if ("error" in r) {
        made = { error: r.error };
        return cal;
      }
      made = { id: r.entry.id, done: prev ? "Saved" : "Added" };
      return prev ? replaceEntry(cal, r.entry, today) : addEntry(cal, r.entry, today);
    }),
  );
  return run.error ? run : made;
}
