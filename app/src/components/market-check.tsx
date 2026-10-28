"use client";
import { useActionState } from "react";
import { Play } from "lucide-react";
import { startMarketCheck, type ThreadState } from "@/app/threads/actions";

export function MarketCheckButton({ slug, label = "Run a market check" }: { slug: string; label?: string }) {
  const [state, action, pending] = useActionState<ThreadState, FormData>(startMarketCheck, {});
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="slug" value={slug} />
      <button className="button primary" disabled={pending}>
        <Play size={14} /> {pending ? "Starting…" : label}
      </button>
      {state.error && <span className="form-error">{state.error}</span>}
      {state.done && <span className="form-done">{state.done}</span>}
    </form>
  );
}
