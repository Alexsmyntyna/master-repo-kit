"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  browserStorage,
  draftKey,
  parseFormDraft,
  pruneDrafts,
  readDraft,
  removeDraft,
  shouldRestore,
  writeDraft,
  type FormDraft,
} from "./drafts";

// Nothing a person typed is lost to a reload, a rebuild or a failed action (DESIGN.md, Drafts).
// Every text field uses useDraft (controlled) or useFormDraft (uncontrolled forms posting to server actions).
// Drafts are cleared only after a successful submit, never when it starts.

const DEBOUNCE = 150;
// Writes waiting on the debounce, by key. A page being hidden or unloaded writes them at once.
const pending = new Map<string, () => void>();
let installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const flushAll = () => [...pending.values()].forEach((f) => f());
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("beforeunload", flushAll);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushAll());
  pruneDrafts(browserStorage());
}

// Replace a draft right away (or remove it when text is empty), dropping any write still waiting.
export function putDraft(key: string, text: string, base = "") {
  pending.delete(key);
  writeDraft(browserStorage(), key, text, base);
}
export function clearDraftKey(key: string) {
  pending.delete(key);
  removeDraft(browserStorage(), key);
}

// Whether a draft is waiting under this key (to open a closed editor so the words are in view).
export function hasDraft(key: string | null): boolean {
  return !!key && !!readDraft(browserStorage(), key);
}

// The storage key: `draft:<pathname>:<name>`, or an explicit key for things kept by scope rather than route.
export function useDraftKey(name: string, key?: string | null): string | null {
  const pathname = usePathname() || "/";
  return key === null ? null : (key ?? draftKey(pathname, name));
}

// The core: restore one key after mount (never during render, so hydration matches), save debounced, clear.
// `base` is what the field shows before any typing; a draft is restored only over that same value.
export function useDraftSaver(key: string | null, base: string, onRestore: (text: string) => void) {
  const baseRef = useRef(base);
  const restoreRef = useRef(onRestore);
  useEffect(() => {
    baseRef.current = base;
    restoreRef.current = onRestore;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mine = useRef<(() => void) | null>(null);

  useEffect(() => {
    install();
    if (!key) return;
    const rec = readDraft(browserStorage(), key);
    if (shouldRestore(rec, baseRef.current)) restoreRef.current(rec.text);
    return () => {
      clearTimeout(timer.current);
      const f = mine.current;
      if (f && pending.get(key) === f) f(); // unmounting (a remount, a closed panel): write what's waiting
    };
  }, [key]);

  const save = useCallback(
    (text: string) => {
      if (!key) return;
      const b = baseRef.current;
      const flush = () => {
        if (pending.get(key) === flush) pending.delete(key);
        writeDraft(browserStorage(), key, text, b);
      };
      pending.set(key, flush);
      mine.current = flush;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => pending.get(key) === flush && flush(), DEBOUNCE);
    },
    [key],
  );
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    if (key) clearDraftKey(key);
  }, [key]);
  return { save, clear };
}

// A controlled text value that survives reloads: [value, setValue, clearDraft].
// Pass `key` to store by scope instead of route (the chat dock: `draft:dock:<scope>`), or `key: null` to switch it off.
export function useDraft(
  name: string,
  initial = "",
  opts: { key?: string | null } = {},
): [string, (next: string) => void, () => void] {
  const key = useDraftKey(name, opts.key);
  const [value, setValue] = useState(initial);
  const { save, clear } = useDraftSaver(key, initial, setValue);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      save(next);
    },
    [save],
  );
  return [value, set, clear];
}

type Result = { error?: unknown } | null | undefined;
const NONE = Symbol("none");
const succeeded = (before: unknown, now: Result) => before !== NONE && !!now && now !== before && !now.error;

