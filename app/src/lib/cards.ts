import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { recordOf } from "./model";
import { getCompanies, repoRoot } from "./repository";
import { getPulse } from "./pulse";

// A project's card (companies/<slug>/card.json): what the owner sees first. Human keys (kind, goal, gates, blocker, next)
// are written by agents or the owner with a source; derived keys (moved, owes, footprint, hygiene, tier) are written by
// tools/card.py refresh. footprint.json and hygiene.json beside it fill in when the card hasn't copied them yet, and
// holding/pulse.json fills in movement. Every key may be missing; a project with no card still shows.

export const KINDS = ["publish", "sell", "client", "tool", "learn", "maintain"] as const;
// tools/recheck.py's flag on an open question: commits in the project's repos since it was asked (or last
// rechecked), an agent working on it now, or an agent's verdict that it's resolved.
export type Recheck = { commits: number; since: string; running: boolean; verdict: string; reason: string; rechecked: string };
export type Line = { text: string; source: string; ref: string; date: string; recheck?: Recheck };
export type Gate = { name: string; state: "done" | "open" | "unknown"; note: string; source: string; ref: string; date: string };
export type Moved = { last_commit: string | null; idle_days: number | null; commits_30d: number | null; uncommitted: number | null; branches: number | null };
export type Owes = { decisions: number; builds_review: number; builds_approved_unrun: number; threads_awaiting: number };
export type Footprint = {
  hosting: string[];
  database: string[];
  payments: string[];
  store: string[];
  domains: string[];
  public_urls_ok: boolean | null;
  monthly_cost: number | null;
  summary: string;
};
export type Hygiene = { score: "good" | "fair" | "poor" | null; reasons: string[]; stray_root_files: number | null; claude_md_lines: number | null; untracked: number | null };
export type Card = {
  slug: string;
  written: boolean; // card.json exists and isn't a stub marked `needs`
  needs: string; // why the card is unwritten, from a stub
  kind: string;
  kindSource: string;
  goal: Line | null;
  gates: Gate[];
  blocker: Line | null;
  next: Line | null;
  updated: string;
  moved: Moved | null;
  owes: Owes | null;
  recheck: number; // open questions flagged by tools/recheck.py (derived by card.py), apart from owes
  footprint: Footprint | null;
  hygiene: Hygiene | null;
  tier: string;
};

const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const has = (r: Record<string, unknown>) => Object.keys(r).length > 0;

// The recheck keys of a card line (`recheck`, `recheck_running`, `rechecked`) or of a thread's or build's front
// matter (`recheck_commits`, `recheck_since`, `recheck_running`, `rechecked`, `recheck_note`). Undefined when none.
export function recheckOf(r: Record<string, unknown>): Recheck | undefined {
  const flag = recordOf(r.recheck);
  const note = recordOf(r.recheck_note);
  const out = {
    commits: num(flag.commits) ?? num(r.recheck_commits) ?? 0,
    since: str(flag.since) || str(r.recheck_since),
    running: !!str(r.recheck_running),
    verdict: str(flag.verdict),
    reason: str(flag.reason) || str(note.reason),
    rechecked: str(r.rechecked),
  };
  return out.commits || out.running || out.verdict || out.rechecked ? out : undefined;
}

function lineOf(v: unknown): Line | null {
  if (typeof v === "string") return v.trim() ? { text: v.trim(), source: "agent", ref: "", date: "" } : null;
  const r = recordOf(v);
  const text = str(r.text);
  if (!text) return null;
  const recheck = recheckOf(r);
  return { text, source: str(r.source) || "agent", ref: str(r.ref), date: str(r.date), ...(recheck ? { recheck } : {}) };
}

function gatesOf(v: unknown): Gate[] {
  return (Array.isArray(v) ? v : []).map(recordOf).flatMap((g) => {
    const name = str(g.name);
    if (!name) return [];
    const s = str(g.state);
    return [{ name, state: s === "done" || s === "open" ? s : "unknown", note: str(g.note), source: str(g.source) || "agent", ref: str(g.ref), date: str(g.date) }];
  });
}

function movedOf(v: unknown): Moved | null {
  const r = recordOf(v);
  if (!has(r)) return null;
  return {
    last_commit: str(r.last_commit) || null,
    idle_days: num(r.idle_days),
    commits_30d: num(r.commits_30d),
    uncommitted: num(r.uncommitted),
    branches: num(r.branches),
  };
}

function owesOf(v: unknown): Owes | null {
  const r = recordOf(v);
  if (!has(r)) return null;
  return {
    decisions: num(r.decisions) ?? 0,
    builds_review: num(r.builds_review) ?? 0,
    builds_approved_unrun: num(r.builds_approved_unrun) ?? 0,
    threads_awaiting: num(r.threads_awaiting) ?? 0,
  };
}

// A footprint record, or footprint.json, which may list per-repo records under `repos`: their lists are merged.
export function footprintOf(v: unknown): Footprint | null {
  const r = recordOf(v);
  if (!has(r)) return null;
  const parts = [r, ...(Array.isArray(r.repos) ? r.repos.map(recordOf) : [])];
  const union = (k: string) => [...new Set(parts.flatMap((p) => strs(p[k])))];
  const ok = r.public_urls_ok;
  const fp = {
    hosting: union("hosting"),
    database: union("database"),
    payments: union("payments"),
    store: union("store"),
    domains: union("domains"),
    public_urls_ok: typeof ok === "boolean" ? ok : null,
    monthly_cost: num(r.monthly_cost),
    summary: str(r.summary),
  };
  // Detected items may be records ({name, path, source}); take their name.
  for (const k of ["hosting", "database", "payments", "store", "domains"] as const)
    if (!fp[k].length)
      fp[k] = [...new Set(parts.flatMap((p) => (Array.isArray(p[k]) ? p[k] : []).map((x) => str(recordOf(x).name || recordOf(x).what)).filter(Boolean)))];
  return fp;
}

