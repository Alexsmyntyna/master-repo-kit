import assert from "node:assert/strict";
import { test } from "node:test";
import { appHref, appLink, looksLikePath, scopeOf } from "../src/lib/file-paths";

test("links in agent text open only known app routes", () => {
  assert.equal(appLink("/companies/camera-app"), "/companies/camera-app");
  assert.equal(appLink("/decisions"), "/decisions");
  assert.equal(appLink("companies/camera-app/wiki/index.md"), "/companies/camera-app");
  for (const h of ["/\\evil.com", "//evil.com", "javascript:alert(1)", "JavaScript:alert(1)", "/api/x", "/decisionsx", "/companies /x", "mailto:a@b.c"])
    assert.equal(appLink(h), undefined, h);
});

test("repo paths in chat replies link to their page in the app", () => {
  assert.equal(appHref("companies/camera-app/wiki/index.md"), "/companies/camera-app");
  assert.equal(appHref("companies/camera-app/wiki/fronts/speed.md"), "/companies/camera-app/wiki/fronts/speed");
  assert.equal(appHref("companies/camera-app/threads/2026-10-10-x/003-ceo.md"), "/threads/camera-app/2026-10-10-x");
  assert.equal(appHref("holding/threads/chat"), "/threads/holding/chat");
  assert.equal(appHref("companies/camera-app/mockups/2026-10-10-wording/index.html"), "/companies/camera-app/mockups/2026-10-10-wording");
  assert.equal(appHref("companies/camera-app/builds/2026-10-11-x/01-a.md"), "/companies/camera-app/build");
  assert.equal(appHref("holding/vision.md"), "/company/vision");
  assert.equal(appHref("holding/wiki/index.md"), "/company");
  assert.equal(appHref("holding/wiki/fronts/entity.md"), "/company/entity");
  assert.equal(appHref("holding/wiki/ideas/2026-10-11-x.md"), "/company/ideas/2026-10-11-x");
  assert.equal(appHref("holding/setup.json"), "/company/setup");
  assert.equal(appHref("holding/direction.md"), "/documents/holding/direction.md");
  assert.equal(appLink("/company/money"), "/company/money");
  for (const p of ["src/app.ts", "/etc/passwd", "~/x.md", "companies/../x.md", "tools/converse.py"]) assert.equal(appHref(p), undefined, p);
});

test("inline code that names a file or folder reads as a path; words and commands don't", () => {
  for (const p of ["context-notepad/threads/x/mockups/index.html", "hub.js", "site/node_modules", "~/notes/a.md", "src/app.ts:42"])
    assert.ok(looksLikePath(p), p);
  for (const p of ["scrollTo", "v2", "git commit -m x", "https://x.com/a", "--force", "$HOME/x"]) assert.ok(!looksLikePath(p), p);
});

test("a document's file paths resolve inside its own build, project, or Master-Repo", () => {
  assert.equal(scopeOf("companies/finance-app/builds/2026-10-10-x/review.md"), "build:finance-app:2026-10-10-x");
  assert.equal(scopeOf("companies/finance-app/threads/t/003-ceo.md"), "project:finance-app");
  assert.equal(scopeOf("holding/vision.md"), "master");
});
