import { getAllScreens, imageHref } from "@/lib/screens";
import { ProjectMark } from "@/components/ui";
import { PageHeader, Row, Rows, Section } from "@/components/ds";
import { dateLabel } from "@/lib/model";
import "@/styles/more.css";

export const metadata = { title: "Screens" };

export default async function Screens() {
  const all = await getAllScreens();
  const mapped = all.filter((a) => a.screens);
  const unmapped = all.filter((a) => !a.screens);
  return (
    <>
      <PageHeader title="Screens" meta={[`${mapped.length} mapped`, `${unmapped.length} not mapped`]} />
      <Section title="Mapped" note={mapped.length}>
        <Rows>
          {mapped.map(({ company, screens }) => {
            const surfaces = screens!.features.flatMap((f) => f.surfaces);
            const shots = Object.values(screens!.latest).sort((a, b) => b.updated.localeCompare(a.updated));
            const captured = surfaces.filter((s) => screens!.latest[s.id]).length;
            const open = screens!.notes.filter((n) => n.status === "open").length;
            const share = captured / Math.max(1, surfaces.length);
            return (
              <Row
                key={company.id}
                href={`/companies/${company.id}/screens`}
                lead={<ProjectMark company={company} />}
                title={company.name}
                detail={
                  <span className="scr-cover">
                    <span className="scr-bar" aria-hidden>
                      <i style={{ width: `${share * 100}%` }} />
                    </span>
                    <span className="mono">
                      {captured}/{surfaces.length}
                    </span>{" "}
                    captured
                  </span>
                }
                meta={[
                  open ? `${open} open note${open === 1 ? "" : "s"}` : "no open notes",
                  shots[0] && `last capture ${dateLabel(shots[0].updated.slice(0, 10))}`,
                ]}
                trail={
                  <span className="scr-strip">
                    {shots.slice(0, 5).map((s) => {
                      const f = s.frames.top || Object.values(s.frames)[0];
                      // eslint-disable-next-line @next/next/no-img-element
                      return <img key={s.surface} src={imageHref(company.id, f.image)} alt={s.surface} loading="lazy" />;
                    })}
                  </span>
                }
              />
            );
          })}
        </Rows>
      </Section>
      {unmapped.length > 0 && (
        <Section title="Not mapped" note={unmapped.length}>
          <Rows dense>
            {unmapped.map(({ company }) => (
              <Row
                key={company.id}
                href={`/companies/${company.id}/screens`}
                lead={<ProjectMark company={company} />}
                title={company.name}
              />
            ))}
          </Rows>
        </Section>
      )}
    </>
  );
}
