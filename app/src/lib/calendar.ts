import { cache } from "react";
import { listOf, recordOf } from "./model";
import { getCompanies, readJson } from "./repository";
import { getPulse, type Pulse } from "./pulse";

// holding/calendar.json: what the owner keeps track of outside a project's code. Two kinds, the distinction they drew
// ("Is it something that is due on that day or is it something that I just want to be reminded to check up on"):
// - `due`: happens on `date` (null when they hasn't given the day). May carry `steps` to get ready.
// - `block`: planned work on `date`, usually with `time`/`end` (HH:MM, local) and `steps`; otherwise like `due`.
// - `check`: comes round every `cadence` after `last_done`; never done means due now; no cadence yet means unscheduled.
// Projects going quiet and release check-ins aren't stored here; they're read from holding/pulse.json each time.
// A due or block entry with `auto: true` is work the owner wants scheduled for them ("if something doesnt get finished it
// can get moved to the next day with time slots avialble", 2026-10-24): see `schedule`. `done` is their own call
// ("compleeting part of it doesnt mean its done"), set with the Done button; ticking every step counts too.
// `spread: true` caps auto work at one step's time a day, for work that gets sloppy in one sitting ("I find weddings
// ahrder and want to spread out the time on them over days", 2026-10-24).
// What kind of work an entry is, shown as an icon and used to group a day's cards ("group types of work by type and
// add an icon for that type so at a glance its understandable", 2026-10-24). An entry's own `type` wins; otherwise
// it follows calendar.json project_types, then `build` for any other project, a check is `check`, and anything
// without a project is `personal`.
export const WORK_TYPES = ["photo", "selling", "client", "build", "check", "personal", "routine"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  photo: "Photo editing",
  selling: "Selling",
  client: "Client work",
  build: "Building",
  check: "Check",
  personal: "Personal",
  routine: "Every week",
};
export type Cadence = "weekly" | "monthly" | "quarterly";
export const CADENCES: Cadence[] = ["weekly", "monthly", "quarterly"];
export type CalendarLink = { label: string; href?: string; path?: string };
export type CalendarStep = { id: string; text: string; done: boolean; done_on?: string };
export type CalendarEntry = {
  id: string;
  title: string;
  kind: "due" | "check" | "block";
  date: string | null;
  time: string | null;
  end: string | null;
  cadence: Cadence | null;
  last_done: string | null;
  project: string | null;
  about: string | null;
  note: string | null;
  links: CalendarLink[];
  steps: CalendarStep[];
  type: WorkType | null;
  auto: boolean;
  spread: boolean;
  hours: number | null;
  done: boolean;
  done_on: string | null;
  source: { source: string; ref: string; date: string } | null;
};
// When auto work may be placed: `start`–`end` (HH:MM) on `days` (0 Sunday … 6 Saturday). Timed work inside those
// hours pushes the rest past `end` by as long as it takes, up to `late` ("I need to work on moday at royal custom
// design then that pushes all other work down to after 5pm", 2026-10-24). holding/calendar.json's top-level
// `workday`; Monday to Friday, 9 to 5, as late as 9, until the owner sets it. `routine` is what fills the same hours every
// week and can't move (church on Sundays): auto work goes around it and the grids show it.
export type Routine = { title: string; days: number[]; start: string; end: string };
export type Workday = { start: string; end: string; late: string; days: number[]; routine: Routine[] };
export const DEFAULT_WORKDAY: Workday = { start: "09:00", end: "17:00", late: "21:00", days: [1, 2, 3, 4, 5], routine: [] };
export type Calendar = { updated: string | null; entries: CalendarEntry[]; workday: Workday };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const clock = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v : null);
const hoursOf = (v: unknown) => (typeof v === "number" && v > 0 && v <= 200 ? Math.round(v * 4) / 4 : null);
const daysOf = (v: unknown) => [...new Set(listOf(v).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))];
function workdayOf(v: unknown): Workday {
  const w = recordOf(v);
  const routine = listOf(w.routine).flatMap((x): Routine[] => {
    const r = recordOf(x);
    const [title, start, end, days] = [str(r.title), clock(r.start), clock(r.end), daysOf(r.days)];
    return title && start && end && end > start && days.length ? [{ title: title.slice(0, 80), days, start, end }] : [];
  });
  const start = clock(w.start) ?? DEFAULT_WORKDAY.start;
  const end = clock(w.end) ?? DEFAULT_WORKDAY.end;
  const late = clock(w.late) ?? (end > DEFAULT_WORKDAY.late ? end : DEFAULT_WORKDAY.late);
  const days = daysOf(w.days);
  return end > start && late >= end ? { start, end, late, days: days.length ? days : DEFAULT_WORKDAY.days, routine } : { ...DEFAULT_WORKDAY, routine };
}

