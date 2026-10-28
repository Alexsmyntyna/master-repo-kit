import test from "node:test";
import assert from "node:assert/strict";
import { parseCard, pendingDecisions, stripBlocks, toWeeks } from "../src/lib/decisions";
import type { Thread } from "../src/lib/threads";

const body = `Ship from main.

\`\`\`release
verdict: push
\`\`\`

\`\`\`options
ask: Ship from main or restart in React Native?
A | Restart in React Native | time: 3–5 months | complexity: high | growth: medium | costs: no releases this quarter
B* | Ship 1.3 from main weekly | time: 1 week | complexity: low | growth: Medium | gives up: no Android
revisit: real Android demand
\`\`\``;

test("an options block becomes a card with options to scale", () => {
  const card = parseCard(body);
  assert.ok(card);
  assert.equal(card.ask, "Ship from main or restart in React Native?");
  assert.deepEqual(
    card.options.map((o) => [o.key, o.recommended, o.weeks, o.complexity, o.growth]),
    [
      ["A", false, 21.65, "high", "medium"],
      ["B", true, 1, "low", "medium"],
    ],
  );
  assert.equal(card.options[1].costs, "no Android");
  assert.equal(card.revisit, "real Android demand");
  assert.equal(stripBlocks(body), "Ship from main.");
  assert.equal(parseCard("No block."), undefined);
  assert.equal(parseCard("```options\nA | Only one\n```")?.options[0].recommended, true);
});

test("time reads as weeks", () => {
  assert.equal(toWeeks("3 days"), 0.6);
  assert.equal(toWeeks("2-3 weeks"), 3);
  assert.equal(toWeeks("20 hours"), 0.5);
  assert.equal(toWeeks("a while"), null);
});

const thread = (scope: string, date: string, extra: Partial<Thread> = {}): Thread => ({
  scope,
  id: `${date}-x`,
  path: `companies/${scope}/threads/${date}-x`,
  title: "T",
  status: "awaiting-owner",
  summary: "",
  decision: "Do it",
  participants: ["owner", "coo"],
  checkin: false,
  talk: false,
  chat: false,
  projects: [scope],
  models: {},
  helpers: true,
  started: date,
  updated: date,
  consults: [], supersededBy: "",
  messages: [
    { path: "m", from: "coo", to: "owner", kind: "decision", subject: "", date, body, refs: [], usage: {}, attachments: [] },
  ],
  ...extra,
});

test("pending decisions: focus first, then oldest, only what waits on the owner", () => {
  const list = pendingDecisions(
    [thread("small", "2026-10-01"), thread("big", "2026-10-09"), thread("big", "2026-10-05", { status: "open" })],
    { big: "Big", small: "Small" },
    ["big"],
    new Date("2026-10-10T12:00:00Z"),
  );
  assert.deepEqual(
    list.map((p) => [p.project, p.waitingDays, p.verdict, !!p.card]),
    [
      ["Big", 1, "push", true],
      ["Small", 9, "push", true],
    ],
  );
});
