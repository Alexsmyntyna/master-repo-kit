import { cache } from "react";
import { getCompanies } from "./repository";
import { getPortfolio } from "./pulse";
import { getThreads, type Role, type Thread } from "./threads";
import { parseCard, stripBlocks, type Card } from "./options";
export { parseCard, stripBlocks, toWeeks, type Card, type Level, type Option } from "./options";

// A decision message can end with an ```options block (agents/ceo.md, agents/coo.md):
//
//   ask: Ship the redesign as build 7 this week?
//   A* | Ship build 7 with two fixes | time: 1 week | complexity: low | growth: medium | costs: Colleagues waits
//   B  | Freeze and cut back to notes | time: 2 weeks | complexity: medium | growth: low | costs: finished work
//   revisit: build 7 can't ship this week
//
// `*` marks the recommendation. Everything is optional except at least one option line.
const releaseVerdict = (body: string) => body.match(/```release\n[\s\S]*?^verdict:\s*(\w+)/m)?.[1];

export type Pending = {
  thread: Thread;
  project: string;
  focus: boolean;
  from: Role;
  since: string; // date the decision reached the owner
  waitingDays: number;
  title: string; // the proposed decision in one line
  card?: Card;
  reasoning: string;
  verdict?: string; // a check-in's release verdict (push, maintain, park, retire)
  isDecision: boolean; // false: the agent asked the owner a question instead of proposing a decision
};

const days = (from: string, to: Date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(from) ? Math.max(0, Math.floor((to.getTime() - Date.parse(from + "T00:00:00Z")) / 864e5)) : 0;

export function pendingDecisions(
  threads: Thread[],
  names: Record<string, string>,
  focus: string[],
  now = new Date(),
): Pending[] {
  return threads
    .filter((t) => ["awaiting-alex", "awaiting-owner"].includes(t.status) && t.messages.length)
    .map((t) => {
      const last = t.messages.at(-1)!;
      return {
        thread: t,
        project: t.scope === "holding" ? "Parent company" : names[t.scope] || t.scope,
        focus: t.scope === "holding" || focus.includes(t.scope),
        from: last.from,
        since: last.date || t.updated,
        waitingDays: days(last.date || t.updated, now),
        title: t.decision || last.subject || t.title,
        card: parseCard(last.body),
        reasoning: stripBlocks(last.body),
        verdict: releaseVerdict(last.body),
        isDecision: last.kind === "decision",
      };
    })
    .sort((a, b) => Number(b.focus) - Number(a.focus) || a.since.localeCompare(b.since));
}

export const getPending = cache(async () => {
  const [threads, companies, portfolio] = await Promise.all([getThreads(), getCompanies(), getPortfolio()]);
  return pendingDecisions(
    threads,
    Object.fromEntries(companies.map((c) => [c.id, c.name])),
    portfolio.focus,
  );
});
