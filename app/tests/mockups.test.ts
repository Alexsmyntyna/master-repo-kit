import assert from "node:assert/strict";
import { test } from "node:test";
import matter from "gray-matter";
import {
  cleanPins,
  withScrollReporter,
  mockupLink,
  notesMarkdown,
  parseMockups,
  reviewOf,
  sniffFrame,
  stripMockups,
  toReview,
  typedNotes,
} from "../src/lib/mockups";

test("parses a mockups block and drops paths outside a mockups folder", () => {
  const body = `Two concepts.

\`\`\`mockups
A | Library grid | companies/reader-app/mockups/2026-10-10-home/a-grid.html
B* | Timeline | ./companies/reader-app/mockups/2026-10-10-home/b-timeline.html
C | Escape | companies/reader-app/notes/../../../etc/passwd.html
\`\`\``;
  const mockups = parseMockups(body);
  assert.deepEqual(mockups.map((m) => [m.letter, m.path]), [
    ["A", "companies/reader-app/mockups/2026-10-10-home/a-grid.html"],
    ["B", "companies/reader-app/mockups/2026-10-10-home/b-timeline.html"],
  ]);
  assert.equal(stripMockups(body), "Two concepts.");
});

test("reads a mockup review and keeps pins to its screens", () => {
  const r = toReview(
    "finance-app",
    "2026-10-10-phone-field",
    {
      title: "Phone",
      date: new Date("2026-10-10"),
      thread: "companies/finance-app/threads/../../etc",
      screens: [{ file: "index.html#home", label: "Home" }, { file: "../x.html", label: "Escape" }],
      questions: ["Where does time start?", { ask: "Which look?", shown: "Serif look", screen: "index.html#home" }],
    },
    "| a | b |",
    {
      answers: ["On the project"],
      pins: [
        { screen: "index.html#home", x: 1.4, y: 0.25, text: "Bigger", date: "2026-10-11" },
        { screen: "nope.html", x: 0, y: 0, text: "Lost" },
      ],
    },
  );
  assert.equal(r.date, "2026-10-10");
  assert.equal(r.thread, "");
  assert.equal(r.status, "open");
  assert.deepEqual(r.size, [402, 874]);
  assert.deepEqual(r.screens.map((s) => s.file), ["index.html#home"]);
  assert.equal(r.questions[1].screen, "index.html#home");
  assert.deepEqual(r.notes.pins, [{ n: 1, screen: "index.html#home", x: 1, y: 0.25, text: "Bigger", date: "2026-10-11" }]);
  const md = notesMarkdown(r, r.notes);
  assert.match(md, /- \*\*Where does time start\?\*\* On the project/);
  assert.match(md, /1\. Home, 100% across, 25% down: Bigger/);
  assert.equal(cleanPins([{ screen: "index.html#home", x: 0.5, y: 0.5, text: "  " }], r.screens).length, 0);
});

test("notes keep what the owner typed by index in the frontmatter; the body has the fixed words", () => {
  const meta = { title: "Phone", screens: ["index.html"], questions: ["Where?", "Which?"] };
  const typed = typedNotes(
    { answers: ["teh project", "same"], pins: ["Biger"], note: "ok" },
    { answers: ["the project", "same"], pins: ["Bigger"], note: "ok" },
  );
  assert.deepEqual(typed, { answers: { 0: "teh project" }, pins: { 0: "Biger" } });
  assert.equal(typedNotes({ answers: ["same"] }, { answers: ["same"], pins: [], note: "" }), undefined);
  const notes = {
    updated: "2026-10-11",
    answers: ["the project", "same"],
    pins: [{ screen: "index.html", x: 0.5, y: 0.5, text: "Bigger", date: "2026-10-11" }],
    note: "",
    typed,
  };
  const saved = matter(matter.stringify("body", notes));
  const r = toReview("finance-app", "2026-10-11-phone", meta, "", saved.data);
  assert.deepEqual(r.notes.typed, typed);
  assert.equal(toReview("finance-app", "2026-10-11-phone", meta, "", { answers: [] }).notes.typed, undefined);
  assert.doesNotMatch(notesMarkdown(r, r.notes), /teh|Biger/);
});

test("a review's index.html opens the review page", () => {
  assert.equal(mockupLink("companies/finance-app/mockups/2026-10-10-phone-field/index.html"), "/companies/finance-app/mockups/2026-10-10-phone-field");
  assert.match(mockupLink("companies/camera-app/mockups/2026-10-10-wording/a-camera-drawer.html"), /^\/mockups\?path=/);
  assert.deepEqual(reviewOf("companies/finance-app/mockups/2026-10-10-phone-field/index.html"), { slug: "finance-app", id: "2026-10-10-phone-field" });
  assert.equal(reviewOf("companies/camera-app/mockups/2026-10-10-wording/a-camera-drawer.html"), undefined);
});

test("a bare mockup that draws its own phone is a phone, counted with the body's padding", () => {
  const phone = `<!doctype html><html><head><style>*{margin:0}body{background:#ddd;display:flex;padding:20px}.ph{width:390px;height:844px;border-radius:44px}.x{width:150px}</style></head><body></body></html>`;
  assert.deepEqual(sniffFrame(phone), { frame: "phone", size: [430, 884] });
  assert.deepEqual(sniffFrame(`<style>body{margin:0}.page{width:1200px;height:900px}</style>`), { frame: "desktop", size: [1280, 800] });
  assert.deepEqual(sniffFrame(`<style>.card{width:320px;height:200px}</style>`).frame, "desktop");
  assert.deepEqual(sniffFrame(""), { frame: "desktop", size: [1280, 800] });
});

test("pins keep how far the mockup was scrolled, and served mockups report their scroll", () => {
  const screens = [{ file: "index.html#home", label: "Home" }];
  const [p] = cleanPins([{ screen: "index.html#home", x: 0.5, y: 0.5, scroll: 640.4, text: "Here" }], screens);
  assert.equal(p.scroll, 640);
  assert.equal("scroll" in cleanPins([{ screen: "index.html#home", x: 0.5, y: 0.5, scroll: 0, text: "Top" }], screens)[0], false);
  const html = withScrollReporter("<html><body><p>hi</p></body></html>");
  assert.match(html, /mockupScroll:scrollY.*<\/script><\/body><\/html>$/);
  assert.match(withScrollReporter("<p>no body tag</p>"), /^<p>no body tag<\/p><script>/);
});

test("pins keep up to four uploaded images and may be an image alone", () => {
  const screens = [{ file: "index.html#home", label: "Home" }];
  const img = "holding/uploads/2026-10-27/abc-shot.png";
  const [p] = cleanPins([{ screen: "index.html#home", x: 0.1, y: 0.1, text: "", images: [img, "../etc/passwd", "/abs.png"] }], screens);
  assert.deepEqual(p.images, [img]);
  assert.equal(cleanPins([{ screen: "index.html#home", x: 0.1, y: 0.1, text: "", images: [] }], screens).length, 0);
});

