import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Card } from "../src/lib/cards";
import { markOlder } from "../src/lib/timeline";

// cards.ts reads MASTER_REPO_ROOT through repository.ts at import, so the data directory is set before the dynamic
// imports below.
const lib = () => import("../src/lib/cards");
let root = "";
const write = async (rel: string, data: unknown) => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), typeof data === "string" ? data : JSON.stringify(data));
};
before(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "mr-cards-")));
  for (const id of ["full", "bare", "stub", "broken", "loose"]) await write(`companies/${id}/company.json`, { id, name: id });
  await write("companies/full/card.json", {
    slug: "full",
    kind: "sell",
    goal: { text: "First sale.", source: "owner", ref: "x.md", date: "2026-10-12" },
    gates: [
      { name: "live site", state: "done", source: "owner" },
      { name: "payments", state: "maybe" },
      { note: "no name, dropped" },
    ],
    blocker: { text: "eBay keys.", source: "owner" },
    next: null,
    moved: { last_commit: "2026-10-12", idle_days: 12, commits_30d: 16 },
    owes: { decisions: 1, builds_review: 0 },
    footprint: { hosting: ["digitalocean"], database: ["mongodb"], summary: "DigitalOcean + MongoDB" },
    hygiene: { score: "fair", reasons: ["3 stray files"] },
  });
  await write("companies/stub/card.json", { slug: "stub", needs: "goal and gates from the owner" });
  await write("companies/stub/footprint.json", { repos: [{ hosting: ["vercel"] }, { database: ["sqlite"] }] });
  await write("companies/stub/hygiene.json", { repos: [{ score: "good", untracked: 1 }, { score: "poor", untracked: 4, reasons: ["CLAUDE.md 900 lines"] }] });
  await write("companies/broken/card.json", "{ not json");
  await write("companies/loose/card.json", { goal: "A plain string goal", blocker: null, moved: null });
  await write("holding/pulse.json", { projects: [{ slug: "bare", tier: "paused", last_commit: "2026-08-01", idle_days: 84, commits_30d: 0 }] });
  process.env.MASTER_REPO_ROOT = root;
});
after(async () => {
  delete process.env.MASTER_REPO_ROOT;
  await rm(root, { recursive: true, force: true });
});

test("cards load from card.json, footprint.json, hygiene.json and pulse, tolerating missing and broken files", async () => {
  const { cardFor } = await lib();
  const full = await cardFor("full");
  assert.equal(full.written, true);
  assert.equal(full.kind, "sell");
  assert.equal(full.goal?.source, "owner");
  assert.deepEqual(full.gates.map((g) => [g.name, g.state]), [["live site", "done"], ["payments", "unknown"]]);
  assert.equal(full.next, null);
  assert.equal(full.owes?.decisions, 1);
  assert.equal(full.hygiene?.score, "fair");

  const bare = await cardFor("bare"); // no card, no footprint, no hygiene: movement from pulse
  assert.equal(bare.written, false);
  assert.equal(bare.goal, null);
  assert.equal(bare.footprint, null);
  assert.equal(bare.hygiene, null);
  assert.equal(bare.moved?.idle_days, 84);
  assert.equal(bare.tier, "paused");

  const stub = await cardFor("stub"); // `needs` marks an unwritten card; the scans still show
  assert.equal(stub.written, false);
  assert.equal(stub.needs, "goal and gates from the owner");
  assert.deepEqual(stub.footprint?.hosting, ["vercel"]);
  assert.deepEqual(stub.footprint?.database, ["sqlite"]);
  assert.equal(stub.hygiene?.score, "poor"); // the worst repo counts
  assert.equal(stub.hygiene?.untracked, 5);
  assert.equal(stub.moved, null);

  const broken = await cardFor("broken");
  assert.equal(broken.written, false);

  const loose = await cardFor("loose"); // a string where a claim is expected, nulls where records are
  assert.equal(loose.written, true);
  assert.equal(loose.goal?.text, "A plain string goal");
  assert.equal(loose.blocker, null);
  assert.equal(loose.moved, null);

  const { allCards } = await lib();
  assert.equal((await allCards()).length, 5); // every project, card or not
});

