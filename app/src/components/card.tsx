import Link from "next/link";
import { costingNotMoving, type Card, type Dials, type Footprint, type Gate, type Hygiene, type Line, type Moved } from "@/lib/cards";
import type { WeekSnapshot } from "@/lib/sparkline";
import { dateLabel } from "@/lib/model";
import { ProjectMark } from "./ui";
import { Provenance } from "./provenance";
import { GateMeter } from "./gate-meter";
import { KindChip } from "./kind-chip";
import { OwesBadges } from "./owes-badges";
import { Sparkline } from "./sparkline";
import { State, Tag, type Tone } from "./ds";
import { RecheckButton, RecheckMark } from "./recheck";
import "@/styles/cards.css";

// A project's card (lib/cards.ts) as the owner reads it: one row on the board, or ≤12 lines leading the project page.

const short = (d: string) => dateLabel(d).replace(/, \d{4}$/, "");
const hygieneTones: Record<string, Tone> = { good: "ok", fair: "idle", poor: "risk" };
const gateMarks: Record<Gate["state"], string> = { done: "✓", open: "○", unknown: "?" };

export function movedText(m: Moved | null): string {
  if (!m || (!m.last_commit && m.idle_days === null)) return "";
  const idle = m.idle_days === null ? "" : m.idle_days === 0 ? "today" : `${m.idle_days}d idle`;
  return [m.last_commit && short(m.last_commit), idle].filter(Boolean).join(" · ");
}

export function footprintText(f: Footprint | null): string {
  if (!f) return "";
  if (f.summary) return f.summary;
  const parts = [...f.hosting, ...f.database, ...f.payments, ...f.store];
  return parts.length ? parts.join(" + ") : "nothing deployed";
}

function HygieneMark({ h }: { h: Hygiene | null }) {
  if (!h?.score) return <span className="faint">—</span>;
  return (
    <span title={h.reasons.join("; ") || undefined}>
      <State tone={hygieneTones[h.score]}>{h.score}</State>
    </span>
  );
}

function Costing({ card }: { card: Card }) {
  return costingNotMoving(card) ? (
    <span title={footprintText(card.footprint)}>
      <Tag tone="risk">costing, not moving</Tag>
    </span>
  ) : null;
}

// Days since the last commit, short: today, 3d, 76d. Quieter the longer it's been.
function Idle({ m }: { m: Moved | null }) {
  const d = m?.idle_days;
  if (d === null || d === undefined) return <span className="faint">—</span>;
  const tone = d <= 7 ? "is-fresh" : d <= 30 ? "is-cooling" : "is-cold";
  return (
    <span className={`idle ${tone}`} title={m?.last_commit ? `Last commit ${dateLabel(m.last_commit)}` : undefined}>
      {d === 0 ? "today" : `${d}d`}
    </span>
  );
}

// The ref tools/recheck.py takes for a card line.
const lineRef = (slug: string, key: "blocker" | "next") => `companies/${slug}/card.json#${key}`;

// Flagged questions on this project other than the blocker (threads, builds, the next step), as one quiet tag.
function OtherRechecks({ card }: { card: Card }) {
  const n = card.recheck - (card.blocker?.recheck?.commits ? 1 : 0);
  return n > 0 ? (
    <span title="Threads, builds or the next step with commits since they were asked; open the project to recheck">
      <Tag tone="attention">{n} to recheck</Tag>
    </span>
  ) : null;
}

