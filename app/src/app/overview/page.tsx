import Link from "next/link";
import { getCompanies, getDocument, getQueue } from "@/lib/repository";
import { getWiki } from "@/lib/wiki";
import { dateLabel, textOf } from "@/lib/model";
import { ProjectMark } from "@/components/ui";
import { FourWeekRun } from "@/components/activity";
import { getActivity, getCommits, reposOf, type Activity } from "@/lib/activity";
import { getCodebases } from "@/lib/codebases";
import { releaseOf, verdictLabels } from "@/lib/pulse";
import { getPending } from "@/lib/decisions";
import { threadHref } from "@/lib/threads";
import { ensureRetryWaiter } from "@/lib/spawn";
import { Empty, Meta, More, PageHeader, Row, Rows, Section, Source, Split, State, Stats, type Tone } from "@/components/ds";

const groups: { key: string; title: string; note: string; test: (a: Activity) => boolean }[] = [
  { key: "live", title: "Active", note: "last 4 weeks", test: (a) => a.freshness === "moving" || a.freshness === "cooling" },
  { key: "stale", title: "Quiet", note: "4–13 weeks", test: (a) => a.freshness === "stale" },
  { key: "old", title: "Dormant", note: "3+ months", test: (a) => a.freshness === "old" || a.freshness === "none" },
];
const verdictTones: Record<string, Tone> = { push: "ok", maintain: "accent", park: "idle", retire: "risk" };
export const metadata = { title: "Overview" };
const today = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

// Every project by how much it moved, read live from git; what's waiting on the owner above it.
export default async function Overview() {
  const [companies, direction, queue, pending, codebases] = await Promise.all([
    getCompanies(),
    getDocument("holding/direction.md"),
    getQueue(),
    getPending(),
    getCodebases(),
    ensureRetryWaiter(), // a slept Mac's queue of runs waiting out the usage limit drains again
  ]);
  const projects = await Promise.all(
    companies.map(async (c) => {
      const repos = reposOf(c.repos);
      const [wiki, activity, [latest]] = await Promise.all([getWiki(c.id), getActivity(repos), getCommits(repos, 1)]);
      return {
        c,
        latest,
        about: wiki.find((p) => p.page === "index")?.summary || textOf(c.one_liner),
        fronts: wiki.filter((p) => p.kind === "front" && ["open", "working", ""].includes(p.status)).length,
        activity,
        waiting: pending.filter((p) => p.thread.scope === c.id).length,
      };
    }),
  );
  projects.sort((a, b) => b.activity.total - a.activity.total || b.activity.last.localeCompare(a.activity.last));
  const commits = projects.reduce((n, p) => n + p.activity.total, 0);
  const thisWeek = projects.filter((p) => p.activity.freshness === "moving").length;
  const own = codebases.codebases.filter((c) => c.kind !== "clone" && !c.project);
  const lift = own.filter((c) => c.note?.verdict === "revive" || c.note?.verdict === "parts");
  const open = queue.filter((q) => ["open", "in_progress"].includes(String(q.meta.status)));
  const question = direction.content.split("## Current open issue")[1]?.trim();

  return (
    <div className="overview">
      <PageHeader
        kicker={today()}
        title="Overview"
      />
      <Stats
        items={[
          { value: commits.toLocaleString("en-US"), label: "commits, 4 weeks" },
          { value: `${thisWeek}/${projects.length}`, label: "active this week" },
          { value: pending.length, label: "waiting on you", href: "/decisions", tone: pending.length ? "attention" : undefined },
        ]}
      />
      <Split
        rail={
          <>
            {question && (
              <Section title="Direction" note={<Source who="agent" />} action={<More href="/documents/holding/direction.md">Direction</More>}>
                <p className="rail-text">{question}</p>
              </Section>
            )}
            <Section title="Queue" note={open.length || undefined} action={<More href="/queue">All</More>}>
              {open.length ? (
                <Rows dense>
                  {open.slice(0, 5).map((q) => (
                    <Row key={q.path} href={`/documents/${q.path}`} title={q.title} />
                  ))}
                </Rows>
              ) : (
                <Empty>Nothing saved</Empty>
              )}
            </Section>
            {lift.length > 0 && (
              <Section title="Codebases" note={lift.length} action={<More href="/codebases">All {codebases.codebases.length}</More>}>
                <Rows dense>
                  {lift.slice(0, 6).map((cb) => (
                    <Row key={cb.slug} href={`/codebases#${cb.slug}`} title={cb.name} meta={[cb.note?.verdict === "revive" ? "revive" : "parts"]} />
                  ))}
                </Rows>
              </Section>
            )}
          </>
        }
      >
        {pending.length > 0 && (
          <Section title="Waiting on you" note={pending.length} action={<More href="/decisions">Decide</More>}>
            <Rows>
              {pending.slice(0, 4).map((p) => {
                const pick = p.card?.options.find((o) => o.recommended);
                return (
                  <Row
                    key={p.thread.path}
                    href={threadHref(p.thread)}
                    tone="attention"
                    lead={<State tone="attention">{p.from.toUpperCase()}</State>}
                    title={p.card?.ask || p.title}
                    meta={[p.project, pick && `recommends ${pick.key}: ${pick.label}`, p.waitingDays ? `${p.waitingDays}d waiting` : "today"]}
                  />
                );
              })}
            </Rows>
          </Section>
        )}

        {groups.map((g) => {
          const rows = projects.filter((p) => g.test(p.activity));
          if (!rows.length) return null;
          return (
            <Section key={g.key} title={g.title} note={`${rows.length} · ${g.note}`}>
              <div className={`ptable ptable-${g.key}`}>
                {rows.map(({ c, latest, about, fronts, activity, waiting }) => {
                  const release = releaseOf(c);
                  const moving = g.key === "live";
                  return (
                    <Link href={`/companies/${c.id}`} key={c.id} className="ptable-row">
                      <span className="ptable-name">
                        <span className="ptable-title">
                          <ProjectMark company={c} />
                          {c.name}
                        </span>
                        {moving && latest ? (
                          <span className="ptable-detail">
                            <span className="sha">{latest.sha}</span> {latest.subject}
                          </span>
                        ) : (
                          about && <span className="ptable-detail">{about}</span>
                        )}
                      </span>
                      <FourWeekRun a={activity} compact />
                      <span className="ptable-release">
                        {release?.verdict ? (
                          <State tone={verdictTones[release.verdict]}>{verdictLabels[release.verdict]}</State>
                        ) : (
                          <span className="faint">not checked</span>
                        )}
                      </span>
                      <Meta
                        items={[
                          waiting > 0 && <span key="w" className="warn">{waiting} waiting</span>,
                          fronts > 0 && `${fronts} front${fronts > 1 ? "s" : ""}`,
                          moving && activity.last && `last ${dateLabel(activity.last).replace(/, \d{4}$/, "")}`,
                        ]}
                      />
                    </Link>
                  );
                })}
              </div>
            </Section>
          );
        })}
      </Split>
    </div>
  );
}
