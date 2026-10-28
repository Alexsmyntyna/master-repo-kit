"use client";
import { useActionState, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { saveVision, type VisionState } from "@/app/company/vision/actions";
import { hasDraft, useDraftKey, useFormDraft } from "@/lib/use-draft";

// Shows the rendered vision; "Edit" swaps in a plain textarea that saves back to holding/vision.md.
// Unsaved edits are a draft: a reload brings them back (and reopens the editor); a failed save keeps them open.
export function VisionEditor({ body, children }: { body: string; children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(saveVision, {});
  const key = useDraftKey("vision");
  useEffect(() => {
    if (hasDraft(key)) setEditing(true);
  }, [key]);
  useEffect(() => {
    if (state.done) setEditing(false);
  }, [state]);
  if (!editing)
    return (
      <div className="vision-doc">
        <button className="button secondary vision-edit" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit
        </button>
        {state.done && <p className="form-done">{state.done}</p>}
        {children}
      </div>
    );
  return <VisionForm body={body} state={state} action={action} pending={pending} onCancel={() => setEditing(false)} />;
}

function VisionForm({
  body,
  state,
  action,
  pending,
  onCancel,
}: {
  body: string;
  state: VisionState;
  action: (form: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const draft = useFormDraft("vision", { result: state });
  return (
    <form ref={draft.ref} action={action} className="vision-doc vision-form">
      <label>
        <span>
          Vision <small>Markdown</small>
        </span>
        <textarea name="body" rows={24} defaultValue={body} />
      </label>
      <div className="form-foot">
        {state.error && <span className="form-error">{state.error}</span>}
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="button primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
