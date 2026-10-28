import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  formatAmount,
  nextSteps,
  ordered,
  parseAmount,
  parseCompany,
  parseMoney,
  parseSetup,
  productChanges,
  setProductMoney,
  setupCounts,
  toggleStep,
  waitingOn,
} from "../src/lib/company";

const setup = parseSetup({
  updated: "2026-10-11",
  groups: [
    { id: "name", title: "Name", steps: [{ id: "pick", text: "Pick the name", who: "owner", done: false, blocked_by: null, source: "x" }] },
    {
      id: "entity",
      title: "Entity",
      steps: [
        { id: "state", text: "Decide the state", who: "owner", done: true, done_on: "2026-10-12", blocked_by: null, source: "x" },
        { id: "llc", text: "File the LLC", who: "owner", done: false, blocked_by: ["pick", "state"], source: "x" },
        { id: "draft", text: "Draft questions", who: "agent", done: false, blocked_by: "state", source: "x" },
      ],
    },
  ],
});

test("setup steps: counts, what blocks a step, and the next ones nothing blocks first", () => {
  assert.deepEqual(setupCounts(setup), { done: 1, total: 4 });
  const llc = setup.groups[1].steps[1];
  assert.deepEqual(waitingOn(setup, llc).map((s) => s.id), ["pick"]); // "state" is done, so it no longer blocks
  assert.deepEqual(setup.groups[1].steps[2].blocked_by, ["state"]); // a single id reads as a list
  assert.deepEqual(nextSteps(setup, 3).map((s) => s.id), ["pick", "draft", "llc"]);
  assert.deepEqual(ordered(setup.groups[1].steps).map((s) => s.id), ["llc", "draft", "state"]); // done sink
});

test("ticking a step sets done and the date; unticking clears the date; unknown steps are refused", () => {
  const ticked = toggleStep(setup, "llc", true, "2026-10-13");
  const llc = ticked.groups[1].steps[1];
  assert.equal(llc.done, true);
  assert.equal(llc.done_on, "2026-10-13");
  assert.equal(llc.done_by, "owner"); // the checkbox only ever writes owner
  assert.equal(ticked.updated, "2026-10-13");
  assert.equal(setup.groups[1].steps[1].done, false); // the input isn't changed
  const unticked = toggleStep(ticked, "llc", false, "2026-10-14").groups[1].steps[1];
  assert.equal(unticked.done_on, null);
  assert.equal(unticked.done_by, undefined);
  assert.throws(() => toggleStep(setup, "nope", true, "2026-10-13"), /Unknown step/);
});

test("a step an agent did is recorded with done_by and evidence; anything else in done_by is ignored", () => {
  const steps = parseSetup({
    groups: [
      {
        id: "name",
        steps: [
          { id: "c", text: "Bring candidates", who: "agent", done: true, done_by: "agent", evidence: "holding/threads/t/002-ceo.md", source: "x" },
          { id: "d", text: "Other", who: "agent", done: true, done_by: "robot", evidence: "", source: "x" },
        ],
      },
    ],
  }).groups[0].steps;
  assert.equal(steps[0].done_by, "agent");
  assert.equal(steps[0].evidence, "holding/threads/t/002-ceo.md");
  assert.equal("done_by" in steps[1], false);
  assert.equal("evidence" in steps[1], false);
  // the owner unticking an agent's step clears who did it and the evidence.
  const back = toggleStep({ updated: "", groups: [{ id: "name", title: "Name", steps }] }, "c", false, "2026-10-12").groups[0].steps[0];
  assert.deepEqual([back.done, back.done_by, back.evidence], [false, undefined, undefined]);
});

test("money: amounts the owner types, never a guessed number", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("  "), null);
  assert.equal(parseAmount("1,200"), 1200);
  assert.equal(parseAmount("$1200.50"), 1200.5);
  for (const bad of ["-5", "abc", "1.234", "1e5", "12 000"]) assert.equal(parseAmount(bad), undefined, bad);
  assert.equal(formatAmount(null), "—");
  assert.equal(formatAmount(0), "$0");
  assert.equal(formatAmount(1200), "$1,200");
  const money = parseMoney({ products: { a: { model: "Ads", state: "unknown", goal_monthly: "12", actual_monthly: null } } });
  assert.equal(money.products.a.goal_monthly, null); // a string isn't a figure
  assert.equal(money.currency, "USD");
  assert.equal(setProductMoney(money, "a", 50, null, "2026-10-12").products.a.goal_monthly, 50);
  assert.throws(() => setProductMoney(money, "b", 1, 1, "2026-10-12"), /Unknown product/);
});

test("money table: one save takes only the products that changed, and refuses it all on a bad amount", () => {
  const money = parseMoney({
    products: { a: { goal_monthly: 100, actual_monthly: null }, b: { goal_monthly: null, actual_monthly: null } },
  });
  const typed = { a: { goal: "100", actual: "" }, b: { goal: "1,200", actual: "" } };
  assert.deepEqual(productChanges(money, typed), { changes: [{ slug: "b", goal: 1200, actual: null }] }); // empty stays null, never 0
  assert.deepEqual(productChanges(money, { a: { goal: "", actual: "" } }), { changes: [{ slug: "a", goal: null, actual: null }] });
  assert.match((productChanges(money, { ...typed, a: { goal: "lots", actual: "" } }) as { error: string }).error, /^a: amounts/);
  assert.deepEqual(productChanges(money, { c: { goal: "1", actual: "" } }), { error: "Unknown product." });
});

test("holding fixtures parse, with unique step ids and blockers that exist", () => {
  const root = path.resolve(import.meta.dirname, "fixtures");
  const read = (f: string) => JSON.parse(readFileSync(path.join(root, "holding", f), "utf8"));
  const real = parseSetup(read("setup.json"));
  const ids = real.groups.flatMap((g) => g.steps.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length, "step ids are unique");
  for (const s of real.groups.flatMap((g) => g.steps)) for (const b of s.blocked_by || []) assert.ok(ids.includes(b), `${s.id} → ${b}`);
  for (const s of real.groups.flatMap((g) => g.steps).filter((s) => s.done_by === "agent")) {
    assert.equal(s.who, "agent", `${s.id}: only an agent's step is done by an agent`);
    assert.ok(s.evidence && existsSync(path.join(root, s.evidence)), `${s.id}: evidence ${s.evidence} exists`);
  }
  const money = parseMoney(read("money.json"));
  assert.ok(Object.keys(money.products).length > 0);
  assert.deepEqual(parseCompany({ name: "  " }), { name: null, legal_name: null, entity: null, updated: "" });
  assert.ok("name" in parseCompany(read("company.json")));
});
