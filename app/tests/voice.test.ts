import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerSaid, isGenerated } from "../src/lib/voice";
import type { Message, Thread } from "../src/lib/threads";

const msg = (from: Message["from"], body: string, date: string): Message =>
  ({ path: "", from, to: "ceo", kind: "reply", subject: "", date, body, refs: [], usage: {}, attachments: [] }) as Message;
const thread = (projects: string[], messages: Message[]) =>
  ({ scope: projects[0], id: "t", path: `t-${projects[0]}`, title: "T", projects, messages, updated: "" }) as unknown as Thread;

test("the owner's words are his own messages, newest first; prompts a tool wrote for him are left out", () => {
  const threads = [
    thread(["finance-app"], [
      msg("owner", "Standing check-in (scheduled by tools/portfolio.py): no release card yet.", "2026-10-10"),
      msg("coo", "The COO's answer", "2026-10-10"),
      msg("owner", "FinanceApp needs a mobile app", "2026-10-10"),
      msg("owner", "Approved.", "2026-10-11"),
    ]),
    thread(["holding", "finance-app"], [msg("owner", "Older thought about FinanceApp", "2026-09-01")]),
    thread(["camera-app"], [msg("owner", "About CameraApp", "2026-10-11")]),
  ];
  assert.deepEqual(
    ownerSaid(threads, "finance-app").map((s) => s.text),
    ["FinanceApp needs a mobile app", "Older thought about FinanceApp"],
  );
});

test("every tool-written message is recognised, and plain words are not", () => {
  for (const body of [
    "Standing check-in (scheduled by tools/portfolio.py): due.",
    "Market check. Build or refresh the market file.",
    "Restate this so I can decide at a glance.",
    "Approved.",
    "context-notepad-hub v3 answers: 1a, 2c",
    "Commit everything you made for this brief on your branch, in clear commits.",
  ])
    assert.ok(isGenerated(body), body);
  for (const body of ["FinanceApp needs a mobile app", "Approved, but keep the web app", "v2 of the hub looks better"]) assert.ok(!isGenerated(body), body);
});
