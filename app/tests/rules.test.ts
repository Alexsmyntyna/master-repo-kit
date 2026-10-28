import test from "node:test";
import assert from "node:assert/strict";
import { contentPath } from "../src/lib/files";
import { ruleOf } from "../src/lib/ledger";

test("owner standards are readable without exposing other local files", () => {
  assert.equal(contentPath("/repo", "local/standards/design.md"), "/repo/local/standards/design.md");
  assert.throws(() => contentPath("/repo", "local/owner.json"));
  assert.throws(() => contentPath("/repo", "local/standards/../owner.json"));
});

test("provenance without an evidence reference remains visible", () => {
  const rule = ruleOf("- Use native fonts. (agent, 2026-10-28)");
  assert.equal(rule.who, "agent");
  assert.equal(rule.date, "2026-10-28");
  assert.equal(rule.ref, "");
});

test("shipped kit provenance is parsed", () => {
  assert.equal(ruleOf("- Use fonts. (kit)").who, "kit");
});
