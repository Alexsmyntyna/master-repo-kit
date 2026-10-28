import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Tag, type Tone } from "./ds";
import { ideaStatusLabels, siteHref, type Idea, type IdeaStatus } from "@/lib/ideas";
import { dateLabel } from "@/lib/model";

const statusTone: Record<IdeaStatus, Tone> = { exploring: "accent", building: "ok", parked: "idle", dropped: "risk" };

export const IdeaStatusTag = ({ status }: { status: IdeaStatus }) => (
  <Tag tone={statusTone[status]}>{ideaStatusLabels[status]}</Tag>
);

// Projects an idea touches, as chips that open the project. Slugs without a project show as plain text.
export function ProjectChips({ slugs, names }: { slugs: string[]; names: Record<string, string> }) {
  if (!slugs.length) return null;
  return (
    <ul className="idea-chips" aria-label="Projects">
      {slugs.map((s) => (
        <li key={s}>
          {names[s] ? (
            <Link href={`/companies/${s}`} className="idea-chip">
              {names[s]}
            </Link>
          ) : (
            <span className="idea-chip">{s}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// One idea in the gallery. The title link covers the whole card; the chips and the action sit above it.
export function IdeaCard({ idea, names }: { idea: Idea; names: Record<string, string> }) {
  return (
    <article className="idea-card">
      <div className="idea-card-top">
        <IdeaStatusTag status={idea.status} />
        <span className="idea-card-date">{dateLabel(idea.updated)}</span>
      </div>
      <h2>
        <Link href={`/ideas/${idea.slug}`}>{idea.title}</Link>
      </h2>
      {idea.name && <p className="idea-card-name">{idea.name}</p>}
      {idea.summary && <p className="idea-card-summary">{idea.summary}</p>}
      <div className="idea-card-foot">
        <ProjectChips slugs={idea.links} names={names} />
        {idea.site && (
          <a className="button primary small" href={siteHref(idea.slug, idea.site)} target="_blank" rel="noreferrer">
            Open page <ArrowUpRight size={13} />
          </a>
        )}
      </div>
    </article>
  );
}
