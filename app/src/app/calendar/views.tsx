import Link from "next/link";
import { Briefcase, Camera, Code2, RefreshCw, Repeat, Tag, User, type LucideIcon } from "lucide-react";
import {
  bucketOf,
  clockOf,
  daysBetween,
  openWindows,
  placeDay,
  timeLabel,
  dropLength,
  groupByType,
  typeOf,
  WORK_TYPE_LABELS,
  type WorkType,
  toMin,
  workLeft,
  type Bucket,
  type CalendarEntry,
  type CalendarItem,
} from "@/lib/calendar";
import { dateLabel } from "@/lib/model";
import { Empty, Row, Rows, Section, Source } from "@/components/ds";
import { CadencePicker, CalendarStepCheck, CheckDone, DatePick, EntryDone, RemoveEntry } from "@/components/calendar";

// The pieces of /calendar (page.tsx puts them together). `names` maps project slugs to names; `at(params)` makes a
// link to this page keeping the view and day.
// `hours` is the working day in minutes ([start, end]): the week grid's range and where open time is marked.
export type Ctx = { names: Record<string, string>; today: string; now: number; hours: [number, number]; at: (p: Record<string, string>) => string };

export const weekday = (d: string, style: "short" | "long" = "short") =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
const span = (i: CalendarItem) => [timeLabel(i.time), timeLabel(i.end)].filter(Boolean).join("–");
const hours = (m: number) => {
  const h = Math.floor(m / 60),
    r = Math.round(m % 60);
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
};
const toneOf = (i: CalendarItem) => (i.from === "pulse" ? "pulse" : i.kind);
const ICONS: Record<WorkType, LucideIcon> = { photo: Camera, selling: Tag, client: Briefcase, build: Code2, check: RefreshCw, personal: User, routine: Repeat };
function TypeIcon({ i }: { i: CalendarItem }) {
  const t = typeOf(i);
  const Icon = ICONS[t];
  return <Icon className={`cal-type cal-type-${t}`} size={12} strokeWidth={2} aria-label={WORK_TYPE_LABELS[t]} />;
}

export function whenLabel(when: string | null, today: string) {
  if (!when) return null;
  const n = daysBetween(today, when);
  const words = n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n < 0 ? `${-n} days ago` : `in ${n} days`;
  return (
    <span className={`cal-when ${n < 0 ? "is-late" : ""}`}>
      {dateLabel(when)} · {words}
    </span>
  );
}

function Links({ e }: { e: CalendarEntry }) {
  if (!e.links.length) return null;
  return (
    <p className="cal-links">
      {e.links.map((l) =>
        l.href ? (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
            {l.label}
          </a>
        ) : (
          <span key={l.label} className="code-text" title={l.path}>
            {l.label}
          </span>
        ),
      )}
    </p>
  );
}

export function Steps({ e }: { e: CalendarEntry }) {
  return (
    <>
      {e.steps.map((s) => (
        <label key={s.id} className={`cal-step-line ${s.done ? "is-done" : ""}`}>
          <CalendarStepCheck entry={e.id} step={s.id} done={s.done} text={s.text} />
          <span>{s.text}</span>
        </label>
      ))}
    </>
  );
}

