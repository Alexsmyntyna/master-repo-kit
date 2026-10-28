import test from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "../src/lib/files";
import { safeSitePath, siteHref, toIdea } from "../src/lib/ideas";

test("an idea takes its fields from frontmatter", () => {
  const raw =
    "---\ntitle: ANDE\nname: Automated Non Destructive Editor\nsummary: A local Aftershoot.\nstatus: building\ndate: 2026-10-22\nupdated: 2026-10-23\nraised_by: owner\nwritten_by: owner\nsite: site/index.html\nlinks: [asset-tool, photo-business]\n---\n\nBody";
  const idea = toIdea("ande", parseDocument("ideas/ande/index.md", raw));
  assert.equal(idea.title, "ANDE");
  assert.equal(idea.name, "Automated Non Destructive Editor");
  assert.equal(idea.status, "building");
  assert.equal(idea.updated, "2026-10-23");
  assert.equal(idea.writtenBy, "owner");
  assert.equal(idea.site, "site/index.html");
  assert.deepEqual(idea.links, ["asset-tool", "photo-business"]);
  assert.equal(idea.content, "Body");
});

test("an idea with missing or odd fields still reads", () => {
  const idea = toIdea("bare", parseDocument("ideas/bare/index.md", "# Bare\n\nJust a thought"));
  assert.equal(idea.title, "Bare");
  assert.equal(idea.status, "exploring");
  assert.equal(idea.summary, "");
  assert.equal(idea.updated, "");
  assert.equal(idea.writtenBy, "agent");
  assert.equal(idea.site, "");
  assert.deepEqual(idea.links, []);
  const odd = toIdea("odd", parseDocument("ideas/odd/index.md", "---\nstatus: nonsense\nsite: ../secret.html\nlinks: nope\ndate: 2026-10-01\n---\nx"));
  assert.equal(odd.status, "exploring");
  assert.equal(odd.site, "");
  assert.deepEqual(odd.links, []);
  assert.equal(odd.updated, "2026-10-01");
});

test("site paths stay inside the site folder", () => {
  assert.equal(safeSitePath(["index.html"]), "index.html");
  assert.equal(safeSitePath(["assets", "x.svg"]), "assets/x.svg");
  assert.equal(safeSitePath("assets/x.svg"), "assets/x.svg");
  for (const bad of [[".."], ["a", "..", "index.md"], ["."], [".env"], ["a", ".git", "x"], [""], ["a", "", "b"], ["a\\b"], ["C:"], []])
    assert.equal(safeSitePath(bad), null, JSON.stringify(bad));
  assert.equal(safeSitePath("/etc/passwd"), null);
  assert.equal(safeSitePath("../index.md"), null);
});

test("the site link goes through the app route", () => {
  assert.equal(siteHref("ande", "site/index.html"), "/ideas/ande/site/index.html");
});
