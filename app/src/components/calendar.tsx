"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeCadence, deleteEntry, markCheckDone, markEntryDone, moveEntry, saveWorkday, setStep } from "@/app/calendar/actions";
import { sendChat } from "@/app/dock/actions";
import { useDraft } from "@/lib/use-draft";
import { isModel, type Model } from "@/lib/models";

// The clicks on /calendar: tick a step, mark a check done, set how often a check comes round, add or edit an entry,
// remove one, and hand loose words to the chat agent (tools/calendar.py is how it writes).
export function CalendarStepCheck({ entry, step, done, text }: { entry: string; step: string; done: boolean; text: string }) {
  const [on, setOn] = useState(done);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => setOn(done), [done]);
  return (
    <span className="step-check">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        aria-label={`${on ? "Done" : "Not done"}: ${text}`}
        onChange={(e) => {
          const value = e.target.checked;
          setOn(value);
          setError("");
          start(async () => {
            const result = await setStep(entry, step, value);
            if (result.error) {
              setOn(!value);
              setError(result.error);
            }
          });
        }}
      />
      {error && <span className="form-error">{error}</span>}
    </span>
  );
}

export function CheckDone({ id }: { id: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="cal-action">
      <button
        type="button"
        className="button secondary small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const result = await markCheckDone(id);
            if (result.error) setError(result.error);
          })
        }
      >
        {pending ? "Saving…" : "Done"}
      </button>
      {error && <span className="form-error">{error}</span>}
    </span>
  );
}

// A due or planned entry, done or back open. Ticked steps stay as they are.
export function EntryDone({ id, done }: { id: string; done: boolean }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="cal-action">
      <button
        type="button"
        className={`button ${done ? "secondary" : "primary"} small`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const result = await markEntryDone(id, !done);
            if (result.error) setError(result.error);
          })
        }
      >
        {pending ? "Saving…" : done ? "Reopen" : "Mark done"}
      </button>
      {error && <span className="form-error">{error}</span>}
    </span>
  );
}

// Drag an entry to another day, a time, or in front of another card. Items carry `data-drag-id`, days
// `data-drop-day`; a day's top row adds `data-drop-untimed`, an hour column `data-drop-h0` (its first hour) and
// `data-drop-px` (pixels a minute) so the drop point becomes a time, snapped to 15 minutes. One listener on the
// document serves the week and month grids alike, so they stay server-rendered. Mouse only (no touch drag in browsers).
export function DragToDay() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    let id: string | null = null;
    let length = 60;
    let over: HTMLElement | null = null;
    // Over an hour column: a box where the card would land, as long as it would run, labelled with the times.
    const ghost = document.createElement("div");
    Object.assign(ghost.style, {
      position: "absolute", left: "2px", right: "2px", zIndex: "5", pointerEvents: "none", boxSizing: "border-box",
      border: "1.5px dashed var(--accent)", borderRadius: "6px", padding: "2px 6px", fontSize: "12px", fontWeight: "500",
      color: "var(--text)", background: "color-mix(in srgb, var(--accent) 18%, transparent)",
    });
    const label = (m: number) => `${Math.floor(m / 60) % 12 || 12}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}${m < 720 ? "am" : "pm"}`;
    const dayAt = (e: Event) => (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-drop-day]") ?? null;
    const timeAt = (col: HTMLElement, y: number) => {
      const m = Number(col.dataset.dropH0) * 60 + (y - col.getBoundingClientRect().top) / Number(col.dataset.dropPx);
      return Math.max(0, Math.min(23 * 60 + 45, Math.round(m / 15) * 15));
    };
    const mark = (el: HTMLElement | null, y = 0) => {
      if (over && over !== el) over.style.outline = "";
      over = el;
      if (el?.dataset.dropH0 && el.dataset.dropPx) {
        const q = timeAt(el, y);
        const px = Number(el.dataset.dropPx);
        Object.assign(ghost.style, { top: `${(q - Number(el.dataset.dropH0) * 60) * px}px`, height: `${Math.max(length, 15) * px}px` });
        ghost.textContent = `${label(q)}–${label(Math.min(q + length, 24 * 60 - 15))}`;
        if (ghost.parentElement !== el) el.appendChild(ghost);
        return;
      }
      ghost.remove();
      if (el) el.style.outline = "2px dashed var(--accent)";
    };
    const onStart = (e: DragEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-drag-id]");
      if (!el?.dataset.dragId) return;
      id = el.dataset.dragId;
      length = Number(el.dataset.dragMin) || 60;
      e.dataTransfer?.setData("text/plain", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    const onOver = (e: DragEvent) => {
      if (!id) return;
      const day = dayAt(e);
      if (day) e.preventDefault();
      // Over a card on the hour grid, the card is the target (it goes in front), so no time preview.
      const onCard = (e.target as HTMLElement | null)?.closest("[data-drag-id]");
      if (day?.dataset.dropH0 && onCard) {
        mark(null);
        day.style.outline = "2px dashed var(--accent)";
        over = day;
      } else mark(day, e.clientY);
    };
    const onDrop = (e: DragEvent) => {
      const target = dayAt(e);
      const day = target?.dataset.dropDay;
      const moving = id;
      id = null;
      mark(null);
      if (!moving || !target || !day) return;
      e.preventDefault();
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-drag-id]")?.dataset.dragId;
      const before = card && card !== moving ? card : undefined;
      let time: string | null | undefined;
      if ("dropUntimed" in target.dataset) time = before ? undefined : null;
      else if (target.dataset.dropH0 && target.dataset.dropPx && !before) {
        const q = timeAt(target, e.clientY);
        time = `${String(Math.floor(q / 60)).padStart(2, "0")}:${String(q % 60).padStart(2, "0")}`;
      }
      setError("");
      start(async () => {
        const r = await moveEntry(moving, day, time, before);
        if (r.error) setError(r.error);
        router.refresh();
      });
    };
    const onEnd = () => {
      id = null;
      mark(null);
    };
    document.addEventListener("dragstart", onStart);
    document.addEventListener("dragover", onOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragend", onEnd);
    return () => {
      ghost.remove();
      document.removeEventListener("dragstart", onStart);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", onEnd);
    };
  }, [router]);
  if (!error && !pending) return null;
  return <p className={error ? "form-error" : "cal-note"}>{error || "Moving…"}</p>;
}