// Everything about one item: time, note, steps, links, and what can be done with it.
export function ItemBody({ i, ctx }: { i: CalendarItem; ctx: Ctx }) {
  const e = i.entry;
  return (
    <div className="cal-body">
      {(i.time || i.project || e?.about) && (
        <p className="cal-note">
          {[span(i), i.project ? ctx.names[i.project] || i.project : e?.about].filter(Boolean).join(" · ")}
        </p>
      )}
      {e && e.kind !== "check" && (
        <DatePick
          id={e.id}
          date={e.date}
          label={`${e.auto && !i.done ? "Starts " : ""}${e.date ? `${weekday(e.date)}, ${dateLabel(e.date)}` : "No day yet"}`}
        />
      )}
      {i.detail && <p className="cal-note">{i.detail}</p>}
      {e?.auto && !i.done && (
        <p className="cal-note">
          {e.time ? "Pinned to this time; suggested again if not done" : "Suggested for this day"} · {hours(workLeft(e))} left{e.hours ? "" : " (an hour a step)"}
          {e.spread ? " · a step a day" : ""} · moves on by itself if not done
        </p>
      )}
      {e && <Steps e={e} />}
      {e && <Links e={e} />}
      {e && e.kind !== "check" && <EntryDone id={e.id} done={i.done} />}
      {e?.kind === "check" && !i.done && (
        <span className="cal-action">
          <CadencePicker id={e.id} value={e.cadence} />
          {e.cadence && <CheckDone id={e.id} />}
        </span>
      )}
      <span className="cal-foot">
        {e?.source && <Source who={e.source.source} date={e.source.date} cite={e.source.ref} />}
        {i.from === "pulse" && <Source who="code" label="Pulse" />}
        {i.project && <Link href={`/companies/${i.project}`}>Project</Link>}
        {e && (
          <Link href={`${ctx.at({ edit: e.id })}#entry`} scroll={false}>
            Edit
          </Link>
        )}
        {e && <RemoveEntry id={e.id} />}
      </span>
    </div>
  );
}

// What can be dragged to another day: stored due and planned entries, not checks, pulse rows or the routine.
const movable = (i: CalendarItem) =>
  i.entry && i.entry.kind !== "check" ? { draggable: true, "data-drag-id": i.entry.id, "data-drag-min": dropLength(i.entry) } : {};

// One item as a chip that opens to its body. `style` places it on the hour grid.
function Chip({ i, ctx, style, size }: { i: CalendarItem; ctx: Ctx; style?: React.CSSProperties; size?: "long" | "short" }) {
  const steps = i.entry?.steps ?? [];
  return (
    <details className={`cal-item cal-${toneOf(i)} ${i.done ? "is-done" : ""} ${size ? `is-${size}` : ""}`} style={style} {...movable(i)}>
      <summary title={[WORK_TYPE_LABELS[typeOf(i)], span(i), i.title].filter(Boolean).join(" · ")}>
        <TypeIcon i={i} />
        {i.time && <span className="cal-time">{timeLabel(i.time)}</span>}
        <span className="cal-title">
          {i.title}
          {i.from === "pulse" && i.project && `: ${ctx.names[i.project] || i.project}`}
        </span>
        {!!steps.length && (
          <span className="cal-count">
            {steps.filter((s) => s.done).length}/{steps.length}
          </span>
        )}
      </summary>
      <ItemBody i={i} ctx={ctx} />
    </details>
  );
}

// Above the views: what's happening now or next, the dated things counting down, and the loose ends.
export function Today({ items, countdown, loose, ctx }: { items: CalendarItem[]; countdown: CalendarEntry[]; loose: number; ctx: Ctx }) {
  const timed = items.filter((i) => i.when === ctx.today && i.time && !i.done);
  const live = timed.find((i) => toMin(i.time!) <= ctx.now && ctx.now < (i.end ? toMin(i.end) : toMin(i.time!) + 30));
  const next = timed.find((i) => toMin(i.time!) > ctx.now);
  const shown = live ?? next;
  return (
    <div className="cal-today">
      <div className="cal-now">
        <span className="cal-kicker">{live ? "Now" : next ? "Next" : "Today"}</span>
        {shown ? (
          <>
            <b>{shown.title}</b>
            <span className="cal-note">
              {span(shown)}
              {live && shown.end ? ` · ${hours(toMin(shown.end) - ctx.now)} left` : ""}
              {!live && next ? ` · in ${hours(toMin(next.time!) - ctx.now)}` : ""}
            </span>
            {!!shown.entry?.steps.length && (
              <div className="cal-now-steps">
                <Steps e={shown.entry} />
              </div>
            )}
          </>
        ) : (
          <span className="cal-note">Nothing timed left today.</span>
        )}
      </div>
      {countdown.map((e) => {
        const n = daysBetween(ctx.today, e.date!);
        const done = e.steps.filter((s) => s.done).length;
        return (
          <Link key={e.id} className="cal-count-card" href={`${ctx.at({ d: e.date! })}`}>
            <span className="cal-kicker">
              {n === 0 ? "Today" : n === 1 ? "Tomorrow" : `${weekday(e.date!)} · ${n} days`}
              {!!e.steps.length && ` · ${done}/${e.steps.length}`}
            </span>
            <b title={`${e.title} · ${weekday(e.date!, "long")}, ${dateLabel(e.date!)}`}>{e.title}</b>
            {!!e.steps.length && (
              <span className="cal-progress" title={`${done} of ${e.steps.length} ready`}>
                <i style={{ width: `${(done / e.steps.length) * 100}%` }} />
              </span>
            )}
          </Link>
        );
      })}
      {loose > 0 && (
        <Link className="cal-count-card is-loose" href="/calendar?view=list">
          <span className="cal-kicker">Loose ends</span>
          <b title="Overdue, due today, or gone quiet">{loose} to look at</b>
        </Link>
      )}
    </div>
  );
}

