import { LoaderCircle } from "lucide-react";
import { AutoRefresh } from "@/components/run-status";
import { DecisionCard } from "@/components/decision-card";
import { Empty, More, PageHeader, Row, Rows, Section } from "@/components/ds";
import { getPending } from "@/lib/decisions";
import { getCompanies } from "@/lib/repository";
import { getThreads, threadHref } from "@/lib/threads";

export const metadata = { title: "Decisions" };

// Everything waiting on the owner: decisions and questions the CEO and COOs brought them, focus projects first.
export default async function Decisions() {
  const [pending, threads, companies] = await Promise.all([getPending(), getThreads(), getCompanies()]);
  const name = (scope: string) => companies.find((c) => c.id === scope)?.name || "Parent company";
  const inMotion = threads.filter((t) => t.status === "open");
  const working = inMotion.filter((t) => t.running?.alive);
  const focus = pending.filter((p) => p.focus),
    rest = pending.filter((p) => !p.focus);
  const oldest = Math.max(0, ...pending.map((p) => p.waitingDays));
  return (
    <>
      <PageHeader
        title="Decisions"
        meta={[
          <span key="n" className={pending.length ? "warn" : ""}>{pending.length ? `${pending.length} waiting on you` : "nothing waiting on you"}</span>,
          pending.length > 0 && `oldest ${oldest === 0 ? "today" : `${oldest} day${oldest === 1 ? "" : "s"}`}`,
          working.length > 0 && `${working.length} in progress`,
        ]}
      />
      <AutoRefresh active={working.length > 0} every={5000} />
      {!!focus.length && (
        <Section title="Focus" note={focus.length}>
          <div className="decision-list">
            {focus.map((p) => (
              <DecisionCard key={p.thread.path} p={p} />
            ))}
          </div>
        </Section>
      )}
      {!!rest.length && (
        <Section title="Other" note={rest.length}>
          <div className="decision-list">
            {rest.map((p) => (
              <DecisionCard key={p.thread.path} p={p} />
            ))}
          </div>
        </Section>
      )}
      {!pending.length && (
        <Empty action={<More href="/threads/new">New thread</More>}>Nothing waiting</Empty>
      )}
      {!!inMotion.length && (
        <Section title="In progress" note={inMotion.length}>
          <Rows>
            {inMotion.map((t) => (
              <Row
                key={t.path}
                href={threadHref(t)}
                lead={t.running?.alive ? <LoaderCircle size={14} className="spin" /> : undefined}
                title={t.title}
                detail={t.summary}
                meta={[
                  name(t.scope),
                  t.running?.alive ? `${t.running.role.toUpperCase()} working` : `next: ${(t.messages.at(-1)?.to || "").toUpperCase()}`,
                  `${t.messages.length} messages`,
                ]}
              />
            ))}
          </Rows>
        </Section>
      )}
    </>
  );
}
