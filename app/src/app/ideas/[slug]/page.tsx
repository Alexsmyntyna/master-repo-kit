import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { PageHeader, Row, Rows, Section, Source } from "@/components/ds";
import { IdeaStatusTag, ProjectChips } from "@/components/ideas";
import { Markdown } from "@/components/markdown";
import { getIdea, getIdeaDocs, siteHref } from "@/lib/ideas";
import { getCompanies } from "@/lib/repository";
import "@/styles/ideas.css";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: (await getIdea((await params).slug))?.title || "Idea not found" };
}

// An idea's landing: what it is, a way into its full page, then the notes and the projects it touches.
export default async function IdeaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const idea = await getIdea(slug);
  if (!idea) notFound();
  const [docs, companies] = await Promise.all([getIdeaDocs(slug), getCompanies()]);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  return (
    <article className="idea-page">
      <Link href="/ideas" className="back-link">
        <ArrowLeft size={14} /> Ideas
      </Link>
      <PageHeader
        kicker={idea.name || undefined}
        title={idea.title}
        lede={idea.summary || undefined}
        meta={[<IdeaStatusTag key="s" status={idea.status} />, <Source key="w" who={idea.writtenBy} date={idea.date} />]}
      />
      {idea.site && (
        <a className="idea-cta" href={siteHref(slug, idea.site)} target="_blank" rel="noreferrer">
          <span>
            <strong>Open the full page</strong>
            <small>The write-up as its own page, in a new tab</small>
          </span>
          <ArrowUpRight size={22} />
        </a>
      )}
      {idea.content && (
        <Section title="Notes">
          <Markdown content={idea.content} path={idea.path} />
        </Section>
      )}
      {idea.links.length > 0 && (
        <Section title="Projects" note={idea.links.length}>
          <ProjectChips slugs={idea.links} names={names} />
        </Section>
      )}
      {docs.length > 0 && (
        <Section title="Documents" note={docs.length}>
          <Rows>
            {docs.map((d) => (
              <Row key={d.path} href={`/documents/${d.path}`} title={d.title} detail={d.path.replace(`ideas/${slug}/`, "")} />
            ))}
          </Rows>
        </Section>
      )}
    </article>
  );
}
