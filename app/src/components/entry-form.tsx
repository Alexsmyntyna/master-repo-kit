"use client";
import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Code2,
  Flag,
  Folder,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  StickyNote,
  Tag,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { saveEntry } from "@/app/calendar/actions";
import { useDraftKey, useDraftSaver } from "@/lib/use-draft";
import { MonthPicker, RemoveEntry, localToday } from "./calendar";

// The add/edit entry dialog on /calendar ("the daily editor just still looks so bad dropdowns ect id rather it feel
// cohesive and when users click on stuff it should intuitivily make sense", 2026-10-24). A title, one plain choice of
// how the entry is placed, then only the fields that choice uses: the day and time as words that open a small month or
// a list of quarter hours, project and type as chips, steps as a checklist. It posts the same fields saveEntry always
// read (hidden inputs), and keeps everything typed as one draft per entry until it saves.

export type FormEntry = {
  id?: string;
  title?: string;
  kind?: string;
  date?: string | null;
  time?: string | null;
  end?: string | null;
  cadence?: string | null;
  project?: string | null;
  about?: string | null;
  note?: string | null;
  steps?: { text: string; done: boolean }[];
  type?: string | null;
  auto?: boolean;
  spread?: boolean;
  hours?: number | null;
};

type Mode = "fixed" | "auto" | "due" | "repeat";
const MODES: [Mode, string, LucideIcon, string][] = [
  ["fixed", "On a day", Clock, "Planned for a day, at a time if you give it one."],
  ["auto", "Find time for me", Sparkles, "Fitted into your free work hours from the day you pick, around fixed plans. Whatever isn’t done moves on by itself."],
  ["due", "Due by", Flag, "A deadline. It counts down on the Today row."],
  ["repeat", "Repeats", Repeat, "Comes round again a while after you mark it done."],
];
const CADENCES: [string, string][] = [
  ["weekly", "Every week"],
  ["monthly", "Every month"],
  ["quarterly", "Every quarter"],
  ["", "Not sure yet"],
];
const TYPES: [string, string, LucideIcon | null][] = [
  ["", "Follow the project", null],
  ["photo", "Photo editing", Camera],
  ["selling", "Selling", Tag],
  ["client", "Client work", Briefcase],
  ["build", "Building", Code2],
  ["check", "Check", RefreshCw],
  ["personal", "Personal", User],
];

type Step = { key: string; text: string; done: boolean };
type State = {
  title: string;
  mode: Mode;
  date: string;
  time: string;
  end: string;
  cadence: string;
  project: string;
  type: string;
  about: string;
  note: string;
  steps: Step[];
  adding: string;
  spread: boolean;
  hours: string;
};
const DRAFTED = ["title", "mode", "date", "time", "end", "cadence", "project", "type", "about", "note", "steps", "adding", "spread", "hours"] as const;

let seq = 0;
const stepKey = () => `s${++seq}`;
const modeOf = (e: FormEntry): Mode => (e.kind === "check" ? "repeat" : e.auto ? "auto" : e.kind === "due" ? "due" : "fixed");
const initialOf = (e: FormEntry): State => ({
  title: e.title ?? "",
  mode: modeOf(e),
  date: e.date ?? "",
  time: e.time ?? "",
  end: e.end ?? "",
  cadence: e.cadence ?? "",
  project: e.project ?? "",
  type: e.type && TYPES.some(([v]) => v === e.type) ? e.type : "",
  about: e.about ?? "",
  note: e.note ?? "",
  steps: (e.steps ?? []).map((s, k) => ({ key: `i${k}`, text: s.text, done: s.done })),
  adding: "",
  spread: e.spread ?? false,
  hours: e.hours ? String(e.hours) : "",
});
// What a field is worth comparing and keeping in a draft (steps without their React keys).
const plain = (s: State, k: (typeof DRAFTED)[number]) => (k === "steps" ? JSON.stringify(s.steps.map(({ text, done }) => ({ text, done }))) : String(s[k]));

