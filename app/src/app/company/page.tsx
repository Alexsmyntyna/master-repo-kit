import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { documentsIn } from "@/lib/files";
import { getCompanies, repoRoot } from "@/lib/repository";
import { getPortfolio, releaseOf, verdictLabels } from "@/lib/pulse";
import { getThreads, threadHref } from "@/lib/threads";
import { dateLabel } from "@/lib/model";
import { getWiki, HOLDING, sectionOf } from "@/lib/wiki";
import { getCompanyInfo, getSetup, nextSteps, setupCounts, waitingOn } from "@/lib/company";
import { Markdown } from "@/components/markdown";
import { ProjectMark } from "@/components/ui";
import { FourWeekRun } from "@/components/activity";
import { FrontRow } from "@/components/wiki";
import { getActivity, reposOf } from "@/lib/activity";
import { Empty, Meta, More, PageHeader, Row, Rows, Section, Source, Split, State, type Tone } from "@/components/ds";
import "@/styles/company.css";

export async function generateMetadata() {
  return { title: (await getCompanyInfo()).name || "Company" };
}

const verdictTones: Record<string, Tone> = { push: "ok", maintain: "accent", park: "idle", retire: "risk" };
const groups = [
  ["maintain", "Maintain"],
  ["park", "Parked"],
  ["retire", "Retire"],
  ["", "Not checked"],
] as const;
const frontOrder = ["open", "working", "parked", "settled"];

