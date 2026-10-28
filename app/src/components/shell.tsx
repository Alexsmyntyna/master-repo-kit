"use client";
import Link from "next/link";
import { Dock } from "@/components/dock/dock";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BookCheck, Building2, CalendarDays, ChevronRight, FolderKanban, Gauge, LayoutGrid, Lightbulb, MessagesSquare, RefreshCw, Menu, Scale, Settings, Terminal, X } from "lucide-react";
import { ProjectMark } from "./ui";
import { systemPages } from "@/lib/system";

// The board first, then the places the owner decides from; the rest folds under More (open while one of its pages is
// current), then the projects, and System at the bottom. The Company item takes the parent company's name once the owner
// sets it in holding/company.json.
type NavItem = { href: string; title: string; icon: typeof LayoutGrid };
const primary: NavItem[] = [
  { href: "/", title: "Board", icon: Gauge },
  { href: "/companies", title: "Projects", icon: FolderKanban },
  { href: "/standards", title: "Standards", icon: BookCheck },
  { href: "/decisions", title: "Decisions", icon: Scale },
  { href: "/calendar", title: "Calendar", icon: CalendarDays },
];
const moreFor = (companyName: string | null): NavItem[] => [
  { href: "/overview", title: "Overview", icon: LayoutGrid },
  { href: "/company", title: companyName || "Company", icon: Building2 },
  { href: "/threads", title: "Threads", icon: MessagesSquare },
  { href: "/ideas", title: "Ideas", icon: Lightbulb },
  { href: "/skills", title: "Skills", icon: Terminal },
];
const subPages: Record<string, string> = { build: "Board", wiki: "Wiki", timeline: "Timeline", model: "Model" };
const system = { href: "/system", title: "System", icon: Settings };
const systemHrefs = systemPages.map((p) => p.href);
function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (href === "/companies") return pathname === "/companies";
  if (href === "/system") return pathname === "/system" || systemHrefs.some((h) => h !== "/skills" && pathname.startsWith(h));
  return pathname === href || pathname.startsWith(`${href}/`); // "/company" isn't active on "/companies/…"
}

export function Shell({
  owner,
  companyName,
  companies,
  queueCount,
  awaitingCount,
  calendarCount,
  openThreadCount,
  runningCount,
  ideaCount,
  children,
}: {
  owner: string;
  companyName: string | null;
  companies: { id: string; name: string }[];
  queueCount: number;
  awaitingCount: number;
  calendarCount: number;
  openThreadCount: number;
  runningCount: number;
  ideaCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname(),
    router = useRouter();
  const [open, setOpen] = useState(false),
    [pending, startTransition] = useTransition();
  const more = moreFor(companyName);
  const navigation = [...primary, ...more];
  const moreCurrent = more.some((n) => isActive(n.href, pathname));
  const project = companies.find(
    (c) => pathname === `/companies/${c.id}` || pathname.startsWith(`/companies/${c.id}/`),
  );
  const current =
    project?.name ||
    [...navigation, system].find((n) => isActive(n.href, pathname) && n.href !== "/")?.title ||
    systemPages.find((n) => pathname.startsWith(n.href))?.title ||
    (pathname.startsWith("/documents") ? "Documents" : "Board");
  // A project's own page under its name: "Projects / FinanceApp / Timeline".
  const subKey = project ? pathname.split("/")[3] || "" : "";
  const sub = subKey ? subPages[subKey] || subKey.charAt(0).toUpperCase() + subKey.slice(1) : "";
  const item = (n: NavItem) => {
    const active = isActive(n.href, pathname);
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={() => setOpen(false)}
        className={`nav-item ${active ? "active" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        <n.icon size={15} />
        <span>{n.title}</span>
        {n.href === "/decisions" && awaitingCount > 0 && (
          <b className="nav-alert" title="Waiting on you">
            {awaitingCount}
          </b>
        )}
        {n.href === "/calendar" && calendarCount > 0 && (
          <b className="nav-alert" title="Due today or overdue">
            {calendarCount}
          </b>
        )}
        {n.href === "/threads" && openThreadCount > 0 && (
          <b className={runningCount > 0 ? "nav-live" : undefined} title={runningCount > 0 ? `${runningCount} running` : "Open"}>
            {openThreadCount}
          </b>
        )}
        {n.href === "/ideas" && ideaCount > 0 && <b title="Ideas">{ideaCount}</b>}
        {n.href === "/system" && queueCount > 0 && <b title="Open in the queue">{queueCount}</b>}
      </Link>
    );
  };
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <strong>Master Repo</strong>
          <small>{owner}</small>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <nav aria-label="Main navigation">
          {primary.map(item)}
          <details className="nav-more" open={moreCurrent || undefined} key={moreCurrent ? "current" : "folded"}>
            <summary className="nav-item">
              <ChevronRight size={15} className="nav-more-chev" />
              <span>More</span>
            </summary>
            {more.map(item)}
          </details>
        </nav>
        <div className="sidebar-projects">
          <Link
            href="/companies"
            className={`nav-label ${pathname === "/companies" ? "active" : ""}`}
            onClick={() => setOpen(false)}
          >
            Projects <span>{companies.length}</span>
          </Link>
          {companies.map((c) => (
            <Link
              href={`/companies/${c.id}`}
              key={c.id}
              className={`project-nav ${pathname === `/companies/${c.id}` || pathname.startsWith(`/companies/${c.id}/`) ? "selected" : ""}`}
              onClick={() => setOpen(false)}
            >
              <ProjectMark company={c} />
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
        <nav className="sidebar-foot" aria-label="System">
          {item(system)}
        </nav>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            {project && (
              <>
                <Link href="/companies">Projects</Link>
                <span aria-hidden>/</span>
              </>
            )}
            {project && sub ? (
              <>
                <Link href={`/companies/${project.id}`}>{project.name}</Link>
                <span aria-hidden>/</span>
                <strong>{sub}</strong>
              </>
            ) : (
              <strong>{current}</strong>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button refresh"
              disabled={pending}
              aria-label="Refresh workspace data"
              title="Refresh workspace data"
              onClick={() => startTransition(() => router.refresh())}
            >
              <RefreshCw size={16} className={pending ? "spin" : ""} />
            </button>
          </div>
        </header>
        <main id="main">{children}</main>
        <Dock />
      </div>
    </div>
  );
}