// The day an entry is on, as a button that opens a small month right under it; a click on a day moves it there
// ("clicking on date opens a tiny dropdown menu style but centered calendar coming from the date", 2026-10-24).
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12)).toISOString().slice(0, 10);
export const localToday = () => {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth(), t.getDate());
};
export function DatePick({ id, date, label }: { id: string; date: string | null; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const pick = (d: string) =>
    start(async () => {
      setError("");
      const r = await moveEntry(id, d);
      if (r.error) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  return (
    <div className="cal-date">
      <button type="button" className="cal-date-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {pending ? "Moving…" : label}
      </button>
      {open && (
        <div className="cal-pick" role="dialog" aria-label="Pick a day">
          <MonthPicker value={date} onPick={pick} disabled={pending} />
          {error && <span className="form-error">{error}</span>}
        </div>
      )}
    </div>
  );
}

// A small month, Monday first: today ringed, `value` filled. Used by DatePick and the entry form's day.
export function MonthPicker({ value, onPick, disabled }: { value: string | null; onPick: (d: string) => void; disabled?: boolean }) {
  const [month, setMonth] = useState(() => (value ?? localToday()).slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1, 12));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const cells = Array.from({ length: 42 }, (_, k) => iso(y, m - 1, 1 + k - lead));
  const today = localToday();
  const shift = (n: number) => setMonth(iso(y, m - 1 + n, 1).slice(0, 7));
  return (
    <>
      <div className="cal-pick-head">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <b>{first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</b>
        <button type="button" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="cal-pick-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, k) => (
          <span key={k}>{d}</span>
        ))}
        {cells.slice(0, cells[35].slice(0, 7) === month ? 42 : 35).map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            className={[d === value && "is-on", d === today && "is-today", d.slice(0, 7) !== month && "is-other"].filter(Boolean).join(" ")}
            onClick={() => onPick(d)}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </>
  );
}

// the owner's working hours, in the bar: when the day starts and finishes, and which days they work. The week grid shows
// these hours and suggested work goes inside them.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function WorkHours({ start, end, days, label }: { start: string; end: string; days: number[]; label: string }) {
  const [state, action, pending] = useActionState(saveWorkday, {});
  const box = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (state.done && box.current) box.current.open = false;
  }, [state]);
  return (
    <details className="cal-hours" ref={box}>
      <summary title="Working hours">Hours · {label}</summary>
      <form action={action} className="cal-hours-form">
        <label className="cal-f">
          <span>Start</span>
          <input type="time" name="start" defaultValue={start} step={900} required data-draft="off" />
        </label>
        <label className="cal-f">
          <span>Finish</span>
          <input type="time" name="end" defaultValue={end} step={900} required data-draft="off" />
        </label>
        <fieldset className="cal-hours-days">
          <legend>Days</legend>
          {DOW.map((d, k) => (
            <label key={d}>
              <input type="checkbox" name="days" value={k} defaultChecked={days.includes(k)} />
              {d}
            </label>
          ))}
        </fieldset>
        <span className="cal-f-actions">
          <button className="button primary small" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          {state.error && <span className="form-error">{state.error}</span>}
        </span>
      </form>
    </details>
  );
}

