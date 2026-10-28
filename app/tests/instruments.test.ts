import assert from "node:assert/strict";
import { test } from "node:test";
import { weeklyCommits } from "../src/lib/sparkline";
import { gateCounts } from "../src/lib/cards";
import { ruleOf } from "../src/lib/ledger";

test("weeklyCommits spreads a stretch evenly over its days and buckets by week, oldest first", () => {
  // 14 commits over 14 days ending today: 7 in each of the last two weeks.
  const snap = { generated: "2026-10-24", repos: [{ segments: [{ from: "2026-10-11", to: "2026-10-24", commits: 14 }] }] };
  const w = weeklyCommits(snap, 12, "2026-10-24");
  assert.equal(w.length, 12);
  assert.deepEqual(w.slice(-2), [7, 7]);
  assert.equal(w.slice(0, 10).every((n) => n === 0), true);
});

test("weeklyCommits sums repos, ignores work before the window, and leaves unread weeks unknown", () => {
  const snap = {
    generated: "2026-10-10",
    repos: [
      { segments: [{ from: "2026-01-01", to: "2026-01-05", commits: 50 }, { from: "2026-10-04", to: "2026-10-04", commits: 3 }] },
      { segments: [{ from: "2026-10-04", to: "2026-10-04", commits: 2 }] },
    ],
  };
  const w = weeklyCommits(snap, 4, "2026-10-24");
  // weeks start Sep 27, Oct 4, Oct 11, Oct 18; the last two begin after the snapshot was read
  assert.deepEqual(w, [0, 5, null, null]);
});

test("weeklyCommits is empty without a snapshot or stretches", () => {
  assert.deepEqual(weeklyCommits(null), []);
  assert.deepEqual(weeklyCommits({ repos: [{ segments: [] }] }), []);
});

test("gateCounts counts gates by state", () => {
  const c = gateCounts([{ state: "done" }, { state: "open" }, { state: "done" }, { state: "unknown" }]);
  assert.deepEqual(c, { done: 2, open: 1, unknown: 1, total: 4 });
  assert.deepEqual(gateCounts([]), { done: 0, open: 0, unknown: 0, total: 0 });
});

test("ruleOf splits a standards line into rule, source, reference and date", () => {
  const r = ruleOf("- Keep it plain and simple. (owner: skills/writing.md, 2026-10)");
  assert.deepEqual(r, { text: "Keep it plain and simple.", who: "owner", ref: "skills/writing.md", date: "2026-10", struck: false });
  assert.equal(ruleOf("- No source here.").who, "");
});