const PX = 0.8; // pixels per minute on the hour grid (48px an hour)
const LONG = 240; // a block of four hours or more (a work day) draws as a quiet band

// The week: untimed things across the top of each day, timed work on an hour scale, and the open time between,
// each gap a link that starts a new entry there. Below 900px it reads as a list per day instead.
export function WeekGrid({ days, items, ctx }: { days: string[]; items: CalendarItem[]; ctx: Ctx }) {
  const timed = items.filter((i) => i.time);
  const starts = timed.map((i) => toMin(i.time!));
  const ends = timed.map((i) => (i.end ? toMin(i.end) : toMin(i.time!) + 30));
  // The working hours, stretched only for something booked outside them.
  const h0 = Math.floor(Math.min(...starts, ctx.hours[0]) / 60);
  const h1 = Math.ceil(Math.max(...ends, ctx.hours[1]) / 60);
  const top = (m: number) => (m - h0 * 60) * PX;
  const on = (d: string) => items.filter((i) => i.when === d);
  return (
    <>
      <div className="cal-tw-scroll">
      <div className="cal-tw" style={{ "--tw-h": `${(h1 - h0) * 60 * PX}px` } as React.CSSProperties}>
        <div className="cal-tw-corner" />
        {days.map((d) => (
          <div key={d} className={`cal-tw-head ${d === ctx.today ? "is-today" : ""} ${d < ctx.today ? "is-past" : ""}`} data-drop-day={d} data-drop-untimed="">
            <div className="cal-tw-date">
              <span>{weekday(d)}</span>
              <b>{Number(d.slice(8))}</b>
            </div>
            <div className="cal-tw-allday">
              {groupByType(on(d).filter((i) => !i.time)).map((i) => (
                <Chip key={i.key} i={i} ctx={ctx} />
              ))}
            </div>
          </div>
        ))}
        <div className="cal-tw-hours">
          {Array.from({ length: h1 - h0 }, (_, k) => (
            <span key={k} style={{ top: k * 60 * PX }}>
              {timeLabel(clockOf((h0 + k) * 60))}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const list = on(d);
          const from = d === ctx.today ? Math.ceil(ctx.now / 15) * 15 : ctx.hours[0];
          const gaps = d >= ctx.today ? openWindows(list, Math.max(from, ctx.hours[0]), ctx.hours[1]) : [];
          return (
            <div
              key={d}
              className={`cal-tw-col ${d === ctx.today ? "is-today" : ""} ${d < ctx.today ? "is-past" : ""}`}
              data-drop-day={d}
              data-drop-h0={h0}
              data-drop-px={PX}
            >
              {gaps.map(([a, b]) => (
                <Link
                  key={a}
                  className="cal-open"
                  scroll={false}
                  style={{ top: top(a), height: (b - a) * PX }}
                  href={`${ctx.at({ add: "1", date: d, time: clockOf(a), end: clockOf(Math.min(b, a + 120)) })}#entry`}
                  title={`Open ${timeLabel(clockOf(a))}–${timeLabel(clockOf(b))}: plan something here`}
                >
                  <span>+ {hours(b - a)} open</span>
                </Link>
              ))}
              {placeDay(list).map((p) => (
                <Chip
                  key={p.item.key}
                  i={p.item}
                  ctx={ctx}
                  size={p.end - p.start >= LONG ? "long" : p.end - p.start <= 60 ? "short" : undefined}
                  style={{
                    top: top(p.start),
                    height: Math.max((p.end - p.start) * PX, 20),
                    left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                    width: `calc(${100 / p.cols}% - 4px)`,
                  }}
                />
              ))}
              {d === ctx.today && ctx.now >= h0 * 60 && ctx.now < h1 * 60 && <i className="cal-nowline" style={{ top: top(ctx.now) }} />}
            </div>
          );
        })}
      </div>
      </div>
      <div className="cal-agenda">
        {days.map((d) => (
          <section key={d} className={`cal-agenda-day ${d === ctx.today ? "is-today" : ""}`} data-drop-day={d}>
            <h3>
              {weekday(d, "long")} <span>{dateLabel(d)}</span>
            </h3>
            {on(d).length ? on(d).map((i) => <Chip key={i.key} i={i} ctx={ctx} />) : <span className="cal-note">Nothing planned</span>}
          </section>
        ))}
      </div>
    </>
  );
}

