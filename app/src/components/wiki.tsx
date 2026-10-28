import { Markdown } from "./markdown";
import { PageHeader, Row, Source, State, type Tone } from "./ds";
import { splitBlocks, wikiHref, type WikiPage } from "@/lib/wiki";
import { views } from "@/views/registry";
import { dateLabel, label } from "@/lib/model";

export function WikiBody({ page }: { page: WikiPage }) {
  const content = page.content.replace(/^#\s+.+\n*/, "");
  return (
    <div className="wiki-body">
      {splitBlocks(content).map((block, i) => {
        if (block.type === "markdown")
          return <Markdown key={i} content={block.content} path={page.path} />;
        const view = views[block.name];
        return view ? (
          <div className="view-slot" key={i}>
            {view.render({ slug: page.slug, options: block.options })}
          </div>
        ) : (
          <p className="view-empty" key={i}>
            Unknown view <code>{block.name}</code>
          </p>
        );
      })}
    </div>
  );
}

const frontTones: Record<string, Tone> = { open: "accent", working: "ok", settled: "idle", parked: "idle" };
export function FrontState({ status }: { status: string }) {
  const s = status || "open";
  return <State tone={frontTones[s]}>{label(s)}</State>;
}

export const raisedLabel = (by: string) => (["owner", "alex"].includes(by) ? "raised by you" : by ? `raised by ${by === "agent" ? "agent" : by}` : "");

// A front as one row: its title, the concern in a sentence, its state.
export function FrontRow({ page }: { page: WikiPage }) {
  return (
    <Row
      href={wikiHref(page.slug, page.page)}
      title={page.title}
      detail={page.summary}
      meta={[<FrontState key="s" status={page.status} />, raisedLabel(page.raisedBy), page.updated && `updated ${dateLabel(page.updated)}`]}
    />
  );
}

// One wiki page as a page of its own: a project's (/companies/<slug>/wiki/…) or the parent company's (/company/…).
export function WikiArticle({ page, kicker }: { page: WikiPage; kicker: React.ReactNode }) {
  return (
    <article className={`wiki-page kind-${page.kind}`}>
      <PageHeader
        kicker={kicker}
        title={page.title}
        lede={page.summary || undefined}
        meta={[
          page.kind === "front" && <FrontState key="s" status={page.status} />,
          raisedLabel(page.raisedBy),
          <Source key="w" who={page.writtenBy} date={page.updated || page.date} cite={page.path} />,
          page.date && page.updated && page.updated !== page.date && `written ${dateLabel(page.date)}`,
        ]}
      />
      <div className="wiki-page-body">
        <WikiBody page={page} />
      </div>
      <p className="path-note">{page.path}</p>
    </article>
  );
}

export function PageRow({ page }: { page: WikiPage }) {
  return (
    <Row
      href={wikiHref(page.slug, page.page)}
      title={page.title}
      meta={[label(page.kind), page.updated && dateLabel(page.updated)]}
    />
  );
}
