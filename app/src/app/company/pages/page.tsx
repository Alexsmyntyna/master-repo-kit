import { getWiki, HOLDING, kindLabels, kinds, wikiHref } from "@/lib/wiki";
import { FrontRow, PageRow } from "@/components/wiki";
import { Empty, PageHeader, Row, Rows, Section } from "@/components/ds";
import { dateLabel } from "@/lib/model";

export const metadata = { title: "Pages · Company" };

// Every page of the parent company's wiki (holding/wiki/), by kind.
export default async function CompanyPages() {
  const pages = await getWiki(HOLDING);
  const index = pages.find((p) => p.page === "index");
  return (
    <div className="company-pages">
      <PageHeader title="Pages" meta={[`${pages.length} in holding/wiki`]} />
      {index && (
        <Section title="Story">
          <Rows>
            <Row href={wikiHref(HOLDING, "index")} title={index.title} meta={[index.updated && dateLabel(index.updated)]} />
          </Rows>
        </Section>
      )}
      {kinds
        .filter((k) => k !== "story")
        .map((k) => {
          const list = pages.filter((p) => p.kind === k && p.page !== "index");
          if (!list.length) return null;
          return (
            <Section key={k} title={kindLabels[k]} note={list.length}>
              <Rows>{list.map((p) => (k === "front" ? <FrontRow key={p.page} page={p} /> : <PageRow key={p.page} page={p} />))}</Rows>
            </Section>
          );
        })}
      {!pages.length && <Empty>No pages yet</Empty>}
    </div>
  );
}