export function MonthGrid({ days, month, items, ctx }: { days: string[]; month: string; items: CalendarItem[]; ctx: Ctx }) {
  return (
    <div className="cal-month">
      {days.slice(0, 7).map((x) => (
        <div key={x} className="cal-dow">
          {weekday(x)}
        </div>
      ))}
      {days.map((x) => {
        const list = items.filter((i) => i.when === x);
        const planned = list.filter((i) => i.time && i.end && i.from !== "routine").reduce((m, i) => m + toMin(i.end!) - toMin(i.time!), 0);
        return (
          <Link
            key={x}
            href={ctx.at({ view: "week", d: x })}
            className={`cal-cell ${x === ctx.today ? "is-today" : ""} ${x.slice(0, 7) !== month ? "is-other" : ""} ${x < ctx.today ? "is-past" : ""}`}
            data-drop-day={x}
          >
            <b>
              {Number(x.slice(8))}
              {planned > 0 && <em>{hours(planned)}</em>}
            </b>
            {[...list.filter((i) => i.time), ...groupByType(list.filter((i) => !i.time))].slice(0, 4).map((i) => (
              <span key={i.key} className={`cal-line cal-${toneOf(i)} ${i.done ? "is-done" : ""}`} {...movable(i)}>
                <TypeIcon i={i} />
                {i.time && <span className="cal-time">{timeLabel(i.time)}</span>}
                <span className="cal-title">{i.title}</span>
              </span>
            ))}
            {list.length > 4 && <span className="cal-more">+{list.length - 4} more</span>}
          </Link>
        );
      })}
    </div>
  );
}

const buckets: [Bucket, string][] = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["week", "This week"],
  ["later", "Later"],
  ["unscheduled", "No date yet"],
];

// Everything open, each once at its next date, by when.
export function ListView({ items, ctx }: { items: CalendarItem[]; ctx: Ctx }) {
  if (!items.length) return <Empty>Nothing on the calendar</Empty>;
  return (
    <>
      {buckets.map(([b, title]) => {
        const group = items.filter((i) => bucketOf(i.when, ctx.today) === b);
        if (!group.length) return null;
        return (
          <Section key={b} title={title} note={String(group.length)}>
            <Rows>
              {group.map((i) => (
                <Row
                  key={i.key}
                  title={
                    <details className={`cal-row cal-${toneOf(i)}`}>
                      <summary>{i.title}</summary>
                      <ItemBody i={i} ctx={ctx} />
                    </details>
                  }
                  meta={[
                    i.project ? ctx.names[i.project] || i.project : i.entry?.about,
                    whenLabel(i.when, ctx.today),
                    i.time && span(i),
                    i.entry?.kind === "check" && (i.entry.last_done ? `last done ${dateLabel(i.entry.last_done)}` : "never done"),
                    i.entry?.steps.length ? `${i.entry.steps.filter((s) => s.done).length} of ${i.entry.steps.length} ready` : null,
                  ]}
                />
              ))}
            </Rows>
          </Section>
        );
      })}
    </>
  );
}

