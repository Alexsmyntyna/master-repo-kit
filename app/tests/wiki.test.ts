import test from "node:test";
import assert from "node:assert/strict";
import { documentHref, parseDocument } from "../src/lib/files";
import { daysSince, sectionOf, splitBlocks, toWikiPage, wikiHref } from "../src/lib/wiki";

test("view fences split prose from embedded views, with options", () => {
  const blocks = splitBlocks("Intro\n\n```view\ngit-momentum\nrepo: CameraApp\n```\n\nAfter\n\n```ts\nconst x = 1;\n```");
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: "markdown", content: "Intro" });
  assert.deepEqual(blocks[1], { type: "view", name: "git-momentum", options: { repo: "CameraApp" } });
  assert.equal(blocks[2].type, "markdown");
  assert.match((blocks[2] as { content: string }).content, /```ts/);
});

test("wiki pages take kind, status and dates from frontmatter, with safe defaults", () => {
  const raw = "---\ntitle: Shared rolls\nkind: front\nstatus: open\nraised_by: owner\ndate: 2026-09-26\n---\n\n# Shared rolls\n\nBody";
  const page = toWikiPage("camera-app", parseDocument("companies/camera-app/wiki/fronts/shared-rolls.md", raw));
  assert.equal(page.page, "fronts/shared-rolls");
  assert.equal(page.kind, "front");
  assert.equal(page.date, "2026-09-26");
  assert.equal(page.updated, "2026-09-26");
  assert.equal(page.raisedBy, "owner");
  const index = toWikiPage("camera-app", parseDocument("companies/camera-app/wiki/index.md", "# CameraApp"));
  assert.equal(index.kind, "story");
  const unknown = toWikiPage("x", parseDocument("companies/x/wiki/a.md", "---\nkind: nonsense\n---\nA"));
  assert.equal(unknown.kind, "topic");
});

test("links between wiki pages route to wiki pages, not the raw document viewer", () => {
  assert.equal(documentHref("evolution.md", "companies/camera-app/wiki/index.md"), "/companies/camera-app/wiki/evolution");
  assert.equal(documentHref("../index.md#open-fronts", "companies/camera-app/wiki/fronts/a.md"), "/companies/camera-app#open-fronts");
  assert.equal(documentHref("../company.json", "companies/camera-app/wiki/index.md"), "/documents/companies/camera-app/company.json");
  assert.equal(wikiHref("camera-app", "index"), "/companies/camera-app");
  assert.equal(wikiHref("camera-app", "fronts/shared-rolls"), "/companies/camera-app/wiki/fronts/shared-rolls");
});

test("the parent company's wiki is holding/wiki, shown under /company", () => {
  const front = toWikiPage("holding", parseDocument("holding/wiki/fronts/entity.md", "---\ntitle: Entity\nkind: front\nstatus: open\n---\n\nBody"));
  assert.equal(front.page, "fronts/entity");
  assert.equal(front.slug, "holding");
  assert.equal(wikiHref("holding", "fronts/entity"), "/company/entity");
  assert.equal(wikiHref("holding", "index"), "/company");
  assert.equal(wikiHref("holding", "ideas/2026-10-11-a b"), "/company/ideas/2026-10-11-a%20b");
  assert.equal(toWikiPage("holding", parseDocument("holding/wiki/index.md", "# Parent company")).kind, "story");
  // links between holding pages, and to the setup checklist and vision, open their /company pages
  assert.equal(documentHref("fronts/name.md", "holding/wiki/index.md"), "/company/name");
  assert.equal(documentHref("../../setup.json", "holding/wiki/fronts/entity.md"), "/company/setup");
  assert.equal(documentHref("../vision.md#open-questions", "holding/wiki/index.md"), "/company/vision#open-questions");
  assert.equal(documentHref("../../companies/finance-app/wiki/index.md", "holding/wiki/index.md"), "/companies/finance-app");
  // a project's wiki is unchanged
  assert.equal(wikiHref("holding-co", "index"), "/companies/holding-co");
});

test("one section of a Markdown page, by its ## heading", () => {
  const md = "# T\n\n## In your words\n\n> quote\n\n### Sub\nkept\n\n## Why a company\n\n| a |\n\n# Next";
  assert.equal(sectionOf(md, "In your words"), "> quote\n\n### Sub\nkept");
  assert.equal(sectionOf(md, "why a company"), "| a |");
  assert.equal(sectionOf(md, "Missing"), "");
});

test("days since a date", () => {
  assert.equal(daysSince("2026-09-20", new Date(2026, 8, 26, 12)), 6);
  assert.equal(daysSince("2026-09-26", new Date(2026, 8, 26, 0, 5)), 0);
  assert.equal(daysSince("", new Date()), null);
});
