import Link from "next/link";
import {
  addDays,
  bucketOf,
  calendarItems,
  countdowns,
  getCalendar,
  monthGrid,
  occurrences,
  timeLabel,
  toMin,
  todayLocal,
  validDay,
  weekDays,
} from "@/lib/calendar";
import { getPulse } from "@/lib/pulse";
import { getCompanies } from "@/lib/repository";
import { AskAgent, DragToDay, WorkHours } from "@/components/calendar";
import { EntryForm, type FormEntry } from "@/components/entry-form";
import { ListView, MonthGrid, Today, WeekGrid, type Ctx } from "./views";
import "@/styles/company.css";
import "@/styles/calendar.css";

export const metadata = { title: "Calendar" };

// `days` is the next seven days from `d` (today by default): this week and next side by side, nothing already past.
type View = "week" | "days" | "month" | "list";
const VIEWS: [View, string][] = [
  ["week", "Week"],
  ["days", "7 days"],
  ["month", "Month"],
  ["list", "List"],
];
type Params = { view?: string; d?: string; add?: string; edit?: string; date?: string; time?: string; end?: string };
const monthTitle = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthStep = (d: string, n: number) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1, 12)).toISOString().slice(0, 10);
};
const clockParam = (v?: string) => (v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);

// holding/calendar.json (the owner's dated things, planned work and recurring checks) plus projects going quiet from
// holding/pulse.json. A bar that stays in reach while the page scrolls (back, today, forward, the range, the view,
// Add), one compact row of today's cards and the box for the chat agent, then Week (an hour grid that scrolls in a
// window-high frame under pinned day headers), Month or List. `d` picks the week or month; `add`/`edit` open the
// entry form.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, companies, cal, pulseMap] = await Promise.all([searchParams, getCompanies(), getCalendar(), getPulse()]);
  const pulse = Object.values(pulseMap);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  const today = todayLocal();
  const clock = new Date();
  const view: View = params.view === "month" || params.view === "list" || params.view === "days" ? params.view : "week";
  const d = validDay(params.d) ?? today;
  const days = view === "month" ? monthGrid(d) : view === "days" ? Array.from({ length: 7 }, (_, k) => addDays(d, k)) : weekDays(d);
  const items = occurrences(cal, pulse, days[0], days.at(-1)!, today);
  const open = calendarItems(cal, pulse, today);
  const at = (p: Record<string, string>) => {
    const q = new URLSearchParams({ view, ...(d !== today ? { d } : {}), ...p });
    if (q.get("view") === "week") q.delete("view");
    if (q.get("d") === today) q.delete("d");
    const s = q.toString();
    return s ? `/calendar?${s}` : "/calendar";
  };
  const here = at({});
  const work = cal.workday;
  const ctx: Ctx = { names, today, now: clock.getHours() * 60 + clock.getMinutes(), hours: [toMin(work.start), toMin(work.end)], at };
  const step = (n: number) => (view === "month" ? monthStep(d, n) : addDays(d, 7 * n));
  const short = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const title = view === "month" ? monthTitle(d) : view === "week" || view === "days" ? `${short(days[0])} – ${short(days[6])}, ${days[6].slice(0, 4)}` : "Everything open";
  const todayItems = occurrences(cal, pulse, today, today, today);

  const editing = params.edit ? cal.entries.find((e) => e.id === params.edit) : undefined;
  const formEntry: FormEntry | null = editing
    ? { ...editing, steps: editing.steps.map((s) => ({ text: s.text, done: s.done })) }
    : params.add
      ? { kind: "block", date: validDay(params.date), time: clockParam(params.time), end: clockParam(params.end) }
      : null;

  return (
    <div className="cal-page">
      <div className="cal-bar">
        {view !== "list" && (
          <span className="cal-nav">
            <Link className="cal-nav-step" href={at({ d: step(-1) })} aria-label={view === "month" ? "Previous month" : "Previous week"}>
              ‹
            </Link>
            <Link className="cal-nav-today" href={at({ d: today })}>
              Today
            </Link>
            <Link className="cal-nav-step" href={at({ d: step(1) })} aria-label={view === "month" ? "Next month" : "Next week"}>
              ›
            </Link>
          </span>
        )}
        <h1>{title}</h1>
        <span className="cal-bar-meta">{items.filter((i) => !i.done).length} open</span>
        <WorkHours
          start={work.start}
          end={work.end}
          days={work.days}
          label={`${timeLabel(work.start)}–${timeLabel(work.end)}${work.days.length === 7 ? "" : `, ${work.days.length} days`}`}
        />
        <nav className="cal-seg" aria-label="Calendar view">
          {VIEWS.map(([v, label]) => (
            <Link key={v} href={at({ view: v, ...(v === "days" ? { d: today } : {}) })} aria-current={view === v ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <Link className="button primary small" href={`${at({ add: "1", date: d >= today ? d : today })}#entry`} scroll={false}>
          Add
        </Link>
      </div>
      <div className="cal-top">
        <Today
          items={todayItems}
          countdown={countdowns(cal, today, 30)}
          loose={open.filter((i) => ["overdue", "today"].includes(bucketOf(i.when, today)) && !i.time).length}
          ctx={ctx}
        />
        <AskAgent url={here} />
      </div>
      <DragToDay />
      {formEntry && (
        <EntryForm
          key={editing?.id ?? `${params.date}-${params.time}`}
          entry={formEntry}
          projects={companies.map((c) => ({ id: c.id, name: c.name }))}
          close={here}
        />
      )}
      {(view === "week" || view === "days") && <WeekGrid days={days} items={items} ctx={ctx} />}
      {view === "month" && <MonthGrid days={days} month={d.slice(0, 7)} items={items} ctx={ctx} />}
      {view === "list" && <ListView items={open} ctx={ctx} />}
    </div>
  );
}
