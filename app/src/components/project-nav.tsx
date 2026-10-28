"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  BookOpen,
  Braces,
  Building2,
  ChartLine,
  ChevronRight,
  Compass,
  Files,
  Globe,
  History,
  ListChecks,
  MonitorSmartphone,
  PenTool,
  Scale,
  SquareKanban,
  Tag,
  type LucideIcon,
} from "lucide-react";

// Icons are named here because a server layout can't hand a component to a client one.
const icons = {
  story: BookOpen,
  board: SquareKanban,
  decisions: Scale,
  market: ChartLine,
  screens: MonitorSmartphone,
  mockups: PenTool,
  timeline: History,
  model: Braces,
  // the parent company's area (/company)
  company: Building2,
  setup: ListChecks,
  money: Banknote,
  name: Tag,
  presence: Globe,
  vision: Compass,
  pages: Files,
} satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof icons;

export type NavLink = { href: string; title: string; status?: string };
export type NavPage = NavLink & { icon: NavIcon; exact?: boolean };
export type NavGroup = { id: string; title: string; items: NavLink[]; more?: NavLink };

const storageKey = "mr.project-nav.open";
const readOpen = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    return {};
  }
};
const writeOpen = (open: Record<string, boolean>) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(open));
  } catch {}
};

// A project's own navigation, beside every project page: its pages with icons, then the wiki by kind and its
// open threads as folding groups with counts. Which groups are open is remembered per browser.
export function ProjectNav({
  name,
  pages,
  groups,
  defaultOpen,
  label = "Project",
}: {
  name: React.ReactNode;
  pages: NavPage[];
  groups: NavGroup[];
  defaultOpen: string[];
  label?: string;
}) {
  const pathname = decodeURIComponent(usePathname());
  const at = (href: string, exact = true) => {
    const h = decodeURIComponent(href.split(/[?#]/)[0]);
    return pathname === h || (!exact && pathname.startsWith(`${h}/`));
  };
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, defaultOpen.includes(g.id)])),
  );
  // Below 1180px the nav is a strip: a group opens as a small dropdown, one at a time, and closes on navigation.
  const [narrow, setNarrow] = useState(false);
  const [popped, setPopped] = useState<string | null>(null);
  useEffect(() => {
    const saved = readOpen();
    if (Object.keys(saved).length) setOpen((o) => ({ ...o, ...saved }));
    const mq = window.matchMedia("(max-width: 1180px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => setPopped(null), [pathname]);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!popped) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !navRef.current?.contains(e.target as Node)) setPopped(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [popped]);
  const toggle = (id: string, value: boolean) =>
    setOpen((o) => {
      if (o[id] === value) return o;
      const next = { ...o, [id]: value };
      writeOpen(next);
      return next;
    });
  const link = (item: NavLink, lead: React.ReactNode, exact = true) => {
    const active = at(item.href, exact);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`pnav-item ${active ? "active" : ""}`}
        aria-current={active ? "page" : undefined}
        title={item.title}
      >
        {lead}
        <span>{item.title}</span>
      </Link>
    );
  };
  return (
    <nav className="pnav" aria-label={label} ref={navRef}>
      <p className="pnav-name">{name}</p>
      <div className="pnav-pages">
        {pages.map((p) => {
          const Icon = icons[p.icon];
          return link(p, <Icon size={15} aria-hidden />, p.exact ?? false);
        })}
      </div>
      <div className="pnav-groups">
        {groups.map((g) => {
          // the group holding the current page is always open
          const current = g.items.some((i) => at(i.href));
          return (
            <details
              key={g.id}
              className={`pnav-group ${current ? "is-current" : ""}`}
              open={narrow ? popped === g.id : current || open[g.id]}
              onToggle={(e) => {
                const isOpen = e.currentTarget.open;
                if (narrow) setPopped((p) => (isOpen ? g.id : p === g.id ? null : p));
                else if (!current) toggle(g.id, isOpen);
              }}
            >
              <summary className="pnav-head">
                <ChevronRight size={13} className="pnav-chev" aria-hidden />
                <span>{g.title}</span>
                <b className="mono">{g.items.length}</b>
              </summary>
              <div className="pnav-list">
                {g.items.map((i) => link(i, i.status ? <i className={`dot state-dot-${i.status}`} aria-hidden /> : null))}
                {g.more && (
                  <Link href={g.more.href} className="pnav-more">
                    {g.more.title}
                  </Link>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </nav>
  );
}
