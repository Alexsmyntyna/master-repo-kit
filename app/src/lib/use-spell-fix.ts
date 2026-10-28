"use client";
import { useCallback, useRef, useState } from "react";
import { fixSpellingAction } from "@/app/spell/actions";
import type { SpellChange } from "./spell-marks";

// Spelling on send (app/DESIGN.md, Spelling). A composer runs the owner's words through the fixer as they're sent, sends
// the fixed text at once and passes what they typed as `typed` so it's stored beside it. Nothing waits for them: a
// spelling they want kept is kept afterwards, from the stored message's "N fixed" (SpellNote).

export type SpellSend = { text: string; typed?: string; changes: SpellChange[] };

// Longer than the fixer's own 1.5s cap; past it the words go as typed.
const WAIT_MS = 4000;

// One text through the fixer. `typed` is set only when the fix changed something; a failed or slow call sends it as typed.
export async function fixOnSend(text: string): Promise<SpellSend> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<null>((done) => (timer = setTimeout(() => done(null), WAIT_MS)));
    const r = await Promise.race([fixSpellingAction(text), late]);
    if (!r || typeof r.text !== "string" || r.text === text || !r.changes.length) return { text, changes: [] };
    return { text: r.text, typed: text, changes: r.changes };
  } catch {
    return { text, changes: [] };
  } finally {
    clearTimeout(timer);
  }
}

type Send = (out: Record<string, SpellSend>) => void;

// `check` runs the fields (id → text) through the fixer and sends straight away; `checking` is true meanwhile (send
// buttons wait on it). Nothing here writes a draft: the fields keep what they typed until the send works.
export function useSpellFix() {
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  const check = useCallback(async (fields: Record<string, string>, send: Send) => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    let out: Record<string, SpellSend>;
    try {
      const ids = Object.keys(fields);
      const results = await Promise.all(ids.map((id) => fixOnSend(fields[id])));
      out = Object.fromEntries(ids.map((id, i) => [id, results[i]]));
    } finally {
      busy.current = false;
      setChecking(false);
    }
    send(out);
  }, []);

  // For a <form action={…}>: call from onSubmit. The first submit is stopped while the fields go through the fixer;
  // then the form is submitted again with the fixed text and `typed` put into its FormData (the `formdata` event),
  // so the fields, their React state and their drafts keep what they typed until the action's result clears them.
  // Returns true when it took the submit (the caller does nothing else with this one).
  const passing = useRef(false);
  const intercept = useCallback(
    (e: React.FormEvent<HTMLFormElement>, names: string[]): boolean => {
      if (passing.current) {
        passing.current = false;
        return false;
      }
      const form = e.currentTarget;
      const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const fields: Record<string, string> = {};
      for (const name of names) {
        const el = form.elements.namedItem(name);
        if ((el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.value.trim()) fields[name] = el.value;
      }
      if (!Object.keys(fields).length) return false; // no words to check: this submit goes on as it is
      e.preventDefault();
      if (busy.current) return true; // already on its way
      check(fields, (out) =>
        // Later, never inside a submit event's dispatch, where requestSubmit is ignored.
        setTimeout(() => {
          if (!form.isConnected) return;
          const onData = (ev: FormDataEvent) => {
            // The button pressed (Send or Approve) still counts if it's disabled for a moment while React catches up.
            if (submitter?.name && !ev.formData.has(submitter.name)) ev.formData.set(submitter.name, submitter.value);
            for (const [name, r] of Object.entries(out)) {
              ev.formData.set(name, r.text);
              if (r.typed !== undefined) ev.formData.set(names.length === 1 ? "typed" : `typed_${name}`, r.typed);
            }
          };
          form.addEventListener("formdata", onData);
          passing.current = true;
          try {
            if (submitter && submitter.form === form && !submitter.disabled) form.requestSubmit(submitter);
            else form.requestSubmit();
          } finally {
            passing.current = false;
            form.removeEventListener("formdata", onData);
          }
        }, 0),
      );
      return true;
    },
    [check],
  );

  return { checking, check, intercept };
}
