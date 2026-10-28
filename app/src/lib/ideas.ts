import { readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { parseDocument, readContent } from "./files";
import { repoRoot } from "./repository";
import type { Document } from "./model";

// An idea is a folder, ideas/<slug>/: index.md (frontmatter + a short body), an optional standalone page in site/,
// and supporting docs (brief.md, research/*.md). Agents write them, so every field may be missing.
export const ideaStatuses = ["exploring", "building", "parked", "dropped"] as const;
export type IdeaStatus = (typeof ideaStatuses)[number];
export const ideaStatusLabels: Record<IdeaStatus, string> = {
  exploring: "Exploring",
  building: "Building",
  parked: "Parked",
  dropped: "Dropped",
};

export type Idea = Document & {
  slug: string;
  name: string; // the long name
  summary: string;
  status: IdeaStatus;
  date: string;
  updated: string;
  raisedBy: string;
  writtenBy: "owner" | "alex" | "agent";
  site: string; // path inside the idea's folder, or "" when there's no standalone page
  links: string[]; // company slugs
};

const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v) : "");

export function toIdea(slug: string, doc: Document): Idea {
  const m = doc.meta;
  const status = str(m.status);
  const site = str(m.site).replace(/^\/+/, "");
  return {
    ...doc,
    slug,
    name: str(m.name),
    summary: str(m.summary),
    status: ideaStatuses.includes(status as IdeaStatus) ? (status as IdeaStatus) : "exploring",
    date: str(m.date),
    updated: str(m.updated) || str(m.date),
    raisedBy: str(m.raised_by),
    writtenBy: str(m.written_by) === "owner" ? "owner" : str(m.written_by) === "alex" ? "alex" : "agent",
    site: safeSitePath(site) ? site : "",
    links: Array.isArray(m.links) ? m.links.map(str).filter(Boolean) : [],
  };
}

// Where an idea's standalone page is served from (app/ideas/[slug]/site/[...path]/route.ts). `site` in the
// frontmatter is relative to the idea's folder ("site/index.html"); the route is already inside site/.
export const siteHref = (slug: string, site: string) =>
  `/ideas/${slug}/site/${site.replace(/^site\//, "").split("/").map(encodeURIComponent).join("/")}`;

// A path asked of the site folder, as segments: only plain names stay inside. Returns the cleaned relative path,
// or null for anything absolute, hidden, backslashed, empty or climbing out with "..".
export function safeSitePath(relative: string | string[]): string | null {
  const parts = Array.isArray(relative) ? relative : relative.split("/");
  if (!parts.length || parts.some((p) => !p || p === "." || p === ".." || p.startsWith(".") || /[\\\0:]/.test(p))) return null;
  return parts.join("/");
}

export const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export const ideaDir = (slug: string) => path.join(repoRoot, "ideas", slug);

export const getIdea = cache(async (slug: string): Promise<Idea | null> => {
  if (!safeSitePath(slug) || slug.includes("/")) return null;
  try {
    return toIdea(slug, parseDocument(`ideas/${slug}/index.md`, await readContent(repoRoot, `ideas/${slug}/index.md`)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
});

// Newest update first; ideas whose index.md is missing are skipped.
export const getIdeas = cache(async (): Promise<Idea[]> => {
  let entries;
  try {
    entries = await readdir(path.join(repoRoot, "ideas"), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const ideas = await Promise.all(entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => getIdea(e.name)));
  return ideas
    .filter((i): i is Idea => !!i)
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
});

// The supporting documents beside index.md: brief.md and research/*.md, as app document paths.
export const getIdeaDocs = cache(async (slug: string): Promise<Document[]> => {
  const names = async (dir: string) =>
    (await readdir(path.join(ideaDir(slug), dir)).catch(() => [] as string[])).filter((n) => n.endsWith(".md") && !n.startsWith("."));
  const files = [...(await names("")).filter((n) => n !== "index.md").map((n) => n), ...(await names("research")).map((n) => `research/${n}`)];
  return Promise.all(
    files.map(async (f) => parseDocument(`ideas/${slug}/${f}`, await readContent(repoRoot, `ideas/${slug}/${f}`))),
  );
});
