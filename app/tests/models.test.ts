import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_MODEL, MODELS, isModel } from "../src/lib/models";
import { readDefaultModels, writeDefaultModels } from "../src/lib/models-file";

const root = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "models-"));
  mkdirSync(path.join(dir, "holding"));
  return dir;
};

test("Fable is a model; anything else isn't", () => {
  assert.ok(MODELS.includes("fable"));
  assert.equal(isModel("fable"), true);
  assert.equal(isModel("gpt"), false);
});

test("defaults fall back without holding/models.json, or with junk in it", async () => {
  const dir = root();
  assert.deepEqual(await readDefaultModels(dir), DEFAULT_MODEL);
  writeFileSync(path.join(dir, "holding", "models.json"), "{nope");
  assert.deepEqual(await readDefaultModels(dir), DEFAULT_MODEL);
  writeFileSync(path.join(dir, "holding", "models.json"), JSON.stringify({ ceo: "fable", coo: "gpt" }));
  assert.deepEqual(await readDefaultModels(dir), { ceo: "fable", coo: "sonnet" });
  rmSync(dir, { recursive: true });
});

test("writing merges roles and refuses unknown roles or models", async () => {
  const dir = root();
  await writeDefaultModels({ ceo: "fable" }, dir);
  await writeDefaultModels({ coo: "haiku" }, dir);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "holding", "models.json"), "utf8")), { ceo: "fable", coo: "haiku" });
  await assert.rejects(writeDefaultModels({ ceo: "gpt" }, dir));
  await assert.rejects(writeDefaultModels({ cto: "opus" }, dir));
  rmSync(dir, { recursive: true });
});