// The parent company's home: the owner's words, the setup (checklist and fronts), why it exists, and what it holds.
export default async function CompanyHome() {
  const [info, pages, setup, companies, portfolio, threads, ideas] = await Promise.all([
    getCompanyInfo(),
    getWiki(HOLDING),
    getSetup(),
    getCompanies(),
    getPortfolio(),
    getThreads(),
    documentsIn(repoRoot, "discovery/ideas"),
  ]);
  const index = pages.find((p) => p.page === "index");
  const fronts = pages
    .filter((p) => p.kind === "front")
    .sort((a, b) => frontOrder.indexOf(a.status || "open") - frontOrder.indexOf(b.status || "open"));
  const openFronts = fronts.filter((f) => ["open", "working", ""].includes(f.status));
  const counts = setupCounts(setup);
  const next = nextSteps(setup, 3);
  const words = index ? sectionOf(index.content, "In your words") : "";
  const why = index ? sectionOf(index.content, "Why a company") : "";

  const byId = Object.fromEntries(companies.map((c) => [c.id, c]));
  const focus = portfolio.focus.map((id) => byId[id]).filter(Boolean);
  const activity = Object.fromEntries(
    await Promise.all(focus.map(async (c) => [c.id, await getActivity(reposOf(c.repos))] as const)),
  );
  const rest = companies.filter((c) => !portfolio.focus.includes(c.id));
  const openThreads = (id: string) => threads.filter((t) => t.scope === id && t.status !== "closed" && t.status !== "decided");

  return (
    <div className="vision-page company-page">
      <PageHeader
        title={info.name || "Parent company"}
        lede={
          index?.summary ? (
            <>
              {index.summary}
              <Source who={index.writtenBy} />
            </>
          ) : undefined
        }
        meta={[
          index?.updated && `updated ${dateLabel(index.updated)}`,
          `${openFronts.length} front${openFronts.length === 1 ? "" : "s"} open`,
          counts.total > 0 && (
            <span key="s">
              <span className="num">{counts.done}</span> of <span className="num">{counts.total}</span> steps done
            </span>
          ),
        ]}
        actions={
          <Link className="button secondary" href="/threads/new?scope=holding">
            <MessageSquarePlus size={15} /> Ask the CEO
          </Link>
        }
      />
      <Split
        rail={
          <>
            <Section title="Pages">
              <Rows dense>
                <Row href="/company/vision" title="Vision" meta={["holding/vision.md"]} />
                <Row href="/documents/holding/company-identity.md" title="Identity brief" meta={["holding/company-identity.md"]} />
                <Row href="/documents/holding/direction.md" title="Direction" meta={["holding/direction.md"]} />
              </Rows>
            </Section>
            <Section title="Ideas" note={ideas.length} action={<More href="/threads/new?scope=holding">New</More>}>
              {ideas.length ? (
                <Rows dense>
                  {ideas
                    .sort((a, b) => String(b.meta.date || "").localeCompare(String(a.meta.date || "")))
                    .map((d) => (
                      <Row
                        key={d.path}
                        href={`/documents/${d.path}`}
                        title={d.title}
                        meta={[String(d.meta.status || "open"), d.meta.date ? dateLabel(d.meta.date) : "undated", d.meta.raised_by === "agent" && "agent"]}
                      />
                    ))}
                </Rows>
              ) : (
                <Empty>No ideas</Empty>
              )}
            </Section>
            <Section title="Connections" note={<Source who="agent" />}>
              {portfolio.relationships.length ? (
                <Rows dense>
                  {portfolio.relationships.map((r, i) => (
                    <Row
                      key={i}
                      title={`${byId[String(r.from)]?.name || String(r.from)} → ${byId[String(r.to)]?.name || String(r.to)}`}
                      detail={String(r.text || "")}
                      meta={[String(r.kind || "").replaceAll("-", " ")]}
                    />
                  ))}
                </Rows>
              ) : (
                <Empty>No connections</Empty>
              )}
            </Section>
          </>
        }
      >
        <Section title="In your words">
          {words ? (
            <div className="story-prose company-words">
              <Markdown content={words} path="holding/wiki/index.md" />
            </div>
          ) : (
            <Empty>Nothing yet</Empty>
          )}
        </Section>

        <Section
          title="Setting it up"
          note={counts.total > 0 && `${counts.done} of ${counts.total} done`}
          action={<More href="/company/setup">Checklist</More>}
        >
          {next.length > 0 && (
            <>
              <h3 className="group-title">Next steps</h3>
              <Rows dense>
                {next.map((s) => {
                  const waits = waitingOn(setup, s);
                  return (
                    <Row
                      key={s.id}
                      href={`/company/setup#step-${s.id}`}
                      title={s.text}
                      meta={[s.group, ["owner", "alex"].includes(s.who) ? "you" : "an agent can do this", waits.length > 0 && `after ${waits.map((w) => w.text).join(", ")}`]}
                      tone={["owner", "alex"].includes(s.who) && !waits.length ? "attention" : undefined}
                    />
                  );
                })}
              </Rows>
            </>
          )}
          <h3 className="group-title">Fronts</h3>
          {fronts.length ? (
            <Rows>
              {fronts.map((f) => (
                <FrontRow key={f.page} page={f} />
              ))}
            </Rows>
          ) : (
            <Empty>No fronts</Empty>
          )}
        </Section>

        <Section title="Why a company" note={index && <Source who={index.writtenBy} date={index.updated} cite={index.path} />}>
          {why ? (
            <div className="story-prose">
              <Markdown content={why} path="holding/wiki/index.md" />
            </div>
          ) : (
            <Empty>Not written yet</Empty>
          )}
        </Section>

        <Section title="What it holds">
          <h3 className="group-title">
            Focus <span>{focus.length}</span>
          </h3>
          <div className="ptable">
            {focus.map((c) => {
              const release = releaseOf(c);
              const open = openThreads(c.id);
              return (
                <div key={c.id} className="ptable-row vision-row">
                  <span className="ptable-name">
                    <Link href={`/companies/${c.id}`} className="ptable-title">
                      <ProjectMark company={c} />
                      {c.name}
                    </Link>
                    <span className="ptable-detail is-wrap">{release?.next_step || "No goal yet"}</span>
                  </span>
                  <FourWeekRun a={activity[c.id]} compact />
                  <span className="ptable-release">
                    {release?.verdict ? <State tone={verdictTones[release.verdict]}>{verdictLabels[release.verdict]}</State> : <span className="faint">not checked</span>}
                  </span>
                  <Meta
                    items={[
                      open.length > 0 && (
                        <Link key="t" href={threadHref(open[0])} className="warn">
                          {open.length} open thread{open.length > 1 ? "s" : ""}
                        </Link>
                      ),
                      <Link key="c" href={`/threads/new?scope=${c.id}`}>ask the COO</Link>,
                    ]}
                  />
                </div>
              );
            })}
          </div>
          <div className="vision-groups company-others">
            {groups.map(([key, title]) => {
              const list = rest.filter((c) => (releaseOf(c)?.verdict || "") === key || (key === "maintain" && releaseOf(c)?.verdict === "push"));
              if (!list.length) return null;
              return (
                <div key={title}>
                  <h3 className="group-title">
                    {title} <span>{list.length}</span>
                  </h3>
                  <Rows dense>
                    {list.map((c) => (
                      <Row key={c.id} href={`/companies/${c.id}`} lead={<ProjectMark company={c} />} title={c.name} detail={releaseOf(c)?.next_step} />
                    ))}
                  </Rows>
                </div>
              );
            })}
          </div>
        </Section>
      </Split>
    </div>
  );
}