// For a form that navigates away when it works (a server action that redirects): clear once it has unmounted
// after a submit that didn't come back with an error. Returns the form's onSubmit.
export function useClearOnLeave(clear: () => void, result?: Result) {
  const sent = useRef(false);
  const clearRef = useRef(clear);
  useEffect(() => {
    clearRef.current = clear;
  });
  useEffect(() => {
    if (result?.error) sent.current = false;
  }, [result]);
  useEffect(
    () => () => {
      if (sent.current) clearRef.current();
    },
    [],
  );
  return useCallback(() => {
    sent.current = true;
  }, []);
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const TEXT_TYPES = new Set(["text", "search", "email", "url", "tel", "number", ""]);
function draftFields(form: HTMLFormElement): Field[] {
  return Array.from(form.elements).filter((el): el is Field => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
    if (!el.name || el.dataset.draft === "off" || el.disabled) return false;
    return el instanceof HTMLInputElement ? TEXT_TYPES.has(el.getAttribute("type")?.toLowerCase() ?? "") : true;
  });
}
const defaultOf = (el: Field) =>
  el instanceof HTMLSelectElement
    ? (Array.from(el.options).find((o) => o.defaultSelected) ?? el.options[0])?.value ?? ""
    : el.defaultValue;

// An uncontrolled form's named text inputs, textareas and selects, as one draft. Attach the returned `ref` to the
// <form>. Restores on mount into fields that are empty or still show their server value; saves on input; clears
// when `result` (the action state) comes back without an error, or, with `redirects`, when the form unmounts after
// a submit. React empties a form after its action runs; when that action failed, the draft is put back.
export function useFormDraft(
  name: string,
  opts: { key?: string | null; result?: Result; redirects?: boolean } = {},
): { ref: (form: HTMLFormElement | null) => (() => void) | void; clear: () => void } {
  const key = useDraftKey(name, opts.key);
  const resultRef = useRef<Result>(opts.result);
  // Read by the reset listener, which runs in the commit after this render, before effects.
  resultRef.current = opts.result; // eslint-disable-line react-hooks/refs
  const submittedWith = useRef<unknown>(NONE);
  const redirects = !!opts.redirects;
  const formRef = useRef<HTMLFormElement | null>(null);
  const bases = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    submittedWith.current = NONE;
    if (key) clearDraftKey(key);
  }, [key]);

  // The action came back: clear on success.
  useEffect(() => {
    if (succeeded(submittedWith.current, opts.result)) clear();
    else if (opts.result?.error) submittedWith.current = NONE;
  }, [opts.result, clear]);

  const ref = useCallback(
    (form: HTMLFormElement | null) => {
      if (!form || !key) return;
      install();
      formRef.current = form;
      bases.current = Object.fromEntries(draftFields(form).map((el) => [el.name, defaultOf(el)]));
      const storage = browserStorage();

      const snapshot = (): string => {
        const values = Object.fromEntries(draftFields(form).map((el) => [el.name, el.value]));
        const changed = Object.entries(values).some(([n, v]) => v !== (bases.current[n] ?? ""));
        return changed ? JSON.stringify({ values, bases: bases.current } satisfies FormDraft) : "";
      };
      const flush = () => {
        if (pending.get(key) === flush) pending.delete(key);
        writeDraft(storage, key, snapshot());
      };
      const restore = () => {
        const rec = readDraft(storage, key);
        const d = rec && parseFormDraft(rec.text);
        if (!d) return;
        for (const el of draftFields(form)) {
          const v = d.values[el.name];
          if (v === undefined || v === el.value) continue;
          if (el.value !== "" && el.value !== (d.bases[el.name] ?? "")) continue; // a newer server value wins
          if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === v)) continue;
          el.value = v;
        }
      };
      restore();

      const onInput = () => {
        pending.set(key, flush);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => pending.get(key) === flush && flush(), DEBOUNCE);
      };
      const onSubmit = () => {
        if (pending.get(key) === flush) flush();
        submittedWith.current = resultRef.current;
      };
      // React resets the form once its action returns. The new state has rendered by then: success clears,
      // anything else puts the words back.
      const onReset = () =>
        setTimeout(() => {
          if (succeeded(submittedWith.current, resultRef.current)) clear();
          else restore();
        }, 0);
      form.addEventListener("input", onInput);
      form.addEventListener("change", onInput);
      form.addEventListener("submit", onSubmit);
      form.addEventListener("reset", onReset);
      return () => {
        form.removeEventListener("input", onInput);
        form.removeEventListener("change", onInput);
        form.removeEventListener("submit", onSubmit);
        form.removeEventListener("reset", onReset);
        clearTimeout(timer.current);
        if (pending.get(key) === flush) flush();
        if (redirects && submittedWith.current !== NONE) clear();
        if (formRef.current === form) formRef.current = null;
      };
    },
    [key, redirects, clear],
  );
  return { ref, clear };
}