test("costing, not moving: hosting or a database, and idle over 30 days", async () => {
  const { costingNotMoving, parseCard } = await lib();
  const card = (fp: unknown, idle: number | null) => parseCard("x", { card: { footprint: fp, moved: { idle_days: idle } } });
  assert.equal(costingNotMoving(card({ hosting: ["digitalocean"] }, 31)), true);
  assert.equal(costingNotMoving(card({ database: ["mongodb"] }, 90)), true);
  assert.equal(costingNotMoving(card({ hosting: ["digitalocean"] }, 30)), false); // exactly 30 isn't over
  assert.equal(costingNotMoving(card({ payments: ["stripe"], domains: ["x.com"] }, 200)), false); // neither hosting nor database
  assert.equal(costingNotMoving(card({ hosting: ["fly"] }, null)), false); // unknown movement isn't idle
  assert.equal(costingNotMoving(parseCard("x", {})), false);
});

test("board order: owes or costing-not-moving first, then least idle, unknown idle last", async () => {
  const { dialsOf, parseCard, sortCards } = await lib();
  const c = (slug: string, idle: number | null, extra: Record<string, unknown> = {}): Card =>
    parseCard(slug, { card: { moved: idle === null ? undefined : { idle_days: idle }, ...extra } });
  const cards = [
    c("quiet", 50),
    c("fresh", 1),
    c("unknown", null),
    c("owes", 20, { owes: { decisions: 0, builds_review: 2 } }),
    c("costly", 90, { footprint: { hosting: ["digitalocean"] } }),
    c("owes-fresh", 3, { owes: { threads_awaiting: 1 } }),
    c("cheap-idle", 90, { footprint: { payments: ["stripe"] } }),
  ];
  assert.deepEqual(sortCards(cards).map((x) => x.slug), ["owes-fresh", "owes", "costly", "fresh", "quiet", "cheap-idle", "unknown"]);
  const dials = dialsOf(cards);
  assert.equal(dials.buildsReview, 2);
  assert.equal(dials.costing, 1);
  assert.equal(dials.decisions, 0);
});

test("recheck flags: card lines carry them, the card counts them apart from owes, the dial adds them up", async () => {
  const { dialsOf, parseCard, owed } = await lib();
  const c = parseCard("x", {
    card: {
      recheck: 2,
      owes: { decisions: 1 },
      blocker: { text: "No keys", date: "2026-10-10", recheck: { commits: 3, since: "2026-10-10" } },
      next: { text: "Check keys", recheck: { verdict: "resolved", reason: "Done in abc123" }, rechecked: "2026-10-24" },
      goal: { text: "Ship" },
    },
  });
  assert.deepEqual(c.blocker?.recheck, { commits: 3, since: "2026-10-10", running: false, verdict: "", reason: "", rechecked: "" });
  assert.equal(c.next?.recheck?.verdict, "resolved");
  assert.equal(c.goal?.recheck, undefined);
  assert.equal(owed(c), 1);
  assert.equal(dialsOf([c, parseCard("y", {})]).recheck, 2);
});

test("footprint and hygiene take per-repo records and named items", async () => {
  const { footprintOf, hygieneOf } = await lib();
  assert.deepEqual(footprintOf({ hosting: [{ name: "dockerfile", path: "Dockerfile", source: "code" }] })?.hosting, ["dockerfile"]);
  assert.equal(footprintOf(null), null);
  assert.equal(hygieneOf({ score: "excellent" })?.score, null);
});

test("timeline marks things over 30 days older than the newest of their kind", () => {
  const events = [
    { kind: "note", date: "2026-10-20" },
    { kind: "note", date: "2026-09-21" }, // 29 days
    { kind: "note", date: "2026-09-01" }, // 49 days
    { kind: "report", date: "2026-08-01" }, // newest of its kind
    { kind: "git", date: "2025-01-01" }, // not aging
  ];
  assert.deepEqual(
    markOlder(events, ["note", "report"]).map((e) => !!(e as { older?: boolean }).older),
    [false, false, true, false, false],
  );
});
