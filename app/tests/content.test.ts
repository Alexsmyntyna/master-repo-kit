import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  contentPath,
  documentHref,
  parseDocument,
  readContent,
  saveQuestion,
} from "../src/lib/files";
import { hasValue, textOf } from "../src/lib/model";

test("content reader rejects traversal, private directories, dotfiles, and unsupported files", () => {
  for (const name of [
    "../secrets.json",
    "companies/../../secrets.json",
    "archive/source.md",
    "companies/.env.json",
    "companies/../identity/profile.md",
    "companies/a\\b.md",
    "/holding/direction.md",
    "app/package.json",
    "holding/data.txt",
  ]) {
    assert.throws(() => contentPath("/workspace", name), name);
  }
  assert.equal(
    contentPath("/workspace", "companies/finance-app/company.json"),
    "/workspace/companies/finance-app/company.json",
  );
});

test("content reader rejects symlinks outside the allowed file location", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "master-repo-read-test-"));
  try {
    await mkdir(path.join(root, "holding"));
    await writeFile(path.join(root, "outside.md"), "private test fixture");
    await symlink(
      path.join(root, "outside.md"),
      path.join(root, "holding", "direction.md"),
    );
    await assert.rejects(
      readContent(root, "holding/direction.md"),
      /Linked files/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saved questions round-trip special characters and cannot choose paths or overwrite records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "master-repo-queue-test-"));
  try {
    await mkdir(path.join(root, "queue"));
    const input = {
      title: 'A title: "quotes", #tags & accents é',
      question: "What should we investigate?\n\n- First example",
      project: "finance-app",
    };
    const first = await saveQuestion(root, input, ["finance-app"]),
      second = await saveQuestion(root, input, ["finance-app"]);
    assert.notEqual(first, second);
    const raw = await readFile(path.join(root, first), "utf8"),
      doc = parseDocument(first, raw);
    assert.equal(doc.title, input.title);
    assert.equal(doc.content, input.question);
    assert.equal(doc.meta.project, "finance-app");
    assert.equal(doc.meta.source, "owner");
    assert.equal(doc.meta.status, "open");
    await assert.rejects(
      saveQuestion(root, { ...input, project: "../../elsewhere" }, ["finance-app"]),
      /Choose an existing/,
    );
    await assert.rejects(
      saveQuestion(root, { ...input, title: "one\nstatus: done" }, ["finance-app"]),
      /Give the question/,
    );
    await assert.rejects(
      saveQuestion(root, { ...input, question: " " }, ["finance-app"]),
      /Add a question/,
    );
    assert.equal(await readFile(path.join(root, first), "utf8"), raw);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("queue refuses a linked directory", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "master-repo-queue-link-test-"),
  );
  try {
    await mkdir(path.join(root, "other"));
    await symlink(path.join(root, "other"), path.join(root, "queue"));
    await assert.rejects(
      saveQuestion(
        root,
        { title: "Question", question: "Test", project: "" },
        [],
      ),
      /Queue directory/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("document links stay within the supported viewer and allow public web references", () => {
  assert.equal(
    documentHref("../companies/finance-app/company.json", "holding/direction.md"),
    "/documents/companies/finance-app/company.json",
  );
  assert.equal(
    documentHref("../sources/review.md", "companies/finance-app/reviews/review.md"),
    "/documents/companies/finance-app/sources/review.md",
  );
  assert.equal(
    documentHref("#customer", "companies/finance-app/notes/test.md"),
    "#customer",
  );
  assert.equal(
    documentHref("https://example.com/source", "holding/direction.md"),
    "https://example.com/source",
  );
  for (const href of [
    "../../secret.md",
    "../archive/source.md",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "//example.com/a.md",
  ]) {
    assert.equal(documentHref(href, "holding/direction.md"), undefined);
  }
});

test("unknown model values stay unknown while provenance objects remain readable", () => {
  assert.equal(hasValue({ who: null, problem: null }), false);
  assert.equal(hasValue([]), false);
  assert.equal(
    textOf({ text: "Tentative customer", source: "owner" }),
    "Tentative customer",
  );
  assert.equal(textOf(null), "");
});

test("JavaScript front matter is never run", async () => {
  const { frontmatter } = await import("../src/lib/frontmatter");
  (globalThis as Record<string, unknown>).pwned = false;
  for (const lang of ["js", "javascript", "JS", " js"]) {
    const doc = frontmatter(`---${lang}\n{ title: (globalThis.pwned = true, "x") }\n---\nbody`);
    assert.equal((globalThis as Record<string, unknown>).pwned, false, lang);
    assert.deepEqual(doc.data, {});
  }
  assert.equal(frontmatter("---\ntitle: ok\n---\nbody").data.title, "ok");
});
