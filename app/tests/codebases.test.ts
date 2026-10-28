import assert from "node:assert/strict";
import { test } from "node:test";
import { readNote } from "../src/lib/codebases";
import { activityFrom } from "../src/lib/activity";

test("codebase notes survive colons in values and read lists", () => {
  const n = readNote("---\ntitle: X\nsummary: Python: film sim\nrelated: [camera-app, asset-tool]\n---\n\nBody.");
  assert.equal(n.meta.summary, "Python: film sim");
  assert.deepEqual(n.meta.related, ["camera-app", "asset-tool"]);
  assert.equal(n.body, "Body.");
});

test("four-week run: rolling weeks ending today, and freshness past the window", () => {
  const today = new Date(2026, 9, 10);
  const a = activityFrom(["2026-10-10", "2026-10-10", "2026-10-04", "2026-09-13", "2026-09-12"], "2026-10-10", today);
  assert.equal(a.days.length, 28);
  assert.equal(a.days[27], 2);
  assert.deepEqual(a.weeks, [1, 0, 0, 3]);
  assert.equal(a.freshness, "moving");
  assert.equal(activityFrom([], "2026-08-01", today).freshness, "stale");
  assert.equal(activityFrom([], "2026-05-01", today).freshness, "old");
  assert.equal(activityFrom([], "", today).freshness, "none");
});