export function parseCalendar(raw: unknown, projectTypes: Record<string, unknown> = {}): Calendar {
  const data = recordOf(raw);
  const entries = listOf(data.entries).flatMap((e): CalendarEntry[] => {
    const r = recordOf(e);
    const id = str(r.id);
    const title = str(r.title);
    if (!id || !title) return [];
    const src = recordOf(r.source);
    const projectType = recordOf(data.project_types)[String(r.project)] ?? projectTypes[String(r.project)];
    return [
      {
        id,
        title,
        kind: r.kind === "check" ? "check" : r.kind === "block" ? "block" : "due",
        date: day(r.date),
        time: clock(r.time),
        end: clock(r.end),
        cadence: CADENCES.includes(r.cadence as Cadence) ? (r.cadence as Cadence) : null,
        last_done: day(r.last_done),
        project: str(r.project),
        about: str(r.about),
        note: str(r.note),
        links: listOf(r.links).flatMap((l) => {
          const x = recordOf(l);
          const label = str(x.label);
          return label && (str(x.href) || str(x.path)) ? [{ label, href: str(x.href) ?? undefined, path: str(x.path) ?? undefined }] : [];
        }),
        steps: listOf(r.steps).flatMap((s) => {
          const x = recordOf(s);
          const sid = str(x.id);
          const text = str(x.text);
          return sid && text ? [{ id: sid, text, done: x.done === true, ...(day(x.done_on) ? { done_on: day(x.done_on)! } : {}) }] : [];
        }),
        type: WORK_TYPES.includes(r.type as WorkType) ? (r.type as WorkType) : WORK_TYPES.includes(projectType as WorkType) ? (projectType as WorkType) : null,
        auto: r.auto === true && r.kind !== "check",
        spread: r.spread === true && r.kind !== "check",
        hours: hoursOf(r.hours),
        done: r.done === true && r.kind !== "check",
        done_on: day(r.done_on),
        source: str(src.source) ? { source: String(src.source), ref: String(src.ref ?? ""), date: String(src.date ?? "") } : null,
      },
    ];
  });
  return { updated: day(data.updated), entries, workday: workdayOf(data.workday) };
}

export const getCalendar = cache(async (): Promise<Calendar> => {
  try {
    const [raw, companies] = await Promise.all([readJson("holding/calendar.json"), getCompanies()]);
    return parseCalendar(raw, Object.fromEntries(companies.map((company) => [company.id, recordOf(company).calendar_type])));
  } catch {
    return { updated: null, entries: [], workday: DEFAULT_WORKDAY };
  }
});

// Date arithmetic on YYYY-MM-DD at noon UTC, so no timezone moves a day.
const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(at(d) + n * 86_400_000);
export const daysBetween = (from: string, to: string) => Math.round((at(to) - at(from)) / 86_400_000);
export function addCadence(d: string, cadence: Cadence): string {
  if (cadence === "weekly") return addDays(d, 7);
  const t = new Date(at(d));
  const months = cadence === "monthly" ? 1 : 3;
  const target = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(t.getUTCDate(), last)); // Jan 31 + 1 month is Feb 28/29, not Mar 3
  return iso(target.getTime());
}

// When an entry next needs the owner: a due entry's date (once past, it stays overdue until its steps are done);
// a check's last_done plus its cadence, or today when it has never been done.
export function nextDate(e: CalendarEntry, today: string): string | null {
  if (e.kind !== "check") return e.date;
  if (!e.cadence) return null;
  return e.last_done ? addCadence(e.last_done, e.cadence) : today;
}

