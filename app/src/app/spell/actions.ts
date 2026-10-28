"use server";
import { fixSpelling, isWord, learnWord, MAX_TEXT, type SpellResult } from "@/lib/spell";

// For composers: run the owner's text through the spelling fixer before it's saved (app/DESIGN.md, Spelling), and
// keep a word they want as typed. Save the fixed text as their words and the original as `typed`.
export async function fixSpellingAction(text: string): Promise<SpellResult> {
  if (typeof text !== "string") return { text: "", changes: [] };
  if (!text || text.length > MAX_TEXT) return { text, changes: [] }; // past the cap it's saved as typed
  const input = text;
  try {
    return await fixSpelling(input);
  } catch {
    return { text: input, changes: [] }; // a broken dictionary never blocks a send
  }
}

export async function learnWordAction(word: string): Promise<{ error?: string; done?: string }> {
  const w = typeof word === "string" ? word.trim() : "";
  if (!isWord(w)) return { error: "Only a single word: letters and apostrophes, up to 40 characters." };
  try {
    await learnWord(w);
    return { done: w };
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    return { error: `Couldn't save it to holding/dictionary.txt (${e.code || e.message}).` };
  }
}
