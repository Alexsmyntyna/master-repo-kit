import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addCadence,
  bucketOf,
  calendarItems,
  markDone,
  nextDate,
  parseCalendar,
  pulseItems,
  setCadence,
  toggleCalendarStep,
} from "../src/lib/calendar";
import type { Pulse } from "../src/lib/pulse";

const cal = parseCalendar({
  entries: [
    { id: "wedding", title: "Wedding", kind: "due", date: "2026-10-15", steps: [{ id: "a", text: "Arrival", done: false }] },
    { id: "do", title: "DigitalOcean", kind: "check", cadence: "monthly", last_done: null },
    { id: "site", title: "Site", kind: "check", cadence: null },
    { id: "bad" },
  ],
});

test("parses entries and drops ones without an id and title", () => {
  assert.deepEqual(cal.entries.map((e) => e.id), ["wedding", "do", "site"]);
  assert.equal(cal.entries[0].steps[0].done, false);
});

test("cadence arithmetic clamps to the end of the month", () => {
  assert.equal(addCadence("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(addCadence("2026-10-12", "weekly"), "2026-10-19");
  assert.equal(addCadence("2026-11-30", "quarterly"), "2027-02-28");
});

test("a check never done is due today; done moves it a cadence on; no cadence is unscheduled", () => {
  const today = "2026-10-12";
  assert.equal(nextDate(cal.entries[1], today), today);
  const done = markDone(cal, "do", today);
  assert.equal(nextDate(done.entries[1], today), "2026-11-12");
  assert.equal(nextDate(cal.entries[2], today), null);
  assert.equal(nextDate(setCadence(cal, "site", "weekly", today).entries[2], today), today);
  assert.throws(() => markDone(cal, "wedding", today));
});

test("buckets by days from today", () => {
  const t = "2026-10-12";
  assert.equal(bucketOf("2026-10-11", t), "overdue");
  assert.equal(bucketOf(t, t), "today");
  assert.equal(bucketOf("2026-10-15", t), "week");
  assert.equal(bucketOf("2026-11-01", t), "later");
  assert.equal(bucketOf(null, t), "unscheduled");
});

test("a past due day drops off once its steps are done, not before", () => {
  const after = "2026-10-16";
  assert.ok(calendarItems(cal, [], after).some((i) => i.key === "wedding"));
  const ready = toggleCalendarStep(cal, "wedding", "a", true, "2026-10-14");
  assert.equal(ready.entries[0].steps[0].done_on, "2026-10-14");
  assert.ok(!calendarItems(ready, [], after).some((i) => i.key === "wedding"));
});

test("pulse rows: booked check-ins on their date, quiet kept projects today, the rest left out", () => {
  const p = (slug: string, tier: string, state: Pulse["state"], next_check: string | null = null) =>
    ({ slug, tier, state, last_commit: null, idle_days: 40, commits_30d: 0, unread: 0, next_check }) as Pulse;
  const rows = pulseItems(
    [p("a", "focus", "cooling"), p("b", "paused", "dormant"), p("c", "maintain", "active"), p("d", "paused", "dormant", "2027-01-08")],
    "2026-10-12",
  );
  assert.deepEqual(rows.map((r) => [r.project, r.title, r.when]), [
    ["a", "Gone quiet", "2026-10-12"],
    ["d", "Check-in", "2027-01-08"],
  ]);
});

test("holding/calendar.json parses with no entry dropped", () => {
  const file = path.resolve(import.meta.dirname, "fixtures/holding/calendar.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parseCalendar(raw).entries.length, raw.entries.length);
});

test("grids: Monday-first weeks and whole weeks around a month", async () => {
  const { weekDays, monthGrid, timeLabel } = await import("../src/lib/calendar");
  assert.deepEqual([weekDays("2026-10-15")[0], weekDays("2026-10-15")[6]], ["2026-10-12", "2026-10-18"]);
  const m = monthGrid("2026-10-20");
  assert.equal(m[0], "2026-09-28");
  assert.equal(m.length % 7, 0);
  assert.equal(m.at(-1), "2026-11-01");
  assert.equal(timeLabel("16:30"), "4:30pm");
  assert.equal(timeLabel("10:00"), "10am");
});

test("occurrences: blocks on their day, a check repeats by cadence and shows where it was done", async () => {
  const { occurrences } = await import("../src/lib/calendar");
  const c = parseCalendar({
    entries: [
      { id: "b", title: "Block", kind: "block", date: "2026-10-12", time: "19:00", steps: [{ id: "s", text: "x", done: true }] },
      { id: "w", title: "Weekly", kind: "check", cadence: "weekly", last_done: "2026-10-05" },
    ],
  });
  const got = occurrences(c, [], "2026-10-01", "2026-10-31", "2026-10-12").map((i) => [i.key, i.when, i.done]);
  assert.deepEqual(got, [
    ["w@2026-10-05", "2026-10-05", true],
    ["b", "2026-10-12", true],
    ["w@2026-10-12", "2026-10-12", false],
    ["w@2026-10-19", "2026-10-19", false],
    ["w@2026-10-26", "2026-10-26", false],
  ]);
});

test("a date from the URL must be a real day in range; the month grid never exceeds six weeks", async () => {
  const { validDay, monthGrid } = await import("../src/lib/calendar");
  assert.equal(validDay("2026-10-12"), "2026-10-12");
  for (const bad of ["2026-02-30", "2026-13-01", "9999-12-31", "0001-01-01", "x", undefined]) assert.equal(validDay(bad), null);
  assert.ok(monthGrid("2026-02-10").length <= 42);
});

test("writing back keeps key order, unknown keys and untouched raw values; new entries go in field order", async () => {
  const { serializeCalendar, addEntry, removeEntry, entryFromFields } = await import("../src/lib/calendar");
  const raw = {
    updated: "2026-10-01",
    extra: 1,
    entries: [
      { id: "w", mine: "kept", title: "Wedding", kind: "due", date: null, source: { source: "owner", ref: "dump", date: "2026-10-12", why: "x" } },
      { id: "gone", title: "Gone", kind: "due" },
    ],
  };
  let c = parseCalendar(raw);
  const made = entryFromFields(
    { title: "List 5 more", kind: "block", date: "2026-10-16", time: "18:30", end: "20:30", steps: "- Shoot\n[ ] List\n\n" },
    { today: "2026-10-12", taken: c.entries.map((e) => e.id), projects: [], source: { source: "owner", ref: "Typed", date: "2026-10-12" } },
  );
  assert.ok("entry" in made);
  c = removeEntry(addEntry(c, made.entry, "2026-10-12"), "gone", "2026-10-12");
  const out = serializeCalendar(raw, c) as { updated: string; extra: number; entries: Record<string, unknown>[] };
  assert.equal(out.extra, 1);
  assert.equal(out.updated, "2026-10-12");
  assert.deepEqual(Object.keys(out.entries[0]), ["id", "mine", "title", "kind", "date", "source"]);
  assert.equal((out.entries[0].source as { why: string }).why, "x"); // unchanged, so the raw object stays
  assert.equal(out.entries[0].date, null); // null was there: kept as "not known yet"
  assert.deepEqual(Object.keys(out.entries[1]), ["id", "title", "kind", "date", "time", "end", "steps", "source"]);
  assert.deepEqual((out.entries[1].steps as { text: string }[]).map((s) => s.text), ["Shoot", "List"]);
});

test("the entry form: checked fields, a fresh id, steps keep their state when edited", async () => {
  const { entryFromFields } = await import("../src/lib/calendar");
  const opts = { today: "2026-10-12", taken: ["wedding"], projects: ["shop"], source: null };
  const err = (f: Record<string, string>) => ("error" in entryFromFields(f, opts) ? (entryFromFields(f, opts) as { error: string }).error : "");
  assert.match(err({ title: "" }), /title/);
  assert.match(err({ title: "x", kind: "block" }), /day/);
  assert.match(err({ title: "x", date: "2026-02-30" }), /real day/);
  assert.match(err({ title: "x", date: "2026-10-16", time: "18:00", end: "17:00" }), /after/);
  assert.match(err({ title: "x", date: "2026-10-16", project: "nope" }), /project/);
  const r = entryFromFields({ title: "Wedding", kind: "due", date: "2026-11-01" }, opts);
  assert.ok("entry" in r && r.entry.id === "wedding-2026-11-01");
  const check = entryFromFields({ title: "DO", kind: "check", cadence: "weekly", date: "2026-10-16", time: "09:00" }, opts);
  assert.ok("entry" in check && check.entry.date === null && check.entry.time === null && check.entry.cadence === "weekly");
  const pin = entryFromFields({ title: "Edit", kind: "block", auto: "on", date: "2026-10-16", time: "17:00", end: "18:00" }, opts);
  assert.ok("entry" in pin && pin.entry.auto && pin.entry.time === "17:00" && pin.entry.end === "18:00"); // a pin survives an edit
  const loose = entryFromFields({ title: "Edit", kind: "block", auto: "on", spread: "on", hours: "6" }, opts);
  assert.ok("entry" in loose && loose.entry.date === null && loose.entry.time === null && loose.entry.spread && loose.entry.hours === 6);
  const prev = cal.entries[0];
  const done = toggleCalendarStep(cal, "wedding", "a", true, "2026-10-12").entries[0];
  const edited = entryFromFields({ title: "Wedding", kind: "due", date: "2026-10-15", steps: "Arrival\nFamilies" }, { ...opts, prev: done });
  assert.ok("entry" in edited);
  assert.equal(edited.entry.id, prev.id);
  assert.deepEqual(edited.entry.steps.map((s) => [s.text, s.done]), [["Arrival", true], ["Families", false]]);
});

test("the hour grid: overlaps side by side, open windows between", async () => {
  const { placeDay, openWindows } = await import("../src/lib/calendar");
  const it = (key: string, time: string | null, end: string | null) =>
    ({ key, title: key, kind: "block", when: "2026-10-13", time, end, done: false, from: "calendar", project: null, detail: null }) as const;
  const day = [it("work", "09:00", "18:00"), it("call", "12:00", "12:30"), it("am", "07:00", "07:30"), it("eve", "18:30", null), it("allday", null, null)];
  const placed = Object.fromEntries(placeDay([...day]).map((p) => [p.item.key, p]));
  assert.equal(placed.allday, undefined);
  assert.deepEqual([placed.work.col, placed.call.col, placed.work.cols, placed.call.cols], [0, 1, 2, 2]);
  assert.deepEqual([placed.am.cols, placed.eve.end - placed.eve.start], [1, 30]);
  assert.deepEqual(openWindows([...day], 7 * 60, 22 * 60), [
    [450, 540],
    [1140, 1320],
  ]);
});

test("auto work: fills free work-day time around timed entries, rolls leftovers on, a step a day when spread", async () => {
  const { schedule, calendarItems, occurrences, setEntryDone, workLeft } = await import("../src/lib/calendar");
  const steps = (n: number, done = 0) => Array.from({ length: n }, (_, k) => ({ id: `s${k}`, text: `Step ${k}`, done: k < done }));
  const work = parseCalendar({
    workday: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    entries: [
      { id: "dentist", title: "Dentist", kind: "due", date: "2026-10-26", time: "10:00", end: "11:00" },
      { id: "shoot", title: "Shoot", kind: "block", auto: true, date: "2026-10-26", steps: steps(4, 1) },
      { id: "wedding", title: "Wedding", kind: "block", auto: true, spread: true, date: "2026-10-26", hours: 6, steps: steps(3) },
      { id: "late", title: "Late", kind: "block", auto: true, date: "2026-10-20", steps: steps(2) },
    ],
  });
  assert.equal(workLeft(work.entries[1]), 180); // an hour a step, open steps only
  const slots = schedule(work, "2026-10-26", 9 * 60);
  // Overdue work starts today, ahead of today's: 9–10 before the dentist, then 11–12.
  assert.deepEqual(slots.get("late"), [
    { date: "2026-10-26", start: 540, end: 600 },
    { date: "2026-10-26", start: 660, end: 720 },
  ]);
  assert.deepEqual(slots.get("shoot"), [{ date: "2026-10-26", start: 720, end: 900 }]);
  // Six hours over three steps, spread: two hours a day, Monday's last two hours then Tuesday and Wednesday.
  assert.deepEqual(slots.get("wedding")!.map((s) => [s.date, s.end - s.start]), [
    ["2026-10-26", 120],
    ["2026-10-27", 120],
    ["2026-10-28", 120],
  ]);
  // Saturday isn't a work day: Friday-evening leftovers land on Monday.
  const fri = schedule(work, "2026-10-30", 16 * 60 + 30);
  assert.deepEqual(fri.get("late")!.map((s) => s.date), ["2026-10-30", "2026-11-02"]);
  // Done is its own call; ticked steps don't make it done, marking it does, and it then sits on the day it was done.
  assert.equal(calendarItems(work, [], "2026-10-26", 540).find((i) => i.key.startsWith("shoot"))?.done, false);
  const done = setEntryDone(work, "shoot", true, "2026-10-27");
  assert.equal(done.entries[1].steps.filter((s) => s.done).length, 1);
  assert.ok(!schedule(done, "2026-10-27", 540).has("shoot"));
  assert.deepEqual(
    occurrences(done, [], "2026-10-26", "2026-11-01", "2026-10-27", 540).filter((i) => i.key === "shoot").map((i) => [i.when, i.done]),
    [["2026-10-27", true]],
  );
  assert.ok(!calendarItems(done, [], "2026-10-29", 540).some((i) => i.key === "shoot"));
  assert.equal(setEntryDone(done, "shoot", false, "2026-10-27").entries[1].done_on, null);
});

test("a day at a client pushes auto work into the evening, as late as the work day allows", async () => {
  const { schedule } = await import("../src/lib/calendar");
  const steps = [1, 2, 3].map((k) => ({ id: `s${k}`, text: `Step ${k}`, done: false }));
  const work = parseCalendar({
    entries: [
      { id: "client", title: "Royal Custom Design", kind: "block", date: "2026-10-26", time: "09:00", end: "17:00" },
      { id: "edit", title: "Edit", kind: "block", auto: true, date: "2026-10-26", hours: 6, steps },
    ],
  });
  // The client takes the whole work day; Monday runs on to 9pm (the default `late`), the rest goes to Tuesday.
  assert.deepEqual(schedule(work, "2026-10-26", 8 * 60).get("edit"), [
    { date: "2026-10-26", start: 17 * 60, end: 21 * 60 },
    { date: "2026-10-27", start: 9 * 60, end: 11 * 60 },
  ]);
  // A two-hour meeting pushes the day two hours past five.
  const short = parseCalendar({ ...work, entries: [{ ...work.entries[0], end: "11:00" }, work.entries[1]] });
  assert.deepEqual(schedule(short, "2026-10-26", 8 * 60).get("edit"), [{ date: "2026-10-26", start: 11 * 60, end: 17 * 60 }]);
});

test("a weekly routine is fixed: auto work goes around it and the grids show it", async () => {
  const { schedule, occurrences } = await import("../src/lib/calendar");
  const work = parseCalendar({
    workday: { start: "09:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], routine: [{ title: "Church", days: [0], start: "09:30", end: "13:00" }] },
    entries: [{ id: "edit", title: "Edit", kind: "block", auto: true, date: "2026-10-25", hours: 2 }],
  });
  // Sunday: half an hour before church is enough to start, the rest after it.
  assert.deepEqual(schedule(work, "2026-10-25", 8 * 60).get("edit"), [
    { date: "2026-10-25", start: 540, end: 570 },
    { date: "2026-10-25", start: 780, end: 870 },
  ]);
  const shown = occurrences(work, [], "2026-10-25", "2026-11-01", "2026-10-25", 8 * 60).filter((i) => i.from === "routine");
  assert.deepEqual(shown.map((i) => [i.when, i.time, i.end]), [["2026-10-25", "09:30", "13:00"], ["2026-11-01", "09:30", "13:00"]]);
});

test("spread work never starts in a gap too short for a whole step", async () => {
  const { schedule } = await import("../src/lib/calendar");
  const work = parseCalendar({
    workday: { start: "09:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] },
    entries: [
      { id: "fill", title: "Fill", kind: "block", date: "2026-10-26", time: "09:00", end: "21:30" },
      { id: "wedding", title: "Wedding", kind: "block", auto: true, spread: true, date: "2026-10-26", steps: [{ id: "a", text: "Cull", done: false }] },
    ],
  });
  assert.deepEqual(schedule(work, "2026-10-26", 0).get("wedding"), [{ date: "2026-10-27", start: 540, end: 600 }]);
});

test("dragging to a day moves a due or planned entry there, time kept; checks don't move", async () => {
  const { moveToDay } = await import("../src/lib/calendar");
  const c = parseCalendar({
    entries: [
      { id: "shoot", title: "Shoot", kind: "block", date: "2026-10-26", time: "10:00", end: "12:00" },
      { id: "edit", title: "Edit", kind: "block", auto: true, date: "2026-10-26" },
      { id: "do", title: "DO", kind: "check", cadence: "weekly" },
    ],
  });
  const moved = moveToDay(moveToDay(c, "shoot", "2026-10-28", "2026-10-24"), "edit", "2026-10-30", "2026-10-24");
  assert.deepEqual([moved.entries[0].date, moved.entries[0].time, moved.entries[1].date], ["2026-10-28", "10:00", "2026-10-30"]);
  assert.throws(() => moveToDay(c, "do", "2026-10-28", "2026-10-24"));
  assert.throws(() => moveToDay(c, "shoot", "2026-02-30", "2026-10-24"));
});

test("drops: a time pins it for as long as it took, the top of a day clears the time, a card goes in front of another", async () => {
  const { moveToDay, schedule, occurrences } = await import("../src/lib/calendar");
  const steps = [1, 2].map((k) => ({ id: `s${k}`, text: `Step ${k}`, done: false }));
  const c = parseCalendar({
    workday: { start: "09:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] },
    entries: [
      { id: "a", title: "A", kind: "block", auto: true, date: "2026-10-26", steps },
      { id: "b", title: "B", kind: "block", auto: true, spread: true, date: "2026-10-26", steps },
      { id: "c", title: "C", kind: "due", date: "2026-10-26", time: "10:00", end: "10:30" },
    ],
  });
  const timed = moveToDay(c, "b", "2026-10-27", "2026-10-25", { time: "14:00" });
  assert.deepEqual([timed.entries[1].time, timed.entries[1].end], ["14:00", "15:00"]); // a spread step: an hour
  assert.equal(moveToDay(c, "a", "2026-10-27", "2026-10-25", { time: "14:00" }).entries[0].end, "16:00"); // what's left
  assert.deepEqual([moveToDay(c, "c", "2026-10-26", "2026-10-25", { time: null }).entries[2].time], [null]);
  assert.deepEqual(moveToDay(c, "b", "2026-10-26", "2026-10-25", { before: "a" }).entries.map((e) => e.id), ["b", "a", "c"]);
  // Pinned: shown at its time on its day, not scheduled elsewhere, and A works around it.
  assert.ok(!schedule(timed, "2026-10-26", 540).has("b"));
  const tue = occurrences(timed, [], "2026-10-27", "2026-10-27", "2026-10-26", 540).find((i) => i.entry?.id === "b");
  assert.equal(tue?.time, "14:00");
  // Once the day passes unfinished, it's suggested again (untimed) from today.
  const later = occurrences(timed, [], "2026-10-28", "2026-10-28", "2026-10-28", 540).find((i) => i.entry?.id === "b");
  assert.deepEqual([later?.when, later?.time], ["2026-10-28", null]);
});

test("the Hours form sets start, finish and days; the file gets a workday only once it differs", async () => {
  const { setWorkday, serializeCalendar } = await import("../src/lib/calendar");
  const raw = { entries: [] };
  const c = parseCalendar(raw);
  assert.ok(!("workday" in serializeCalendar(raw, c)));
  const w = setWorkday(c, { start: "09:30", end: "20:00", days: [6, 0, 1, 2, 3, 4, 5] }, "2026-10-24");
  assert.deepEqual(serializeCalendar(raw, w).workday, { start: "09:30", end: "20:00", late: "20:00", days: [0, 1, 2, 3, 4, 5, 6], routine: [] });
  assert.throws(() => setWorkday(c, { start: "20:00", end: "09:00", days: [1] }, "2026-10-24"));
  assert.throws(() => setWorkday(c, { start: "09:00", end: "17:00", days: [] }, "2026-10-24"));
});

test("work types: the entry's own, else its project's, else check or personal; a day's cards group by type", async () => {
  const { typeOf, groupByType, calendarItems } = await import("../src/lib/calendar");
  const c = parseCalendar({
    project_types: { "photo-business": "photo", "resale-app": "selling" },
    entries: [
      { id: "a", title: "Lucas", kind: "due", date: "2026-10-26", project: "photo-business" },
      { id: "b", title: "List", kind: "due", date: "2026-10-26", project: "resale-app" },
      { id: "c", title: "Rebekah", kind: "due", date: "2026-10-26", project: "photo-business" },
      { id: "d", title: "RCD", kind: "due", date: "2026-10-26", type: "client" },
      { id: "e", title: "Dentist", kind: "due", date: "2026-10-26" },
      { id: "f", title: "Site", kind: "check", cadence: "weekly", project: "finance-app" },
    ],
  });
  const items = calendarItems(c, [], "2026-10-26", 0).filter((i) => i.when === "2026-10-26");
  assert.deepEqual(Object.fromEntries(items.map((i) => [i.key, typeOf(i)])), { a: "photo", b: "selling", c: "photo", d: "client", e: "personal", f: "build" });
  assert.deepEqual(groupByType(items).map((i) => i.key), ["a", "c", "b", "d", "e", "f"]);
});