// A row on the page: a stored entry, or one derived from the pulse (`from: "pulse"`).
export type CalendarItem = {
  key: string;
  title: string;
  kind: "due" | "check" | "block";
  when: string | null;
  time: string | null;
  end: string | null;
  done: boolean;
  from: "calendar" | "pulse" | "routine";
  entry?: CalendarEntry;
  project: string | null;
  detail: string | null;
  auto?: boolean;
  order?: number;
};
export const typeOf = (i: CalendarItem): WorkType => {
  if (i.from === "routine") return "routine";
  if (i.from === "pulse") return "check";
  if (i.entry?.type) return i.entry.type;
  if (i.project) return "build";
  return i.kind === "check" ? "check" : "personal";
};
// A day's cards grouped by type, the groups in the order their first card comes (so priority still leads).
export function groupByType(items: CalendarItem[]): CalendarItem[] {
  const order = [...new Set(items.map(typeOf))];
  return [...items].sort((a, b) => order.indexOf(typeOf(a)) - order.indexOf(typeOf(b)));
}

// Projects the owner keeps (focus or maintain) that have gone cooling or dormant get a "look at it" row today, unless a
// release check-in is already booked; any booked check-in is a row on its date.
export function pulseItems(pulse: Pulse[], today: string): CalendarItem[] {
  return pulse.flatMap((p): CalendarItem[] => {
    const next = (p as Pulse & { next_check?: string | null }).next_check;
    const quiet = p.idle_days != null ? `${p.idle_days} days since a commit` : null;
    const loose = p.uncommitted ? `${p.uncommitted} uncommitted` : null;
    const detail = [quiet, loose].filter(Boolean).join(" · ") || null;
    const base = { kind: "check" as const, time: null, end: null, done: false, from: "pulse" as const, project: p.slug, detail };
    if (day(next)) return [{ ...base, key: `pulse:${p.slug}`, title: "Check-in", when: next! }];
    if (["focus", "maintain"].includes(p.tier) && (p.state === "cooling" || p.state === "dormant"))
      return [{ ...base, key: `pulse:${p.slug}`, title: "Gone quiet", when: today }];
    return [];
  });
}

export type Bucket = "overdue" | "today" | "week" | "later" | "unscheduled";
export function bucketOf(when: string | null, today: string): Bucket {
  if (!when) return "unscheduled";
  const n = daysBetween(today, when);
  return n < 0 ? "overdue" : n === 0 ? "today" : n <= 7 ? "week" : "later";
}

// Done: marked done, or every step ticked. A done entry drops off the list once its day has passed (an auto one
// once the day it was finished has); so does a past day with nothing left to tick. Unfinished auto work never does.
export const isDone = (e: CalendarEntry) => e.done || (e.steps.length > 0 && e.steps.every((s) => s.done));
const doneDay = (e: CalendarEntry) => (e.auto ? (e.done_on ?? e.date) : e.date);
const finished = (e: CalendarEntry, today: string) => {
  if (e.kind === "check") return false;
  if (e.auto && !isDone(e)) return false;
  const d = doneDay(e);
  return !!d && daysBetween(today, d) < 0 && (isDone(e) || e.steps.every((s) => s.done));
};

// Auto work's size: `hours` shared across the steps (an hour a step when no hours are given), counting only the
// open ones, so ticking a step frees its time. Minutes, in quarter hours.
const stepTime = (e: CalendarEntry) => (e.hours ? (e.hours * 60) / Math.max(e.steps.length, 1) : 60);
export function workLeft(e: CalendarEntry): number {
  const open = e.steps.filter((s) => !s.done).length;
  return Math.max(15, Math.round((stepTime(e) * Math.max(open, 1)) / 15) * 15);
}

// Free stretches between `from` and `to` (minutes) around `busy`, each at least `min` long.
export function freeTime(busy: [number, number][], from: number, to: number, min: number): [number, number][] {
  const out: [number, number][] = [];
  let at = from;
  for (const [a, b] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (Math.min(a, to) - at >= min) out.push([at, Math.min(a, to)]);
    at = Math.max(at, b);
    if (at >= to) break;
  }
  if (to - at >= min) out.push([at, to]);
  return out;
}

