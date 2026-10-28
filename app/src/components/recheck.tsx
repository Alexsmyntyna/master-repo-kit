"use client";
import { startTransition, useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { startRecheck, type RecheckState } from "@/app/recheck";
import type { Recheck } from "@/lib/cards";
import "@/styles/cards.css";

// tools/recheck.py's flag on an open question, and the button that has an agent recheck it. The button works inside a
// board row's link: it stops the click from following the link.
const day = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : d;

export function RecheckButton({ item, label = "Recheck" }: { item: string; label?: string }) {
  const [state, action, pending] = useActionState<RecheckState, FormData>(startRecheck, {});
  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const form = new FormData();
    form.set("ref", item);
    startTransition(() => action(form));
  };
  return (
    <span className="recheck-act">
      <button type="button" className="button secondary small" disabled={pending || !!state.done} onClick={go}>
        <RefreshCw size={12} /> {pending ? "Starting…" : state.done || label}
      </button>
      {state.error && <span className="form-error">{state.error}</span>}
    </span>
  );
}

// "3 commits since Oct 11" and a Recheck button; "rechecking…" while the agent works; the resolved verdict on a card
// line; "rechecked Oct 24" once an agent found it still valid. `quiet` drops the rechecked note (the board rows).
export function RecheckMark({ flag, item, quiet = false }: { flag?: Recheck; item: string; quiet?: boolean }) {
  if (!flag) return null;
  if (flag.running) return <span className="recheck-mark is-running">rechecking…</span>;
  if (flag.verdict === "resolved")
    return (
      <span className="recheck-mark is-resolved" title={flag.reason || undefined}>
        resolved, per recheck {flag.rechecked && day(flag.rechecked)}
      </span>
    );
  if (flag.commits > 0)
    return (
      <span className="recheck-mark">
        <span title={`Commits in the project's repos since ${flag.since}; this may be out of date`}>
          {flag.commits} commit{flag.commits === 1 ? "" : "s"} since {day(flag.since)}
        </span>
        <RecheckButton item={item} />
      </span>
    );
  if (quiet || !flag.rechecked) return null;
  return (
    <span className="recheck-mark is-done" title={flag.reason || undefined}>
      rechecked {day(flag.rechecked)}
    </span>
  );
}
