"use client";
import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { saveGoals, saveProducts, setStepDone, type MoneyState } from "@/app/company/actions";
import { useFormDraft } from "@/lib/use-draft";

// Client pieces of the Company pages: the setup checkbox the owner ticks, and the money forms they type into.

export function StepCheck({ id, done, text }: { id: string; done: boolean; text: string }) {
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
            const result = await setStepDone(id, value);
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

// An amount field: empty means "not set", shown elsewhere as "—".
function Amount({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="amount">
      <span>{label}</span>
      <span className="amount-input">
        <i aria-hidden>$</i>
        <input name={name} inputMode="decimal" defaultValue={value} placeholder="—" autoComplete="off" spellCheck={false} />
      </span>
    </label>
  );
}

export function GoalsForm({ year, monthly }: { year: string; monthly: string }) {
  const [state, action, pending] = useActionState<MoneyState, FormData>(saveGoals, {});
  const draft = useFormDraft("money-goals", { result: state });
  return (
    <form ref={draft.ref} action={action} className="money-form">
      <Amount name="year" label="Year" value={year} />
      <Amount name="monthly" label="Monthly" value={monthly} />
      <button className="button secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error && <span className="form-error">{state.error}</span>}
      {state.done && !pending && <span className="form-done">{state.done}</span>}
    </form>
  );
}

// The products table as one form: each row's goal and actual per month are the cells the owner edits; one Save under
// the table writes every changed product. Edited cells are a draft (useFormDraft), so a reload keeps them; Save
// stays off until a cell differs from the record.
export function ProductsForm({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  const [state, action, pending] = useActionState<MoneyState, FormData>(saveProducts, {});
  const draft = useFormDraft("money-products", { result: state });
  const form = useRef<HTMLFormElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const scan = useCallback(() => {
    const fields = Array.from(form.current?.querySelectorAll<HTMLInputElement>(".amount-input input") || []);
    setDirty(fields.some((el) => el.value !== el.defaultValue));
  }, []);
  // A restored draft is written into the fields without an input event; React resets the form after the action
  // (and the draft puts failed numbers back a tick later). Look again each time.
  useEffect(scan, [scan]);
  useEffect(() => {
    const t = setTimeout(scan, 10);
    return () => clearTimeout(t);
  }, [state, scan]);
  const draftRef = draft.ref;
  const ref = useCallback(
    (el: HTMLFormElement | null) => {
      form.current = el;
      return draftRef(el);
    },
    [draftRef],
  );
  return (
    <form ref={ref} action={action} className="money-table" aria-label="Products" onInput={scan}>
      {head}
      {children}
      <div className="money-foot">
        <button className="button secondary" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.error && <span className="form-error">{state.error}</span>}
        {state.done && !pending && !dirty && <span className="form-done">{state.done}</span>}
      </div>
    </form>
  );
}

// One product in the money table: its read-only cells, then goal and actual per month, which the owner edits.
export function ProductMoneyRow({
  slug,
  goal,
  actual,
  children,
}: {
  slug: string;
  goal: string;
  actual: string;
  children: React.ReactNode;
}) {
  return (
    <div className="money-row" role="row">
      {children}
      <Amount name={`goal:${slug}`} label="Goal per month" value={goal} />
      <Amount name={`actual:${slug}`} label="Actual per month" value={actual} />
    </div>
  );
}
