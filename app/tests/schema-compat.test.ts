import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readThread } from "../src/lib/threads";
import { parseDocument } from "../src/lib/files";
import { toWikiPage } from "../src/lib/wiki";
import { toIdea } from "../src/lib/ideas";
import { ownerSaid } from "../src/lib/voice";

for (const owner of ["alex", "owner"] as const) {
  test(`${owner} schema: provenance and thread roles remain readable`, async () => {
    const doc = parseDocument("ideas/demo/index.md", `---\ntitle: Demo\nkind: front\nraised_by: ${owner}\nwritten_by: ${owner}\n---\n\nBody`);
    assert.equal(toIdea("demo", doc).writtenBy, owner);
    assert.equal(toWikiPage("demo", doc).writtenBy, owner);
    const root = await mkdtemp(path.join(os.tmpdir(), "schema-compat-"));
    try {
      const dir = path.join(root, "companies/demo/threads/decision");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "thread.md"), `---\ntitle: Decision\nstatus: awaiting-${owner}\nparticipants: ["${owner}", "coo"]\n---\n`);
      await writeFile(path.join(dir, `001-${owner}.md`), `---\nfrom: ${owner}\nto: coo\nkind: reply\ndate: 2026-10-28\n---\n\nShip the camera.`);
      const thread = await readThread(root, "demo", "decision");
      assert.ok(thread);
      assert.equal(thread.status, `awaiting-${owner}`);
      assert.equal(thread.messages[0].from, owner);
      assert.deepEqual(thread.participants, [owner, "coo"]);
      assert.equal(ownerSaid([thread], "demo")[0].text, "Ship the camera.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
