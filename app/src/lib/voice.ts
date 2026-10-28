import type { Thread } from "./threads";

// What the owner has said about a project in their own words: their messages in its threads, newest first. Prompts a tool
// or button wrote in their name (check-ins, market checks, restate requests) and bare approvals are left out.
export type Said = { text: string; date: string; thread: Thread };

// Every message a tool or button writes in the owner's name. The app shows these as "Automatic", never as their words.
const templates = [
  /^Standing check-in \(scheduled by/, // tools/portfolio.py check-in
  /^Market check\. Build or refresh/, // the Market page's button
  /^Restate this so I can decide/, // the thread page's "Restate" button
  /^Approved\.?$/, // a bare approval
  /^Trial of the consult tool/,
  /^[a-z0-9-]+ v\d+\b/, // a mockup hub's answer sheet ("context-notepad-hub v3 …")
  /^Commit everything you made for this brief/, // the Board's "commit the rest" preset
];
export const isGenerated = (body: string) => templates.some((t) => t.test(body.trim()));

export function ownerSaid(threads: Thread[], slug: string, limit = 3): Said[] {
  return threads
    .filter((t) => t.projects.includes(slug))
    .flatMap((t) =>
      t.messages
        .filter((m) => ["owner", "alex"].includes(m.from) && m.body.trim() && !isGenerated(m.body))
        .map((m) => ({ text: m.body.trim(), date: m.date, thread: t })),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.thread.updated.localeCompare(a.thread.updated))
    .slice(0, limit);
}
