import { notFound } from "next/navigation";
import { getCompany, getReports } from "@/lib/repository";
import { dateLabel } from "@/lib/model";
import { getWiki, kindLabels, kinds, wikiHref } from "@/lib/wiki";
import { ProjectNav, type NavGroup, type NavPage } from "@/components/project-nav";
import { ProjectMark } from "@/components/ui";
import { getThreads, threadHref } from "@/lib/threads";

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (!company) notFound();
  const [pages, threads, reports] = await Promise.all([getWiki(slug), getThreads(), getReports(slug)]);
  const own = threads.filter((t) => t.projects.includes(slug));
  const open = own.filter((t) => t.status !== "closed" && t.status !== "decided");
  const base = `/companies/${slug}`;
  const top: NavPage[] = [
    { href: base, title: "Story", icon: "story", exact: true },
    { href: `${base}/build`, title: "Board", icon: "board" },
    { href: `${base}/decisions`, title: "Decisions", icon: "decisions" },
    { href: `${base}/market`, title: "Market", icon: "market" },
    { href: `${base}/screens`, title: "Screens", icon: "screens" },
    { href: `${base}/mockups`, title: "Mockups", icon: "mockups" },
    { href: `${base}/timeline`, title: "Timeline", icon: "timeline" },
    { href: `${base}/model`, title: "Model", icon: "model" },
  ];
  const groups: NavGroup[] = [
    ...kinds
      .filter((k) => k !== "story")
      .map((k) => ({
        id: k,
        title: kindLabels[k],
        items: pages
          .filter((p) => p.kind === k && p.page !== "index")
          .map((p) => ({
            href: wikiHref(slug, p.page),
            title: p.title,
            status: k === "front" ? p.status || "open" : undefined,
          })),
      }))
      .filter((g) => g.items.length),
    ...(reports.length
      ? [
          {
            id: "reports",
            title: "Reports",
            items: reports.map((r) => {
              const date = r.path.split("/").pop()?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
              return { href: `/documents/${r.path}`, title: date ? `${dateLabel(date).replace(/, \d{4}$/, "")} · ${r.title}` : r.title };
            }),
          },
        ]
      : []),
    ...(own.length
      ? [
          {
            id: "threads",
            title: "Threads",
            items: open.map((t) => ({ href: threadHref(t), title: t.title, status: t.status })),
            more: { href: `/threads?project=${slug}`, title: "All threads" },
          },
        ]
      : []),
  ];
  return (
    <div className="project-shell">
      <ProjectNav
        name={
          <>
            <ProjectMark company={company} />
            {company.name}
          </>
        }
        pages={top}
        groups={groups}
        defaultOpen={["front", "threads"]}
      />
      <div className="project-content">{children}</div>
    </div>
  );
}