// Where unfinished auto work goes, worked out fresh on every read and never stored: in order of its `date` (today
// when it has none; so leftovers from past days go first) then file order, starting on that day or today if later, each entry takes the free work-day
// time it needs from its start day on (no more than a step's time a day when `spread`), around timed entries and the
// auto work placed before it. A day whose work hours are partly taken by timed entries runs past `end` by that much
// (up to `late`), so a day at a client pushes the auto work into the evening rather than to tomorrow. Today starts at the
// next quarter hour after `now`. Whatever doesn't fit rolls to the next work day with room, so yesterday's leftovers
// land today without anyone moving them. Mirrored by schedule() in tools/agenda.py.
export type Slot = { date: string; start: number; end: number };
export function schedule(cal: Calendar, today: string, now: number, horizon = 90): Map<string, Slot[]> {
  const w0 = toMin(cal.workday.start);
  const w1 = toMin(cal.workday.end);
  const late = toMin(cal.workday.late);
  const busy = new Map<string, [number, number][]>();
  const take = (d: string, a: number, b: number) => busy.set(d, [...(busy.get(d) ?? []), [a, b]]);
  for (const e of cal.entries)
    if (e.kind !== "check" && (!e.auto || pinned(e, today)) && !isDone(e) && e.date && e.date >= today && e.time)
      take(e.date, toMin(e.time), e.end ? toMin(e.end) : toMin(e.time) + 30);
  // How far each day runs: the work-day end plus the work hours its timed entries take (overlaps counted once).
  const dayEnd = new Map<string, number>();
  for (const [d, list] of busy) {
    const taken = w1 - w0 - freeTime(list, w0, w1, 1).reduce((m, [a, b]) => m + b - a, 0);
    dayEnd.set(d, Math.min(late, w1 + taken));
  }
  const queue = cal.entries
    .map((e, n) => ({ e, n, order: e.date ?? today, from: e.date && e.date > today ? e.date : today }))
    .filter(({ e }) => e.auto && e.kind !== "check" && !isDone(e) && !pinned(e, today))
    .sort((a, b) => a.order.localeCompare(b.order) || a.n - b.n);
  const out = new Map<string, Slot[]>();
  for (const { e, from } of queue) {
    let left = workLeft(e);
    const cap = e.spread ? Math.max(30, Math.round(stepTime(e) / 15) * 15) : Infinity;
    const slots: Slot[] = [];
    for (let d = from, k = 0; left > 0 && k < horizon; d = addDays(d, 1), k++) {
      if (!cal.workday.days.includes(weekdayOf(d))) continue;
      const start = d === today ? Math.max(w0, Math.ceil(now / 15) * 15) : w0;
      let room = cap;
      const fixed = [...(busy.get(d) ?? []), ...routineOn(cal.workday, d).map((r): [number, number] => [toMin(r.start), toMin(r.end)])];
      for (const [a, b] of freeTime(fixed, start, dayEnd.get(d) ?? w1, 30)) {
        if (e.spread && b - a < Math.min(room, left)) continue; // spread work is a whole step in one sitting
        const end = Math.min(b, a + left, a + room);
        slots.push({ date: d, start: a, end });
        take(d, a, end);
        left -= end - a;
        room -= end - a;
        if (left <= 0 || room <= 0) break;
      }
    }
    out.set(e.id, slots);
  }
  return out;
}
// Auto work dragged to a time is pinned there for that day; if the day passes unfinished it's suggested again.
export const pinned = (e: CalendarEntry, today: string) => e.auto && !!e.time && !!e.date && e.date >= today;
const weekdayOf = (d: string) => new Date(at(d)).getUTCDay();
export const routineOn = (w: Workday, d: string) => w.routine.filter((r) => r.days.includes(weekdayOf(d)));
// Auto work shows as something to work on that day, untimed and once a day however its time was split: the slots
// only decide which days ("maybe it was better when those items where just at the top as things I could be working
// on ... rather than scheduled hour by hour", 2026-10-24).
const slotItem = (e: CalendarEntry, s: Slot): CalendarItem => ({
  ...itemOf(e, s.date, false, `${e.id}@${s.date}`),
  time: null,
  end: null,
  auto: true,
});
const autoDays = (slots: Slot[]) => slots.filter((s, k) => !k || slots[k - 1].date !== s.date);
const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

const itemOf = (e: CalendarEntry, when: string | null, done: boolean, key = e.id): CalendarItem => ({
  key,
  title: e.title,
  kind: e.kind,
  when,
  time: e.time,
  end: e.end,
  done,
  from: "calendar",
  entry: e,
  project: e.project,
  detail: e.note,
  ...(e.auto ? { auto: true } : {}),
});
export const byWhen = (a: CalendarItem, b: CalendarItem) =>
  (a.when ?? "9999").localeCompare(b.when ?? "9999") ||
  (a.time ?? "99").localeCompare(b.time ?? "99") ||
  (a.order ?? 1e9) - (b.order ?? 1e9) ||
  a.title.localeCompare(b.title);
