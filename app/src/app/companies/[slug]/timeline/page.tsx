import Link from "next/link";
import { notFound } from "next/navigation";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { getCompany, getDocument, getNotes, getReports, getReviews, readJson, repoRoot } from "@/lib/repository";
import { mockupHref, REVIEW_ID } from "@/lib/mockups";
import { markOlder } from "@/lib/timeline";
import { getSnapshot, getWiki, wikiHref } from "@/lib/wiki";
import { dateLabel, label, listOf, recordOf, textOf } from "@/lib/model";
import { GitMomentum } from "@/views/git-momentum";
import { GitSegments } from "@/views/git-segments";
import { getThreads, threadHref } from "@/lib/threads";
import { ownerSaid } from "@/lib/voice";
import { getMockupReviews } from "@/lib/mockup-reviews";
import { Empty, PageHeader, Section, type Who } from "@/components/ds";
import { Provenance } from "@/components/provenance";
import { OlderTag } from "@/components/older-tag";
import { Sparkline } from "@/components/sparkline";
import { GateMeter } from "@/components/gate-meter";
import { OwesBadges } from "@/components/owes-badges";
import { cardFor } from "@/lib/cards";
import { CircleDashed, ClipboardCheck, FileText, Flag, GitCommitHorizontal, Hammer, MessagesSquare, NotebookPen, PenTool, Quote, Scale, ScrollText } from "lucide-react";

type Event = {
  date: string;
  end?: string;
  kind: "page" | "front" | "decision" | "review" | "note" | "report" | "build" | "thread" | "git" | "quiet" | "said" | "mockup";
  title: string;
  body?: string;
  href?: string;
  who: Who; // whose words or work this is
  note?: string;
  older?: boolean; // over 30 days older than the newest of its kind
};

// Each kind's mark in the timeline's second column, coloured by whose it is.
const kindIcons: Record<Event["kind"], typeof FileText> = {
  page: FileText,
  front: Flag,
  decision: Scale,
  review: ClipboardCheck,
  note: NotebookPen,
  report: ScrollText,
  build: Hammer,
  thread: MessagesSquare,
  git: GitCommitHorizontal,
  quiet: CircleDashed,
  said: Quote,
  mockup: PenTool,
};

// Kinds that are things made (documents, mockups, builds, threads): an old one may be superseded by a newer one.
const AGING: readonly Event["kind"][] = ["page", "review", "note", "report", "build", "thread", "mockup"];

// Mockup folders without a review.md (getMockupReviews covers the rest), and builds read from build.md alone, so the
// timeline doesn't run git for every build.
async function bareMockups(slug: string, reviewed: Set<string>) {
  const dir = path.join(repoRoot, "companies", slug, "mockups");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: { id: string; date: string; file: string }[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !REVIEW_ID.test(e.name) || reviewed.has(e.name)) continue;
    const files = (await readdir(path.join(dir, e.name)).catch(() => [] as string[])).filter((f) => /^[a-z0-9-]+\.html$/.test(f)).sort();
    const file = files.includes("index.html") ? "index.html" : files[0];
    out.push({ id: e.name, date: e.name.slice(0, 10), file: file ? `companies/${slug}/mockups/${e.name}/${file}` : "" });
  }
  return out;
}
async function buildDocs(slug: string) {
  const ids = (await readdir(path.join(repoRoot, "companies", slug, "builds")).catch(() => [] as string[])).filter((id) => /^[a-z0-9-]+$/.test(id));
  const docs = await Promise.all(ids.map((id) => getDocument(`companies/${slug}/builds/${id}/build.md`).then((d) => ({ id, d })).catch(() => null)));
  return docs.filter((x): x is NonNullable<typeof x> => !!x);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompany((await params).slug);
  return { title: c ? `${c.name} timeline` : "Timeline" };
}

const fileDate = (path: string, meta: Record<string, unknown>) =>
  (meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : String(meta.date || "")) ||
  path.split("/").pop()?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ||
  "";

