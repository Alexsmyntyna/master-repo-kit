import type { Owes } from "@/lib/cards";

// What a project waits on the owner for, as verbs with counts: decide, review, reply (amber), and builds approved but not
// run yet (quiet: that one is on the agents). `full` spells each out for the project card.
export function OwesBadges({ owes, full = false }: { owes: Owes | null; full?: boolean }) {
  if (!owes) return null;
  const items: [number, string, string, boolean][] = [
    [owes.decisions, "decide", `decision${owes.decisions === 1 ? "" : "s"} to make`, true],
    [owes.builds_review, "review", `build${owes.builds_review === 1 ? "" : "s"} to review`, true],
    [owes.threads_awaiting, "reply", `thread${owes.threads_awaiting === 1 ? "" : "s"} waiting on you`, true],
    [owes.builds_approved_unrun, "to run", "approved, not run", false],
  ];
  const shown = items.filter(([n]) => n > 0);
  if (!shown.length) return null;
  return (
    <span className="owes">
      {shown.map(([n, verb, words, yours]) => (
        <span key={verb} className={`owe${yours ? " is-yours" : ""}`} title={`${n} ${words}`}>
          <b>{n}</b> {full ? words : verb}
        </span>
      ))}
    </span>
  );
}
