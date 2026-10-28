import { cache } from "react";
import { recordOf, type Company } from "./model";
import { readJson } from "./repository";

// holding/pulse.json is written by tools/portfolio.py pulse; a project's release card lives in company.json.
export type Pulse = {
  slug: string;
  tier: string;
  state: "active" | "cooling" | "dormant" | "abandoned" | "no-code";
  last_commit: string | null;
  idle_days: number | null;
  commits_30d: number;
  unread: number;
  uncommitted?: number;
  branches?: number;
  worktrees?: number;
};
export type Release = {
  published?: string;
  channel?: string;
  landing_page?: string | null;
  verdict?: "push" | "maintain" | "park" | "retire";
  cadence?: string;
  next_step?: string;
  last_check?: string;
  next_check?: string | null;
  thread?: string;
};
export const stateLabels: Record<string, string> = {
  active: "Active",
  cooling: "Cooling",
  dormant: "Dormant",
  abandoned: "Abandoned",
  "no-code": "No code",
};
export const verdictLabels: Record<string, string> = {
  push: "Push",
  maintain: "Maintain",
  park: "Park",
  retire: "Retire",
};
// The State tone for each verdict (same as the Overview, Vision and release card).
export const verdictTones: Record<string, "ok" | "accent" | "idle" | "risk"> = { push: "ok", maintain: "accent", park: "idle", retire: "risk" };

export const getPulse = cache(async (): Promise<Record<string, Pulse>> => {
  try {
    const data = recordOf(await readJson("holding/pulse.json"));
    const rows = Array.isArray(data.projects) ? (data.projects as Pulse[]) : [];
    return Object.fromEntries(rows.map((r) => [r.slug, r]));
  } catch {
    return {};
  }
});
export const releaseOf = (c: Company): Release | undefined => {
  const r = recordOf((c as Record<string, unknown>).release);
  return Object.keys(r).length ? (r as Release) : undefined;
};

// holding/portfolio.json: which projects get the CEO (focus) and which run between the owner and their COO.
export type Portfolio = { focus: string[]; maintain: string[]; paused: string[]; undecided: string[]; relationships: Record<string, unknown>[] };
export const getPortfolio = cache(async (): Promise<Portfolio> => {
  const data = recordOf(await readJson("holding/portfolio.json").catch(() => ({})));
  const list = (k: string) => (Array.isArray(data[k]) ? (data[k] as string[]) : []);
  return {
    focus: list("focus"),
    maintain: list("maintain"),
    paused: list("paused"),
    undecided: list("undecided"),
    relationships: Array.isArray(data.relationships) ? (data.relationships as Record<string, unknown>[]) : [],
  };
});
