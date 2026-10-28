import { cache } from "react";
import { readJson } from "./repository";

// The parent company's own data, beside its wiki (holding/wiki/):
// - holding/company.json: its name, null until the owner picks one (the nav label and the Company page title);
// - holding/setup.json: the setup checklist, ordered groups of steps; the owner's click sets `done` (`done_by: owner`), and
//   a step an agent can do may be recorded done by the agent (`done_by: agent`, `evidence`: a path to what it delivered);
// - holding/money.json: how each product earns, and the goals and actuals the owner enters. Nothing is ever guessed:
//   a number nobody entered is null and shows as "—".
// The helpers below are pure, so tests and server actions share them.

export type CompanyInfo = { name: string | null; legal_name: string | null; entity: string | null; updated: string };
export type SetupStep = {
  id: string;
  text: string;
  who: "owner" | "alex" | "agent";
  done: boolean;
  done_on?: string | null;
  done_by?: "owner" | "alex" | "agent";
  evidence?: string; // a path to what the agent delivered, when done_by is agent
  blocked_by: string[] | null;
  source: string;
  note?: string;
};
export type SetupGroup = { id: string; title: string; steps: SetupStep[] };
export type Setup = { updated: string; note?: string; groups: SetupGroup[] };
export type ProductMoney = {
  model: string;
  state: string; // earning | free | not-yet | unknown
  goal_monthly: number | null;
  actual_monthly: number | null;
  note: string;
};
export type Money = {
  updated: string;
  note?: string;
  currency: string;
  goals: { note?: string; year: number | null; monthly: number | null };
  products: Record<string, ProductMoney>;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : null);

export function parseCompany(raw: unknown): CompanyInfo {
  const r = obj(raw);
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { name: s(r.name), legal_name: s(r.legal_name), entity: s(r.entity), updated: str(r.updated) };
}

export function parseSetup(raw: unknown): Setup {
  const r = obj(raw);
  const groups = Array.isArray(r.groups) ? r.groups : [];
  return {
    updated: str(r.updated),
    note: str(r.note) || undefined,
    groups: groups.map((g) => {
      const o = obj(g);
      return {
        id: str(o.id),
        title: str(o.title) || str(o.id),
        steps: (Array.isArray(o.steps) ? o.steps : []).map((s) => {
          const x = obj(s);
          return {
            id: str(x.id),
            text: str(x.text),
            who: x.who === "agent" ? "agent" : x.who === "owner" ? "owner" : "alex",
            done: x.done === true,
            done_on: str(x.done_on) || null,
            ...((x.done_by === "owner" || x.done_by === "alex") || x.done_by === "agent" ? { done_by: x.done_by } : {}),
            ...(str(x.evidence) ? { evidence: str(x.evidence) } : {}),
            blocked_by: ids(x.blocked_by),
            source: str(x.source),
            ...(str(x.note) ? { note: str(x.note) } : {}),
          } satisfies SetupStep;
        }),
      };
    }),
  };
}

export const allSteps = (setup: Setup) => setup.groups.flatMap((g) => g.steps.map((s) => ({ ...s, group: g.title })));

