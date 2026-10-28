// Drafts: what someone typed, kept in localStorage so a reload, a rebuild or a failed action can't lose it.
// Pure storage logic (no React), so it can be tested with a fake storage. The hooks are in use-draft.ts.

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & { length?: number; key?: (i: number) => string | null };
// `base` is the value the field showed when the typing started (a server value, or ""). A draft is restored only
// over that same value, so a newer server value wins over an old draft.
export type DraftRecord = { text: string; at: number; base?: string };

export const DRAFT_PREFIX = "draft:";
export const DRAFT_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export const draftKey = (scope: string, name: string) => `${DRAFT_PREFIX}${scope}:${name}`;

export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(storage: DraftStorage | null, key: string, now = Date.now()): DraftRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw) as Partial<DraftRecord>;
    if (typeof rec?.text !== "string" || typeof rec.at !== "number" || now - rec.at > DRAFT_MAX_AGE) {
      storage.removeItem(key);
      return null;
    }
    return { text: rec.text, at: rec.at, base: typeof rec.base === "string" ? rec.base : "" };
  } catch {
    return null;
  }
}

// Saves the text; text that is back to where it started (the base, or empty) is not a draft and is removed.
export function writeDraft(storage: DraftStorage | null, key: string, text: string, base = "", now = Date.now()) {
  if (!storage) return;
  try {
    if (text === base || !text) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ text, at: now, base } satisfies DraftRecord));
  } catch {}
}

export function removeDraft(storage: DraftStorage | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {}
}

// Restore when the field still shows what it showed when the draft was typed (or is empty), and the draft differs.
export function shouldRestore(rec: DraftRecord | null, current: string): rec is DraftRecord {
  return !!rec && !!rec.text && rec.text !== current && (current === "" || (rec.base ?? "") === current);
}

// Drops every expired draft (run once per page load).
export function pruneDrafts(storage: DraftStorage | null, now = Date.now()) {
  if (!storage?.key || storage.length === undefined) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => readDraft(storage, k, now));
  } catch {}
}

// A form's fields as one draft: { values, bases } keyed by field name.
export type FormDraft = { values: Record<string, string>; bases: Record<string, string> };
export function parseFormDraft(text: string): FormDraft | null {
  try {
    const d = JSON.parse(text) as FormDraft;
    return d && typeof d.values === "object" && typeof d.bases === "object" ? d : null;
  } catch {
    return null;
  }
}
