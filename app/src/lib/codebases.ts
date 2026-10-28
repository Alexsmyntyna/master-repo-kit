import { readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { activityFrom, type Activity } from "./activity";
import { readContent } from "./files";
import { repoRoot } from "./repository";

// Every codebase in ~/Documents/GitHub: facts from tools/codebases.py scan (holding/codebases/index.json) and what
// an agent learned reading it (holding/codebases/<slug>.md, holding/codebases/BRIEF.md).
export type Verdict = "revive" | "parts" | "reference" | "archive" | "";
export type Codebase = {
  name: string;
  slug: string;
  path: string;
  kind: "own" | "fork" | "clone" | "folder";
  project: string; // the project it already is, if any
  readme: string;
  files: number;
  languages: string[];
  commits: number;
  mine: number;
  first: string;
  last: string;
  activity: Activity;
  note?: { verdict: Verdict; related: string[]; summary: string; learn: string; body: string; path: string };
};
export const verdictOrder: Verdict[] = ["revive", "parts", "reference", "archive", ""];
export const verdictLabels: Record<string, string> = {
  revive: "Revive",
  parts: "Parts",
  reference: "Reference",
  archive: "Archive",
  "": "Not read",
};

// Agents write these notes freehand, so a colon inside a summary must not break them: read the frontmatter as
// plain `key: value` lines (and `[a, b]` lists) rather than YAML.
export function readNote(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string | string[]> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    meta[kv[1]] = /^\[.*\]$/.test(v)
      ? v.slice(1, -1).split(",").map((x) => x.trim().replace(/^(["'])(.*)\1$/, "$2")).filter(Boolean)
      : v;
  }
  return { meta, body: m[2].trim() };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const getCodebases = cache(async (): Promise<{ generated: string; codebases: Codebase[] }> => {
  let index: { generated?: string; codebases?: Record<string, unknown>[] };
  try {
    index = JSON.parse(await readContent(repoRoot, "holding/codebases/index.json"));
  } catch {
    return { generated: "", codebases: [] };
  }
  const notes = new Set(
    (await readdir(path.join(repoRoot, "holding/codebases")).catch(() => [] as string[])).filter((f) =>
      /^[a-z0-9-]+\.md$/.test(f),
    ),
  );
  const codebases = await Promise.all(
    (index.codebases || []).map(async (e): Promise<Codebase> => {
      const slug = str(e.slug);
      const days = (e.days && typeof e.days === "object" ? e.days : {}) as Record<string, number>;
      const dates = Object.entries(days).flatMap(([d, n]) => new Array(Number(n) || 0).fill(d));
      let note: Codebase["note"];
      if (notes.has(`${slug}.md`)) {
        const rel = `holding/codebases/${slug}.md`;
        const doc = readNote(await readContent(repoRoot, rel));
        const v = str(doc.meta.verdict).toLowerCase();
        note = {
          verdict: (verdictOrder.includes(v as Verdict) ? v : "") as Verdict,
          related: Array.isArray(doc.meta.related) ? doc.meta.related.map(String) : [],
          summary: str(doc.meta.summary),
          learn: str(doc.meta.learn),
          body: doc.body,
          path: rel,
        };
      }
      return {
        name: str(e.name),
        slug,
        path: str(e.path),
        kind: (["own", "fork", "clone", "folder"].includes(str(e.kind)) ? e.kind : "folder") as Codebase["kind"],
        project: str(e.project),
        readme: str(e.readme),
        files: Number(e.files) || 0,
        languages: Array.isArray(e.languages) ? e.languages.map(String) : [],
        commits: Number(e.commits) || 0,
        mine: Number(e.mine) || 0,
        first: str(e.first),
        last: str(e.last),
        activity: activityFrom(dates, str(e.last)),
        note,
      };
    }),
  );
  return { generated: str(index.generated), codebases };
});
