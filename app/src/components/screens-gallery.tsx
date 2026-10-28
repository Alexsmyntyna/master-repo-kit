"use client";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { addNote, resolveNote, startScreens, type ScreensState } from "@/app/screens/actions";
import type { Captured, Note, Surface } from "@/lib/screens";
import { useFormDraft } from "@/lib/use-draft";
import { Chips, Empty, FilterBar, SearchBox, Source, Tag, type Tone } from "./ds";

type Props = {
  slug: string;
  features: { id: string; title: string; surfaces: Surface[] }[];
  latest: Record<string, Captured>;
  notes: Note[];
};
const img = (slug: string, file: string) =>
  `/screens/image?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`;
const frameOrder = (a: string, b: string) => {
  const rank = (p: string) => (p === "top" ? 0 : p === "bottom" ? 2 : 1);
  return rank(a) - rank(b) || a.localeCompare(b);
};
type Filter = "all" | "captured" | "missing" | "notes";
const filterLabels: Record<Filter, string> = { all: "All", captured: "Captured", missing: "Not captured", notes: "Open notes" };
const severityLabel: Record<string, string> = { issue: "Issue", "needs-evaluation": "Needs a look", suggestion: "Suggestion" };
const severityTone: Record<string, Tone> = { issue: "risk", "needs-evaluation": "attention", suggestion: "idle" };

function Feedback({ state }: { state: ScreensState }) {
  return (
    <>
      {state.error && <span className="form-error">{state.error}</span>}
      {state.done && <span className="form-done">{state.done}</span>}
    </>
  );
}