export function setupCounts(setup: Setup) {
  const steps = allSteps(setup);
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

// The steps a step still waits on (its blockers not yet done).
export function waitingOn(setup: Setup, step: SetupStep): SetupStep[] {
  const byId = new Map(allSteps(setup).map((s) => [s.id, s]));
  return (step.blocked_by || []).map((id) => byId.get(id)).filter((s): s is SetupStep & { group: string } => !!s && !s.done);
}

// The next undone steps in checklist order, the ones nothing blocks first.
export function nextSteps(setup: Setup, n = 3) {
  const open = allSteps(setup).filter((s) => !s.done);
  const ready = open.filter((s) => !waitingOn(setup, s).length);
  return [...ready, ...open.filter((s) => !ready.includes(s))].slice(0, n);
}

// A group's steps for display: undone in order, done ones at the bottom.
export const ordered = (steps: SetupStep[]) => [...steps.filter((s) => !s.done), ...steps.filter((s) => s.done)];

// the owner ticks or unticks a step: ticked is `done_by: owner`; unticked clears who, when and the evidence.
// Throws on an unknown step, so a stale page can't write a new one.
export function toggleStep(setup: Setup, id: string, done: boolean, today: string): Setup {
  if (!allSteps(setup).some((s) => s.id === id)) throw new Error("Unknown step");
  return {
    ...setup,
    updated: today,
    groups: setup.groups.map((g) => ({
      ...g,
      steps: g.steps.map((s) => {
        if (s.id !== id) return s;
        const next: SetupStep = { ...s, done, done_on: done ? today : null, done_by: "owner" };
        delete next.evidence;
        if (!done) delete next.done_by;
        return next;
      }),
    })),
  };
}

export function parseMoney(raw: unknown): Money {
  const r = obj(raw);
  const goals = obj(r.goals);
  return {
    updated: str(r.updated),
    note: str(r.note) || undefined,
    currency: str(r.currency) || "USD",
    goals: { note: str(goals.note) || undefined, year: num(goals.year), monthly: num(goals.monthly) },
    products: Object.fromEntries(
      Object.entries(obj(r.products)).map(([slug, v]) => {
        const p = obj(v);
        return [
          slug,
          {
            model: str(p.model) || "unknown",
            state: str(p.state) || "unknown",
            goal_monthly: num(p.goal_monthly),
            actual_monthly: num(p.actual_monthly),
            note: str(p.note),
          },
        ];
      }),
    ),
  };
}

// What the owner typed in an amount field: "" is "not set" (null); "1,200", "$1200" and "1200.50" are numbers;
// anything else (words, negatives) is undefined, so the action can refuse it.
export function parseAmount(input: string): number | null | undefined {
  const t = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n <= 1e12 ? n : undefined;
}

// A figure for display: "—" when nobody entered it (never 0).
export function formatAmount(n: number | null, currency = "USD"): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
}

// The text for an amount input: empty when not set.
export const amountInput = (n: number | null) => (n === null ? "" : String(n));

export function setGoals(money: Money, year: number | null, monthly: number | null, today: string): Money {
  return { ...money, updated: today, goals: { ...money.goals, year, monthly } };
}

export function setProductMoney(money: Money, slug: string, goal: number | null, actual: number | null, today: string): Money {
  const p = money.products[slug];
  if (!p) throw new Error("Unknown product");
  return { ...money, updated: today, products: { ...money.products, [slug]: { ...p, goal_monthly: goal, actual_monthly: actual } } };
}

// The whole products table saved at once: the slugs whose goal or actual differ from the record. `typed` is what
// each row's two fields hold; an amount that isn't a number refuses the whole save (nothing half-written).
export type ProductChange = { slug: string; goal: number | null; actual: number | null };
export function productChanges(
  money: Money,
  typed: Record<string, { goal: string; actual: string }>,
): { changes: ProductChange[] } | { error: string } {
  const changes: ProductChange[] = [];
  for (const [slug, t] of Object.entries(typed)) {
    const p = money.products[slug];
    if (!p) return { error: "Unknown product." };
    const goal = parseAmount(t.goal),
      actual = parseAmount(t.actual);
    if (goal === undefined || actual === undefined) return { error: `${slug}: amounts are plain numbers, like 1200 or 1,200.50.` };
    if (goal !== p.goal_monthly || actual !== p.actual_monthly) changes.push({ slug, goal, actual });
  }
  return { changes };
}

const read = async (rel: string) => {
  try {
    return await readJson(rel);
  } catch {
    return {};
  }
};
export const getCompanyInfo = cache(async () => parseCompany(await read("holding/company.json")));
export const getSetup = cache(async () => parseSetup(await read("holding/setup.json")));
export const getMoney = cache(async () => parseMoney(await read("holding/money.json")));
