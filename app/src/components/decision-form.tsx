"use client";
import { useActionState, useEffect, useState } from "react";
import { Check, Compass, CornerUpLeft, ListChecks } from "lucide-react";
import { decide, type ThreadState } from "@/app/threads/actions";
import { hasDraft, useDraft } from "@/lib/use-draft";
import type { Card, Level } from "@/lib/decisions";
import { useSpellFix } from "@/lib/use-spell-fix";
import "@/styles/decisions.css";

const levelText: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };

// Three pips: how much of something an option carries. `good` flips the colour, since high growth is
// what you want and high complexity isn't.
function Pips({ value, good }: { value: Level | null; good?: boolean }) {
  if (!value) return <span className="muted">—</span>;
  const n = value === "low" ? 1 : value === "medium" ? 2 : 3;
  return (
    <span className={`pips pips-${good ? "good" : "cost"}-${n}`} title={levelText[value]}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} />
      ))}
      <span>{levelText[value]}</span>
    </span>
  );
}

function TimeBar({ time, weeks, max }: { time: string; weeks: number | null; max: number }) {
  if (!time) return <span className="muted">—</span>;
  return (
    <span className="time-cell">
      {weeks !== null && max > 0 && (
        <span className="time-bar" aria-hidden="true">
          <i style={{ width: `${Math.max(6, (weeks / max) * 100)}%` }} />
        </span>
      )}
      <span>{time}</span>
    </span>
  );
}

export function DecisionForm({
  scope,
  id,
  card,
  isDecision,
  from,
  steer = true,
}: {
  steer?: boolean; // false on the thread page, where the composer below is the place to change direction
  scope: string;
  id: string;
  card?: Card;
  isDecision: boolean;
  from: string;
}) {
  const [state, action, pending] = useActionState<ThreadState, FormData>(decide, {});
  const max = Math.max(0, ...(card?.options.map((o) => o.weeks || 0) || []));
  const who = from.toUpperCase();
  // The steer box is a draft per decision (it shows on /decisions and on the thread); none where it's hidden.
  const draftKey = steer ? `draft:decision:${scope}/${id}:note` : null;
  const [text, setText, clearDraft] = useDraft("note", "", { key: draftKey });
  const spell = useSpellFix(); // the note goes through the spelling fixer before it's sent
  const asking = !isDecision && !card; // a question: the answer box is the main action, always open
  const [steering, setSteering] = useState(asking);
  useEffect(() => {
    if (hasDraft(draftKey)) setSteering(true); // words from before a reload: open the box they're in
  }, [draftKey]);
  useEffect(() => {
    if (state.done) clearDraft();
  }, [state, clearDraft]);
  const typed = text.trim().length > 0;
  const setIntent = (e: React.MouseEvent<HTMLButtonElement>, value: string) => {
    const intent = e.currentTarget.form?.elements.namedItem("intent") as HTMLInputElement | null;
    if (intent) intent.value = value;
  };
  // Changing direction is its own action: it never approves, and needn't be one of the options. A text link, so the
  // buttons stay the two real choices.
  const steerOpen = steer && !steering && (
    <button type="button" className="steer-open" onClick={() => setSteering(true)}>
      Something else
    </button>
  );
  if (state.done) return <p className="form-done decision-done">{state.done}</p>;
  return (
    <form action={action} className="decision-form" onSubmit={(e) => spell.intercept(e, ["note"])}>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="id" value={id} />
      {card && (
        <div className="tradeoffs" role="table" aria-label="Options and their trade-offs">
          <div className="tradeoff-row tradeoff-head" role="row">
            <span role="columnheader">Option</span>
            <span role="columnheader">Time</span>
            <span role="columnheader">Complexity</span>
            <span role="columnheader">Growth</span>
            <span role="columnheader">Cost</span>
            <span role="columnheader" className="sr-only">
              Choose
            </span>
          </div>
          {card.options.map((o) => (
            <div key={o.key} className={`tradeoff-row ${o.recommended ? "is-recommended" : ""}`} role="row">
              <span role="cell" className="tradeoff-option">
                <b className="option-key">{o.key}</b>
                <span>
                  {o.label}
                  {o.recommended && <small className="recommended-tag">{who} recommends</small>}
                </span>
              </span>
              <span role="cell" data-label="Time">
                <TimeBar time={o.time} weeks={o.weeks} max={max} />
              </span>
              <span role="cell" data-label="Complexity">
                <Pips value={o.complexity} />
              </span>
              <span role="cell" data-label="Growth">
                <Pips value={o.growth} good />
              </span>
              <span role="cell" data-label="Costs" className="tradeoff-costs">
                {o.costs || <span className="muted">—</span>}
              </span>
              <span role="cell">
                <button
                  className={`button ${o.recommended ? "primary" : "secondary"}`}
                  name="choice"
                  value={`${o.key}: ${o.label}`}
                  onClick={(e) => setIntent(e, o.recommended && isDecision ? "approve" : "redirect")}
                  disabled={pending}
                  title={o.recommended && isDecision ? "Approve this decision" : `Send it back to the ${who} to replan around ${o.key}`}
                >
                  {o.recommended && isDecision ? <Check size={15} /> : <CornerUpLeft size={15} />}
                  {o.key}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <input type="hidden" name="intent" defaultValue={isDecision ? "approve" : "answer"} />
      {!card && isDecision && (
        <div className="decision-actions">
          <button className="button primary" disabled={pending} onClick={(e) => setIntent(e, "approve")}>
            <Check size={15} /> {typed ? "Approve with note" : "Approve"}
          </button>
          <button
            className="button secondary"
            disabled={pending}
            title={`Ask the ${who} to restate this as options with time, complexity and growth`}
            onClick={(e) => setIntent(e, "card")}
          >
            <ListChecks size={15} /> Trade-offs
          </button>
          {steerOpen}
        </div>
      )}
      {(card || !isDecision) && steerOpen}
      {steer && steering && (
      <div className="steer">
        <label className="steer-label" htmlFor={`steer-${id}`}>
          {isDecision || card ? "New direction" : "Your answer"}
        </label>
        <textarea
          id={`steer-${id}`}
          name="note"
          rows={typed ? 4 : 3}
          autoFocus={!asking}
          maxLength={2000}
          spellCheck
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            isDecision || card
              ? "What you want instead"
              : "Your answer"
          }
        />
        <div className="decision-actions">
          {isDecision || card ? (
            <button className="button primary" disabled={pending || !typed} onClick={(e) => setIntent(e, "steer")}>
              <Compass size={15} /> Send
            </button>
          ) : (
            <>
              <button className="button primary" disabled={pending || !typed} onClick={(e) => setIntent(e, "answer")}>
                <CornerUpLeft size={15} /> Answer
              </button>
              <button className="button secondary" disabled={pending || !typed} onClick={(e) => setIntent(e, "steer")}>
                <Compass size={15} /> Send as direction
              </button>
            </>
          )}
          {!card && !isDecision && (
            <button
              className="button secondary"
              disabled={pending}
              title={`Ask the ${who} to restate this as options with time, complexity and growth`}
              onClick={(e) => setIntent(e, "card")}
            >
              <ListChecks size={15} /> Trade-offs
            </button>
          )}
          {typed && (isDecision || card) && <span className="side-hint">Sent as the note with an option</span>}
        </div>
      </div>
      )}
      {pending && <span className="side-hint">Working…</span>}
      {state.error && <span className="form-error">{state.error}</span>}
    </form>
  );
}
