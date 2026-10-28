import { getWiki, HOLDING, kindLabels, kinds, wikiHref } from "@/lib/wiki";
import { getCompanyInfo } from "@/lib/company";
import { getThreads, threadHref } from "@/lib/threads";
import { ProjectNav, type NavGroup, type NavPage } from "@/components/project-nav";

// The parent company's area, laid out like a project's: its own nav beside every page (/company/…).
export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const [pages, threads, info] = await Promise.all([getWiki(HOLDING), getThreads(), getCompanyInfo()]);
  const own = threads.filter((t) => t.scope === HOLDING);
  const open = own.filter((t) => t.status !== "closed" && t.status !== "decided");
  const top: NavPage[] = [
    { href: "/company", title: "Company", icon: "company", exact: true },
    { href: "/company/setup", title: "Setup", icon: "setup" },
    { href: "/company/money", title: "Money", icon: "money" },
    { href: wikiHref(HOLDING, "fronts/name"), title: "Name", icon: "name" },
    { href: wikiHref(HOLDING, "fronts/public-presence"), title: "Presence", icon: "presence" },
    { href: "/company/vision", title: "Vision", icon: "vision" },
    { href: "/company/pages", title: "Pages", icon: "pages" },
  ];
  const groups: NavGroup[] = [
    ...kinds
      .filter((k) => k !== "story")
      .map((k) => ({
        id: `company-${k}`,
        title: kindLabels[k],
        items: pages
          .filter((p) => p.kind === k && p.page !== "index")
          .map((p) => ({ href: wikiHref(HOLDING, p.page), title: p.title, status: k === "front" ? p.status || "open" : undefined })),
      }))
      .filter((g) => g.items.length),
    ...(own.length
      ? [
          {
            id: "company-threads",
            title: "Threads",
            items: open.map((t) => ({ href: threadHref(t), title: t.title, status: t.status })),
            more: { href: "/threads", title: "All threads" },
          },
        ]
      : []),
  ];
  return (
    <div className="project-shell">
      <ProjectNav
        label="Company"
        name={info.name || "Parent company"}
        pages={top}
        groups={groups}
        defaultOpen={["company-front", "company-threads"]}
      />
      <div className="project-content">{children}</div>
    </div>
  );
}
