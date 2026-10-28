"use client";
import { useEffect, useId, useRef, useState } from "react";
import { learnWordAction } from "@/app/spell/actions";
import { diffWords, type SpellChange } from "@/lib/spell-marks";

// Spelling fixes in the owner's words, after the fact (app/DESIGN.md, Spelling). Composers send at once (useSpellFix);
// this is where they see a fix and keeps their spelling.

type Kept = { state: "saving" | "kept" } | { state: "error"; error: string };
const key = (w: string) => w.toLowerCase();

// A stored message that carries `typed` gets a faint "2 fixed". A click opens each fix as "typed → saved as" with
// Keep, which adds the typed word to holding/dictionary.txt so it's never fixed again. The message isn't edited.
// The popover sits in the top layer (popover="auto": Esc and a click outside close it), so a scrolling list can't
// clip it; `.spell-note-tip:popover-open` tells the dock an Esc is taken.
export function SpellNote({ typed, body, fixes }: { typed?: string; body: string; fixes?: number }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState<Record<string, Kept>>({});

  // A scroll or resize elsewhere closes it, since it's placed against the button.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !pop.current?.contains(e.target as Node) && pop.current?.hidePopover();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (!typed || typed.trim() === body.trim()) return null;
  const changes = diffWords(typed.trim(), body.trim());
  const n = changes.length || fixes || 1;
  // One row per word they typed, however often it was fixed.
  const rows = changes.filter((c, i) => changes.findIndex((d) => key(d.from) === key(c.from) && d.to === c.to) === i);

  // Under the button, or above it near the bottom of the window, kept on screen. Placed roughly before it shows and
  // exactly once it has a size.
  const place = (measured: boolean) => {
    const b = button.current?.getBoundingClientRect();
    const el = pop.current;
    if (!b || !el) return;
    const { width, height } = measured ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const below = b.bottom + 6 + height <= window.innerHeight - 8;
    el.style.top = `${Math.max(8, below ? b.bottom + 6 : b.top - 6 - height)}px`;
    el.style.left = `${Math.max(8, Math.min(b.left, window.innerWidth - width - 8))}px`;
  };
  const keep = async (c: SpellChange) => {
    setKept((k) => ({ ...k, [key(c.from)]: { state: "saving" } }));
    const r = await learnWordAction(c.from).catch((e: Error) => ({ error: e?.message || "Couldn't save the word." }));
    setKept((k) => ({ ...k, [key(c.from)]: r.error ? { state: "error", error: r.error } : { state: "kept" } }));
  };

  return (
    // Inside a <summary> a click on the note's text would open or close the message, so it's cancelled. A click on a
    // button never reaches the <summary>, and must not be cancelled: it's what opens the popover.
    <span className="spell-note" onClick={(e) => !(e.target as Element).closest("button") && e.preventDefault()}>
      <button
        ref={button}
        type="button"
        className="spell-note-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        popoverTarget={id}
        title="What you typed"
      >
        {n} fixed
      </button>
      <span
        ref={pop}
        id={id}
        popover="auto"
        className="spell-note-tip"
        role="dialog"
        aria-label="Spelling fixes"
        onBeforeToggle={(e) => e.newState === "open" && place(false)}
        onToggle={(e) => {
          setOpen(e.newState === "open");
          if (e.newState === "open") place(true);
        }}
      >
        {rows.length ? (
          <>
            <span className="spell-note-head">You typed → saved as</span>
            <span className="spell-note-list" role="list">
              {rows.map((c) => {
                const k = kept[key(c.from)];
                return (
                  <span key={c.index} className="spell-note-row" role="listitem">
                    <span className="spell-note-pair">
                      <span className="spell-note-was">{c.from}</span> → {c.to}
                    </span>
                    {k?.state === "kept" ? (
                      <span className="spell-note-kept" role="status">
                        Kept
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="spell-note-keep"
                        disabled={k?.state === "saving"}
                        title={`Add “${c.from}” to holding/dictionary.txt: it's never fixed again`}
                        onClick={() => keep(c)}
                      >
                        {k?.state === "saving" ? "Keeping…" : "Keep"}
                      </button>
                    )}
                    {k?.state === "error" && (
                      <span className="spell-note-error" role="alert">
                        {k.error}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
          </>
        ) : (
          <>
            <span className="spell-note-head">You typed</span>
            <span className="spell-note-text">{typed.trim().length > 600 ? typed.trim().slice(0, 600) + "…" : typed.trim()}</span>
          </>
        )}
      </span>
    </span>
  );
}
