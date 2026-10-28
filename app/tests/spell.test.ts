import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { applyChanges, damerau, fixSpelling, learnWord, MAX_MS, MAX_TEXT, MAX_UNKNOWN } from "../src/lib/spell";
import { diffWords, fixedSegments } from "../src/lib/spell-marks";

// A data directory of its own, so learnWord never writes to the real holding/.
let root = "";
before(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "mr-spell-")));
  await mkdir(path.join(root, "companies", "time-app"), { recursive: true });
  await mkdir(path.join(root, "companies", "metadata-tool"), { recursive: true });
  await mkdir(path.join(root, "holding"));
  await writeFile(path.join(root, "companies", "time-app", "company.json"), JSON.stringify({ id: "time-app", name: "TimeApp" }));
  await writeFile(
    path.join(root, "companies", "metadata-tool", "company.json"),
    JSON.stringify({ id: "metadata-tool", name: "Metadata Tool" }),
  );
});
after(() => rm(root, { recursive: true, force: true }));

const fix = async (text: string) => (await fixSpelling(text, { root })).text;

test("obvious typos are fixed, word for word, with where each one was", async () => {
  const typed = "the hustory feilds need expereince.";
  const r = await fixSpelling(typed, { root });
  assert.equal(r.text, "the history fields need experience.");
  assert.deepEqual(r.changes, [
    { from: "hustory", to: "history", index: 4 },
    { from: "feilds", to: "fields", index: 12 },
    { from: "expereince", to: "experience", index: 24 },
  ]);
  assert.equal(applyChanges(typed, r.changes), r.text);
});

test("real words, even the wrong ones, stay", async () => {
  assert.equal(await fix("I keep loosing the thread"), "I keep loosing the thread");
  assert.equal(await fix("the colour and the color"), "the colour and the color");
});

test("capitals: sentence starts are fixed keeping the capital; ALLCAPS, camelCase and names mid-sentence are not", async () => {
  assert.equal(await fix("Hustory first. Feilds next"), "History first. Fields next");
  assert.equal(await fix("- Feilds on a list line"), "- Fields on a list line");
  assert.equal(await fix("HUSTORY and FEILDS"), "HUSTORY and FEILDS");
  assert.equal(await fix("FinanceApp, TimeApp and CameraApp"), "FinanceApp, TimeApp and CameraApp");
  assert.equal(await fix("we went to Hustory today"), "we went to Hustory today");
});

test("code, paths, links, handles and project words are never touched", async () => {
  for (const text of [
    "see `nores hustory` here",
    "```\nfeilds hustory\n```",
    "open lib/hustory.ts or ./feilds",
    "go to https://example.com/hustory?feilds=1",
    "mail feilds@example.com",
    "ping @hustory about #feilds",
    "[the page](hustory-feilds)",
    "timeapp and Timeapp and photosorter",
    "the wiki, mockups, repos and a worktree",
    "the nspell lib", // a dictionary suggestion that changes the first letter ("spell") isn't taken
  ])
    assert.equal(await fix(text), text, text);
});

test("apostrophes: a missing one is put back when that is the only fix; otherwise the word stays", async () => {
  assert.equal(await fix("dont do that, isnt it"), "don't do that, isn't it");
  assert.equal(await fix("thats what youre after"), "that's what you're after");
  assert.equal(await fix("I don’t know, thats it"), "I don’t know, that’s it"); // his curly style is kept
  assert.equal(await fix("im fine, ok"), "im fine, ok"); // "i'm" isn't a word and two-letter words are left
});

test("swapped letters win over other near words; ties and many near words leave the word alone", async () => {
  assert.equal(await fix("teh plan and thier time"), "the plan and their time");
  assert.equal(await fix("we need it untill friday"), "we need it until friday");
  assert.equal(await fix("realy wierd"), "realy wierd"); // relay or really; weird or wired
  assert.equal(await fix("alot of nores"), "alot of nores"); // many dictionary words one letter away
});

test("a word he keeps is learned and no longer changed", async () => {
  assert.equal(await fix("the hustory"), "the history");
  await learnWord("hustory", { root });
  await learnWord("Hustory", { root }); // same word, ignoring case
  await learnWord("abacus", { root });
  assert.equal(await readFile(path.join(root, "holding", "dictionary.txt"), "utf8"), "abacus\nhustory\n");
  assert.equal(await fix("the hustory"), "the hustory");
  await assert.rejects(learnWord("two words", { root }));
  await assert.rejects(learnWord("path/like", { root }));
});

test("bounded work: long text comes back as typed, and after the budget the rest stays as typed", async () => {
  await fix("warm up"); // dictionaries loaded
  const long = "teh hustory ".repeat(Math.ceil((MAX_TEXT + 1) / 12));
  let t = Date.now();
  assert.deepEqual(await fixSpelling(long, { root }), { text: long, changes: [] });
  assert.ok(Date.now() - t < 200, "a text over the cap isn't looked at");

  // Word budget: the first MAX_UNKNOWN misspelt words are fixed, the rest are not.
  const many = "teh ".repeat(MAX_UNKNOWN + 10) + "hustory";
  const r = await fixSpelling(many, { root });
  assert.equal(r.changes.length, MAX_UNKNOWN);
  assert.ok(r.text.endsWith("the teh teh teh teh teh teh teh teh teh teh hustory"));

  // Time budget: gibberish is slow to look up (nspell's suggest), so lookups stop after MAX_MS.
  let seed = 7;
  const gibberish = Array.from({ length: 60 }, () =>
    Array.from({ length: 6 }, () => "bcdfghjklmnpqrstvwxz"[(seed = (seed * 1103515245 + 12345) % 2147483648) % 20]).join(""),
  );
  const slow = gibberish.join(" ") + " hustory";
  t = Date.now();
  const g = await fixSpelling(slow, { root });
  assert.ok(Date.now() - t < MAX_MS + 1500, `took ${Date.now() - t}ms`);
  assert.ok(g.text.endsWith(" hustory"));
  assert.ok(!g.changes.some((c) => c.from === "hustory"));

  // A word over MAX_WORD letters is left without a lookup.
  const huge = "hustory".repeat(5);
  assert.equal(await fix(`the ${huge}`), `the ${huge}`);
});

test("helpers: segments for underlining, a diff from the stored typed text, and distance", () => {
  const typed = "dont lose teh words";
  const changes = diffWords(typed, "don't lose the words");
  assert.deepEqual(changes, [
    { from: "dont", to: "don't", index: 0 },
    { from: "teh", to: "the", index: 10 },
  ]);
  assert.deepEqual(fixedSegments(typed, changes), [
    { text: "don't", from: "dont", index: 0 },
    { text: " lose " },
    { text: "the", from: "teh", index: 10 },
    { text: " words" },
  ]);
  assert.equal(applyChanges(typed, changes.slice(1)), "dont lose the words"); // "Keep my spelling" on the first
  assert.equal(applyChanges(typed, [{ from: "nope", to: "x", index: 0 }]), typed); // a stale change is skipped
  assert.deepEqual(diffWords("one two", "one, two"), []); // not a word-only difference
  assert.equal(damerau("teh", "the"), 1);
  assert.equal(damerau("hustory", "history"), 1);
  assert.equal(damerau("tommorow", "tomorrow"), 2);
});
