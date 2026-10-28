import Link from "next/link";
import { ArrowUpRight, Search, X } from "lucide-react";
import { isClaim, type Claim } from "@/lib/model";

// Master-Repo's shared building blocks. Pages compose these instead of styling their own headers, sections,
// lists and labels; the styles are in src/styles/ds.css.

import { Provenance, whoLabels, whoOf, type Who } from "./provenance";

// Provenance lives in provenance.tsx; Source is its name across the app.
export { Provenance as Source, whoLabels, type Who };
const Source = Provenance;

// A claim from company.json, set in the voice of whoever made it: the owner's words in serif, code in mono.
export function Statement({ label, value }: { label?: string; value: Claim | string }) {
  const c: Claim = isClaim(value) ? value : { text: String(value), source: "agent" };
  const w = whoOf(c.source);
  return (
    <div className={`statement voice-${w}`}>
      {label && <p className="statement-label">{label}</p>}
      <p className="statement-text">{c.text}</p>
      <Source who={w} date={c.date} cite={c.ref} />
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  lede,
  meta,
  actions,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  meta?: React.ReactNode[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="ph">
      <div className="ph-main">
        {kicker && <p className="ph-kicker">{kicker}</p>}
        <h1>{title}</h1>
        {lede && <div className="ph-lede">{lede}</div>}
        {meta && <Meta items={meta} />}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </header>
  );
}

// Short facts in a line, separated by dots.
export function Meta({ items }: { items: React.ReactNode[] }) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  if (!shown.length) return null;
  return (
    <p className="meta">
      {shown.map((x, i) => (
        <span key={i}>{x}</span>
      ))}
    </p>
  );
}

export function Section({
  id,
  title,
  note,
  action,
  children,
  className = "",
}: {
  id?: string;
  title: React.ReactNode;
  note?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`sec ${className}`}>
      <header className="sec-head">
        <h2>{title}</h2>
        {note && <span className="sec-note">{note}</span>}
        {action && <span className="sec-action">{action}</span>}
      </header>
      {children}
    </section>
  );
}

// The page body beside a narrower rail of facts.
export function Split({ children, rail }: { children: React.ReactNode; rail: React.ReactNode }) {
  return (
    <div className="split">
      <div className="split-main">{children}</div>
      <aside className="split-rail">{rail}</aside>
    </div>
  );
}

// Lists are hairline rows, not cards.
export function Rows({ children, dense = false }: { children: React.ReactNode; dense?: boolean }) {
  return <div className={`rows ${dense ? "rows-dense" : ""}`}>{children}</div>;
}

