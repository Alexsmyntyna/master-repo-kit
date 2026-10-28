import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listThreads, readThread } from "../src/lib/threads";

// Mirrors the format tools/converse.py writes (JSON-valued frontmatter).
test("threads read in order with roles, usage, and status grouping", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "master-repo-threads-"));
  try {
    const dir = path.join(root, "companies", "demo", "threads", "2026-10-10-go");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "thread.md"),
      '---\ntitle: "Go?"\nstatus: "awaiting-owner"\nsummary: "CEO says go."\ndecision: "Ship it"\nstarted: "2026-10-10"\nupdated: "2026-10-10"\n---\n',
    );
    await writeFile(path.join(dir, "001-owner.md"), '---\nfrom: "owner"\nto: "coo"\nkind: "directive"\ndate: "2026-10-10"\n---\n\nIs it viable?\n');
    await writeFile(
      path.join(dir, "002-coo.md"),
      '---\nfrom: "coo"\nto: "ceo"\nkind: "report"\ndate: "2026-10-10"\nusage: {"engine": "claude", "model": "sonnet"}\n---\n\nYes.\n',
    );
    await writeFile(path.join(dir, "notes.md"), "not a message");
    const t = await readThread(root, "demo", "2026-10-10-go");
    assert.ok(t);
    assert.equal(t.title, "Go?");
    assert.equal(t.decision, "Ship it");
    assert.deepEqual(
      t.messages.map((m) => [m.from, m.to, m.kind, m.body]),
      [
        ["owner", "coo", "directive", "Is it viable?"],
        ["coo", "ceo", "report", "Yes."],
      ],
    );
    assert.equal(t.messages[1].usage.model, "sonnet");
    assert.equal(await readThread(root, "demo", "missing"), undefined);
    const all = await listThreads(root, ["holding", "demo"]);
    assert.deepEqual(all.map((x) => x.status), ["awaiting-owner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// tools/converse.py --typed: what the owner typed, as a YAML block scalar, beside the spelling-fixed body.
test("a message keeps what the owner typed and how many words were fixed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "master-repo-threads-"));
  try {
    const dir = path.join(root, "companies", "demo", "threads", "chat");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "thread.md"), '---\ntitle: "Chat"\nstatus: "talking"\n---\n');
    await writeFile(
      path.join(dir, "001-owner.md"),
      '---\nfrom: "owner"\nto: "ceo"\nkind: "reply"\ndate: "2026-10-11"\npage: false\ntyped: |\n  teh hustory: dont\n\n    indented\n  ---\nfixes: 3\n---\n\nthe history: don\'t\n\n  indented\n---\n',
    );
    await writeFile(path.join(dir, "002-ceo.md"), '---\nfrom: "ceo"\nto: "owner"\nkind: "reply"\ndate: "2026-10-11"\n---\n\nOk.\n');
    const t = await readThread(root, "demo", "chat");
    assert.ok(t);
    const [owner, ceo] = t.messages;
    assert.equal(owner.typed, "teh hustory: dont\n\n  indented\n---");
    assert.equal(owner.fixes, 3);
    assert.equal(owner.body, "the history: don't\n\n  indented\n---");
    assert.equal(ceo.typed, undefined);
    assert.equal(ceo.fixes, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
