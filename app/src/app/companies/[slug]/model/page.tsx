import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany, getNotes, getReviews, readJson } from "@/lib/repository";
import { dateLabel, hasValue, listOf, recordOf, textOf, type Document } from "@/lib/model";
import { allClaims, ClaimSection, QuietClaims } from "@/components/value";
import { Empty, More, PageHeader, Row, Rows, Section, Source, Split, Tabs, type Who } from "@/components/ds";
import "@/styles/project-pages.css";

const tabs = ["strategy", "product", "history", "references"];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompany((await params).slug);
  return { title: c ? `${c.name} model` : "Not found" };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const fileDate = (d: Document) =>
  (d.meta.date instanceof Date ? d.meta.date.toISOString().slice(0, 10) : str(d.meta.date)) ||
  d.path.split("/").pop()?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ||
  "";

function DocRows({ docs }: { docs: Document[] }) {
  return (
    <Rows dense>
      {docs.map((d) => (
        <Row
          key={d.path}
          href={`/documents/${d.path}`}
          title={d.title}
          meta={[<Source key="s" who="agent" date={fileDate(d)} />, <span key="p" className="code-text">{d.path.split("/").pop()}</span>]}
        />
      ))}
    </Rows>
  );
}

// Paths and links recorded in company.json, one per row.
function PathRows({ items }: { items: unknown[] }) {
  return (
    <Rows dense>
      {items.map((x, i) => {
        const r = recordOf(x);
        const path = typeof x === "string" ? x : str(r.path) || str(r.url);
        const title = str(r.title) || str(r.name);
        const inRepo = /^(companies|holding|identity|discovery|queue)\//.test(path);
        return (
          <Row
            key={i}
            href={inRepo ? `/documents/${path}` : undefined}
            title={title || <span className="code-text">{path}</span>}
            detail={title ? <span className="code-text">{path}</span> : undefined}
            meta={[str(r.note), r.date ? dateLabel(r.date) : ""]}
          />
        );
      })}
    </Rows>
  );
}

