import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "@/lib/repository";
import { DEFAULT_MODEL, isModel, type Model, type Role } from "@/lib/models";

// holding/models.json: {"ceo": "fable", "coo": "sonnet"}. tools/converse.py reads the same file (default_model).
const file = (root = repoRoot) => path.join(root, "holding", "models.json");

async function readRaw(root?: string): Promise<Record<string, unknown>> {
  try {
    const data = JSON.parse(await readFile(file(root), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export async function readDefaultModels(root?: string): Promise<Record<Role, Model>> {
  const raw = await readRaw(root);
  return {
    ceo: isModel(raw.ceo) ? raw.ceo : DEFAULT_MODEL.ceo,
    coo: isModel(raw.coo) ? raw.coo : DEFAULT_MODEL.coo,
  };
}

// Merges the given roles into the file; unknown roles or models are refused.
export async function writeDefaultModels(models: Partial<Record<string, unknown>>, root?: string): Promise<Record<Role, Model>> {
  const next: Record<string, unknown> = await readRaw(root);
  for (const [role, model] of Object.entries(models)) {
    if (role !== "ceo" && role !== "coo") throw new Error(`Unknown role ${role}`);
    if (!isModel(model)) throw new Error(`Unknown model ${String(model)}`);
    next[role] = model;
  }
  await writeFile(file(root), JSON.stringify(next, null, 2) + "\n");
  return readDefaultModels(root);
}