export function ScreensTask({ slug, task, surface, label }: { slug: string; task: string; surface?: string; label: string }) {
  const [state, action, pending] = useActionState(startScreens, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="task" value={task} />
      {surface && <input type="hidden" name="surface" value={surface} />}
      <button className="button secondary" disabled={pending}>
        {pending ? "Starting…" : label}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function NoteForm({ slug, surface, capture }: { slug: string; surface: string; capture?: string }) {
  const [state, action, pending] = useActionState(addNote, {});
  const draft = useFormDraft(`note:${surface}`, { result: state });
  return (
    <form ref={draft.ref} action={action} className="sg-form" key={surface}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="surface" value={surface} />
      {capture && <input type="hidden" name="capture" value={capture} />}
      <div className="choice-row">
        {(["issue", "needs-evaluation", "suggestion"] as const).map((s, i) => (
          <label key={s} className="choice-pill">
            <input type="radio" name="severity" value={s} defaultChecked={i === 0} />
            {severityLabel[s]}
          </label>
        ))}
      </div>
      <textarea name="text" rows={3} maxLength={2000} placeholder="What's wrong" />
      <div className="form-foot">
        <Feedback state={state} />
        <button className="button primary" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </button>
      </div>
    </form>
  );
}

function ResolveButton({ slug, note }: { slug: string; note: string }) {
  const [state, action, pending] = useActionState(resolveNote, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="note" value={note} />
      <button className="text-button" disabled={pending}>{pending ? "…" : "Resolve"}</button>
      <Feedback state={state} />
    </form>
  );
}

function Review({
  slug,
  surface,
  captured,
  notes,
  onClose,
  onMove,
}: {
  slug: string;
  surface: Surface;
  captured?: Captured;
  notes: Note[];
  onClose: () => void;
  onMove: (step: number) => void;
}) {
  const positions = captured ? Object.keys(captured.frames).sort(frameOrder) : [];
  const [position, setPosition] = useState(positions[0]);
  const frame = captured && position ? captured.frames[position] : undefined;
  useEffect(() => setPosition(positions[0]), [surface.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onMove(1);
      if (e.key === "ArrowLeft") onMove(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, onMove]);
  return (
    <div className="sg-backdrop" onClick={onClose}>
      <div className="sg-dialog" role="dialog" aria-label={surface.title} onClick={(e) => e.stopPropagation()}>
        <div className="sg-image">
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img(slug, frame.image)} alt={`${surface.title}, ${position}`} />
          ) : (
            <div className="sg-nocap">
              <ImageOff size={28} />
              <p>Not captured</p>
              {surface.gap && <small>{surface.gap}</small>}
            </div>
          )}
          {positions.length > 1 && (
            <div className="sg-frames">
              {positions.map((p) => (
                <button key={p} className={p === position ? "is-on" : ""} onClick={() => setPosition(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="sg-side">
          <div className="sg-head">
            <button className="icon-button" onClick={() => onMove(-1)} aria-label="Previous screen"><ChevronLeft size={18} /></button>
            <button className="icon-button" onClick={() => onMove(1)} aria-label="Next screen"><ChevronRight size={18} /></button>
            <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
          <p className="sg-kicker">{surface.featureTitle}</p>
          <h2>{surface.title}</h2>
          <p className="sg-path">
            <span className="code-text">{surface.id}</span>
            {surface.route && <span className="code-text">{surface.route}</span>}
          </p>
          {frame && (
            <p className="sg-facts">
              <span className="code-text">{frame.run}</span>
              <span>{new Date(frame.finished).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              {Object.values(frame.config).map((v) => (
                <span key={v}>{v}</span>
              ))}
            </p>
          )}
          {surface.states.length > 0 && (
            <details className="fold">
              <summary>{surface.states.length} states to cover</summary>
              <div className="fold-body sg-states">
                <ul>{surface.states.map((s) => <li key={s}>{s}</li>)}</ul>
                {surface.gap && <p>{surface.gap}</p>}
              </div>
            </details>
          )}
          <div className="sg-actions">
            <ScreensTask slug={slug} task="capture" surface={surface.id} label="Capture" />
            {captured && <ScreensTask slug={slug} task="analyze" surface={surface.id} label="Review" />}
          </div>
          <h3>Notes</h3>
          {notes.length ? (
            <div className="sg-notes">
              {notes.map((n) => {
                const first = n.revisions[0],
                  last = n.revisions.at(-1)!;
                return (
                  <div key={n.id} className={`sg-note ${n.status === "resolved" ? "is-resolved" : ""}`}>
                    <div className="sg-note-head">
                      <Tag tone={severityTone[n.severity]}>{severityLabel[n.severity]}</Tag>
                      <Source who={first.author.split(" ")[0]} date={first.at.slice(0, 10)} />
                      {n.status === "open" ? <ResolveButton slug={slug} note={n.id} /> : <span className="sg-resolved">resolved</span>}
                    </div>
                    <p>{first.text}</p>
                    {n.status === "resolved" && last !== first && <p className="sg-resolution">↳ {last.text}</p>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="sg-none">No notes</p>
          )}
          <NoteForm slug={slug} surface={surface.id} capture={frame?.image} />
        </aside>
      </div>
    </div>
  );
}

export function ScreensGallery({ slug, features, latest, notes }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const openNotes = useMemo(() => {
    const m: Record<string, Note[]> = {};
    for (const n of notes) (m[n.surface] ||= []).push(n);
    return m;
  }, [notes]);
  const visible = features
    .map((f) => ({
      ...f,
      surfaces: f.surfaces.filter((s) => {
        const q = query.toLowerCase();
        if (q && !`${s.title} ${s.id} ${f.title}`.toLowerCase().includes(q)) return false;
        if (filter === "captured") return !!latest[s.id];
        if (filter === "missing") return !latest[s.id];
        if (filter === "notes") return (openNotes[s.id] || []).some((n) => n.status === "open");
        return true;
      }),
    }))
    .filter((f) => f.surfaces.length);
  const flat = visible.flatMap((f) => f.surfaces);
  const all = features.flatMap((f) => f.surfaces);
  const counts: Record<Filter, number> = {
    all: all.length,
    captured: all.filter((s) => latest[s.id]).length,
    missing: all.filter((s) => !latest[s.id]).length,
    notes: all.filter((s) => (openNotes[s.id] || []).some((n) => n.status === "open")).length,
  };
  const move = useCallback(
    (step: number) =>
      setOpenId((id) => {
        const i = flat.findIndex((s) => s.id === id);
        return flat[(i + step + flat.length) % flat.length]?.id ?? id;
      }),
    [flat],
  );
  const current = flat.find((s) => s.id === openId);
  return (
    <>
      <FilterBar>
        <SearchBox label="Search screens" placeholder="Search screens" value={query} onChange={setQuery} />
        <Chips<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={(["all", "captured", "missing", "notes"] as const).map((f) => ({ value: f, label: filterLabels[f], count: counts[f] }))}
        />
      </FilterBar>
      {visible.map((f) => {
        const shot = f.surfaces.filter((s) => latest[s.id]);
        const missing = f.surfaces.filter((s) => !latest[s.id]);
        return (
          <section key={f.id} className="sec sg-feature">
            <header className="sec-head">
              <h2>{f.title}</h2>
              <span className="sec-note">
                {shot.length} of {f.surfaces.length} captured
              </span>
            </header>
            {shot.length > 0 && (
              <div className="sg-grid">
                {shot.map((s) => {
                  const c = latest[s.id];
                  const top = c.frames[Object.keys(c.frames).sort(frameOrder)[0]];
                  const open = (openNotes[s.id] || []).filter((n) => n.status === "open");
                  const frames = Object.keys(c.frames).length;
                  return (
                    <button key={s.id} className="sg-card" onClick={() => setOpenId(s.id)}>
                      <span className="sg-thumb">
                        {top ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img(slug, top.image)} alt="" loading="lazy" />
                        ) : (
                          <ImageOff size={22} />
                        )}
                      </span>
                      <span className="sg-title">{s.title}</span>
                      <span className="sg-meta">
                        {frames} frame{frames > 1 ? "s" : ""}
                        {open.length > 0 && (
                          <Tag tone={open.some((n) => n.severity === "issue") ? "risk" : "attention"}>{open.length}</Tag>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {missing.length > 0 && (
              <div className="rows rows-dense sg-missing">
                {missing.map((s) => {
                  const open = (openNotes[s.id] || []).filter((n) => n.status === "open");
                  return (
                    <button key={s.id} className="row row-link" onClick={() => setOpenId(s.id)}>
                      <span className="row-lead sg-dot" aria-hidden />
                      <span className="row-body">
                        <span className="row-title">{s.title}</span>
                      </span>
                      <span className="row-trail sg-trail">
                        {s.route && <span className="code-text">{s.route}</span>}
                        {s.states.length > 0 && <span>{s.states.length} states</span>}
                        {open.length > 0 && <Tag tone={open.some((n) => n.severity === "issue") ? "risk" : "attention"}>{open.length}</Tag>}
                        <span>not captured</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {!visible.length && <Empty>No matches</Empty>}
      {current && (
        <Review
          slug={slug}
          surface={current}
          captured={latest[current.id]}
          notes={openNotes[current.id] || []}
          onClose={() => setOpenId(null)}
          onMove={move}
        />
      )}
    </>
  );
}