// One project on the board: name and finish line, goal, blocker; the instruments on the right.
export function BoardRow({ card, name, snapshot }: { card: Card; name: string; snapshot?: WeekSnapshot | null }) {
  return (
    <Link href={`/companies/${card.slug}`} className={`board-row ${card.written ? "" : "is-unwritten"}`}>
      <span className="board-text">
        <span className="board-name">
          <ProjectMark company={{ id: card.slug, name }} />
          <span className="board-title">{name}</span>
          <KindChip kind={card.kind} source={card.kindSource} />
          <Costing card={card} />
          <OtherRechecks card={card} />
        </span>
        {card.written ? (
          <>
            <span className="board-line board-goal">{card.goal ? card.goal.text : <span className="faint">no goal</span>}</span>
            {card.blocker ? (
              <span className={`board-line board-blocker${card.blocker.recheck ? " has-recheck" : ""}`}>
                <span className="board-clip">{card.blocker.text}</span>
                <RecheckMark flag={card.blocker.recheck} item={lineRef(card.slug, "blocker")} quiet />
              </span>
            ) : (
              <span className="board-line faint">no blocker recorded</span>
            )}
          </>
        ) : (
          <span className="board-line faint">no card yet{card.needs && card.needs !== "card not written" ? ` · ${card.needs}` : ""}</span>
        )}
      </span>
      <span className="board-inst">
        <span className="bi bi-spark">
          <Sparkline snapshot={snapshot} />
        </span>
        <span className="bi bi-gates">{card.gates.length ? <GateMeter gates={card.gates} /> : <span className="faint">—</span>}</span>
        <span className="bi bi-owes">
          <OwesBadges owes={card.owes} />
        </span>
        <span className="bi bi-idle">
          <Idle m={card.moved} />
        </span>
        <span className="bi bi-hyg">
          <HygieneMark h={card.hygiene} />
        </span>
      </span>
    </Link>
  );
}

export function BoardHead() {
  return (
    <div className="board-row board-head" aria-hidden>
      <span className="board-text">Project, goal, blocker</span>
      <span className="board-inst">
        <span className="bi bi-spark">12 weeks</span>
        <span className="bi bi-gates">Gates</span>
        <span className="bi bi-owes">Owes you</span>
        <span className="bi bi-idle">Idle</span>
        <span className="bi bi-hyg">Hygiene</span>
      </span>
    </div>
  );
}