// Within a day, stored entries keep their file order, which is also the order auto work is scheduled in: dragging a
// card in front of another reorders the file ("reoprder", 2026-10-24).
const ranked = (cal: Calendar, items: CalendarItem[]) => {
  const rank = new Map(cal.entries.map((e, k) => [e.id, k]));
  return items.map((i) => (i.entry ? { ...i, order: rank.get(i.entry.id) } : i));
};

// The list: everything still open, each once, at its next date (auto work at its first scheduled slot).
export function calendarItems(cal: Calendar, pulse: Pulse[], today: string, now = nowMinutes()): CalendarItem[] {
  const slots = schedule(cal, today, now);
  const stored = cal.entries
    .filter((e) => !finished(e, today))
    .map((e) => {
      if (!e.auto || isDone(e)) return itemOf(e, e.auto ? doneDay(e) : nextDate(e, today), isDone(e));
      if (pinned(e, today)) return itemOf(e, e.date, false);
      const first = slots.get(e.id)?.[0];
      return first ? slotItem(e, first) : { ...itemOf(e, null, false), time: null, end: null, auto: true };
    });
  return ranked(cal, [...stored, ...pulseItems(pulse, today)]).sort(byWhen);
}

// The week and month grids: every occurrence between `from` and `to` (inclusive), done ones included. A check shows
// on the day it was last done (done) and then every cadence from its next date.
// Unfinished auto work shows in its scheduled slots; once done it sits, untimed, on the day it was finished.
export function occurrences(cal: Calendar, pulse: Pulse[], from: string, to: string, today: string, now = nowMinutes()): CalendarItem[] {
  const inRange = (d: string | null) => !!d && d >= from && d <= to;
  const out: CalendarItem[] = [];
  const slots = schedule(cal, today, now);
  for (const e of cal.entries) {
    if (e.kind !== "check") {
      if (e.auto && !isDone(e) && pinned(e, today)) inRange(e.date) && out.push(itemOf(e, e.date, false));
      else if (e.auto && !isDone(e)) for (const s of autoDays(slots.get(e.id) ?? [])) inRange(s.date) && out.push(slotItem(e, s));
      else if (inRange(doneDay(e))) out.push({ ...itemOf(e, doneDay(e), isDone(e)), ...(e.auto ? { time: null, end: null } : {}) });
      continue;
    }
    if (inRange(e.last_done)) out.push(itemOf(e, e.last_done, true, `${e.id}@${e.last_done}`));
    let next = nextDate(e, today);
    for (let n = 0; next && next <= to && n < 60; n++, next = addCadence(next, e.cadence!))
      if (next >= from) out.push(itemOf(e, next, false, `${e.id}@${next}`));
  }
  for (const p of pulseItems(pulse, today)) if (inRange(p.when)) out.push(p);
  for (let d = from, k = 0; d <= to && k < 62; d = addDays(d, 1), k++)
    for (const r of routineOn(cal.workday, d))
      out.push({ key: `routine:${r.title}@${d}`, title: r.title, kind: "block", when: d, time: r.start, end: r.end, done: false, from: "routine", project: null, detail: "Every week" });
  return ranked(cal, out).sort(byWhen);
}

// Monday-first weeks. `weekStart` is the Monday on or before `d`; `monthGrid` is the whole weeks covering d's month.
export function weekStart(d: string): string {
  const dow = new Date(at(d)).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}
export const weekDays = (d: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(d), i));
export function monthGrid(d: string): string[] {
  const first = `${d.slice(0, 7)}-01`;
  const last = addDays(addCadence(first, "monthly"), -1);
  const days: string[] = [];
  // At most six weeks, whatever `d` is.
  for (let x = weekStart(first); (x <= last || days.length % 7) && days.length < 42; x = addDays(x, 1)) days.push(x);
  return days;
}
// A `d` from the URL: a real calendar day between 2000 and 2100, else null.
export function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v)) return null;
  const y = Number(v.slice(0, 4));
  return y >= 2000 && y <= 2100 && !Number.isNaN(at(v)) && iso(at(v)) === v ? v : null;
}
export const timeLabel = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

// The sidebar count: what needs the owner today or is past due.
export const needsAttention = (items: CalendarItem[], today: string) =>
  items.filter((i) => ["overdue", "today"].includes(bucketOf(i.when, today))).length;

