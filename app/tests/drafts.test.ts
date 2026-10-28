import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRAFT_MAX_AGE,
  draftKey,
  parseFormDraft,
  pruneDrafts,
  readDraft,
  removeDraft,
  shouldRestore,
  writeDraft,
  type DraftStorage,
} from "../src/lib/drafts";

// A fake localStorage, optionally one that throws on every call (private mode, blocked site data).
function fakeStorage(broken = false): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const guard = () => {
    if (broken) throw new Error("storage unavailable");
  };
  return {
    data,
    getItem: (k) => (guard(), data.get(k) ?? null),
    setItem: (k, v) => (guard(), void data.set(k, String(v))),
    removeItem: (k) => (guard(), void data.delete(k)),
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
  };
}

const key = draftKey("/threads/new", "title");
const now = Date.parse("2026-10-11T12:00:00Z");

test("keys are draft:<scope>:<name>", () => {
  assert.equal(key, "draft:/threads/new:title");
  assert.equal(draftKey("dock", "finance-app"), "draft:dock:finance-app");
});

test("a written draft restores with its text, time and base", () => {
  const s = fakeStorage();
  writeDraft(s, key, "Half a thought", "", now);
  assert.deepEqual(readDraft(s, key, now + 1000), { text: "Half a thought", at: now, base: "" });
});

test("text back at its base, or empty, is not a draft", () => {
  const s = fakeStorage();
  writeDraft(s, key, "edited", "server text", now);
  assert.ok(s.data.has(key));
  writeDraft(s, key, "server text", "server text", now);
  assert.equal(s.data.has(key), false);
  writeDraft(s, key, "again", "", now);
  writeDraft(s, key, "", "", now);
  assert.equal(s.data.has(key), false);
});

test("drafts older than 30 days are ignored and removed", () => {
  const s = fakeStorage();
  writeDraft(s, key, "old words", "", now);
  assert.ok(readDraft(s, key, now + DRAFT_MAX_AGE - 1));
  assert.equal(readDraft(s, key, now + DRAFT_MAX_AGE + 1), null);
  assert.equal(s.data.has(key), false);
});

test("pruning drops expired drafts and leaves other keys alone", () => {
  const s = fakeStorage();
  writeDraft(s, "draft:/a:x", "stale", "", now - DRAFT_MAX_AGE - 1);
  writeDraft(s, "draft:/b:y", "fresh", "", now);
  s.setItem("dock-width", "440");
  pruneDrafts(s, now);
  assert.deepEqual([...s.data.keys()].sort(), ["dock-width", "draft:/b:y"]);
});

test("clearing removes the key", () => {
  const s = fakeStorage();
  writeDraft(s, key, "sent", "", now);
  removeDraft(s, key);
  assert.equal(readDraft(s, key, now), null);
});

test("corrupt records are dropped, not thrown", () => {
  const s = fakeStorage();
  s.setItem(key, "{not json");
  assert.equal(readDraft(s, key, now), null);
  s.setItem(key, JSON.stringify({ text: 3, at: now }));
  assert.equal(readDraft(s, key, now), null);
  assert.equal(s.data.has(key), false);
});

test("storage that throws, or none at all, is a no-op", () => {
  for (const s of [fakeStorage(true), null]) {
    assert.doesNotThrow(() => writeDraft(s, key, "words", "", now));
    assert.equal(readDraft(s, key, now), null);
    assert.doesNotThrow(() => removeDraft(s, key));
    assert.doesNotThrow(() => pruneDrafts(s, now));
  }
});

test("a draft restores over an empty field or the value it was typed over, not over a newer server value", () => {
  const rec = { text: "my edit", at: now, base: "v1" };
  assert.equal(shouldRestore(rec, ""), true);
  assert.equal(shouldRestore(rec, "v1"), true);
  assert.equal(shouldRestore(rec, "v2"), false);
  assert.equal(shouldRestore(rec, "my edit"), false);
  assert.equal(shouldRestore(null, ""), false);
});

test("form drafts parse back to values and bases", () => {
  const text = JSON.stringify({ values: { title: "T", question: "Q" }, bases: { title: "", question: "" } });
  assert.deepEqual(parseFormDraft(text)?.values, { title: "T", question: "Q" });
  assert.equal(parseFormDraft("nope"), null);
  assert.equal(parseFormDraft(JSON.stringify({ values: {} })), null);
});
