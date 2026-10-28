import { Empty, PageHeader, Row, Rows } from "@/components/ds";
import { getStandards } from "@/lib/repository";
import { dateLabel } from "@/lib/model";

export const metadata = { title: "Standards" };

// How the owner wants projects built (standards/*.md): design, structure, deployment, stack, testing, agent files.
// Agents read these before working in a project repo; each rule is a dated, sourced line.
export default async function Standards() {
  const standards = await getStandards();
  return (
    <>
      <PageHeader title="Standards" meta={[`${standards.length} ${standards.length === 1 ? "standard" : "standards"}`]} />
      {standards.length ? (
        <Rows>
          {standards.map((s) => {
            const name = s.path.split("/").pop()!.replace(/\.md$/, "");
            const rules = s.content.split("\n").filter((l) => /^\s*[-*] /.test(l)).length;
            return (
              <Row
                key={s.path}
                href={`/standards/${name}?file=${encodeURIComponent(s.path)}`}
                title={s.title}
                detail={s.path}
                meta={[rules > 0 && `${rules} rules`, s.meta.updated ? `updated ${dateLabel(s.meta.updated)}` : null]}
                trail={<span className="code-text">{name}.md</span>}
              />
            );
          })}
        </Rows>
      ) : (
        <Empty>No standards written yet</Empty>
      )}
      <p className="path-note">standards/ → local/standards/ → companies/&lt;slug&gt;/standards.md</p>
    </>
  );
}
