import { notFound } from "next/navigation";
import { getCompany } from "@/lib/repository";
import { getSnapshot, getWiki, wikiHref } from "@/lib/wiki";
import { dateLabel, isClaim, label, recordOf, textOf, type Claim } from "@/lib/model";
import Link from "next/link";
import { WikiBody } from "@/components/wiki";
import { cardFor } from "@/lib/cards";
import { ProjectCard } from "@/components/card";
import { FourWeekRun } from "@/components/activity";
import { getActivity, getCommits, reposOf } from "@/lib/activity";
import { getPulse, releaseOf } from "@/lib/pulse";
import { getThreads, threadHref } from "@/lib/threads";
import { getIdeas } from "@/lib/ideas";
import { IdeaStatusTag } from "@/components/ideas";
import { getPending } from "@/lib/decisions";
import { ownerSaid } from "@/lib/voice";
import { ReleaseSection } from "@/components/release";
import { Empty, Fold, More, PageHeader, Row, Rows, Said, Section, Source, Split, Statement } from "@/components/ds";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompany((await params).slug);
  return { title: c?.name || "Project not found" };
}

const ago = (days: number | null) => (days === null ? "" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

// A project's front page, in order of trust: what the owner said, what the code shows, then what agents wrote.
export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCompany(slug);
  if (!c) notFound();
  const repos = reposOf(c.repos);
  const [pages, pulse, threads, activity, commits, pending, allIdeas, card, snapshot] = await Promise.all([
    getWiki(slug),
    getPulse(),
    getThreads(),
    getActivity(repos),
    getCommits(repos, 8),
    getPending(),
    getIdeas(),
    cardFor(slug),
    getSnapshot(slug),
  ]);
  const ideas = allIdeas.filter((i) => i.links.includes(slug));
  const index = pages.find((p) => p.page === "index");
  const fronts = pages.filter((p) => p.kind === "front");
  const open = fronts.filter((p) => ["open", "working", ""].includes(p.status));
  const said = ownerSaid(threads, slug, 3);
  const waiting = pending.filter((p) => p.thread.scope === slug);
  const checkin = threads.find((t) => t.scope === slug && t.checkin && ["open", "awaiting-alex", "awaiting-owner", "talking"].includes(t.status));
  const p = pulse[slug];

  const thesis = recordOf(c.thesis);
  const vision = (
    [
      ["Why it exists", thesis.why_it_exists],
      ["What it should become", thesis.what_it_should_become],
      ["Ambition", c.ambition],
      ["The bet", thesis.the_bet],
    ] as [string, unknown][]
  ).filter(([, v]) => textOf(v));
  // the owner's own statements first, then code, then agents' readings.
  const rank = (v: unknown) => ({ owner: 0, alex: 0, code: 1, public: 2 })[String(isClaim(v) ? v.source : "")] ?? 3;
  vision.sort((a, b) => rank(a[1]) - rank(b[1]));

  const lede = index?.summary ? (
    <>
      {index.summary}
      <Source who={index.writtenBy} />
    </>
  ) : isClaim(c.one_liner) ? (
    <>
      {c.one_liner.text}
      <Source who={c.one_liner.source} date={c.one_liner.date} cite={c.one_liner.ref} />
    </>
  ) : (
    textOf(c.one_liner) || undefined
  );

  return (
    <article className="project-page">
      <PageHeader
        kicker={[textOf(c.kind), textOf(c.stage)].filter(Boolean).map(label).join(" · ") || undefined}
        title={c.name}
        lede={lede}
        meta={[
          ...repos.map((r) => <span key={r.path} className="num">{r.path.split("/").pop()}</span>),
          activity.last && (
            <span key="last" className={activity.idle !== null && activity.idle > 28 ? "warn" : ""}>
              last commit {ago(activity.idle)}
            </span>
          ),
          activity.total > 0 && <span key="4w"><span className="num">{activity.total}</span> commits, 4 weeks</span>,
          !!p?.uncommitted && <span key="u" className="warn">{p.uncommitted} uncommitted files</span>,
          !!p?.branches && <span key="b" className="warn">{p.branches} branches</span>,
        ]}
      />

      <ProjectCard card={card} snapshot={snapshot} />
      {open.length > 0 && (
        <p className="fronts-line">
          <span>Open fronts</span>
          <span>
            {open.map((f) => (
              <Link key={f.page} href={wikiHref(slug, f.page)}>
                <i className={`dot state-dot-${f.status || "open"}`} aria-hidden />
                {f.title}
              </Link>
            ))}
          </span>
        </p>
      )}

      <Split
        rail={
          <>
            {waiting.length > 0 && (
              <Section title="Waiting on you" note={waiting.length}>
                <Rows>
                  {waiting.map((w) => (
                    <Row
                      key={w.thread.path}
                      href={threadHref(w.thread)}
                      title={w.card?.ask || w.title}
                      meta={[w.from.toUpperCase(), w.waitingDays ? `${w.waitingDays}d` : "today"]}
                      tone="attention"
                    />
                  ))}
                </Rows>
              </Section>
            )}
            {ideas.length > 0 && (
              <Section title="Ideas" note={ideas.length}>
                <Rows dense>
                  {ideas.map((i) => (
                    <Row key={i.slug} href={`/ideas/${i.slug}`} title={i.title} trail={<IdeaStatusTag status={i.status} />} />
                  ))}
                </Rows>
              </Section>
            )}
            <Section title="Activity" action={<More href={`/companies/${slug}/timeline`}>Timeline</More>}>
              <FourWeekRun a={activity} compact />
            </Section>
            <Section title="Commits" note={<Source who="code" />}>
              {commits.length ? (
                <div>
                  {commits.map((x) => (
                    <div className="commit" key={`${x.repo}${x.sha}`}>
                      <span className="sha">{x.sha}</span>
                      <span className="commit-subject">{x.subject}</span>
                      <span className="commit-date">
                        {dateLabel(x.date)}
                        {repos.length > 1 ? ` · ${x.repo}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>No commits</Empty>
              )}
            </Section>
            <ReleaseSection slug={slug} release={releaseOf(c)} pulse={p} pending={checkin} />
          </>
        }
      >
        <Section title="Your words">
          {said.length ? (
            said.map((s) => (
              <Said key={s.thread.path + s.date + s.text.slice(0, 20)} text={s.text} date={s.date} where={s.thread.title} href={threadHref(s.thread)} />
            ))
          ) : (
            <Empty>Nothing yet</Empty>
          )}
        </Section>

        {vision.length > 0 && (
          <Section title="Vision" action={<More href={`/companies/${slug}/model`}>Model</More>}>
            {vision.map(([k, v]) => (
              <Statement key={k} label={k} value={v as Claim | string} />
            ))}
          </Section>
        )}

        {index && (
          <Section
            title="Story"
            note={<Source who={index.writtenBy} date={index.updated} />}
          >
            {index.writtenBy === "agent" ? (
              <Fold summary={`Read · ${Math.max(1, Math.round(index.content.split(/\s+/).length / 230))} min`}>
                <div className="story-prose">
                  <WikiBody page={index} />
                </div>
              </Fold>
            ) : (
              <div className="story-prose">
                <WikiBody page={index} />
              </div>
            )}
          </Section>
        )}
      </Split>
    </article>
  );
}
