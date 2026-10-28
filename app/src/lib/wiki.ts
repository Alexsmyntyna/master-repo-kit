import { readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { parseDocument, readContent } from "./files";
import { getCompany, repoRoot } from "./repository";
import { recordOf, type Document } from "./model";
import { holdingWikiHref } from "./file-paths";

// A project's wiki is plain Markdown in companies/<slug>/wiki/, written by agents and the owner. The parent company
// has one too: scope "holding" is holding/wiki/, shown under /company.
export const kinds = [
  "story",
  "front",
  "topic",
  "idea",
  "visualization",
  "redesign",
  "history",
  "research",
] as const;
export type Kind = (typeof kinds)[number];
export const kindLabels: Record<Kind, string> = {
  story: "Story",
  front: "Fronts",
  topic: "Topics",
  idea: "Ideas",
  visualization: "Visualizations",
  redesign: "Redesigns",
  history: "History",
  research: "Research",
};

export type WikiPage = Document & {
  slug: string; // project, or "holding" for the parent company
  page: string; // path inside wiki/, without .md ("index" for the landing page)
  kind: Kind;
  summary: string;
  date: string;
  updated: string;
  status: string;
  raisedBy: string;
  writtenBy: "owner" | "alex" | "agent"; // who wrote the words: agents unless the page says `written_by: alex`
};

export const HOLDING = "holding";
export const wikiBase = (scope: string) => (scope === HOLDING ? "holding/wiki" : `companies/${scope}/wiki`);

export function toWikiPage(slug: string, doc: Document): WikiPage {
  const page = doc.path
    .replace(`${wikiBase(slug)}/`, "")
    .replace(/\.md$/, "");
  const m = doc.meta;
  const kind = kinds.includes(m.kind as Kind)
    ? (m.kind as Kind)
    : page === "index"
      ? "story"
      : "topic";
  const str = (v: unknown) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v) : "";
  return {
    ...doc,
    slug,
    page,
    kind,
    summary: str(m.summary),
    date: str(m.date),
    updated: str(m.updated) || str(m.date),
    status: str(m.status),
    raisedBy: str(m.raised_by),
    writtenBy: str(m.written_by) === "owner" ? "owner" : str(m.written_by) === "alex" ? "alex" : "agent",
  };
}

export function wikiHref(slug: string, page: string): string {
  if (slug === HOLDING) return holdingWikiHref(page);
  return page === "index"
    ? `/companies/${slug}`
    : `/companies/${slug}/wiki/${page.split("/").map(encodeURIComponent).join("/")}`;
}

async function markdownFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith(".") && !e.name.startsWith("_"))
      .map((e) =>
        e.isDirectory()
          ? markdownFiles(path.join(dir, e.name), `${prefix}${e.name}/`)
          : e.isFile() && e.name.endsWith(".md")
            ? Promise.resolve([`${prefix}${e.name}`])
            : Promise.resolve([]),
      ),
  );
  return nested.flat();
}

export const getWiki = cache(async (slug: string): Promise<WikiPage[]> => {
  if (slug !== HOLDING && !(await getCompany(slug))) return [];
  const base = wikiBase(slug);
  const files = await markdownFiles(path.join(repoRoot, base));
  const pages = await Promise.all(
    files.map(async (f) => {
      const rel = `${base}/${f}`;
      return toWikiPage(slug, parseDocument(rel, await readContent(repoRoot, rel)));
    }),
  );
  return pages.sort(
    (a, b) =>
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
      b.updated.localeCompare(a.updated) ||
      a.title.localeCompare(b.title),
  );
});

export const getWikiPage = cache(async (slug: string, page: string) =>
  (await getWiki(slug)).find((p) => p.page === page),
);

// A /company/<name> page: a front first (fronts/<name>), then any other holding wiki page.
export const getHoldingPage = cache(async (name: string) => {
  const pages = await getWiki(HOLDING);
  return pages.find((p) => p.page === `fronts/${name}`) || pages.find((p) => p.page === name && name !== "index");
});

// One "## Heading" section of a Markdown page (up to the next # or ## heading), or "" when it isn't there.
export function sectionOf(content: string, heading: string): string {
  const lines = content.split("\n");
  const want = heading.trim().toLowerCase();
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, "").trim().toLowerCase() === want);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

// Split Markdown into prose and ```view blocks so registered React views can render inline.
export type Block =
  | { type: "markdown"; content: string }
  | { type: "view"; name: string; options: Record<string, string> };
export function splitBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const re = /^```view[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  let last = 0;
  for (const match of content.matchAll(re)) {
    const before = content.slice(last, match.index).trim();
    if (before) blocks.push({ type: "markdown", content: before });
    const [name = "", ...rest] = match[1].trim().split("\n");
    const options: Record<string, string> = {};
    for (const line of rest) {
      const [k, ...v] = line.split(":");
      if (k && v.length) options[k.trim()] = v.join(":").trim();
    }
    blocks.push({ type: "view", name: name.trim(), options });
    last = (match.index ?? 0) + match[0].length;
  }
  const rest = content.slice(last).trim();
  if (rest) blocks.push({ type: "markdown", content: rest });
  return blocks;
}

// Git data written by tools/git_history.py snapshot. Missing means "not generated yet".
export type GitMonth = { month: string; commits: number; fixes: number };
export type GitRepo = {
  label: string;
  path: string;
  commits: number;
  read?: number;
  first?: string;
  last?: string;
  fixes?: number;
  months?: GitMonth[];
  segments?: {
    id: string;
    from: string;
    to: string;
    commits: number;
    fixes: number;
    status: string;
    features: { sha: string; date: string; subject: string }[];
  }[];
  hotspots?: { path: string; fixes: number; touches: number }[];
  written_once?: { path: string; date: string; present: boolean }[];
};
export type GitSnapshot = { slug: string; generated: string; repos: GitRepo[] };
export const getSnapshot = cache(
  async (slug: string): Promise<GitSnapshot | null> => {
    try {
      const raw = JSON.parse(
        await readContent(repoRoot, `companies/${slug}/git/snapshot.json`),
      );
      return recordOf(raw).repos ? (raw as GitSnapshot) : null;
    } catch {
      return null;
    }
  },
);
export function lastCoded(snapshot: GitSnapshot | null): string {
  return (
    snapshot?.repos
      .map((r) => r.last || "")
      .sort()
      .at(-1) || ""
  );
}
export function daysSince(date: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // Compare calendar days; git dates are local, so never report a negative age.
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const [y, m, d] = date.split("-").map(Number);
  return Math.max(0, Math.round((day(today) - Date.UTC(y, m - 1, d)) / 86400000));
}
