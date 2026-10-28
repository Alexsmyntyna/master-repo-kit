import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { repoRoot } from "./repository";

// Whose Master Repo this is: local/owner.json, { "name": display name, "emails": [...], "handles": [...] }; optional short overrides the first name.
// Missing or unreadable → neutral words, so the app runs on anyone's data (tools/paths.py owner() matches this).
export type Owner = { name: string; short: string };

export function ownerOf(raw: unknown): Owner {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = typeof r.name === "string" ? r.name.trim() : "";
  const short = typeof r.short === "string" ? r.short.trim() : "";
  return { name: name || "Owner", short: short || (name ? name.split(/\s+/)[0] : "You") };
}

export const getOwner = cache(async (): Promise<Owner> => {
  try {
    return ownerOf(JSON.parse(await readFile(path.join(repoRoot, "local", "owner.json"), "utf8")));
  } catch {
    return ownerOf(null);
  }
});
