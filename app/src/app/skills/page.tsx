import { PageHeader, Row, Rows, Section, Tag } from "@/components/ds";
import { getSkills } from "@/lib/repository";
import { label } from "@/lib/model";
import "@/styles/more.css";

export const metadata = { title: "Skills" };

// What the agents know how to do. the owner never copies these; agents load them from skills/INDEX.md.
export default async function Skills() {
  const skills = await getSkills();
  const groups = [
    { kind: "session", title: "Sessions" },
    { kind: "task", title: "Tasks" },
    { kind: "project", title: "In a project repo" },
  ];
  return (
    <>
      <PageHeader title="Skills" meta={groups.map((g) => `${skills.filter((s) => (s.meta.kind || "session") === g.kind).length} ${g.title.toLowerCase()}`)} />
      {groups.map((g) => {
        const list = skills.filter((s) => (s.meta.kind || "session") === g.kind);
        return (
          <Section key={g.kind} title={g.title} note={list.length}>
            <Rows>
              {list.map((s) => (
                <Row
                  key={s.path}
                  href={`/documents/${s.path}`}
                  title={
                    <span className="skill-title">
                      {s.title}
                      {s.meta.status !== "ready" && <Tag>{label(String(s.meta.status))}</Tag>}
                    </span>
                  }
                  detail={String(s.meta.when || "")}
                  trail={<span className="code-text">{s.path.split("/").pop()}</span>}
                />
              ))}
            </Rows>
          </Section>
        );
      })}
      <p className="path-note">skills/&lt;name&gt;.md · python3 tools/skills.py sync</p>
    </>
  );
}
