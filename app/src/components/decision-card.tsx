import Link from "next/link";
import { BriefView } from "@/components/brief";
import { MockupStrip } from "@/components/mockups";
import { parseMockups } from "@/lib/mockups";
import { DecisionForm } from "@/components/decision-form";
import { ProjectMark } from "@/components/ui";
import { Fold, Meta, State } from "@/components/ds";
import { verdictLabels, verdictTones } from "@/lib/pulse";
import { threadHref } from "@/lib/threads";
import type { Pending } from "@/lib/decisions";
import "@/styles/decisions.css";

const waiting = (d: number) => (d === 0 ? "today" : `${d}d`);

// One decision the owner owes: who asks and how long it's waited, the ask with the verdict beside it, the actions in one
// row, and the reasoning and thread on one quiet line under them.
export function DecisionCard({ p }: { p: Pending }) {
  const { thread, card } = p;
  const last = thread.messages.at(-1)!;
  const n = thread.messages.length;
  return (
    <article className={`decision-card ${p.waitingDays >= 7 ? "is-stale" : ""}`}>
      <header className="decision-meta">
        {thread.scope !== "holding" && <ProjectMark company={{ id: thread.scope, name: p.project }} />}
        <Meta
          items={[
            <strong key="p">{p.project}</strong>,
            `${p.from.toUpperCase()} ${p.isDecision ? "proposes" : "asks"}`,
            thread.checkin && "check-in",
            <span key="w" className={p.waitingDays >= 7 ? "warn" : ""}>waiting {waiting(p.waitingDays)}</span>,
          ]}
        />
      </header>
      <div className="decision-head">
        <h2>{card?.ask || p.title}</h2>
        {p.verdict && <State tone={verdictTones[p.verdict] || "idle"}>{verdictLabels[p.verdict] || p.verdict}</State>}
      </div>
      {card?.ask && p.title !== card.ask && <p className="decision-proposal">{p.title}</p>}
      {/* A proposal's title already says what's proposed, and the reasoning is one click away; a question keeps two
          lines of context. */}
      {!card && !p.isDecision && thread.summary && <p className="decision-proposal is-clamped">{thread.summary}</p>}
      <MockupStrip mockups={parseMockups(last.body)} />
      <DecisionForm scope={thread.scope} id={thread.id} card={card} isDecision={p.isDecision} from={p.from} />
      {card?.revisit && (
        <p className="decision-revisit">
          <b>Revisit if</b> {card.revisit}
        </p>
      )}
      <Fold summary="Reasoning" aside={<Link href={threadHref(thread)}>Thread, {n} message{n === 1 ? "" : "s"}</Link>}>
        <BriefView body={p.reasoning} path={last.path} />
      </Fold>
    </article>
  );
}