const scores = ["good", "fair", "poor"] as const;
// A hygiene record, or hygiene.json with per-repo records under `repos`: the worst repo's score counts.
export function hygieneOf(v: unknown): Hygiene | null {
  const r = recordOf(v);
  if (!has(r)) return null;
  const repos = Array.isArray(r.repos) ? r.repos.map(recordOf) : [];
  const scoreOf = (x: Record<string, unknown>) => (scores as readonly string[]).indexOf(str(x.score));
  const worst = [r, ...repos].map(scoreOf).reduce((a, b) => Math.max(a, b), -1);
  // The top-level figure, else the repos' figures added up.
  const sum = (k: string) => {
    if (num(r[k]) !== null) return num(r[k]);
    const vals = repos.map((x) => num(x[k])).filter((n): n is number => n !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return {
    score: worst >= 0 ? scores[worst] : null,
    reasons: [...strs(r.reasons), ...repos.flatMap((x) => strs(x.reasons))],
    stray_root_files: sum("stray_root_files"),
    claude_md_lines: sum("claude_md_lines"),
    untracked: sum("untracked"),
  };
}

// One card from the raw files; any of them may be undefined (missing) or malformed.
export function parseCard(slug: string, raw: { card?: unknown; footprint?: unknown; hygiene?: unknown; pulse?: unknown }): Card {
  const c = recordOf(raw.card);
  const exists = raw.card !== undefined && has(c);
  const needs = c.needs === undefined || c.needs === null ? "" : str(c.needs) || "card not written";
  const p = recordOf(raw.pulse);
  return {
    slug,
    written: exists && !(c.needs !== undefined && c.needs !== null),
    needs,
    kind: str(c.kind),
    kindSource: str(c.kind_source) || (str(c.kind) ? "agent" : ""),
    goal: lineOf(c.goal),
    gates: gatesOf(c.gates),
    blocker: lineOf(c.blocker),
    next: lineOf(c.next),
    updated: str(c.updated),
    moved: movedOf(c.moved) || movedOf(has(p) ? p : undefined),
    owes: owesOf(c.owes),
    recheck: num(c.recheck) ?? 0,
    footprint: footprintOf(c.footprint) || footprintOf(raw.footprint),
    hygiene: hygieneOf(c.hygiene) || hygieneOf(raw.hygiene),
    tier: str(c.tier) || str(p.tier),
  };
}

// What the card asks of the owner: decisions and builds waiting on them.
export const owed = (c: Card) => (c.owes ? c.owes.decisions + c.owes.builds_review + c.owes.threads_awaiting : 0);

// Something that costs (hosting or a database) on a project that hasn't moved in over 30 days.
export const COSTING_IDLE_DAYS = 30;
export function costingNotMoving(c: Card): boolean {
  const fp = c.footprint;
  const idle = c.moved?.idle_days;
  return !!fp && (fp.hosting.length > 0 || fp.database.length > 0) && typeof idle === "number" && idle > COSTING_IDLE_DAYS;
}

// The board's order: projects that owe the owner something or cost without moving first, then by days idle (most recently
// moved first; unknown last), then by slug.
export function sortCards(cards: Card[]): Card[] {
  const urgent = (c: Card) => (owed(c) > 0 || costingNotMoving(c) ? 0 : 1);
  const idle = (c: Card) => c.moved?.idle_days ?? Number.POSITIVE_INFINITY;
  return [...cards].sort((a, b) => urgent(a) - urgent(b) || idle(a) - idle(b) || a.slug.localeCompare(b.slug));
}

export type Dials = { blockers: number; decisions: number; buildsReview: number; recheck: number; costing: number; poorHygiene: number };
export function dialsOf(cards: Card[]): Dials {
  return {
    blockers: cards.filter((c) => c.blocker).length,
    decisions: cards.reduce((n, c) => n + (c.owes?.decisions || 0), 0),
    buildsReview: cards.reduce((n, c) => n + (c.owes?.builds_review || 0), 0),
    recheck: cards.reduce((n, c) => n + c.recheck, 0),
    costing: cards.filter(costingNotMoving).length,
    poorHygiene: cards.filter((c) => c.hygiene?.score === "poor").length,
  };
}

const readOptional = async (relative: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, relative), "utf8"));
  } catch {
    return undefined; // missing or malformed: shown as unknown
  }
};

export const cardFor = cache(async (slug: string): Promise<Card> => {
  const [card, footprint, hygiene, pulse] = await Promise.all([
    readOptional(`companies/${slug}/card.json`),
    readOptional(`companies/${slug}/footprint.json`),
    readOptional(`companies/${slug}/hygiene.json`),
    getPulse().then((p) => p[slug]),
  ]);
  return parseCard(slug, { card, footprint, hygiene, pulse });
});

export const allCards = cache(async (): Promise<Card[]> => {
  const companies = await getCompanies();
  return sortCards(await Promise.all(companies.map((c) => cardFor(c.id))));
});

// Finish-line gates by state, for the GateMeter (components/gate-meter.tsx).
export type GateCounts = { done: number; open: number; unknown: number; total: number };
export function gateCounts(gates: Pick<Gate, "state">[]): GateCounts {
  const n = (s: Gate["state"]) => gates.filter((g) => g.state === s).length;
  return { done: n("done"), open: n("open"), unknown: n("unknown"), total: gates.length };
}
