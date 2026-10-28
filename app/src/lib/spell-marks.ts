// Pure helpers for spelling fixes (src/lib/spell.ts makes them). No Node imports, so client components can use
// these to underline fixed words and undo one ("Keep my spelling").

// One fixed word. `index` is the word's offset in the ORIGINAL text (what the owner typed), never in the fixed text.
export type SpellChange = { from: string; to: string; index: number };

// A run of the fixed text; `from` is set on a fixed word and holds what they typed there.
export type FixedSegment = { text: string; from?: string; index?: number };

const valid = (text: string, changes: SpellChange[]) =>
  [...changes]
    .filter((c) => text.startsWith(c.from, c.index))
    .sort((a, b) => a.index - b.index)
    .filter((c, i, all) => i === 0 || all[i - 1].index + all[i - 1].from.length <= c.index);

// The original text with these changes made. Changes that don't match the text at their index, or overlap an
// earlier one, are skipped, so a stale list never garbles their words.
export function applyChanges(original: string, changes: SpellChange[]): string {
  return fixedSegments(original, changes)
    .map((s) => s.text)
    .join("");
}

// The fixed text split into plain runs and fixed words, for a UI that underlines each fix with the original on hover.
export function fixedSegments(original: string, changes: SpellChange[]): FixedSegment[] {
  const out: FixedSegment[] = [];
  let at = 0;
  for (const c of valid(original, changes)) {
    if (c.index > at) out.push({ text: original.slice(at, c.index) });
    out.push({ text: c.to, from: c.from, index: c.index });
    at = c.index + c.from.length;
  }
  if (at < original.length || !out.length) out.push({ text: original.slice(at) });
  return out;
}

const WORDS = /[A-Za-z'’]+/g;

// The changes that turn `original` into `fixed`, when they differ only in whole words (what the fixer does). Used
// to show fixes on a stored message from its `typed` text. Returns [] when the two differ in anything else.
export function diffWords(original: string, fixed: string): SpellChange[] {
  if (original === fixed) return [];
  const a = [...original.matchAll(WORDS)];
  const b = [...fixed.matchAll(WORDS)];
  if (a.length !== b.length || original.replace(WORDS, "\0") !== fixed.replace(WORDS, "\0")) return [];
  return a.flatMap((m, i) => (m[0] === b[i][0] ? [] : [{ from: m[0], to: b[i][0], index: m.index! }]));
}