// Words for days and times.
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const time12 = (t: string) => {
  const m = toMin(t);
  return `${Math.floor(m / 60) % 12 || 12}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}${m < 720 ? "am" : "pm"}`;
};
const span = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} hr${h > 1 ? "s" : ""}${m ? ` ${m} min` : ""}` : `${m} min`;
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const dayWords = (d: string) => {
  const label = shortDay(d);
  const n = dayDiff(localToday(), d);
  return n === 0 ? `Today · ${label}` : n === 1 ? `Tomorrow · ${label}` : n === -1 ? `Yesterday · ${label}` : label;
};
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const hoursWords = (h: number) => `${h} hr${h === 1 ? "" : "s"}`;
const QUARTERS = Array.from({ length: 96 }, (_, k) => clockOf(k * 15));

type Menu = "day" | "from" | "to" | "project" | "type";

export function EntryForm({ entry, projects, close }: { entry: FormEntry; projects: { id: string; name: string }[]; close: string }) {
  const router = useRouter();
  const [result, action, pending] = useActionState(saveEntry, {});
  const [initial] = useState(() => initialOf(entry));
  const [s, setS] = useState<State>(initial);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  const stepInputs = useRef(new Map<string, HTMLInputElement>());
  const addInput = useRef<HTMLInputElement | null>(null);

  // One draft for the whole entry: each field as typed, next to what it showed before. Restored field by field, and
  // only over a field still showing that same value, so a newer saved value wins over an old draft.
  const key = useDraftKey(entry.id ? `calendar-entry-${entry.id}` : "calendar-entry-new");
  const restore = useCallback((text: string) => {
    try {
      const d = JSON.parse(text) as { values: Record<string, string>; bases: Record<string, string> };
      setS((cur) => {
        const next = { ...cur };
        for (const k of DRAFTED) {
          const v = d.values?.[k];
          if (v === undefined || v === plain(cur, k)) continue;
          if (plain(cur, k) !== (d.bases?.[k] ?? "") && plain(cur, k) !== plain(initialOf({}), k)) continue;
          if (k === "steps") next.steps = (JSON.parse(v) as { text: string; done: boolean }[]).map((x) => ({ ...x, key: stepKey() }));
          else if (k === "spread") next.spread = v === "true";
          else if (k === "mode") next.mode = MODES.some(([m]) => m === v) ? (v as Mode) : cur.mode;
          else next[k] = v;
        }
        return next;
      });
    } catch {}
  }, []);
  const { save, clear } = useDraftSaver(key, "", restore);
  const change = (patch: Partial<State> | ((cur: State) => Partial<State>)) =>
    setS((cur) => {
      const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
      const changed = DRAFTED.some((k) => plain(next, k) !== plain(initial, k));
      const values = Object.fromEntries(DRAFTED.map((k) => [k, plain(next, k)]));
      const bases = Object.fromEntries(DRAFTED.map((k) => [k, plain(initial, k)]));
      save(changed ? JSON.stringify({ values, bases }) : "");
      return next;
    });

  const cancel = useCallback(() => router.replace(close), [router, close]);
  useEffect(() => {
    if (result.done && !result.error) {
      clear();
      router.replace(close);
    }
  }, [result, close, router, clear]);

  // Escape closes an open menu first, then the dialog; a click outside a menu closes it. The page under the dialog
  // doesn't scroll while it's open.
  const menuRef = useRef(menu);
  useEffect(() => {
    menuRef.current = menu;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (menuRef.current) setMenu(null);
      else cancel();
    };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !(e.target as HTMLElement | null)?.closest("[data-menu]")) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      root.style.overflow = before;
    };
  }, [cancel]);
  useEffect(() => {
    if (!focusStep) return;
    (focusStep === "add" ? addInput.current : stepInputs.current.get(focusStep))?.focus();
    setFocusStep(null);
  }, [focusStep]);

  const pickDay = (date: string) => {
    change({ date });
    setMenu(null);
  };
  const toggle = (m: Menu) => setMenu(menu === m ? null : m);
  const setMode = (mode: Mode) =>
    change((cur) => ({
      mode,
      // Into "find time": a time becomes a pin only if the entry already had one; otherwise it starts loose.
      ...(mode === "auto" && cur.mode !== "auto" ? (entry.auto ? { time: entry.time ?? "", end: entry.end ?? "" } : { time: "", end: "" }) : {}),
    }));
  const pickFrom = (t: string) =>
    change((cur) => {
      if (!t) return { time: "", end: "" };
      const len = cur.time && cur.end ? toMin(cur.end) - toMin(cur.time) : 60;
      const end = Math.min(toMin(t) + len, 23 * 60 + 45);
      return { time: t, end: cur.mode === "due" ? "" : end > toMin(t) ? clockOf(end) : "" };
    });

  const kind = s.mode === "repeat" ? "check" : s.mode === "due" ? "due" : s.mode === "auto" && entry.kind === "due" ? "due" : "block";
  const stepsText = [...s.steps.map((x) => x.text), s.adding]
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n");
  const hoursNum = Number(s.hours) || 0;
  const bumpHours = (d: number) => {
    const next = Math.max(0, Math.min(200, (hoursNum || Math.max(openSteps, 1)) + d));
    change({ hours: next >= 0.5 ? String(next) : "" });
  };
  const openSteps = s.steps.filter((x) => !x.done && x.text.trim()).length + (s.adding.trim() ? 1 : 0);
  const typeNow = TYPES.find(([v]) => v === s.type) ?? TYPES[0];
  const TypeIcon = typeNow[2];
  const projectName = projects.find((p) => p.id === s.project)?.name;
  const modeHelp = MODES.find(([m]) => m === s.mode)![3];
  const needsDay = s.mode === "fixed" && !s.date;

  const addStep = (after?: string) => {
    const k = stepKey();
    change((cur) => {
      const steps = [...cur.steps];
      const at = after ? steps.findIndex((x) => x.key === after) + 1 : steps.length;
      steps.splice(at, 0, { key: k, text: "", done: false });
      return { steps };
    });
    setFocusStep(k);
  };
  const removeStep = (k: string, focusPrev = false) => {
    const at = s.steps.findIndex((x) => x.key === k);
    change((cur) => ({ steps: cur.steps.filter((x) => x.key !== k) }));
    if (focusPrev) setFocusStep(s.steps[at - 1]?.key ?? "add");
  };

  return (
    <div
      className="ef-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <form action={action} className={`ef ef-${s.mode}`} id="entry" role="dialog" aria-modal="true" aria-label={entry.id ? "Edit entry" : "New entry"}>
        {entry.id && <input type="hidden" name="id" value={entry.id} />}
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="date" value={s.mode === "repeat" ? "" : s.date} />
        <input type="hidden" name="time" value={s.mode === "repeat" ? "" : s.time} />
        <input type="hidden" name="end" value={s.mode === "repeat" || s.mode === "due" ? "" : s.end} />
        <input type="hidden" name="cadence" value={s.mode === "repeat" ? s.cadence : ""} />
        <input type="hidden" name="project" value={s.project} />
        <input type="hidden" name="type" value={s.type} />
        <input type="hidden" name="steps" value={stepsText} />
        {s.mode === "auto" && <input type="hidden" name="auto" value="on" />}
        {s.mode === "auto" && s.spread && <input type="hidden" name="spread" value="on" />}
        <input type="hidden" name="hours" value={s.mode === "auto" ? s.hours : ""} />

        <header className="ef-head">
          <span>{entry.id ? "Edit" : "New"}</span>
          <button type="button" className="ef-x" onClick={cancel} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <input
          className="ef-title"
          name="title"
          value={s.title}
          onChange={(e) => change({ title: e.target.value })}
          placeholder="What needs doing?"
          required
          maxLength={120}
          autoFocus={!entry.id}
          autoComplete="off"
          aria-label="Title"
        />

        <div className="ef-modes" role="radiogroup" aria-label="How it goes on the calendar">
          {MODES.map(([m, label, Icon]) => (
            <button key={m} type="button" role="radio" aria-checked={s.mode === m} className={s.mode === m ? "is-on" : ""} onClick={() => setMode(m)}>
              <Icon size={14} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
        <p className="ef-help">{modeHelp}</p>

        {s.mode !== "repeat" ? (
          <div className="ef-when">
            <Anchor open={menu === "day"}>
              <button type="button" className={`ef-pill ef-pill-day ${needsDay ? "is-needed" : ""}`} aria-expanded={menu === "day"} onClick={() => toggle("day")}>
                <span className="ef-pill-k">{s.mode === "auto" ? "Start" : s.mode === "due" ? "Due" : "Day"}</span>
                {s.date ? dayWords(s.date) : s.mode === "auto" ? "Today" : s.mode === "due" ? "No day yet" : "Pick a day"}
                <ChevronDown size={14} />
              </button>
              {menu === "day" && (
                <div className="ef-pop ef-pop-day">
                  <MonthPicker
                    value={s.date || null}
                    onPick={(d) => {
                      change({ date: d });
                      setMenu(null);
                    }}
                  />
                  <div className="ef-pop-foot">
                    <button type="button" onClick={() => pickDay(localToday())}>
                      Today
                    </button>
                    <button type="button" onClick={() => pickDay(addDay(localToday(), 1))}>
                      Tomorrow
                    </button>
                    {s.mode !== "fixed" && s.date && (
                      <button type="button" onClick={() => pickDay("")}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Anchor>

            {(s.mode === "fixed" || s.mode === "due") && (
              <span className="ef-times">
                <Anchor open={menu === "from"}>
                  <button type="button" className={`ef-pill ${s.time ? "" : "is-quiet"}`} aria-expanded={menu === "from"} onClick={() => toggle("from")}>
                    <Clock size={14} />
                    {s.time ? `${s.mode === "due" ? "by " : ""}${time12(s.time)}` : "Add a time"}
                  </button>
                  {menu === "from" && (
                    <TimeList
                      value={s.time}
                      onPick={(t) => {
                        pickFrom(t);
                        setMenu(null);
                      }}
                      items={[["", s.mode === "due" ? "Any time that day" : "No time (all day)"], ...QUARTERS.map((q): [string, string] => [q, time12(q)])]}
                      fallback="09:00"
                    />
                  )}
                </Anchor>
                {s.mode === "fixed" && s.time && (
                  <>
                    <span className="ef-dash">–</span>
                    <Anchor open={menu === "to"}>
                      <button type="button" className={`ef-pill ${s.end ? "" : "is-quiet"}`} aria-expanded={menu === "to"} onClick={() => toggle("to")}>
                        {s.end ? time12(s.end) : "End"}
                      </button>
                      {menu === "to" && (
                        <TimeList
                          value={s.end}
                          onPick={(t) => {
                            change({ end: t });
                            setMenu(null);
                          }}
                          items={[
                            ["", "No end"],
                            ...QUARTERS.filter((q) => toMin(q) > toMin(s.time)).map((q): [string, string] => [q, `${time12(q)}  ·  ${span(toMin(q) - toMin(s.time))}`]),
                          ]}
                          fallback={s.time}
                        />
                      )}
                    </Anchor>
                    <button type="button" className="ef-clear" aria-label="Remove the time" title="Remove the time" onClick={() => pickFrom("")}>
                      <X size={13} />
                    </button>
                  </>
                )}
                {s.mode === "due" && s.time && (
                  <button type="button" className="ef-clear" aria-label="Remove the time" title="Remove the time" onClick={() => pickFrom("")}>
                    <X size={13} />
                  </button>
                )}
              </span>
            )}

            {s.mode === "auto" && (
              <span className="ef-stepper" aria-label="How much work">
                <span className="ef-pill-k">Work</span>
                <button type="button" onClick={() => bumpHours(-0.5)} aria-label="Less time" disabled={hoursNum === 0.5}>
                  <Minus size={13} />
                </button>
                <output>{hoursNum ? hoursWords(hoursNum) : `${Math.max(openSteps, 1)} hr${openSteps > 1 ? "s" : ""}`}</output>
                <button type="button" onClick={() => bumpHours(0.5)} aria-label="More time">
                  <Plus size={13} />
                </button>
                <span className="ef-stepper-note">{hoursNum ? (s.steps.length > 1 ? "shared by the steps" : "") : "an hour a step"}</span>
                {hoursNum > 0 && (
                  <button type="button" className="ef-link" onClick={() => change({ hours: "" })}>
                    Reset
                  </button>
                )}
              </span>
            )}
          </div>
        ) : (
          <div className="ef-chips" role="radiogroup" aria-label="How often">
            {CADENCES.map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={s.cadence === v} className={`ef-chip ${s.cadence === v ? "is-on" : ""}`} onClick={() => change({ cadence: v })}>
                {label}
              </button>
            ))}
          </div>
        )}

        {s.mode === "auto" && (
          <div className="ef-auto-extra">
            <button type="button" role="switch" aria-checked={s.spread} className="ef-switch" onClick={() => change({ spread: !s.spread })}>
              <span className="ef-switch-track">
                <i />
              </span>
              <span>
                <b>A step a day</b>
                <small>At most one step’s time each day, for work that gets sloppy in one sitting.</small>
              </span>
            </button>
            {s.time && (
              <p className="ef-pin">
                Held at {time12(s.time)}
                {s.end ? `–${time12(s.end)}` : ""} on {s.date ? shortDay(s.date) : "its day"}; suggested again if not done.{" "}
                <button type="button" className="ef-link" onClick={() => change({ time: "", end: "" })}>
                  Let it move
                </button>
              </p>
            )}
          </div>
        )}

        <div className="ef-tags">
          <Anchor open={menu === "project"}>
            <button type="button" className={`ef-chip ef-chip-menu ${s.project ? "is-set" : ""}`} aria-expanded={menu === "project"} onClick={() => toggle("project")}>
              <Folder size={13} />
              {projectName ?? "No project"}
              <ChevronDown size={13} />
            </button>
            {menu === "project" && (
              <Options
                value={s.project}
                items={[["", "No project", null], ...projects.map((p): [string, string, null] => [p.id, p.name, null])]}
                onPick={(v) => {
                  change({ project: v });
                  setMenu(null);
                }}
              />
            )}
          </Anchor>
          <Anchor open={menu === "type"}>
            <button type="button" className={`ef-chip ef-chip-menu ${s.type ? "is-set" : ""}`} aria-expanded={menu === "type"} onClick={() => toggle("type")}>
              {TypeIcon ? <TypeIcon size={13} className={`cal-type cal-type-${s.type}`} /> : <Tag size={13} />}
              {s.type ? typeNow[1] : "Type: from the project"}
              <ChevronDown size={13} />
            </button>
            {menu === "type" && (
              <Options
                value={s.type}
                items={TYPES}
                onPick={(v) => {
                  change({ type: v });
                  setMenu(null);
                }}
              />
            )}
          </Anchor>
        </div>

        <section className="ef-steps" aria-label="Steps">
          <h3>
            Steps
            {s.steps.length > 0 && (
              <span>
                {s.steps.filter((x) => x.done).length} of {s.steps.length} done
              </span>
            )}
          </h3>
          <ul>
            {s.steps.map((x) => (
              <li key={x.key} className={x.done ? "is-done" : ""}>
                <span className="ef-step-dot" title={x.done ? "Done (tick steps on the card)" : "Not done yet"}>
                  {x.done && <Check size={11} strokeWidth={3} />}
                </span>
                <input
                  ref={(el) => {
                    if (el) stepInputs.current.set(x.key, el);
                    else stepInputs.current.delete(x.key);
                  }}
                  value={x.text}
                  maxLength={200}
                  aria-label="Step"
                  onChange={(e) => change((cur) => ({ steps: cur.steps.map((y) => (y.key === x.key ? { ...y, text: e.target.value } : y)) }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addStep(x.key);
                    } else if (e.key === "Backspace" && !x.text) {
                      e.preventDefault();
                      removeStep(x.key, true);
                    }
                  }}
                />
                <button type="button" className="ef-step-x" aria-label={`Remove step ${x.text}`} onClick={() => removeStep(x.key)}>
                  <X size={13} />
                </button>
              </li>
            ))}
            <li className="ef-step-add">
              <Plus size={14} />
              <input
                ref={addInput}
                value={s.adding}
                maxLength={200}
                placeholder={s.steps.length ? "Add a step" : "Break it into steps (optional)"}
                aria-label="Add a step"
                onChange={(e) => change({ adding: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (!s.adding.trim()) return;
                    change((cur) => ({ steps: [...cur.steps, { key: stepKey(), text: cur.adding.trim(), done: false }], adding: "" }));
                  }
                }}
              />
            </li>
          </ul>
        </section>

        <div className="ef-extra">
          <label className="ef-line">
            <MapPin size={14} />
            <input name="about" value={s.about} onChange={(e) => change({ about: e.target.value })} placeholder="Where, or for whom" maxLength={120} autoComplete="off" />
          </label>
          <label className="ef-line ef-line-note">
            <StickyNote size={14} />
            <textarea name="note" value={s.note} onChange={(e) => change({ note: e.target.value })} placeholder="Note" rows={s.note ? 3 : 1} maxLength={1000} />
          </label>
        </div>

        <footer className="ef-foot">
          {entry.id ? <RemoveEntry id={entry.id} /> : <span className="ef-keys">Enter saves · Esc closes</span>}
          {result.error && <span className="form-error">{result.error}</span>}
          <span className="ef-foot-end">
            <button type="button" className="button secondary" onClick={cancel}>
              Cancel
            </button>
            <button className="button primary" disabled={pending || !s.title.trim() || needsDay} title={needsDay ? "Pick a day first" : undefined}>
              {pending ? "Saving…" : entry.id ? "Save" : "Add"}
            </button>
          </span>
        </footer>
      </form>
    </div>
  );
}

const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function Anchor({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <span className={`ef-anchor ${open ? "is-open" : ""}`} data-menu>
      {children}
    </span>
  );
}

// A list of quarter hours that opens scrolled to the current choice (or `fallback` when there is none).
function TimeList({ value, items, onPick, fallback }: { value: string; items: [string, string][]; onPick: (v: string) => void; fallback: string }) {
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = list.current;
    const on = el?.querySelector<HTMLElement>(`[data-v="${value || fallback}"]`) ?? el?.querySelector<HTMLElement>("[data-v]:not([data-v=''])");
    if (el && on) el.scrollTop = on.offsetTop - el.clientHeight / 2 + on.offsetHeight / 2;
  }, [value, fallback]);
  return (
    <div className="ef-pop ef-pop-list" ref={list} role="listbox">
      {items.map(([v, label]) => (
        <button key={v || "none"} type="button" role="option" aria-selected={v === value} data-v={v} className={`${v === value ? "is-on" : ""} ${v ? "" : "is-none"}`} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Options({ value, items, onPick }: { value: string; items: [string, string, LucideIcon | null][]; onPick: (v: string) => void }) {
  return (
    <div className="ef-pop ef-pop-list ef-pop-options" role="listbox">
      {items.map(([v, label, Icon]) => (
        <button key={v || "none"} type="button" role="option" aria-selected={v === value} className={v === value ? "is-on" : ""} onClick={() => onPick(v)}>
          {Icon ? <Icon size={14} className={`cal-type cal-type-${v}`} /> : <span className="ef-opt-gap" />}
          {label}
          {v === value && <Check size={13} className="ef-opt-check" />}
        </button>
      ))}
    </div>
  );
}
