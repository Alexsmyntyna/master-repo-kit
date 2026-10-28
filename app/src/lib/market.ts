import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "./files";
import { repoRoot } from "./repository";

// companies/<slug>/market/, written by tools/market.py (facts) and the agents (judgment). See its docstring.
export type Shot = { url?: string; path: string; captured?: string };
export type Competitor = {
  id: string;
  name: string;
  kind: string;
  url?: string;
  who?: string | null;
  positioning?: string | null;
  threat?: string | null;
  strengths: string[];
  complaints: string[];
  notes?: string | null;
  sources: { url: string; date?: string }[];
  appstore?: {
    id: number;
    seller?: string;
    price?: string;
    rating?: number | null;
    ratings?: number;
    genre?: string;
    last_update?: string;
    icon?: string;
    description?: string;
    shots: Shot[];
  };
  web?: { pages: Shot[] };
};
export type Review = { rating: number; title?: string; text?: string; version?: string; date?: string };
export type Market = {
  updated: string | null;
  doc?: { content: string; path: string };
  competitors: Competitor[];
  reviews: Record<string, Review[]>;
};

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);

async function json(file: string) {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, file), "utf8"));
  } catch {
    return undefined;
  }
}

export async function getMarket(slug: string): Promise<Market | undefined> {
  const base = `companies/${slug}/market`;
  const data = await json(`${base}/competitors.json`);
  let doc: Market["doc"];
  try {
    const parsed = parseDocument(`${base}/market.md`, await readFile(path.join(repoRoot, base, "market.md"), "utf8"));
    doc = { content: parsed.content, path: parsed.path };
  } catch {}
  if (!data && !doc) return undefined;
  const competitors: Competitor[] = (Array.isArray(data?.competitors) ? data.competitors : []).map(
    (c: Record<string, unknown>) => ({
      ...c,
      strengths: list(c.strengths),
      complaints: list(c.complaints),
      sources: Array.isArray(c.sources)
        ? c.sources.map((s) => (typeof s === "string" ? { url: s } : (s as { url: string; date?: string })))
        : [],
    }),
  );
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  competitors.sort((a, b) => (order[a.threat || ""] ?? 3) - (order[b.threat || ""] ?? 3));
  const reviews: Record<string, Review[]> = {};
  await Promise.all(
    competitors.map(async (c) => {
      const r = await json(`${base}/reviews/${c.id}.json`);
      if (Array.isArray(r?.reviews)) reviews[c.id] = r.reviews;
    }),
  );
  return { updated: data?.updated || null, doc, competitors, reviews };
}

// Only images under companies/<slug>/market/shots/, resolved without escaping it.
export async function safeShot(rel: string): Promise<string | undefined> {
  if (!/^companies\/[a-z0-9-]+\/market\/shots\/[a-z0-9-]+\/[a-z0-9-]+\.(png|jpe?g|webp)$/.test(rel)) return undefined;
  try {
    const file = await realpath(path.join(repoRoot, rel));
    const root = await realpath(path.join(repoRoot, rel.split("/shots/")[0], "shots"));
    return file.startsWith(root + path.sep) ? file : undefined;
  } catch {
    return undefined;
  }
}
export const shotHref = (p: string) => `/market/image?path=${encodeURIComponent(p)}`;