// company.json, the structured model agents keep: each claim with its source, the owner's first.
export default async function StrategicModel({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params,
    query = await searchParams;
  const c = await getCompany(slug);
  if (!c) notFound();
  const tab = tabs.includes(query.tab || "") ? query.tab! : "strategy";
  const [reviews, notes, decisions] = await Promise.all([
    getReviews(slug),
    getNotes(slug),
    readJson(`companies/${slug}/decisions.json`).catch(() => []),
  ]);
  const product = recordOf(c.product),
    roadmap = recordOf(c.roadmap),
    thesis = recordOf(c.thesis),
    customer = recordOf(c.customer),
    market = recordOf(c.market),
    brand = recordOf(c.brand),
    reentry = recordOf(c.reentry),
    developer = recordOf(c.developer),
    links = recordOf(c.links);
  const claims = allClaims(c);
  const by = (w: Who) => claims.filter((x) => (w === "agent" ? !["owner", "alex", "code", "public"].includes(x.source || "") : w === "owner" ? ["owner", "alex"].includes(x.source || "") : x.source === w)).length;
  const counts = (["owner", "code", "public", "agent"] as Who[]).map((w) => [w, by(w)] as const).filter(([, n]) => n);
  const decided = listOf(decisions).map(recordOf);
  const counted: Record<string, number> = { history: reviews.length + notes.length + decided.length };

  return (
    <article className="pp pp-model">
      <PageHeader
        title="Model"
        meta={[
          ...counts.map(([w, n]) => (
            <span key={w} className="pp-count">
              <Source who={w} /> <span className="num">{n}</span>
            </span>
          )),
          !claims.length && "empty",
          c.updated && `updated ${dateLabel(c.updated)}`,
          <Link key="raw" href={`/documents/companies/${slug}/company.json`} className="pp-link code-text">
            company.json
          </Link>,
        ]}
      />
      <Tabs
        label="Model sections"
        items={tabs.map((t) => ({
          href: `/companies/${slug}/model?tab=${t}`,
          label: t[0].toUpperCase() + t.slice(1),
          count: counted[t],
          current: tab === t,
        }))}
      />

      {tab === "strategy" && (
        <Split
          rail={
            <>
              <QuietClaims title="Open questions" value={c.open_questions} empty="None" />
              <QuietClaims title="Assumptions" value={c.assumptions} empty="None" />
              <QuietClaims title="Risks" value={c.risks} empty="None" />
            </>
          }
        >
          {!hasValue(thesis) && !hasValue(customer) && (
            <Empty>Mostly empty</Empty>
          )}
          <ClaimSection
            title="Thesis"
            fields={[
              ["Why it exists", thesis.why_it_exists],
              ["What it should become", thesis.what_it_should_become],
              ["Ambition", c.ambition],
              ["The bet", thesis.the_bet],
            ]}
          />
          <ClaimSection
            title="Customer"
            fields={[
              ["Who", customer.who],
              ["Problem", customer.problem],
              ["Current alternatives", customer.current_alternatives],
              ["Why switch", customer.why_switch],
            ]}
          />
          <ClaimSection
            title="Market"
            fields={[
              ["Positioning", market.positioning],
              ["Competitors", market.competitors],
              ["Business model", market.business_model],
              ["Evidence of fit", market.fit_evidence],
            ]}
          />
          <ClaimSection
            title="Brand"
            fields={[
              ["Name", brand.name_notes],
              ["Promise", brand.promise],
              ["Voice", brand.voice],
              ["Visual direction", brand.visual_direction],
            ]}
          />
        </Split>
      )}

      {tab === "product" && (
        <Split
          rail={
            <>
              <QuietClaims title="Now" value={roadmap.now} empty="None" />
              <QuietClaims title="Next" value={roadmap.next} empty="None" />
              <QuietClaims title="Later" value={roadmap.later} empty="None" />
            </>
          }
        >
          <ClaimSection
            title="Product today"
            fields={[
              ["Current state", product.current_state],
              ["Verified", product.verified_at],
            ]}
          />
          <ClaimSection title="Capabilities" fields={[["Capabilities", product.capabilities]]} />
          <ClaimSection
            title="Gaps"
            fields={[
              ["Gaps", product.gaps],
              ["Rebuild", product.rebuild],
            ]}
          />
          <ClaimSection
            title="Coming back"
            fields={[
              ["Last active", reentry.last_active],
              ["Left off", reentry.left_off],
              ["In flight", reentry.in_flight],
              ["First step back", reentry.first_step_back],
            ]}
          />
          <ClaimSection
            title="Developer"
            fields={[
              ["Technologies", developer.technologies],
              ["Techniques", developer.techniques],
              ["Lessons", developer.lessons],
            ]}
          />
        </Split>
      )}

      {tab === "history" && (
        <>
          <Section title="Decisions" note={decided.length || undefined} action={<More href={`/companies/${slug}/decisions`}>All</More>}>
            {decided.length ? (
              <Rows>
                {decided.map((d, i) => {
                  const source = recordOf(d.source);
                  const alternatives = listOf(d.alternatives).map(textOf).filter(Boolean);
                  return (
                    <Row
                      key={i}
                      lead={<span className="pp-date">{dateLabel(d.date)}</span>}
                      title={textOf(d.decision)}
                      detail={
                        <span className="pp-decided">
                          {textOf(d.why) && <span>{textOf(d.why)}</span>}
                          {alternatives.length > 0 && (
                            <span className="pp-aside">
                              <b>Passed over</b> {alternatives.join(" · ")}
                            </span>
                          )}
                        </span>
                      }
                      meta={[
                        <Source key="s" who={str(source.type) || "owner"} date={source.date} cite={str(source.note)} />,
                        str(d.id),
                        str(source.ref) && <span key="r" className="code-text">{str(source.ref).split(";")[0]}</span>,
                      ]}
                    />
                  );
                })}
              </Rows>
            ) : (
              <Empty>No decisions yet</Empty>
            )}
          </Section>
          <Section title="Reviews" note={reviews.length || undefined}>
            {reviews.length ? <DocRows docs={reviews} /> : <Empty>No reviews yet</Empty>}
          </Section>
          <Section title="Notes" note={notes.length || undefined}>
            {notes.length ? <DocRows docs={notes} /> : <Empty>No notes yet</Empty>}
          </Section>
        </>
      )}

      {tab === "references" && (
        <>
          <Section title="Repositories" note={<Source who="code" />}>
            {listOf(c.repos).length ? (
              <Rows dense>
                {listOf(c.repos).map((x, i) => {
                  const r = recordOf(x);
                  const seen = recordOf(r.last_inspected);
                  return (
                    <Row
                      key={i}
                      title={<span className="code-text">{str(r.path)}{str(r.subdir) && `/${str(r.subdir)}`}</span>}
                      meta={[
                        str(r.role),
                        seen.date ? `inspected ${dateLabel(seen.date)}` : "not inspected",
                        str(seen.commit) && <span key="c" className="sha">{str(seen.commit).slice(0, 7)}</span>,
                      ]}
                    />
                  );
                })}
              </Rows>
            ) : (
              <Empty>No repository</Empty>
            )}
          </Section>
          {listOf(c.lineage).length > 0 && (
            <Section title="Lineage">
              <PathRows items={listOf(c.lineage)} />
            </Section>
          )}
          {(["public", "mockups", "docs"] as const).map((k) =>
            listOf(links[k]).length ? (
              <Section key={k} title={{ public: "Public links", mockups: "Mockups", docs: "Documents" }[k]}>
                <PathRows items={listOf(links[k])} />
              </Section>
            ) : null,
          )}
          {listOf(c.legacy_notes).length > 0 && (
            <Section title="Legacy notes" note={listOf(c.legacy_notes).length}>
              <PathRows items={listOf(c.legacy_notes)} />
            </Section>
          )}
        </>
      )}
    </article>
  );
}