export function Row({
  href,
  lead,
  title,
  detail,
  meta,
  trail,
  tone,
}: {
  href?: string;
  lead?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  meta?: React.ReactNode[];
  trail?: React.ReactNode;
  tone?: Tone;
}) {
  const body = (
    <>
      {lead && <span className="row-lead">{lead}</span>}
      <span className="row-body">
        <span className="row-title">{title}</span>
        {detail && <span className="row-detail">{detail}</span>}
        {meta && <Meta items={meta} />}
      </span>
      {trail && <span className="row-trail">{trail}</span>}
    </>
  );
  const cls = `row ${tone ? `tone-${tone}` : ""}`;
  return href ? (
    <Link href={href} className={`${cls} row-link`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export type Tone = "accent" | "attention" | "ok" | "risk" | "idle" | "agent";
export function Tag({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`tag ${tone ? `tone-${tone}` : ""}`}>{children}</span>;
}

// A state dot with its word: open, working, settled, parked, waiting...
export function State({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`state-word ${tone ? `tone-${tone}` : ""}`}>
      <i aria-hidden />
      {children}
    </span>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function More({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="more-link">
      {children} <ArrowUpRight size={13} aria-hidden />
    </Link>
  );
}

// the owner's own words, verbatim, with where and when they said them. `auto` is a message a tool wrote in their name:
// plain sans, marked Automatic.
// `note` sits at the end of the caption (a spelling note: components/spell-fixes.tsx SpellNote).
export function Said({
  text,
  date,
  where,
  href,
  auto = false,
  note,
  attached,
}: {
  text: string;
  date?: string;
  where?: string;
  href?: string;
  auto?: boolean;
  note?: React.ReactNode;
  attached?: React.ReactNode; // what they attached (AttachmentChips), under their words; a message may be only that
}) {
  return (
    <figure className={`said-block${auto ? " is-auto" : ""}`}>
      {text && <blockquote>{text}</blockquote>}
      {attached}
      <figcaption>
        <Source who={auto ? "auto" : "owner"} date={date} />
        {where && (href ? <Link href={href}>{where}</Link> : <span>{where}</span>)}
        {note}
      </figcaption>
    </figure>
  );
}

// Something worth having but not worth reading first: folded until asked for. `aside` sits on the same quiet line
// after a dot (a link to the source, say) and drops below the content once it's open.
export function Fold({
  summary,
  children,
  open = false,
  aside,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  aside?: React.ReactNode;
}) {
  const fold = (
    <details className="fold" open={open || undefined}>
      <summary>{summary}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
  if (!aside) return fold;
  return (
    <div className="fold-line">
      {fold}
      <span className="fold-aside">{aside}</span>
    </div>
  );
}

// Figures. `lg` (default): a few big numbers under a page title, each over its label.
// `sm`: small labels over figures between hairlines, for a panel or a rail. A `wide` item takes the whole line.
type Maybe<T> = T | false | null | undefined | "" | 0;
export type StatItem ={ value: React.ReactNode; label: string; href?: string; tone?: Tone; wide?: boolean; code?: boolean };
export function Stats({ items, size = "lg" }: { items: Maybe<StatItem>[]; size?: "lg" | "sm" }) {
  const shown = items.filter((x): x is StatItem => !!x);
  if (size === "sm")
    return (
      <dl className="stats-sm">
        {shown.map((x) => (
          <div key={x.label} className={`${x.wide ? "is-wide" : ""} ${x.tone ? `tone-${x.tone}` : ""}`}>
            <dt>{x.label}</dt>
            <dd className={x.code ? "code-text" : typeof x.value === "string" || typeof x.value === "number" ? "is-figure" : ""}>{x.value}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <div className="stats">
      {shown.map((x) =>
        x.href ? (
          <Link key={x.label} href={x.href} className={`stat ${x.tone ? `tone-${x.tone}` : ""}`}>
            <strong>{x.value}</strong>
            <span>{x.label}</span>
          </Link>
        ) : (
          <div key={x.label} className={`stat ${x.tone ? `tone-${x.tone}` : ""}`}>
            <strong>{x.value}</strong>
            <span>{x.label}</span>
          </div>
        ),
      )}
    </div>
  );
}

// Key / value pairs, one per line: a faint key beside its value. Falsy entries are skipped.
export type KVItem = [key: string, value: React.ReactNode, className?: string];
export function KV({ items, className = "" }: { items: Maybe<KVItem>[]; className?: string }) {
  return (
    <dl className={`kv ${className}`}>
      {items
        .filter((x): x is KVItem => !!x)
        .map(([k, v, cls]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={cls}>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

// A button that opens a small list of choices (`menu-item` buttons, `menu-field` inputs, `menu-sep`). It is a plain
// <details>; client pages close it on an outside click with `useMenuDismiss` (components/build.tsx).
export function Menu({
  label,
  children,
  align = "end",
  up = false,
  button = "button secondary",
  title,
  className = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  up?: boolean;
  button?: string;
  title?: string;
  className?: string;
}) {
  return (
    <details className={`menu menu-${align}${up ? " menu-up" : ""} ${className}`}>
      <summary className={button} title={title} aria-label={title}>
        {label}
      </summary>
      <div className="menu-pop">{children}</div>
    </details>
  );
}

// Underline tabs built from links; the current one carries aria-current.
export type TabItem = { href: string; label: React.ReactNode; count?: number; current?: boolean; title?: string };
export function Tabs({ label, items, scroll, className = "" }: { label: string; items: TabItem[]; scroll?: boolean; className?: string }) {
  return (
    <nav className={`tabs ${className}`} aria-label={label}>
      {items.map((t) => (
        <Link key={t.href} href={t.href} scroll={scroll} aria-current={t.current ? "page" : undefined} title={t.title}>
          {t.label}
          {!!t.count && <span className="tabs-count">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

// A list's filters (used from client components): a search box, rows of choice chips with counts.
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="fbar">{children}</div>;
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="fbar-search">
      <Search size={15} aria-hidden />
      <input aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}>
          <X size={13} />
        </button>
      )}
    </label>
  );
}

export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="fbar-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} className={value === o.value ? "is-on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="mono">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// A table of figures: hairline rows, faint headers, figures right-aligned (`num` on th and td).
export function DataTable({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="dtable-wrap">
      <table className={`dtable ${className}`}>{children}</table>
    </div>
  );
}

// A figure with a small bar beside it, for a DataTable cell. `part` runs from 0 to 1.
export function Bar({ part, tone, title, children }: { part: number; tone?: Tone; title?: string; children: React.ReactNode }) {
  return (
    <span className={`dbar-cell ${tone ? `tone-${tone}` : ""}`} title={title}>
      <span className="mono">{children}</span>
      <span className="dbar" aria-hidden>
        <i style={{ width: `${Math.max(0, Math.min(1, part)) * 100}%` }} />
      </span>
    </span>
  );
}

// Where a piece of work stands, drawn the way issue trackers do: dashed, empty, half, most, done.
export type Stage = "proposed" | "ready" | "working" | "review" | "done";
export function StageIcon({ stage, live = false }: { stage: Stage; live?: boolean }) {
  const part = { proposed: 0, ready: 0, working: 0.5, review: 0.75, done: 1 }[stage];
  const c = 2 * Math.PI * 2.5;
  return (
    <svg className={`stage-icon st-${stage}${live ? " is-live" : ""}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r="5.75" fill="none" strokeWidth="1.5" strokeDasharray={stage === "proposed" ? "2.2 1.8" : undefined} />
      {stage === "done" ? (
        <>
          <circle cx="7" cy="7" r="5.75" />
          <path d="M4.6 7.1 6.3 8.7 9.4 5.5" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stage-tick" />
        </>
      ) : (
        part > 0 && <circle cx="7" cy="7" r="2.5" fill="none" strokeWidth="5" strokeDasharray={`${part * c} ${c}`} transform="rotate(-90 7 7)" />
      )}
    </svg>
  );
}