export default async function Timeline({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCompany(slug);
  if (!c) notFound();
  const [pages, snapshot, reviews, notes, decisions, threads, mockups, reports, builds, card] = await Promise.all([
    getWiki(slug),
    getSnapshot(slug),
    getReviews(slug),
    getNotes(slug),
    readJson(`companies/${slug}/decisions.json`).catch(() => []),
    getThreads(),
    getMockupReviews(slug),
    getReports(slug),
    buildDocs(slug),
    cardFor(slug),
  ]);
  const bare = await bareMockups(slug, new Set(mockups.map((m) => m.id)));
  const events: Event[] = [];
  // Mockup reviews: the agent's mockup, the owner's answers, and each note they pinned or wrote on it.
  for (const m of mockups) {
    const href = `/companies/${slug}/mockups/${m.id}`;
    events.push({ date: m.date, kind: "mockup", title: `Mockup: ${m.title}`, href, who: "agent", note: m.status === "open" ? "waiting on you" : "mockup" });
    const answers = m.questions.map((q, i) => (m.notes.answers[i] ? `${q.ask} ${m.notes.answers[i]}` : "")).filter(Boolean);
    if (m.status === "answered")
      events.push({ date: m.answered || m.notes.updated, kind: "mockup", title: `Mockup answered: ${m.title}`, body: answers.join(" · "), href, who: "owner" });
    for (const p of m.notes.pins)
      events.push({ date: p.date || m.notes.updated, kind: "said", title: p.text, href, who: "owner", note: `note ${p.n} on ${m.title}` });
    if (m.notes.note) events.push({ date: m.notes.updated, kind: "said", title: m.notes.note, href, who: "owner", note: `on ${m.title}` });
  }
  for (const p of pages) {
    if (p.date)
      events.push({
        date: p.date,
        kind: p.kind === "front" ? "front" : "page",
        title: p.kind === "front" ? `Front raised: ${p.title}` : p.page === "index" ? "Story written" : `${label(p.kind)}: ${p.title}`,
        body: p.summary,
        href: wikiHref(slug, p.page),
        who: p.writtenBy,
        note: p.kind === "front" && p.raisedBy ? `raised by ${["owner", "alex"].includes(p.raisedBy) ? "you" : "agent"}` : undefined,
      });
    if (p.kind === "front" && ["settled", "parked"].includes(p.status) && p.updated)
      events.push({ date: p.updated, kind: "front", title: `Front ${p.status}: ${p.title}`, href: wikiHref(slug, p.page), who: p.writtenBy });
  }
  for (const d of listOf(decisions).map(recordOf))
    events.push({ date: String(d.date || ""), kind: "decision", title: textOf(d.decision), body: textOf(d.why), who: "owner", note: "decided" });
  for (const said of ownerSaid(threads, slug, 50))
    events.push({ date: said.date, kind: "said", title: said.text, href: threadHref(said.thread), who: "owner", note: said.thread.title });
  for (const r of reviews)
    events.push({ date: fileDate(r.path, r.meta), kind: "review", title: r.title, href: `/documents/${r.path}`, who: "agent", note: "review" });
  for (const n of notes)
    events.push({ date: fileDate(n.path, n.meta), kind: "note", title: n.title, href: `/documents/${n.path}`, who: "agent", note: "note" });
  for (const r of reports)
    events.push({ date: fileDate(r.path, r.meta), kind: "report", title: r.title, href: `/documents/${r.path}`, who: "agent", note: "report" });
  for (const m of bare)
    events.push({ date: m.date, kind: "mockup", title: `Mockup: ${label(m.id.slice(11))}`, href: m.file ? mockupHref(m.file) : undefined, who: "agent", note: "mockup" });
  for (const { id, d } of builds)
    events.push({
      date: (d.meta.created instanceof Date ? d.meta.created.toISOString() : String(d.meta.created || "")).slice(0, 10) || id.slice(0, 10),
      kind: "build",
      title: `Build: ${d.title}`,
      href: `/companies/${slug}/build?open=${id}#detail`,
      who: "agent",
      note: ["build", String(d.meta.status || "")].filter(Boolean).join(" · "),
    });
  for (const t of threads.filter((t) => t.projects.includes(slug) && !t.chat))
    events.push({
      date: t.started.slice(0, 10),
      kind: "thread",
      title: `Thread: ${t.title}`,
      href: threadHref(t),
      who: t.checkin ? "auto" : "agent",
      note: ["thread", t.status].filter(Boolean).join(" · "),
    });
  for (const repo of snapshot?.repos || []) {
    const segs = repo.segments || [];
    segs.forEach((s, i) => {
      events.push({
        date: s.from,
        end: s.to,
        kind: "git",
        title: `${s.commits} commits${snapshot!.repos.length > 1 ? ` in ${repo.label}` : ""}`,
        body: s.features.slice(0, 3).map((f) => f.subject).join(" · "),
        who: "code",
        note: `${Math.round((s.fixes * 100) / s.commits)}% fixes${s.status === "read" ? "" : " · not read"}`,
      });
      const next = segs[i + 1];
      if (next) {
        const gap = Math.round((new Date(next.from).getTime() - new Date(s.to).getTime()) / 86400000);
        if (gap > 30)
          events.push({ date: s.to, end: next.from, kind: "quiet", title: `Quiet for ${gap} days`, who: "code" });
      }
    });
  }
  const dated = markOlder(events, AGING).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a, b) => b.date.localeCompare(a.date));
  const byMonth = new Map<string, Event[]>();
  const count = (kind: Event["kind"], one: string, many = `${one}s`) => {
    const n = dated.filter((e) => e.kind === kind).length;
    return `${n} ${n === 1 ? one : many}`;
  };
  for (const e of dated) {
    const m = e.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) || []), e]);
  }

  return (
    <article className="timeline-page">
      <PageHeader
        title="Timeline"
        actions={
          <div className="tl-instruments">
            <span title="Commits per week, last 12 weeks">
              <Sparkline snapshot={snapshot} />
            </span>
            <GateMeter gates={card.gates} />
            <OwesBadges owes={card.owes} />
          </div>
        }
        meta={[
          count("said", "quote"),
          count("decision", "decision"),
          count("front", "front"),
          count("report", "report"),
          count("mockup", "mockup"),
          count("build", "build"),
          count("git", "git stretch", "git stretches"),
          dated.some((e) => e.older) && `${dated.filter((e) => e.older).length} older`,
        ]}
      />
      {!dated.length && <Empty>Nothing dated yet</Empty>}
      <ol className="tl">
        {[...byMonth].map(([month, list]) => (
          <li key={month} className="tl-month">
            <h2 className="tl-month-label">
              {new Date(month + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
            </h2>
            <ol>
              {list.map((e, i) => {
                const Icon = kindIcons[e.kind];
                const inner = (
                  <>
                    <span className="tl-date">
                      {dateLabel(e.date).replace(/, \d{4}$/, "")}
                      {e.end && e.end !== e.date && <span className="tl-end">to {dateLabel(e.end).replace(/, \d{4}$/, "")}</span>}
                    </span>
                    <span className="tl-mark" title={label(e.kind)}>
                      <Icon size={14} aria-hidden />
                    </span>
                    <span className="tl-body">
                      <span className="tl-title">{e.title}</span>
                      {e.body && <span className="tl-text">{e.body}</span>}
                      <span className="tl-foot">
                        <Provenance who={e.who} />
                        {e.note && <span>{e.note}</span>}
                        {e.older && <OlderTag />}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={i} className={`tl-event tl-${e.kind} src-${e.who} ${e.older ? "is-older" : ""}`}>
                    {e.href ? <Link href={e.href}>{inner}</Link> : <div>{inner}</div>}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
      {snapshot && (
        <Section id="git" title="Git history" note={<span className="code-text">python3 tools/git_history.py snapshot {slug}</span>}>
          <GitMomentum slug={slug} options={{}} />
          <GitSegments slug={slug} options={{}} />
        </Section>
      )}
    </article>
  );
}
