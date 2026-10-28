import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrief, parseFlow, parseStats } from "../src/lib/brief";

const body = `Approve option A: ship 1.3.x from main within a week.

**Decision:** The COO plans week 1 from main.

**What it costs:**

- No Android this quarter.
- No RN spike.

**Non-negotiable in week 1:** Fix roll joining first.

**What would make me revisit:**

- Main can't upload in two weeks.

Any one of these reopens the RN spike.

\`\`\`stats
82/100 | Dispo reviews at 3★ or less | last 100
4.8★ | Lapse
\`\`\`

**Questions for the COO before planning:**

1. Is 1.3 live?
2. Which 1.4 piece first?

\`\`\`flow
Ship 1.3.x | week 1 | now
One 1.4 piece | week 2–3
Done before | | done
\`\`\`

\`\`\`mockups
A | Roll | holding/mockups/x/a-roll.html
\`\`\``;

test("a message becomes lead, callouts, sections, stats and flow", () => {
  const b = parseBrief(body);
  assert.equal(b.lead, "Approve option A: ship 1.3.x from main within a week.");
  assert.deepEqual(
    b.blocks.map((x) => [x.type, "label" in x ? x.label : "", "tone" in x ? x.tone : ""]),
    [
      ["callout", "Decision", "decision"],
      ["section", "What it costs", "cost"],
      ["callout", "Non-negotiable in week 1", "risk"],
      ["section", "What would make me revisit", "risk"],
      ["stats", "", ""],
      ["section", "Questions for the COO before planning", "question"],
      ["flow", "", ""],
    ],
  );
  const revisit = b.blocks[3];
  assert.ok(revisit.type === "section" && revisit.text.endsWith("reopens the RN spike."));
  assert.ok(!JSON.stringify(b).includes("mockups"));
});

test("stats and flow lines", () => {
  assert.deepEqual(parseStats("82/100 | reviews | last 100\nnot a stat"), [
    { value: "82/100", label: "reviews", note: "last 100" },
  ]);
  assert.deepEqual(parseFlow("1. Ship | week 1 | now\n- Plan"), [
    { label: "Ship", note: "week 1", state: "now" },
    { label: "Plan", note: "", state: "" },
  ]);
});

test("plain markdown stays markdown, and a list is never the lead", () => {
  const b = parseBrief("- one\n- two\n\nAfter.");
  assert.equal(b.lead, "");
  assert.deepEqual(b.blocks, [{ type: "md", text: "- one\n- two\n\nAfter." }]);
  const c = parseBrief("```ts\nconst a = 1;\n\nconst b = 2;\n```");
  assert.equal(c.blocks.length, 1);
});

test("a reconcile block lists the other questions an answer changed, linking only to real threads", async () => {
  const { parseBrief } = await import("../src/lib/brief");
  const b = parseBrief("Going with RN.\n\n```reconcile\ncompanies/camera-app/threads/2026-10-10-swift | withdraw | Swift is out\nholding/threads/x-y | redo | new copy\n../etc/passwd | withdraw | no\n```");
  const r = b.blocks.find((x) => x.type === "reconcile");
  assert.ok(r && r.type === "reconcile");
  assert.deepEqual(r.items.map((i) => [i.action, i.href]), [
    ["withdraw", "/threads/camera-app/2026-10-10-swift"],
    ["redo", "/threads/holding/x-y"],
  ]);
});

// The portfolio check-in (companies/portfolio/threads/2026-10-10-check-in-2026-10-10/002-coo.md) ends on one label.
test("a lone label stays an inline paragraph; two in a row become parts", () => {
  const lone = parseBrief(
    "The site returns 200 on `/` and `/blog`.\n\n**3. Will this reach people?** Yes.\n\n**Smallest test:** read 30 days of traffic.\n\n```release\nverdict: maintain\n```",
  );
  assert.equal(lone.lead, "The site returns 200 on `/` and `/blog`.");
  assert.deepEqual(lone.blocks, [
    { type: "md", text: "**3. Will this reach people?** Yes.\n\n**Smallest test:** read 30 days of traffic." },
  ]);

  const section = parseBrief("Lead.\n\n**What it costs:**\n- No Android.");
  assert.deepEqual(section.blocks, [{ type: "md", text: "**What it costs:**\n\n- No Android." }]);

  const pair = parseBrief("Lead.\n\n**Smallest test:** read the traffic.\n\n**Revisit if:** nobody reads it.");
  assert.deepEqual(pair.blocks.map((b) => b.type), ["callout", "callout"]);
});
