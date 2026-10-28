import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCompanies, getCompany } from "@/lib/repository";
import { getThread } from "@/lib/threads";
import { dateLabel } from "@/lib/model";
import { Consults, LatestMessage, MessageCard, ThreadStatus } from "@/components/thread-view";
import { OpenOnHash } from "@/components/open-on-hash";
import { Reply } from "@/components/composer";
import { RunStatus } from "@/components/run-status";
import { ensureRetryWaiter } from "@/lib/spawn";
import { getPortfolio } from "@/lib/pulse";
import { parseCard } from "@/lib/decisions";
import { threadHrefOf } from "@/lib/brief";
import { DecisionForm } from "@/components/decision-form";
import { RecheckMark } from "@/components/recheck";
import { More, PageHeader } from "@/components/ds";

type Params = { params: Promise<{ scope: string; thread: string }> };

export async function generateMetadata({ params }: Params) {
  const { scope, thread } = await params;
  return { title: (await getThread(scope, thread))?.title || "Thread not found" };
}

export default async function ThreadPage({ params }: Params) {
  const { scope, thread: id } = await params;
  if (!/^[a-z0-9-]+$/.test(scope) || !/^[a-z0-9-]+$/.test(id)) notFound();
  const [thread, company, portfolio, companies] = await Promise.all([
    getThread(scope, id),
    scope === "holding" ? undefined : getCompany(scope),
    getPortfolio(),
    getCompanies(),
    ensureRetryWaiter(),
  ]);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  if (!thread) notFound();
  const next = thread.messages.at(-1)?.to;
  const last = thread.messages.at(-1);
  // A stale thread (unanswered 14 days, tools/refresh.py) can still be answered like one waiting on the owner.
  const awaiting = ["awaiting-alex", "awaiting-owner"].includes(thread.status) || thread.status === "stale";
  const card = awaiting && last ? parseCard(last.body) : undefined;
  return (
    <article className="thread-page">
      <Link href="/threads" className="back-link">
        <ArrowLeft size={14} /> All threads
      </Link>
      <PageHeader
        kicker={
          <>
            {company ? <Link href={`/companies/${scope}`}>{company.name}</Link> : "Parent company"} · started {dateLabel(thread.started)}
          </>
        }
        title={thread.title}
        lede={thread.summary || undefined}
        meta={[
          <ThreadStatus key="s" status={thread.status} />,
          thread.status === "stale" && thread.staleSince && (
            <span key="stale" className="muted">
              stale since {dateLabel(thread.staleSince)}
            </span>
          ),
          awaiting && thread.recheck && <RecheckMark key="recheck" flag={thread.recheck} item={thread.path} />,
          `${thread.messages.length} messages`,
          ...thread.participants
            .filter((r) => !["owner", "alex"].includes(r))
            .map((r) => `${r.toUpperCase()} on ${thread.models[r] || (r === "ceo" ? "opus" : "sonnet")}${thread.models[r] ? "" : " (auto)"}`),
          thread.helpers && "helpers on",
          thread.status === "open" && next && !["owner", "alex"].includes(next) && `next: ${next.toUpperCase()}`,
        ]}
      />
      <header className="thread-hero">
        {scope !== "holding" && (
          <More href={`/companies/${scope}/build?thread=${scope}/${id}`}>Send to the Board</More>
        )}
        {thread.supersededBy && threadHrefOf(thread.supersededBy) && (
          <p className="thread-superseded">
            Withdrawn by the CEO; see <Link href={threadHrefOf(thread.supersededBy)}>the newer thread</Link>. Reply to reopen.
          </p>
        )}
        {thread.decision && (
          <p className={`thread-decision ts-${thread.status}`}>
            <strong>{thread.status === "decided" ? "Decided" : "Proposed"}:</strong> {thread.decision}
          </p>
        )}
      </header>

      <RunStatus
        scope={scope}
        id={id}
        running={thread.running}
        failed={thread.failed}
        waiting={thread.waiting}
        next={next}
        status={thread.status}
      />
      {thread.running?.alive && (
        <Consults consults={thread.consults.filter((c) => c.feeds === thread.messages.length + 1)} names={names} />
      )}

      {last && (
        <LatestMessage
          m={last}
          n={thread.messages.length}
          consults={thread.consults.filter((c) => c.feeds === thread.messages.length)}
          names={names}
        >
          {awaiting && (last.from === "ceo" || last.from === "coo") && (card || last.kind === "decision") && (
            <div className="latest-decide">
              {card?.ask && <h3>{card.ask}</h3>}
              <DecisionForm
                scope={scope}
                id={id}
                card={card}
                isDecision={last.kind === "decision"}
                from={last.from}
                steer={false}
              />
              {card?.revisit && (
                <p className="decision-revisit">
                  <b>Revisit if</b> {card.revisit}
                </p>
              )}
            </div>
          )}
        </LatestMessage>
      )}

      {(thread.status !== "closed" || !!thread.supersededBy) && (
        <Reply
          scope={scope}
          id={id}
          awaiting={awaiting}
          canApprove={false}
          focus={scope === "holding" || portfolio.focus.includes(scope) || thread.participants.includes("ceo")}
          lastFrom={thread.messages.at(-1)?.from}
          busy={!!thread.running?.alive}
          models={thread.models}
          repos={(Array.isArray(company?.repos) ? company.repos : [])
            .map((r) => String((r as { path?: string }).path || ""))
            .filter(Boolean)}
        />
      )}

      {thread.messages.length > 1 && (
        <section className="history">
          <h2 className="history-head">Earlier · {thread.messages.length - 1}</h2>
          <OpenOnHash />
          <ol className="msg-list">
            {thread.messages.slice(0, -1).map((m, i) => (
              <MessageCard
                key={m.path}
                m={m}
                n={i + 1}
                consults={thread.consults.filter((c) => c.feeds === i + 1)}
                names={names}
              />
            ))}
          </ol>
        </section>
      )}

      <p className="path-note">{thread.path}</p>
    </article>
  );
}