export function CadencePicker({ id, value }: { id: string; value: string | null }) {
  const [current, setCurrent] = useState(value ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => setCurrent(value ?? ""), [value]);
  return (
    <span className="cal-action fbar-select">
      <select
        aria-label="How often"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const before = current;
          setCurrent(next);
          setError("");
          start(async () => {
            const result = await changeCadence(id, next);
            if (result.error) {
              setCurrent(before);
              setError(result.error);
            }
          });
        }}
      >
        <option value="">How often?</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="quarterly">Quarterly</option>
      </select>
      {error && <span className="form-error">{error}</span>}
    </span>
  );
}

// Two clicks to remove: the first asks, the second does it.
export function RemoveEntry({ id }: { id: string }) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="cal-action">
      <button
        type="button"
        className={`button secondary small cal-remove ${sure ? "is-sure" : ""}`}
        disabled={pending}
        onBlur={() => setSure(false)}
        onClick={() =>
          sure
            ? start(async () => {
                const r = await deleteEntry(id);
                if (r.error) setError(r.error);
              })
            : setSure(true)
        }
      >
        {pending ? "Removing…" : sure ? "Remove it" : "Remove"}
      </button>
      {error && <span className="form-error">{error}</span>}
    </span>
  );
}

// Loose words for the chat agent ("dentist sometime in November", "find me two hours for FinanceApp this weekend").
// It goes to the parent company's chat with this page as context; the agent answers there and writes through
// tools/calendar.py, so the dock opens to follow it.
// A cheap model by default: scheduling and adding entries don't need a big one (the owner, 2026-10-24). The choice is
// converse.py's --model, so it sticks to this chat until changed.
const ASK_MODELS: [Model, string][] = [
  ["haiku", "Haiku · quick, for scheduling"],
  ["sonnet", "Sonnet · more thought"],
  ["opus", "Opus · planning"],
];
export function AskAgent({ url }: { url: string }) {
  const [text, setText, clear] = useDraft("calendar-ask", "");
  const [model, setModel] = useDraft("calendar-ask-model", "haiku");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      setError("");
      const fd = new FormData();
      fd.set("url", url);
      fd.set("title", "Calendar");
      fd.set("body", text.trim());
      if (isModel(model)) fd.set("model", model);
      const r = await sendChat(fd);
      if (r.error) return setError(r.error);
      clear();
      setText("");
      setSent(true);
      window.dispatchEvent(new Event("dock:open"));
    });
  return (
    <form
      className="cal-ask"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) send();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter is a new line.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (text.trim() && !pending) send();
          }
        }}
        placeholder={"Tell the calendar agent anything: “move the weddings to next week”, “dentist sometime in November”, “add a shoot with Lucas Friday 2–5”, or paste a whole list of things to plan."}
        aria-label="Ask the calendar agent"
        maxLength={5000}
        data-draft="off"
      />
      <div className="cal-ask-foot">
        <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
          {ASK_MODELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <span className="cal-ask-hints">
          {error ? (
            <span className="form-error">{error}</span>
          ) : sent ? (
            <span>Sent. The answer comes in the chat, usually within a minute.</span>
          ) : (
            <span>Enter to send · Shift+Enter, new line</span>
          )}
        </span>
        <button className="button primary small" disabled={pending || !text.trim()}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
