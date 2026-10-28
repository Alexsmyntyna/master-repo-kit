import Link from "next/link";
import { LoaderCircle, Plus } from "lucide-react";
import { AutoRefresh } from "@/components/run-status";
import { getCompanies } from "@/lib/repository";
import { getThreads, roleNames, statusLabels, statusOrder, threadHref, type Thread } from "@/lib/threads";
import { dateLabel } from "@/lib/model";
import { ProjectMark } from "@/components/ui";
import { Empty, PageHeader, Row, Rows, Section } from "@/components/ds";

export const metadata = { title: "Threads" };

// Every conversation, grouped by where it stands. A row leads with what the thread is deciding, since most
// titles are just "Check-in <date>". ?project=<slug> narrows it to one project's threads (the project nav links here).
export default async function Threads({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const [{ project: only }, all, companies] = await Promise.all([searchParams, getThreads(), getCompanies()]);
  const name = (scope: string) => companies.find((c) => c.id === scope)?.name || "Parent company";
  const project = companies.find((c) => c.id === only);
  const threads = project ? all.filter((t) => t.projects.includes(project.id)) : all;
  const working = threads.filter((t) => t.running?.alive);
  const row = (t: Thread) => {
    const last = t.messages.at(-1);
    const headline = t.decision || t.summary;
    return (
      <Row
        key={t.path}
        href={threadHref(t)}
        lead={t.running?.alive ? <LoaderCircle size={14} className="spin" /> : <ProjectMark company={{ id: t.scope, name: name(t.scope) }} />}
        title={headline || t.title}
        meta={[
          name(t.scope),
          headline && t.title,
          t.running?.alive
            ? `${t.running.role.toUpperCase()} working · ${t.running.model}`
            : last && `last: ${roleNames[last.from]} · ${dateLabel(last.date)}`,
          `${t.messages.length} messages`,
        ]}
        tone={["awaiting-alex", "awaiting-owner"].includes(t.status) ? "attention" : undefined}
      />
    );
  };
  return (
    <>
      <PageHeader
        kicker={project && <Link href={`/companies/${project.id}`}>{project.name}</Link>}
        title="Threads"
        meta={[
          `${threads.length} conversations`,
          working.length > 0 && `${working.length} running`,
          project && <Link href="/threads">All projects</Link>,
        ]}
        actions={
          <Link href={project ? `/threads/new?scope=${project.id}` : "/threads/new"} className="button primary">
            <Plus size={15} /> New thread
          </Link>
        }
      />
      <AutoRefresh active={working.length > 0} every={5000} />
      {!!working.length && (
        <Section title="Running" note={working.length}>
          <Rows>{working.map(row)}</Rows>
        </Section>
      )}
      {!threads.length && <Empty>No threads yet</Empty>}
      {statusOrder
        .filter((s) => threads.some((t) => t.status === s && !t.running?.alive))
        .map((s) => {
          const list = threads.filter((t) => t.status === s && !t.running?.alive);
          return (
            <Section key={s} title={statusLabels[s]} note={list.length}>
              <Rows>{list.map(row)}</Rows>
            </Section>
          );
        })}
    </>
  );
}