export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function getCalendarItems(today = todayLocal()) {
  const [cal, pulse] = await Promise.all([getCalendar(), getPulse()]);
  return { calendar: cal, items: calendarItems(cal, Object.values(pulse), today), today };
}

// Edits, from the page (app/calendar/actions.ts) and from agents (tools/calendar.py, which mirrors these rules).
// Each returns a new Calendar; serializeCalendar writes it back over the raw file.
const find = (cal: Calendar, id: string) => {
  const e = cal.entries.find((x) => x.id === id);
  if (!e) throw new Error("Unknown entry");
  return e;
};
const swap = (cal: Calendar, id: string, next: CalendarEntry | null, today: string): Calendar => ({
  ...cal,
  updated: today,
  entries: cal.entries.flatMap((x) => (x.id !== id ? [x] : next ? [next] : [])),
});
// A due or block entry dragged to another day. `time` undefined keeps its time, null makes it untimed (the top of a
// day), HH:MM puts it there for as long as it took before (auto work: a step when spread, else what's left; anything
// else an hour). `before` moves it in front of that entry in the file. Auto work starts from the new day.
// How long an entry runs once dropped at a time (the grid's drag preview shows the same).
export const dropLength = (e: CalendarEntry) =>
  e.time && e.end ? toMin(e.end) - toMin(e.time) : e.auto ? (e.spread ? Math.round(stepTime(e) / 15) * 15 : workLeft(e)) : 60;
export function moveToDay(
  cal: Calendar,
  id: string,
  date: string,
  today: string,
  opts: { time?: string | null; before?: string } = {},
): Calendar {
  const e = find(cal, id);
  if (e.kind === "check" || !validDay(date)) throw new Error("Unknown entry");
  let next: CalendarEntry = { ...e, date };
  if (opts.time === null) next = { ...next, time: null, end: null };
  else if (opts.time !== undefined) {
    if (!clock(opts.time)) throw new Error("Bad time");
    const len = dropLength(e);
    const a = toMin(opts.time);
    const b = Math.min(a + Math.max(len, 15), 23 * 60 + 45);
    next = { ...next, time: opts.time, end: b > a ? clockOf(b) : null };
  }
  const rest = cal.entries.map((x) => (x.id === id ? next : x));
  if (!opts.before || opts.before === id) return { ...cal, updated: today, entries: rest };
  find(cal, opts.before);
  const without = rest.filter((x) => x.id !== id);
  without.splice(without.findIndex((x) => x.id === opts.before), 0, next);
  return { ...cal, updated: today, entries: without };
}
// the owner's hours from the Hours form on /calendar ("allow in settings to change the working hours", 2026-10-24). One
// finish time: `end` and `late` both, so nothing is suggested after it. The routine is kept as it is.
export function setWorkday(cal: Calendar, f: { start: string; end: string; days: number[] }, today: string): Calendar {
  const start = clock(f.start);
  const end = clock(f.end);
  const days = [...new Set(f.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!start || !end || end <= start || !days.length) throw new Error("Bad hours");
  return { ...cal, updated: today, workday: { ...cal.workday, start, end, late: end, days } };
}
// Done or not, the owner's call; ticked steps stay as they were either way.
export function setEntryDone(cal: Calendar, id: string, done: boolean, today: string): Calendar {
  const e = find(cal, id);
  if (e.kind === "check") throw new Error("Unknown entry");
  return swap(cal, id, { ...e, done, done_on: done ? today : null }, today);
}
export function markDone(cal: Calendar, id: string, today: string): Calendar {
  const e = find(cal, id);
  if (e.kind !== "check") throw new Error("Unknown entry");
  return swap(cal, id, { ...e, last_done: today }, today);
}
export function setCadence(cal: Calendar, id: string, cadence: Cadence | null, today: string): Calendar {
  const e = find(cal, id);
  if (e.kind !== "check") throw new Error("Unknown entry");
  return swap(cal, id, { ...e, cadence }, today);
}
export function toggleCalendarStep(cal: Calendar, id: string, stepId: string, done: boolean, today: string): Calendar {
  const e = find(cal, id);
  if (!e.steps.some((s) => s.id === stepId)) throw new Error("Unknown step");
  const steps = e.steps.map((s) => (s.id !== stepId ? s : done ? { ...s, done, done_on: today } : { id: s.id, text: s.text, done }));
  return swap(cal, id, { ...e, steps }, today);
}
export function addEntry(cal: Calendar, entry: CalendarEntry, today: string): Calendar {
  if (cal.entries.some((x) => x.id === entry.id)) throw new Error("Duplicate id");
  return { ...cal, updated: today, entries: [...cal.entries, entry] };
}
export const replaceEntry = (cal: Calendar, entry: CalendarEntry, today: string) => (find(cal, entry.id), swap(cal, entry.id, entry, today));
export const removeEntry = (cal: Calendar, id: string, today: string) => (find(cal, id), swap(cal, id, null, today));

// "List 5 more pieces" → "list-5-more-pieces"; a taken id gets the date, then a number.
export const slug = (text: string, max = 40) =>
  text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "item";
export function freshId(title: string, date: string | null, taken: Iterable<string>): string {
  const ids = new Set(taken);
  const base = slug(title);
  for (const c of [base, date ? `${base}-${date}` : null]) if (c && !ids.has(c)) return c;
  for (let n = 2; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
}
// Steps typed one per line. A line matching an existing step keeps its id and done state.
export function stepsFrom(text: string, before: CalendarStep[] = []): CalendarStep[] {
  const out: CalendarStep[] = [];
  for (const line of text.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\[[ x]\])\s*/i, "").trim()).filter(Boolean).slice(0, 30)) {
    const t = line.slice(0, 200);
    const same = before.find((s) => s.text === t && !out.some((o) => o.id === s.id));
    out.push(same ?? { id: freshId(t, null, out.map((o) => o.id)), text: t, done: false });
  }
  return out;
}

