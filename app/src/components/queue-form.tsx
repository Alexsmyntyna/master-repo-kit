"use client";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { hasDraft, useDraftKey, useFormDraft } from "@/lib/use-draft";
import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { addQuestion } from "@/app/queue/actions";
import "@/styles/more.css";

// Save a question for a later session. Closed it's one button; open it's a short form. No agent is started.
export function QueueForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false),
    [state, action, pending] = useActionState(addQuestion, {});
  const form = useRef<HTMLFormElement>(null);
  // Typed words are a draft until saved; a waiting draft opens the form.
  const draft = useFormDraft("question", { result: state });
  const draftRef = draft.ref;
  const formRef = useCallback(
    (el: HTMLFormElement | null) => {
      form.current = el;
      return draftRef(el);
    },
    [draftRef],
  );
  const key = useDraftKey("question");
  useEffect(() => {
    if (hasDraft(key)) setOpen(true);
  }, [key]);
  useEffect(() => {
    if (state.saved) form.current?.reset();
  }, [state.saved]);
  return (
    <div className="q-new">
      {!open && (
        <button className="button primary" aria-expanded={open} aria-controls="question-form" onClick={() => setOpen(true)}>
          <Plus size={15} aria-hidden /> New question
        </button>
      )}
      {open && (
        <form ref={formRef} action={action} id="question-form" className="q-form">
          <div className="q-form-row">
            <label className="q-field">
              <span>Title</span>
              <input name="title" maxLength={140} required placeholder="What to look into" autoFocus />
            </label>
            <label className="q-field">
              <span>Project</span>
              <select name="project">
                <option value="">All projects</option>
                {companies.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="q-field">
            <span>Question</span>
            <textarea name="question" rows={4} maxLength={10000} required placeholder="Context for later" />
          </label>
          <div className="q-form-actions">
            {state.error && (
              <p role="alert" className="q-error">
                {state.error}
              </p>
            )}
            {state.saved && (
              <p role="status" className="q-saved">
                <Check size={15} aria-hidden /> Saved. <Link href={`/documents/${state.saved}`}>Open it</Link>
              </p>
            )}
            <button type="button" className="button secondary" onClick={() => setOpen(false)}>
              Close
            </button>
            <button className="button primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
