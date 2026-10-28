import { DocLink } from "@/components/ui";
import { Empty, More, PageHeader, Row, Rows, Section, Split, Statement } from "@/components/ds";
import { Value } from "@/components/value";
import { getDocument, readJson } from "@/lib/repository";
import { dateLabel, isClaim, recordOf } from "@/lib/model";
import "@/styles/more.css";

export const metadata = { title: "Identity" };

export default async function Identity() {
  const [profile, narrative, patterns, technologies, lessons] = await Promise.all([
    getDocument("identity/profile.md"),
    getDocument("identity/narrative.md"),
    getDocument("identity/patterns.md"),
    readJson("identity/technologies.json"),
    readJson("identity/lessons.json"),
  ]);
  const lessonList = Array.isArray(recordOf(lessons).lessons) ? (recordOf(lessons).lessons as unknown[]) : [];
  const techs = recordOf(technologies).technologies;
  const techList = Array.isArray(techs) ? techs : [];
  return (
    <>
      <PageHeader
        title="Identity"
        meta={[
          `${lessonList.length} lessons`,
          `${techList.length} technologies`,
          !!recordOf(lessons).updated && `updated ${dateLabel(recordOf(lessons).updated)}`,
        ]}
      />
      <Split
        rail={
          <>
            <Section title="Pages">
              <Rows dense>
                {[profile, narrative, patterns].map((d) => (
                  <DocLink key={d.path} doc={d} />
                ))}
                <DocLink doc={{ path: "identity/career/README.md", title: "Career", content: "", meta: {} }} />
              </Rows>
            </Section>
            <Section title="Sessions">
              <Rows dense>
                <Row href="/documents/skills/identity.md" title="Identity" detail={<span className="code-text">skills/identity.md</span>} />
                <Row href="/documents/skills/tech-map.md" title="Tech map" detail={<span className="code-text">skills/tech-map.md</span>} />
                <Row href="/documents/skills/interview-practice.md" title="Interview practice" detail={<span className="code-text">skills/interview-practice.md</span>} />
              </Rows>
            </Section>
          </>
        }
      >
        <Section title="Lessons" note={lessonList.length || undefined}>
          {lessonList.length ? (
            <div className="lessons">
              {lessonList.map((l, i) => (isClaim(l) ? <Statement key={i} value={l} /> : <Value key={i} value={l} />))}
            </div>
          ) : (
            <Empty>No lessons yet</Empty>
          )}
        </Section>
        <Section title="Technologies" note={techList.length || undefined}>
          {techList.length ? (
            <Value value={techList} />
          ) : (
            <Empty action={<More href="/documents/skills/tech-map.md">Tech map</More>}>No tech map yet</Empty>
          )}
        </Section>
      </Split>
    </>
  );
}
