import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { getCompanies, getCompany, readJson } from "@/lib/repository";
import { getWiki } from "@/lib/wiki";
import { isClaim, label, listOf, recordOf, textOf, dateLabel } from "@/lib/model";
import { getPending } from "@/lib/decisions";
import { getPortfolio } from "@/lib/pulse";
import { getThreads, threadHref } from "@/lib/threads";
import { DecisionCard } from "@/components/decision-card";
import { FrontRow } from "@/components/wiki";
import { Empty, More, PageHeader, Row, Rows, Section, Source, State, Tag } from "@/components/ds";
import "@/styles/project-pages.css";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompany((await params).slug);
  return { title: c ? `${c.name} decisions` : "Decisions" };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
// decisions.json points at the thread a decision came from (companies/<slug>/threads/<id>).
const threadLink = (ref: string) => {
  const m = ref.match(/^(?:companies\/([a-z0-9-]+)|(holding))\/threads\/([a-z0-9-]+)/);
  return m ? `/threads/${m[1] || m[2]}/${m[3]}` : undefined;
};

// Everything a project has decided, is deciding, or still has open, in one place.
export default async function ProjectDecisions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCompany(slug);
  if (!c) notFound();
  const [pending, threads, pages, log, portfolio, companies] = await Promise.all([
    getPending(),
    getThreads(),
    getWiki(slug),
    readJson(`companies/${slug}/decisions.json`).catch(() => []),
    getPortfolio(),
    getCompanies(),
  ]);
  const name = (id: string) => companies.find((x) => x.id === id)?.name || id;
  const waiting = pending.filter((p) => p.thread.projects.includes(slug));
  const talking = threads.filter((t) => t.projects.includes(slug) && ["talking", "open"].includes(t.status));
  const fronts = pages.filter((p) => p.kind === "front" && ["open", "working", ""].includes(p.status));
  const questions = listOf(c.open_questions).filter((q) => textOf(q));
  const decided = listOf(log)
    .map(recordOf)
    .sort((a, b) => str(b.date).localeCompare(str(a.date)));
  const related = portfolio.relationships
    .map(recordOf)
    .filter((r) => r.from === slug || r.to === slug)
    .map((r): Record<string, unknown> & { other: string } => ({ ...r, other: String(r.from === slug ? r.to : r.from) }));
  const openCount = talking.length + fronts.length + questions.length;

  return (
    <article className="pp">
      <PageHeader
        title="Decisions"
        meta={[
          <span key="w" className={waiting.length ? "warn" : ""}>
            {waiting.length ? `${waiting.length} waiting on you` : "nothing waiting on you"}
          </span>,
          `${openCount} open`,
          `${decided.length} decided`,
        ]}
        actions={
          <Link href={`/threads/new?scope=${slug}&mode=talk`} className="button secondary">
            <MessageCircle size={15} /> Talk
          </Link>
        }
      />

      <Section title="Waiting on you" note={waiting.length || undefined}>
        {waiting.length ? (
          <div className="decision-list">
            {waiting.map((p) => (
              <DecisionCard key={p.thread.path} p={p} />
            ))}
          </div>
        ) : (
          <Empty>Nothing waiting</Empty>
        )}
      </Section>

      <Section title="Open" note={openCount || undefined}>
        {openCount ? (
          <>
            {(talking.length > 0 || fronts.length > 0) && (
              <Rows>
                {talking.map((t) => (
                  <Row
                    key={t.path}
                    href={threadHref(t)}
                    title={t.title}
                    detail={t.summary}
                    meta={[
                      t.talk ? "Conversation" : "Thread",
                      t.status === "talking" ? (
                        <State key="s" tone="attention">your turn</State>
                      ) : (
                        <State key="s" tone="accent">next: {(t.messages.at(-1)?.to || "").toUpperCase()}</State>
                      ),
                      `${t.messages.length} messages`,
                      t.projects.length > 1 && `also ${t.projects.filter((p) => p !== slug).map(name).join(", ")}`,
                    ]}
                  />
                ))}
                {fronts.map((f) => (
                  <FrontRow key={f.path} page={f} />
                ))}
              </Rows>
            )}
            {questions.length > 0 && (
              <div className="pp-agent-block">
                <p className="pp-sub">
                  Open questions <Source who="agent" />
                  <More href={`/companies/${slug}/model`}>Model</More>
                </p>
                <Rows dense>
                  {questions.map((q, i) => (
                    <Row
                      key={i}
                      title={textOf(q)}
                      trail={isClaim(q) && q.source && q.source !== "agent" ? <Source who={q.source} date={q.date} /> : undefined}
                    />
                  ))}
                </Rows>
              </div>
            )}
          </>
        ) : (
          <Empty>Nothing open</Empty>
        )}
      </Section>

      <Section title="Decided" note={decided.length || undefined}>
        {decided.length ? (
          <Rows>
            {decided.map((d, i) => {
              const source = recordOf(d.source);
              const href = threadLink(str(source.ref));
              const alternatives = listOf(d.alternatives).map(textOf).filter(Boolean);
              return (
                <Row
                  key={str(d.id) || i}
                  href={href}
                  lead={<span className="pp-date">{dateLabel(d.date)}</span>}
                  title={textOf(d.decision)}
                  detail={
                    (textOf(d.why) || alternatives.length > 0 || str(d.revisit)) && (
                      <span className="pp-decided">
                        {textOf(d.why) && <span>{textOf(d.why)}</span>}
                        {alternatives.length > 0 && (
                          <span className="pp-aside">
                            <b>Passed over</b> {alternatives.join(" · ")}
                          </span>
                        )}
                        {str(d.revisit) && (
                          <span className="pp-aside">
                            <b>Revisit if</b> {str(d.revisit)}
                          </span>
                        )}
                      </span>
                    )
                  }
                  meta={[
                    <Source key="s" who={str(source.type) || str(source.source) || "owner"} date={source.date} cite={str(source.note)} />,
                    str(d.id),
                    href ? "thread" : str(source.ref) && <span key="r" className="code-text">{str(source.ref)}</span>,
                  ]}
                />
              );
            })}
          </Rows>
        ) : (
          <Empty>No decisions yet</Empty>
        )}
      </Section>

      {related.length > 0 && (
        <Section title="Connections" note={related.length}>
          <Rows>
            {related.map((r, i) => (
              <Row
                key={i}
                href={`/companies/${r.other}/decisions`}
                title={name(r.other)}
                detail={str(r.text)}
                meta={[str(r.kind) && <Tag key="k">{label(str(r.kind))}</Tag>, <Source key="s" who={str(r.source)} date={r.date} />]}
              />
            ))}
          </Rows>
        </Section>
      )}
    </article>
  );
}
