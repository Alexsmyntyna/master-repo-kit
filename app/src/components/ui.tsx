import { FileText } from "lucide-react";
import { PageHeader, Row, State, type Tone } from "./ds";
import {
  initials,
  label,
  textOf,
  type Company,
  type Document,
} from "@/lib/model";
export function ProjectMark({
  company,
  large = false,
}: {
  company: Pick<Company, "id" | "name">;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`project-mark ${large ? "large" : ""}`}
      style={{ background: `hsl(${[...company.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0)} 60% 70%)` }}
    >
      {initials(company.name)}
    </span>
  );
}
// Older pages' header; renders the shared PageHeader.
export function PageHeading({
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return <PageHeader title={title} lede={description} actions={children} />;
}
// A document in a list: one hairline row with its title and path.
export function DocLink({ doc, description }: { doc: Document; description?: string }) {
  return (
    <Row
      href={`/documents/${doc.path}`}
      lead={<FileText size={15} style={{ color: "var(--faint)", marginTop: 3 }} aria-hidden />}
      title={doc.title}
      detail={description || <span className="code-text">{doc.path}</span>}
    />
  );
}

const stageTone: Record<string, Tone> = {
  launched: "ok",
  building: "ok",
  open: "ok",
  ready: "ok",
  in_progress: "accent",
  idea: "agent",
  paused: "idle",
  dormant: "idle",
  retired: "idle",
};
// A stage or status as a dot and a word.
export function Status({ value }: { value: unknown }) {
  const text = textOf(value);
  return <State tone={stageTone[text] || "idle"}>{text ? label(text) : "No stage"}</State>;
}