// The totals above the board, as one quiet line: a label and its figure, coloured only when it's not zero. "Needs
// recheck" counts open questions asked before newer commits (tools/recheck.py scan); "Recheck all" has an agent
// go through them.
export function DialStrip({ dials }: { dials: Dials }) {
  const items: [string, number, Tone?][] = [
    ["Blockers", dials.blockers],
    ["Decisions owed", dials.decisions, "attention"],
    ["Builds to review", dials.buildsReview, "attention"],
    ["Needs recheck", dials.recheck, "attention"],
    ["Costing, not moving", dials.costing, "risk"],
    ["Poor hygiene", dials.poorHygiene, "risk"],
  ];
  return (
    <div className="dials-bar">
      <dl className="dials">
        {items.map(([k, v, tone]) => (
          <div key={k} className={tone && v ? `tone-${tone}` : v ? "" : "is-zero"}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {dials.recheck > 0 && <RecheckButton item="--all" label="Recheck all" />}
    </div>
  );
}

// One line of the card: label | value | provenance. Every row uses the same three columns, so values start at one x
// and every source tag ends at one x.
function CardRow({ k, children, src, className = "" }: { k?: React.ReactNode; children?: React.ReactNode; src?: React.ReactNode; className?: string }) {
  return (
    <dl className={`pc-row ${className}`}>
      <dt className="pc-k">{k}</dt>
      <dd className="pc-v">{children}</dd>
      <dd className="pc-p">{src}</dd>
    </dl>
  );
}

const srcOf = (line: Line) => <Provenance who={line.source} date={line.date} cite={line.ref} />;
const none = (text: string) => <span className="faint">{text}</span>;

// The card leading a project page: one typeface, one size, three columns; a hairline between the major rows only.
export function ProjectCard({ card, snapshot }: { card: Card; snapshot?: WeekSnapshot | null }) {
  const fp = footprintText(card.footprint);
  const h = card.hygiene;
  const o = card.owes;
  const owesAny = !!o && o.decisions + o.builds_review + o.threads_awaiting + o.contradictions + o.builds_approved_unrun > 0;
  const groups: [string, React.ReactNode][] = [];
  if (!card.written)
    groups.push(["card", <CardRow key="c" k="Card">{none(`no card yet${card.needs && card.needs !== "card not written" ? ` · ${card.needs}` : ""}`)}</CardRow>]);
  if (card.written || card.goal)
    groups.push([
      "goal",
      <CardRow key="g" k={<>Goal <KindChip kind={card.kind} source={card.kindSource} /></>} src={card.goal && srcOf(card.goal)}>
        {card.goal ? card.goal.text : none("not set")}
      </CardRow>,
    ]);
  if (card.gates.length)
    groups.push([
      "finish",
      <>
        <CardRow k="Finish">
          <GateMeter gates={card.gates} />
        </CardRow>
        {card.gates.map((g) => (
          <CardRow key={g.name} className={`pc-gate gate-${g.state}`} src={g.state !== "unknown" && g.source ? <Provenance who={g.source} date={g.date} cite={g.ref} /> : null}>
            <b aria-label={g.state}>{gateMarks[g.state]}</b>
            <span>
              {g.name}
              {g.note && <span className="pc-note"> {g.note}</span>}
            </span>
          </CardRow>
        ))}
      </>,
    ]);
  if (card.written || card.blocker)
    groups.push([
      "blocker",
      <CardRow key="b" k="Blocker" src={card.blocker && srcOf(card.blocker)}>
        {card.blocker ? (
          <>
            {card.blocker.text} <RecheckMark flag={card.blocker.recheck} item={lineRef(card.slug, "blocker")} />
          </>
        ) : (
          none("none recorded")
        )}
      </CardRow>,
    ]);
  if (card.next)
    groups.push([
      "next",
      <CardRow key="n" k="Next" src={srcOf(card.next)}>
        {card.next.text} <RecheckMark flag={card.next.recheck} item={lineRef(card.slug, "next")} />
      </CardRow>,
    ]);
  groups.push([
    "moved",
    <CardRow key="m" k="Moved" src={card.moved ? <Provenance who="code" /> : null}>
      <span className="pc-spark">
        <Sparkline snapshot={snapshot} />
      </span>
      <span>
        {movedText(card.moved) || none("no commits read")}
        {card.moved?.commits_30d ? <span className="pc-note">, {card.moved.commits_30d} commits in 30 days</span> : null}
      </span>
    </CardRow>,
  ]);
  // Flagged threads and builds; their Recheck buttons are on the thread pages.
  const otherRechecks = card.recheck - (card.blocker?.recheck?.commits ? 1 : 0) - (card.next?.recheck?.commits ? 1 : 0);
  groups.push([
    "owes",
    <CardRow key="o" k="Owes you">
      {owesAny ? <OwesBadges owes={o} full /> : none("nothing")}
      {otherRechecks > 0 && <span className="pc-note"> · {otherRechecks} with commits since asked, may need a recheck</span>}
    </CardRow>,
  ]);
  groups.push([
    "footprint",
    <CardRow key="f" k="Footprint" src={fp ? <Provenance who="code" /> : null}>
      <span>
        {costingNotMoving(card) && <span className="pc-risk">Costing, not moving. </span>}
        {fp || none("not scanned")}
      </span>
    </CardRow>,
  ]);
  groups.push([
    "hygiene",
    <CardRow key="h" k="Hygiene" src={h?.score ? <Provenance who="code" /> : null}>
      <span>
        <HygieneMark h={h} />
        {h?.reasons.length ? <span className="pc-note"> {h.reasons.slice(0, 2).join("; ")}</span> : null}
      </span>
    </CardRow>,
  ]);
  return (
    <section className="project-card" aria-label="Card">
      <div className="pc">
        {groups.map(([key, row]) => (
          <div key={key} className={`pc-group pc-${key}`}>
            {row}
          </div>
        ))}
        {card.updated && (
          <div className="pc-group pc-foot">
            <CardRow src={`card updated ${short(card.updated)} · tier ${(card.tier || "undecided").toLowerCase()}`} />
          </div>
        )}
      </div>
    </section>
  );
}
