import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type NSpell from "nspell";
import { repoRoot } from "./repository";
import { applyChanges, type SpellChange } from "./spell-marks";

export { applyChanges, diffWords, fixedSegments, type FixedSegment, type SpellChange } from "./spell-marks";

// Spelling fixes for the owner's words before they're saved (app/DESIGN.md, Spelling). Their words are quoted verbatim
// everywhere, so this only ever swaps a misspelt word for one spelling of the same word: no rephrasing, no
// splitting or joining, no punctuation or whitespace. When in doubt it leaves the word alone; the caller keeps
// what they typed beside the fixed text.
//
// A word is fixed only when all of these hold:
// - It's a plain word: letters, with apostrophes inside (straight or curly); hyphenated parts count as words.
// - It's 3 letters or more, all lowercase, or capitalised (first letter only) at the start of a sentence or line.
//   ALLCAPS, camelCase or mixed ("FinanceApp", "TimeApp") and capitalised words mid-sentence (names) are left.
// - It isn't inside a fenced block, inline code, a URL, an email or a markdown link target, and its chunk of
//   text (between spaces, outer punctuation stripped) has no `/`, `.`, `` ` ``, `@`, `#`, digit or symbol.
// - Neither dictionary (en-US, en-GB) accepts it, and it isn't in the project dictionary (case-insensitive).
// - Exactly one fix is found, tried in this order, and keeps the word's capitalisation:
//   1. a missing apostrophe ("dont" → "don't", "thats" → "that's"; "im" stays: "i'm" isn't a word);
//   2. two neighbouring letters swapped ("teh" → "the", "feilds" → "fields"), or, for words of 5 letters or
//      more, a letter doubled or undoubled ("untill" → "until"); if two of these fit ("realy": "relay",
//      "really"), the word is left;
//   3. the dictionary has exactly one suggestion within Damerau-Levenshtein distance 2 (1 for words of 4
//      letters or fewer) that keeps the capitalisation and the first letter ("hustory" → "history"; "nores"
//      has many, so it's left; "nspell" isn't turned into "spell").
//   In 2 and 3 a word of 4 letters or fewer only becomes a word on the COMMON list ("alot" stays, not "alto").

type Dicts = { us: NSpell; gb: NSpell };
let dicts: Promise<Dicts> | undefined;
const suggestions = new Map<string, string[]>();

// Loaded on first use (about 0.2s) and kept for the life of the server.
function loadDicts(): Promise<Dicts> {
  dicts ??= (async () => {
    const [{ default: nspell }, { default: us }, { default: gb }] = await Promise.all([
      import("nspell"),
      import("dictionary-en"),
      import("dictionary-en-gb"),
    ]);
    // Typed as Uint8Array; they're the Buffers fs.readFile returned.
    const load = (dict: { aff: Uint8Array; dic: Uint8Array }) => nspell({ aff: Buffer.from(dict.aff), dic: Buffer.from(dict.dic) });
    return { us: load(us), gb: load(gb) };
  })();
  return dicts;
}

// This repo's own words. Short and obvious; anything else the owner adds goes to holding/dictionary.txt.
const BUILT_IN = [
  "CEO", "COO", "wiki", "wikis", "mockup", "mockups", "repo", "repos", "worktree", "worktrees", "codebase",
  "codebases", "monorepo", "frontend", "backend", "subagent", "subagents", "Next.js", "Nextjs", "iOS", "iPadOS",
  "macOS", "TestFlight", "Supabase", "Vercel", "GitHub", "Xcode", "SwiftUI", "Lightroom", "Figma", "Tailwind",
  "TypeScript", "JavaScript", "npm", "localhost", "webhook", "webhooks", "signup", "dropdown", "async", "config",
];

export const DICTIONARY_FILE = "holding/dictionary.txt";
const dictionaryPath = (root: string) => path.join(root, DICTIONARY_FILE);

async function learned(root: string): Promise<string[]> {
  try {
    return (await readFile(dictionaryPath(root), "utf8")).split("\n").map((w) => w.trim()).filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(dictionaryPath(root), "").catch(() => {}); // created when missing (no holding/ → skip)
    return [];
  }
}

async function companyWords(root: string): Promise<string[]> {
  const entries = await readdir(path.join(root, "companies"), { withFileTypes: true }).catch(() => []);
  const words = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
      .map(async (e) => {
        try {
          const data = JSON.parse(await readFile(path.join(root, "companies", e.name, "company.json"), "utf8"));
          return [data.id, data.name].filter((v): v is string => typeof v === "string");
        } catch {
          return [];
        }
      }),
  );
  return words.flat();
}

const norm = (w: string) => w.replace(/’/g, "'").toLowerCase();

