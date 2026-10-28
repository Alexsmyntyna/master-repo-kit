import { Empty, PageHeader } from "@/components/ds";
import { IdeaCard } from "@/components/ideas";
import { getIdeas } from "@/lib/ideas";
import { getCompanies } from "@/lib/repository";
import "@/styles/ideas.css";

export const metadata = { title: "Ideas" };

export default async function Ideas() {
  const [ideas, companies] = await Promise.all([getIdeas(), getCompanies()]);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader title="Ideas" meta={[`${ideas.length} idea${ideas.length === 1 ? "" : "s"}`]} />
      {ideas.length ? (
        <div className="idea-grid">
          {ideas.map((i) => (
            <IdeaCard key={i.slug} idea={i} names={names} />
          ))}
        </div>
      ) : (
        <Empty>No ideas yet</Empty>
      )}
    </>
  );
}
