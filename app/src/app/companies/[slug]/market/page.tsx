import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getCompany } from "@/lib/repository";
import { getMarket, shotHref, type Competitor, type Review } from "@/lib/market";
import { getThreads, threadHref } from "@/lib/threads";
import { dateLabel } from "@/lib/model";
import { Markdown } from "@/components/markdown";
import { MarketCheckButton } from "@/components/market-check";
import { Bar, DataTable, Empty, Fold, PageHeader, Section, Source, State, Stats, type Tone } from "@/components/ds";
import "@/styles/project-pages.css";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompany((await params).slug);
  return { title: c ? `${c.name} market` : "Market" };
}

const web = (u?: string) => (u && /^https?:\/\//.test(u) ? u : undefined);
const threatTone: Record<string, Tone | undefined> = { high: "risk", medium: undefined, low: "idle" };
const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const daysSince = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? Math.round((Date.now() - Date.parse(d)) / 86400000) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const low = (r?: Review[]) => (r || []).filter((x) => x.rating <= 3);

// One row per competitor: the App Store's figures, side by side.
function CompetitorTable({ competitors, reviews }: { competitors: Competitor[]; reviews: Record<string, Review[]> }) {
  // Rating counts run from a handful to hundreds of thousands, so their bars are on a log scale.
  const maxLog = Math.log10(Math.max(10, ...competitors.map((c) => c.appstore?.ratings || 0)));
  const none = <span className="faint">–</span>;
  return (
    <DataTable>
      <thead>
        <tr>
          <th>App</th>
          <th>Threat</th>
          <th>Price</th>
          <th className="num">Rating</th>
          <th className="num">Ratings</th>
          <th className="num">Low reviews</th>
          <th className="num">Updated</th>
        </tr>
      </thead>
      <tbody>
        {competitors.map((c) => {
          const a = c.appstore;
          const r = reviews[c.id];
          const bad = low(r);
          const age = daysSince(a?.last_update);
          return (
            <tr key={c.id}>
              <td>
                <a href={`#${c.id}`} className="dtable-name">
                  {c.name}
                </a>
                <span className="dtable-sub">{a?.seller || c.kind}</span>
              </td>
              <td>{c.threat ? <State tone={threatTone[c.threat]}>{c.threat}</State> : none}</td>
              <td>{a?.price || none}</td>
              <td className="num">{a?.rating ? <Bar part={a.rating / 5}>{a.rating.toFixed(2)}</Bar> : none}</td>
              <td className="num">
                {a?.ratings ? (
                  <Bar part={Math.log10(Math.max(1, a.ratings)) / maxLog} title={a.ratings.toLocaleString("en-US")}>
                    {compact(a.ratings)}
                  </Bar>
                ) : (
                  none
                )}
              </td>
              <td className="num">
                {r?.length ? (
                  <Bar part={bad.length / r.length} tone="risk" title="Recent reviews at 3★ or less">
                    {bad.length}
                    <span className="faint"> / {r.length}</span>
                  </Bar>
                ) : (
                  <span className="faint">not read</span>
                )}
              </td>
              <td className={`num ${age !== null && age > 180 ? "faint" : ""}`}>{a?.last_update ? dateLabel(a.last_update) : none}</td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

// The detail for one competitor: what the market check made of it (agent), its screenshots, and its worst reviews.
function CompetitorDetail({ c, reviews, checked }: { c: Competitor; reviews?: Review[]; checked: string | null }) {
  const shots = [...(c.appstore?.shots || []), ...(c.web?.pages || [])];
  const bad = low(reviews);
  const sources = c.sources.filter((s) => web(s.url));
  return (
    <section className="mdetail" id={c.id}>
      <header className="mdetail-head">
        <h3>
          {web(c.url) ? (
            <a href={web(c.url)} target="_blank" rel="noreferrer">
              {c.name} <ArrowUpRight size={14} aria-hidden />
            </a>
          ) : (
            c.name
          )}
        </h3>
        {c.threat && <State tone={threatTone[c.threat]}>{c.threat} threat</State>}
        <Source who="agent" date={checked || undefined} />
      </header>
      {(c.positioning || c.who) && (
        <p className="mdetail-pos">
          {c.positioning}
          {c.who && <span> For {c.who.replace(/^for\s+/i, "")}</span>}
        </p>
      )}
      {(c.strengths.length > 0 || c.complaints.length > 0) && (
        <div className="mdetail-cols">
          {c.strengths.length > 0 && (
            <div>
              <p className="pp-sub">Strengths</p>
              <ul>{c.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {c.complaints.length > 0 && (
            <div>
              <p className="pp-sub">Complaints</p>
              <ul className="is-risk">{c.complaints.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {shots.length > 0 && (
        <div className="mshots">
          {shots.map((s) => (
            <a key={s.path} href={shotHref(s.path)} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shotHref(s.path)} alt={`${c.name} screenshot`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {bad.length > 0 && (
        <Fold summary={`Low reviews · ${bad.length} of ${reviews!.length}`}>
          <div className="mreviews">
            {bad.slice(0, 12).map((r, i) => (
              <blockquote key={i}>
                <span className="mreview-meta">
                  <span className="mreview-stars">{"★".repeat(r.rating)}</span>
                  {r.date && <span>{dateLabel(r.date)}</span>}
                  {r.version && <span className="mono">v{r.version}</span>}
                  <Source who="public" />
                </span>
                <span>
                  {r.title && <strong>{r.title}</strong>} {r.text}
                </span>
              </blockquote>
            ))}
          </div>
        </Fold>
      )}
      {(c.notes || sources.length > 0) && (
        <p className="mdetail-notes">
          {c.notes}{" "}
          {sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer">
              [{i + 1}]
            </a>
          ))}
        </p>
      )}
    </section>
  );
}

export default async function ProjectMarket({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (!company) notFound();
  const [market, threads] = await Promise.all([getMarket(slug), getThreads()]);
  const check = threads.find((t) => t.scope === slug && t.title.startsWith("Market check") && t.status !== "closed");
  const competitors = market?.competitors || [];
  const ratings = competitors.map((c) => c.appstore?.rating).filter((x): x is number => !!x);
  const allReviews = Object.values(market?.reviews || {}).flat();
  const med = median(ratings);
  const high = competitors.filter((c) => c.threat === "high").length;
  const reach = competitors.reduce((n, c) => n + (c.appstore?.ratings || 0), 0);

  return (
    <article className="pp">
      <PageHeader
        title="Market"
        meta={[
          market?.updated && `updated ${dateLabel(market.updated)}`,
          check && (
            <Link key="c" href={threadHref(check)} className="pp-link">
              {check.running?.alive ? "check running…" : "latest check"}
            </Link>
          ),
        ]}
        actions={<MarketCheckButton slug={slug} label={market ? "Refresh" : "Run market check"} />}
      />

      {!market ? (
        <Empty>No market data yet</Empty>
      ) : (
        <>
          {competitors.length > 0 && (
            <Stats
              items={[
                { value: competitors.length, label: "competitors" },
                { value: high, label: "high threat" },
                ...(med !== null ? [{ value: med.toFixed(2), label: "median rating" }] : []),
                ...(reach ? [{ value: compact(reach), label: "ratings" }] : []),
                ...(allReviews.length
                  ? [{ value: `${Math.round((low(allReviews).length / allReviews.length) * 100)}%`, label: `low reviews (of ${allReviews.length})` }]
                  : []),
              ]}
            />
          )}

          {competitors.length > 0 && (
            <Section title="Competitors" note={<Source who="public" date={market.updated || undefined} cite="App Store, read by tools/market.py" />}>
              <CompetitorTable competitors={competitors} reviews={market.reviews} />
            </Section>
          )}

          {market.doc && (
            <Section title="Notes" note={<Source who="agent" date={market.updated || undefined} cite={market.doc.path} />}>
              <Fold summary={`Read · ${Math.max(1, Math.round(market.doc.content.split(/\s+/).length / 230))} min`}>
                <div className="pp-prose">
                  <Markdown content={market.doc.content.replace(/^#\s+.+\n*/, "")} path={market.doc.path} />
                </div>
              </Fold>
            </Section>
          )}

          {competitors.length > 0 && (
            <Section title="Details" note={competitors.length}>
              <div className="mdetails">
                {competitors.map((c) => (
                  <CompetitorDetail key={c.id} c={c} reviews={market.reviews[c.id]} checked={market.updated} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </article>
  );
}