// Every company's name and id (and each word in them), holding/dictionary.txt and the built-in list, lowercased.
// Read on each call: a few small files, and a word the owner just kept counts straight away.
export async function projectWords(root = repoRoot, extra: string[] = []): Promise<Set<string>> {
  const all = [...BUILT_IN, ...(await companyWords(root)), ...(await learned(root)), ...extra];
  return new Set(all.flatMap((w) => [w, ...w.split(/[^A-Za-z'’]+/)]).filter(Boolean).map(norm));
}

export const WORD = /^[A-Za-z]+(?:['’][A-Za-z]+)*$/;
export const isWord = (w: string) => w.length <= 40 && WORD.test(w);

// Adds a word the owner wants kept as typed to holding/dictionary.txt (deduplicated ignoring case, sorted).
export async function learnWord(word: string, opts: { root?: string } = {}): Promise<string[]> {
  const w = word.trim();
  if (!isWord(w)) throw new Error("Only a single word: letters and apostrophes, up to 40 characters.");
  const root = opts.root ?? repoRoot;
  const seen = new Map<string, string>();
  for (const x of [...(await learned(root)), w]) if (!seen.has(norm(x))) seen.set(norm(x), x);
  const words = [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || a.localeCompare(b));
  const file = dictionaryPath(root);
  await writeFile(`${file}.tmp`, words.join("\n") + "\n");
  await rename(`${file}.tmp`, file);
  return words;
}

// Optimal string alignment distance: insert, delete, substitute, or swap two neighbouring letters, each 1.
export function damerau(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

// Common English words of four letters or fewer: the only words a short typo is turned into.
const COMMON = new Set(
  (
    "a able about above act add after again age ago air all also am an and any are area arm army art as ask at away " +
    "baby back bad bag ball bank base be bear beat bed been best big bill bit black blue body book born both box boy " +
    "but buy by call came camp can car card care case cell cent city club cold come cost could cup cut dark data date " +
    "day dead deal dear deep did die do does dog done door down draw drop drug due during each east easy eat edge else " +
    "end even ever eye face fact fail fall far farm fast fear feel feet few fill film find fine fire firm fish five " +
    "flow fly food foot for form four free from full fund game gas get girl give go goal god gone good got grow gun " +
    "had hair half hall hand hang hard has hat have he head hear heat held help her here hers high him his hit hold " +
    "home hope hot hour how huge i idea if in into is it item its job join just keep key kid kill kind king knew know " +
    "lack land last late law lay lead left leg less let lie life like line list live long look lose loss lot love low " +
    "made main make man many map mark may me mean meet men mind miss mom more most move much must my name near need " +
    "new news next nice nine no nor not note now of off oil ok old on once one only onto open or our out over own " +
    "page paid pain part pass past pay per pick plan play poor post pull push put race rate read real red rest rich " +
    "ride road rock role room rule run safe said sale same save saw say sea seat see seek seem seen self sell send " +
    "set she ship shot show shut side sign sing sit site six size skin so some son song soon sort stay step still " +
    "stop such sure take talk task team tell ten term test than that the them then they this thus time tiny to told " +
    "too took top tour town tree trip true try turn two type unit up upon us use used user very view vote wait walk " +
    "wall want war was way we week well went were west what when who whom why wide wife will win wind wish with word " +
    "work year yes yet you your zero"
  ).split(" "),
);

type Shape = "lower" | "capital";
const shapeOf = (w: string): Shape | undefined =>
  /^[a-z']+$/.test(w) ? "lower" : /^[A-Z][a-z']*$/.test(w) ? "capital" : undefined;
const uniq = (xs: string[]) => [...new Set(xs)];

// Candidates from one kind of edit that a dictionary accepts and that keep the word's shape.
function accepted(d: Dicts, shape: Shape, candidates: string[]): string[] {
  return uniq(candidates).filter((c) => shapeOf(c) === shape && (d.us.correct(c) || d.gb.correct(c)));
}

function suggest(d: Dicts, w: string): string[] {
  let s = suggestions.get(w);
  if (!s) {
    s = uniq([...d.us.suggest(w), ...d.gb.suggest(w)]);
    if (suggestions.size > 5000) suggestions.clear();
    suggestions.set(w, s);
  }
  return s;
}

// The one fix for a misspelt word (apostrophes already straight), or undefined to leave it.
function fixWord(d: Dicts, w: string): string | undefined {
  const shape = shapeOf(w);
  const letters = w.replace(/'/g, "").length;
  if (!shape || letters < 3) return undefined;
  const one = (xs: string[]) => (xs.length === 1 ? xs[0] : xs.length > 1 ? null : undefined);

  // 1. A missing apostrophe.
  const apostrophe = one(accepted(d, shape, [...Array(w.length - 1)].map((_, i) => `${w.slice(0, i + 1)}'${w.slice(i + 1)}`)));
  if (apostrophe !== undefined) return apostrophe ?? undefined;

  // 2. Two neighbouring letters swapped; for longer words also a letter doubled or undoubled.
  const swaps = [...Array(w.length - 1)].map((_, i) => w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
  const doubles =
    letters >= 5
      ? [...w].flatMap((ch, i) => [
          ...(/[a-z]/i.test(ch) ? [w.slice(0, i + 1) + ch.toLowerCase() + w.slice(i + 1)] : []),
          ...(i > 0 && w[i - 1].toLowerCase() === ch.toLowerCase() ? [w.slice(0, i) + w.slice(i + 1)] : []),
        ])
      : [];
  // Short words have many neighbours ("alot" → "alto"), so they only become a common word.
  const common = (xs: string[]) => (letters <= 4 ? xs.filter((x) => COMMON.has(x.toLowerCase())) : xs);
  const cheap = one(common(accepted(d, shape, [...swaps, ...doubles].filter((c) => c !== w))));
  if (cheap !== undefined) return cheap ?? undefined;

  // 3. The dictionary's only suggestion that is close and keeps the shape.
  const limit = letters <= 4 ? 1 : 2;
  const near = suggest(d, w).filter(
    (s) => !/[\s-]/.test(s) && shapeOf(s) === shape && s[0] === w[0] && damerau(w.toLowerCase(), s.toLowerCase()) <= limit,
  );
  return near.length === 1 ? common(near)[0] : undefined;
}

// Text that is never looked at: fenced blocks, inline code, URLs, markdown link targets. (Emails and handles are
// left by the chunk rule: a chunk with `@` or `#` isn't a word.) Each pattern starts on a literal, so a long
// run of text can't make one backtrack.
const PROTECTED = [
  /(^|\n)(```|~~~)[\s\S]*?(\n\2|$)/g,
  /`[^`\n]{0,2000}`/g,
  /\b(?:https?:\/\/|www\.)\S+/g,
  /\]\([^)\s]{0,500}\)/g,
];

// Bounds on the work one call does, since the server action takes any text. Past MAX_TEXT the text comes back
// as typed; words longer than MAX_WORD are left; after MAX_UNKNOWN words that need a fix looked up, or MAX_MS
// spent looking (nspell's suggest is the slow part: up to ~0.3s for one gibberish word), the rest stay as typed.
export const MAX_TEXT = 20_000;
export const MAX_WORD = 30;
export const MAX_UNKNOWN = 200;
export const MAX_MS = 1500;
const LEAD = /^["“‘'(\[{*_]+/;
const TRAIL = /["”’'.,;:!?…)\]}*_]+$/;

// A capitalised word counts only at the start of the text, a line (after a list marker or quote) or a sentence.
// Only the 200 characters before the word are looked at.
function startsSentence(text: string, index: number): boolean {
  const from = Math.max(0, index - 200);
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const line = text.slice(Math.max(from, lineStart), index);
  if (lineStart >= from && /^\s*(?:[-*+>]|\d+[.)]|#{1,6})?\s*["“‘'(\[*_]*$/.test(line)) return true;
  return /[.!?]["”’')\]*_]*\s+["“‘'(\[*_]*$/.test(line);
}

// The protected ranges, sorted and merged, so each chunk is checked against them in one pass.
function protectedRanges(text: string): [number, number][] {
  const all = PROTECTED.flatMap((re) => [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]));
  all.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

export type SpellResult = { text: string; changes: SpellChange[] };

// Fixes obvious misspellings in the owner's text (rules at the top of this file). `root` is the data directory the
// project dictionary is read from; `words` are extra words to leave alone.
export async function fixSpelling(text: string, opts: { root?: string; words?: string[] } = {}): Promise<SpellResult> {
  if (typeof text !== "string" || text.length > MAX_TEXT || !/[A-Za-z]{3}/.test(text)) return { text, changes: [] };
  const [d, known] = await Promise.all([loadDicts(), projectWords(opts.root ?? repoRoot, opts.words)]);
  const skip = protectedRanges(text);
  let r = 0;
  const curly = text.includes("’");
  const changes: SpellChange[] = [];
  let unknown = 0;
  const deadline = Date.now() + MAX_MS;

  for (const chunk of text.matchAll(/\S+/g)) {
    if (unknown >= MAX_UNKNOWN) break;
    const start = chunk.index!;
    while (r < skip.length && skip[r][1] <= start) r++;
    if (r < skip.length && skip[r][0] < start + chunk[0].length) continue; // overlaps protected text
    const lead = chunk[0].match(LEAD)?.[0].length ?? 0;
    const core = chunk[0].slice(lead).replace(TRAIL, "");
    if (!core || /[^A-Za-z'’-]/.test(core)) continue; // a path, a handle, a number or code: leave the whole chunk
    let offset = start + lead;
    for (const part of core.split("-")) {
      const at = offset;
      offset += part.length + 1;
      if (part.length > MAX_WORD || !WORD.test(part) || known.has(norm(part))) continue;
      const plain = part.replace(/’/g, "'");
      if (d.gb.correct(plain) || d.us.correct(plain)) continue; // accepted words never reach suggest()
      if (shapeOf(plain) === "capital" && !startsSentence(text, at)) continue; // a name mid-sentence
      if (++unknown > MAX_UNKNOWN || Date.now() > deadline) {
        unknown = MAX_UNKNOWN; // out of budget: everything after this stays as typed
        break;
      }
      const fix = fixWord(d, plain);
      if (fix && fix !== plain) changes.push({ from: part, to: curly || part.includes("’") ? fix.replace(/'/g, "’") : fix, index: at });
    }
  }
  return { text: applyChanges(text, changes), changes };
}