// The add/edit form's fields, checked. `projects` are the known slugs; `prev` is the entry being edited.
export type EntryFields = Partial<
  Record<"title" | "kind" | "date" | "time" | "end" | "cadence" | "project" | "about" | "note" | "steps" | "type" | "auto" | "spread" | "hours", string>
>;
export function entryFromFields(
  f: EntryFields,
  opts: { today: string; taken: string[]; projects: string[]; prev?: CalendarEntry; source: CalendarEntry["source"] },
): { entry: CalendarEntry } | { error: string } {
  const title = (f.title ?? "").replace(/\s+/g, " ").trim();
  if (!title || title.length > 120) return { error: "Give it a title (under 120 characters)." };
  const kind = f.kind === "check" || f.kind === "block" ? f.kind : "due";
  const date = f.date ? validDay(f.date) : null;
  if (f.date && !date) return { error: "That date isn't a real day." };
  const time = f.time ? clock(f.time) : null;
  const end = f.end ? clock(f.end) : null;
  if ((f.time && !time) || (f.end && !end)) return { error: "Times are HH:MM." };
  if (end && (!time || end <= time)) return { error: "The end comes after the start." };
  const auto = kind !== "check" && f.auto === "on";
  if (kind === "block" && !date && !auto) return { error: "Planned work needs a day." };
  const hours = f.hours?.trim() ? hoursOf(Number(f.hours)) : null;
  if (f.hours?.trim() && !hours) return { error: "Hours of work is a number, up to 200." };
  const cadence = kind === "check" && CADENCES.includes(f.cadence as Cadence) ? (f.cadence as Cadence) : null;
  const project = f.project?.trim() || null;
  if (project && !opts.projects.includes(project)) return { error: "Unknown project." };
  const note = f.note?.trim() || null;
  if (note && note.length > 1000) return { error: "Keep the note under 1,000 characters." };
  const about = f.about?.trim().slice(0, 120) || null;
  const prev = opts.prev;
  return {
    entry: {
      id: prev?.id ?? freshId(title, date, opts.taken),
      title,
      kind,
      date: kind === "check" ? null : date,
      // Auto work with a time is pinned there for its day (see `pinned`); the form sends the pin back unchanged or
      // without it once the owner unpins, so an edit doesn't quietly unpin it.
      time: kind === "check" ? null : time,
      end: kind === "check" ? null : end,
      cadence,
      last_done: kind === "check" ? (prev?.last_done ?? null) : null,
      project,
      about,
      note,
      links: prev?.links ?? [],
      steps: f.steps === undefined ? (prev?.steps ?? []) : stepsFrom(f.steps, prev?.steps),
      type: WORK_TYPES.includes(f.type as WorkType) && f.type !== "routine" ? (f.type as WorkType) : f.type === undefined ? (prev?.type ?? null) : null,
      auto,
      spread: auto && f.spread === "on",
      hours: auto ? hours : null,
      done: kind !== "check" && (prev?.done ?? false),
      done_on: kind !== "check" ? (prev?.done_on ?? null) : null,
      source: prev?.source ?? opts.source,
    },
  };
}

