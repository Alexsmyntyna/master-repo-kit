import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentKind, attachmentName, splitAttachmentRefs, uploadOf } from "../src/lib/attachment-refs";
import { appHref, appLink, uploadHref } from "../src/lib/file-paths";

const up = "holding/uploads/2026-10-11";

test("the record lines at the end of a body come apart from his words", () => {
  const body = `Look at this.\n\n[image #3](${up}/mabc-image.png)\n[pasted #2: Release notes for the week](${up}/mabc-pasted-Release-notes.md)\n[file #1: my spec.txt](</workspace/owner/Desktop/my spec.txt>)\n[folder #1: FinanceApp/](/workspace/owner/code/FinanceApp)`;
  const { text, refs } = splitAttachmentRefs(body);
  assert.equal(text, "Look at this.");
  assert.deepEqual(
    refs.map((r) => [r.label, r.name, r.path, r.href]),
    [
      ["image #3", "", `${up}/mabc-image.png`, `/files/${up}/mabc-image.png`],
      ["pasted #2", "Release notes for the week", `${up}/mabc-pasted-Release-notes.md`, `/files/${up}/mabc-pasted-Release-notes.md`],
      ["file #1", "my spec.txt", "/workspace/owner/Desktop/my spec.txt", undefined], // outside the repo: named, not linked
      ["folder #1", "FinanceApp/", "/workspace/owner/code/FinanceApp", undefined],
    ],
  );
  // A message that is only an attachment has no words.
  assert.deepEqual(splitAttachmentRefs(`[image #1](${up}/a.png)\n`).text, "");
});

test("a reference in the middle of his words, or not after a blank line, stays his words", () => {
  for (const body of [`See [image #1](${up}/a.png) here.`, `Look:\n[image #1](${up}/a.png)`, `[image #1](${up}/a.png)\n\nThen this.`, "Plain."]) {
    const { text, refs } = splitAttachmentRefs(body);
    assert.equal(refs.length, 0, body);
    assert.equal(text, body);
  }
});

test("only upload paths open in the file viewer, nothing else new", () => {
  assert.equal(uploadHref(`${up}/mabc-image.png`), `/files/${up}/mabc-image.png`);
  assert.equal(appHref(`${up}/mabc-pasted-notes.md`), `/files/${up}/mabc-pasted-notes.md`); // not /documents
  assert.equal(appLink(`${up}/mabc-image.png`), `/files/${up}/mabc-image.png`);
  for (const p of ["holding/uploads/../money.json", "holding/uploads/2026-10-11/../../x.png", "holding/uploads/x.png", "holding/money.json", "/workspace/owner/shot.png", "holding/uploads/2026-10-11/a b.png"])
    assert.equal(uploadHref(p), undefined, p);
  for (const h of ["/files/holding/money.json", "/files/holding/uploads/2026-10-11/a.png", "files/holding/x"]) assert.equal(appLink(h), undefined, h);
});

test("the composer reads what an attached path is", () => {
  const abs = `/workspace/owner/Master-Repo/${up}`;
  assert.equal(uploadOf(`${abs}/mabc-image.png`), `${up}/mabc-image.png`);
  assert.equal(uploadOf("/workspace/owner/Desktop/shot.png"), undefined);
  assert.equal(attachmentKind(`${abs}/mabc-image.png`), "image");
  assert.equal(attachmentKind(`${abs}/mabc-pasted-Release-notes.md`), "pasted");
  assert.equal(attachmentKind(`${abs}/mabc-notes.md`), "file");
  assert.equal(attachmentName(`${abs}/mabc1234-pasted-Release-notes.md`), "Release-notes.md");
  assert.equal(attachmentName("/workspace/owner/Desktop/mabc1234-report.pdf"), "mabc1234-report.pdf"); // not an upload: as named
});