// Back to the raw file, changing as little as possible: each entry keeps its key order and any keys the app doesn't
// know, a field whose parsed value didn't change keeps its raw value, an empty field is left out unless the raw entry
// already had it (null means "not known yet"). New entries are written in FIELDS order.
const FIELDS = ["id", "title", "kind", "date", "time", "end", "cadence", "last_done", "project", "about", "links", "note", "steps", "type", "auto", "spread", "hours", "done", "done_on", "source"] as const;
const empty = (v: unknown) => v == null || v === false || (Array.isArray(v) && !v.length);
const rawField = (e: CalendarEntry, k: (typeof FIELDS)[number]) =>
  k === "steps" ? e.steps.map((s) => ({ id: s.id, text: s.text, done: s.done, ...(s.done_on ? { done_on: s.done_on } : {}) })) : e[k];
export function serializeCalendar(raw: unknown, cal: Calendar): Record<string, unknown> {
  const r = recordOf(raw);
  const old = new Map(listOf(r.entries).map((e) => [recordOf(e).id, recordOf(e)] as const));
  const entries = cal.entries.map((e) => {
    const base = old.get(e.id) ?? {};
    const was = parseCalendar({ entries: [base] }).entries[0];
    const out: Record<string, unknown> = {};
    const put = (k: string) => {
      const field = k as (typeof FIELDS)[number];
      if (!FIELDS.includes(field)) return void (out[k] = base[k]);
      const v = rawField(e, field);
      if (was && k in base && JSON.stringify(rawField(was, field)) === JSON.stringify(v)) out[k] = base[k];
      else if (!empty(v) || k in base) out[k] = v ?? (field === "auto" || field === "spread" || field === "done" ? false : null);
    };
    Object.keys(base).forEach(put);
    FIELDS.filter((k) => !(k in base)).forEach(put);
    return out;
  });
  // `workday` is written only when it changed, so a file without one keeps the defaults implicit.
  const workday = JSON.stringify(workdayOf(r.workday)) === JSON.stringify(cal.workday) ? r.workday : cal.workday;
  return { ...r, updated: cal.updated ?? r.updated ?? null, ...(workday !== undefined ? { workday } : {}), entries };
}

// The week's hour grid. Minutes since midnight; an item with no end takes half an hour.
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const span = (i: CalendarItem): [number, number] => {
  const a = toMin(i.time!);
  return [a, i.end ? Math.max(toMin(i.end), a + 15) : a + 30];
};
// Timed items laid side by side where they overlap: `col` of `cols` in their cluster.
export type Placed = { item: CalendarItem; start: number; end: number; col: number; cols: number };
export function placeDay(items: CalendarItem[]): Placed[] {
  const timed: Placed[] = items
    .filter((i) => i.time)
    .map((item) => {
      const [start, end] = span(item);
      return { item, start, end, col: 0, cols: 1 };
    });
  timed.sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Placed[] = [];
  let reach = -1;
  const close = () => cluster.forEach((p) => (p.cols = Math.max(...cluster.map((c) => c.col)) + 1));
  for (const p of timed) {
    if (p.start >= reach) {
      close();
      cluster = [];
    }
    const used = new Set(cluster.filter((c) => c.end > p.start).map((c) => c.col));
    while (used.has(p.col)) p.col++;
    cluster.push(p);
    reach = Math.max(reach, p.end);
  }
  close();
  return timed;
}
// Open time on a day between `from` and `to` (minutes), at least `min` long: where new work could go.
export const openWindows = (items: CalendarItem[], from: number, to: number, min = 45): [number, number][] =>
  freeTime(items.filter((i) => i.time && !i.done).map(span), from, to, min);
export const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Dated things coming up (not planned work): the countdowns over the week.
export const countdowns = (cal: Calendar, today: string, days = 30) =>
  cal.entries
    .filter((e) => e.kind === "due" && !e.auto && !isDone(e) && e.date && e.date >= today && daysBetween(today, e.date) <= days)
    .sort((a, b) => a.date!.localeCompare(b.date!));
