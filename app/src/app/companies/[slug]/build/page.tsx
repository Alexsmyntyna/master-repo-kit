import Link from "next/link";
import { X } from "lucide-react";
import { notFound } from "next/navigation";
import { getCompany } from "@/lib/repository";
import { COLUMNS, getBuilds, type AgentRun, type Build, type Column } from "@/lib/builds";
import { getThread } from "@/lib/threads";
import { threadHrefOf } from "@/lib/brief";
import { dateLabel } from "@/lib/model";
import { parseHub } from "@/lib/hub";
import { BriefView } from "@/components/brief";
import { Fold, Meta, PageHeader, Said, Source, StageIcon, State, Stats, Tabs, type Tone } from "@/components/ds";
import { isGenerated } from "@/lib/voice";
import { retryClock } from "@/lib/retry-clock";
import { AgentControls, LiveRefresh, MenuDismiss, NewBuild, OpenProject, RunButton, ShapeEpic, StopAll } from "@/components/build";
import "@/styles/board.css";

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ thread?: string; open?: string; view?: string }>;
};

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  return { title: `Board · ${(await getCompany(slug))?.name || slug}` };
}

const stageLabels: Record<Column, string> = {
  proposed: "Proposed",
  ready: "Ready",
  working: "Working",
  review: "Review",
  done: "Done",
};

// The epic's status as a state word: amber only when it waits on the owner.
const epicStatus: Record<string, [string, Tone]> = {
  planning: ["Planning", "agent"],
  proposed: ["Needs approval", "attention"],
  approved: ["Approved", "accent"],
  running: ["Running", "ok"],
  reviewing: ["Reviewing", "agent"],
  review: ["Needs review", "attention"],
  failed: ["Failed", "risk"],
  waiting: ["Limit reached", "idle"], // a subtask hit the usage limit; converse.py retry resumes it
};
const EpicState = ({ b }: { b: Build }) => {
  const [label, tone] = epicStatus[b.status] || [b.status, "idle" as Tone];
  return <State tone={tone}>{label}</State>;
};

const runTones: Record<string, Tone> = {
  running: "ok",
  done: "attention",
  failed: "risk",
  merged: "ok",
  stopped: "idle",
  discarded: "idle",
  "not started": "idle",
};
const runLabels: Record<string, string> = { done: "To review", running: "Running", failed: "Failed", stopped: "Stopped", merged: "Merged", discarded: "Discarded" };
const runLabel = (r: AgentRun) =>
  r.status === "not started"
    ? stageLabels[r.column]
    : r.status === "waiting"
      ? `Limit reached · retrying at ${retryClock(r.retryAt)}`
      : runLabels[r.status] || r.status;
const RunState = ({ r }: { r: AgentRun }) => <State tone={runTones[r.status] || "idle"}>{runLabel(r)}</State>;

// Where things link: an epic (and optionally one of its subtasks) opens in the panel on the right.
const hrefOf = (view: string, id: string, n?: string) =>
  `?${view === "subtasks" ? "view=subtasks&" : ""}open=${id}${n ? `.${n}` : ""}#detail`;

// A short plain name for an epic. The COO's plan title when it wrote one; otherwise b.title is the owner's own first line,
// so take its first few words (their whole ask is shown verbatim under the name).
const squash = (s: string) => s.toLowerCase().replace(/\W+/g, " ").trim();
function shortTitle(b: Build): string {
  const goal = b.goal.trim();
  if (b.title && !squash(goal).startsWith(squash(b.title).slice(0, 40))) return b.title;
  const first = (b.title || goal).split(/(?<=[.!?])\s|\n/)[0].trim();
  let out = first;
  if (first.length > 48) {
    out = first.slice(0, 46);
    out = `${out.slice(0, out.lastIndexOf(" ") > 20 ? out.lastIndexOf(" ") : out.length).replace(/[,;:]$/, "")}…`;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function Progress({ b }: { b: Build }) {
  const done = b.runs.filter((r) => r.column === "done").length;
  return (
    <span className="bd-prog" aria-label={`${done} of ${b.runs.length} subtasks done`}>
      <span className="bd-prog-bar">
        {b.runs.map((r) => (
          <i key={r.n} className={`p-${r.column}${r.live ? " is-live" : ""}`} />
        ))}
      </span>
      <span className="mono">
        {done}/{b.runs.length}
      </span>
    </span>
  );
}

// The epic on the board: it moves column to column; its subtasks are listed inside it. The card opens the panel.
function EpicCard({ b, view, open }: { b: Build; view: string; open: boolean }) {
  return (
    <li className={`bd-card${open ? " is-open" : ""}${b.live ? " is-live" : ""}`}>
      <Link href={hrefOf(view, b.id)} scroll={false} className="bd-card-main" title={b.goal.trim()}>
        <span className="bd-card-title">{shortTitle(b)}</span>
        <span className="bd-card-top">
          <EpicState b={b} />
          {b.kind === "task" && <span className="bd-kind">Task</span>}
        </span>
      </Link>
      {view !== "subtasks" && b.runs.length > 1 && (
        <ol className="bd-checklist">
          {b.runs.map((r) => (
            <li key={r.n} className={r.column === "done" ? "is-done" : ""}>
              <Link href={hrefOf(view, b.id, r.n)} scroll={false}>
                <StageIcon stage={r.column} live={r.live} />
                <span className="bd-n mono">{r.n}</span>
                <span className="bd-ellipsis">{r.title}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {b.runs.length > 1 && (
        <span className="bd-card-foot">
          <Progress b={b} />
        </span>
      )}
    </li>
  );
}

// A subtask as its own card (Epics + subtasks view), under its epic's name.
function SubCard({ b, r, view, open }: { b: Build; r: AgentRun; view: string; open: boolean }) {
  return (
    <li className={`bd-card bd-sub${open ? " is-open" : ""}${r.live ? " is-live" : ""}`}>
      <Link href={hrefOf(view, b.id, r.n)} scroll={false} className="bd-card-main">
        <span className="bd-sub-title">
          <StageIcon stage={r.column} live={r.live} />
          <span className="bd-n mono">{r.n}</span>
          <span>{r.title}</span>
        </span>
        <span className="bd-sub-epic bd-ellipsis">{shortTitle(b)}</span>
      </Link>
      <span className="bd-card-foot">
        <RunState r={r} />
        <Meta
          items={[
            r.needs.length > 0 && `needs ${r.needs.join(", ")}`,
            r.commits > 0 && (
              <span key="c">
                {r.commits} commit{r.commits === 1 ? "" : "s"}
              </span>
            ),
          ]}
        />
      </span>
    </li>
  );
}

// What the agent did, newest last. Its final message is the report, shown on its own, so it isn't repeated here.
function Feed({ r }: { r: AgentRun }) {
  const head = r.report.slice(0, 80);
  const events = r.events.filter((e) => e.kind !== "result" && !(e.kind === "text" && head && e.text.startsWith(head)));
  if (!events.length) return <p className="bd-quiet">Nothing yet</p>;
  return (
    <ol className="bd-feed" aria-label="What the agent did, newest last">
      {events.map((e, i) => (
        <li key={i} className={`ev-${e.kind}`}>
          {e.kind === "tool" ? (
            <>
              <b>{e.text}</b>
              <span className="code-text" title={e.detail}>
                {e.detail}
              </span>
            </>
          ) : e.kind === "prompt" ? (
            <>
              <b className="bd-feed-you">You</b>
              <span>{e.text.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 200)}</span>
            </>
          ) : (
            <span>{e.text}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

// A titled block inside the panel; its source sits beside the title.
function Block({ title, source, children }: { title: string; source?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bd-block">
      <header>
        <h3>{title}</h3>
        {source}
      </header>
      {children}
    </section>
  );
}

// A message the owner sent the agent. A mockup hub's answer sheet is folded and read as questions and answers; the notes
// in it are their own typing, so they keep their serif. Other tool-written messages are marked Automatic.
function Message({ text, at }: { text: string; at: string }) {
  const hub = parseHub(text);
  if (!hub) return <Said text={text} date={at.slice(0, 10)} auto={isGenerated(text)} />;
  return (
    <Fold
      summary={
        <>
          Mockup answers
          <Source who="auto" date={at.slice(0, 10)} />
        </>
      }
    >
      <ol className="bd-hub" aria-label={hub.title || "Mockup answers"}>
        {hub.answers.map((a) => (
          <li key={a.key}>
            <p className="bd-hub-q">{a.question || a.key}</p>
            <p className="bd-hub-a">{a.choice === "-" ? <span className="bd-quiet">No option chosen</span> : a.label}</p>
            {a.note && <blockquote className="bd-hub-note">{a.note}</blockquote>}
          </li>
        ))}
      </ol>
      {hub.path && <p className="bd-hub-path code-text">{hub.path}</p>}
    </Fold>
  );
}

// One subtask's agent: figures, branch, the warning, what the owner sent it, its report, then the detail folded.
function AgentPane({ b, r }: { b: Build; r: AgentRun }) {
  const path = `companies/${b.slug}/builds/${b.id}`;
  const steps = r.events.filter((e) => e.kind === "tool").length;
  const changed = r.diffStat.split("\n").at(-1)?.trim();
  return (
    <div className="bd-pane">
      <div className="bd-pane-head">
        <h3>
          <span className="bd-n mono">{r.n}</span>
          {r.title}
        </h3>
        <span className="bd-pane-state">
          {r.live && <i className="pulse-dot" />}
          <RunState r={r} />
        </span>
      </div>
      <div className="bd-facts">
        <Stats
          size="sm"
          items={[
            { label: "Commits", value: r.commits },
            { label: "Steps", value: steps },
            { label: "Cost", value: r.costUsd ? `$${r.costUsd.toFixed(2)}` : "–" },
            r.needs.length > 0 && { label: "Needs", value: r.needs.join(", ") },
            r.branch && {
              label: "Branch",
              wide: true,
              code: true,
              value: (
                <>
                  {r.branch}
                  {r.stackedOn && <span className="bd-quiet"> on {r.stackedOn}</span>}
                </>
              ),
            },
          ]}
        />
        {r.dirty && !r.live && (
          <p className="bd-warn">
            <State tone="attention">{r.commits ? "Uncommitted changes won't merge" : "Nothing committed yet"}</State>
          </p>
        )}
      </div>
      {r.messages.length > 0 && (
        <Block title="Your messages" source={<span className="bd-count mono">{r.messages.length}</span>}>
          <div className="bd-messages">
            {r.messages.map((m, i) => (
              <Message key={i} text={m.text} at={m.at} />
            ))}
          </div>
        </Block>
      )}
      {r.report && !r.live && (
        <Block title="Report" source={<Source who="agent" />}>
          <BriefView body={r.report} path={path} lead={false} />
        </Block>
      )}
      <div className="bd-folds">
        {r.diffStat && (
          <Fold summary={<>Changes{changed && <span className="bd-quiet"> · {changed}</span>}</>}>
            <pre className="bd-pre">{r.diffStat}</pre>
            {r.log.length > 0 && (
              <ul className="bd-log">
                {r.log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </Fold>
        )}
        <Fold open={r.live} summary={<>Activity<span className="bd-quiet"> · {steps} steps</span></>}>
          <Feed r={r} />
        </Fold>
        <Fold summary="Brief">
          <BriefView body={r.brief} path={path} lead={false} />
        </Fold>
      </div>
    </div>
  );
}

// Where the epic is, as a five-step track.
function Track({ stage }: { stage: Column }) {
  const at = COLUMNS.indexOf(stage);
  return (
    <ol className="bd-track" aria-label="Where this epic is">
      {COLUMNS.map((c, i) => (
        <li key={c} className={i < at ? "past" : i === at ? `now st-${c}` : ""}>
          <i />
          <span>{stageLabels[c]}</span>
        </li>
      ))}
    </ol>
  );
}

function EpicDetail({ b, openN, view }: { b: Build; openN?: string; view: string }) {
  const ready = b.runs.filter((r) => r.column === "ready");
  const selected = b.runs.find((r) => r.n === openN);
  const shaping = b.kind === "epic" && !b.approved && !b.live && b.status !== "planning" && b.runs.length > 0;
  const canRun = b.approved && !b.live && ready.length > 0;
  const path = `companies/${b.slug}/builds/${b.id}`;
  const commits = b.runs.reduce((n, r) => n + r.commits, 0);
  const order = b.runs.length > 1 && (b.mode === "sequence" ? ", in order" : b.mode === "parallel" ? ", side by side" : "");
  const overviewActions = shaping || canRun || b.live;
  return (
    <section className={`bd-panel${b.live ? " is-live" : ""}`} id="detail" aria-label="The open epic">
      <header className="bd-panel-head">
        <div className="bd-panel-kicker">
          <Meta
            items={[
              <span key="k" className="bd-kind">
                {b.kind === "task" ? "Task" : "Epic"}
              </span>,
              dateLabel(b.created.slice(0, 10)),
              b.runs.length > 0 && `${b.runs.length} subtask${b.runs.length === 1 ? "" : "s"}${order || ""}`,
              b.thread && (
                <Link key="t" href={threadHrefOf(b.thread)}>
                  Thread
                </Link>
              ),
            ]}
          />
          <Link href={view === "subtasks" ? "?view=subtasks" : "?"} scroll={false} className="bd-close" aria-label="Close">
            <X size={16} />
          </Link>
        </div>
        <h2>{shortTitle(b)}</h2>
        <div className="bd-words">
          <Said text={b.goal.trim()} date={b.created.slice(0, 10)} />
          {b.directions.map((d, i) => (
            <Said key={i} text={d.text} date={d.at.slice(0, 10)} where="Direction" />
          ))}
        </div>
        <Track stage={b.stage} />
      </header>

      <Tabs
        label="Epic and its agents"
        scroll={false}
        items={[
          { href: hrefOf(view, b.id), label: "Overview", current: !selected },
          ...b.runs.map((r) => ({
            href: hrefOf(view, b.id, r.n),
            current: selected?.n === r.n,
            title: r.title,
            label: (
              <>
                <StageIcon stage={r.column} live={r.live} />
                <span className="mono">{r.n}</span>
                <span>{r.title}</span>
              </>
            ),
          })),
        ]}
      />

      <div className="bd-panel-body">
        {selected ? (
          <AgentPane b={b} r={selected} />
        ) : (
          <div className="bd-pane">
            <Stats
              size="sm"
              items={[
                {
                  label: "Status",
                  value: (
                    <>
                      {b.live && <i className="pulse-dot" />}
                      <EpicState b={b} />
                    </>
                  ),
                },
                b.runs.length > 0 && { label: "Subtasks", value: <Progress b={b} /> },
                { label: "Commits", value: commits },
              ]}
            />
            {b.error && <p className="bd-warn tone-risk">{b.error}</p>}
            {b.review && (
              <Block title="Review" source={<Source who="agent" label="COO" />}>
                <BriefView body={b.review} path={`${path}/review.md`} lead={false} />
              </Block>
            )}
            {b.plan && b.kind === "epic" && (
              <div className="bd-folds">
                <Fold open={!b.approved} summary={<>Plan<span className="bd-quiet"> · COO</span></>}>
                  <BriefView body={b.plan} path={`${path}/plan.md`} lead={false} />
                </Fold>
              </div>
            )}
          </div>
        )}
      </div>

      {selected && selected.status !== "not started" && (
        <footer className="bd-panel-foot">
          <AgentControls
            key={`${b.id}.${selected.n}`}
            commits={selected.commits}
            slug={b.slug}
            build={b.id}
            brief={selected.n}
            live={selected.live}
            status={selected.status}
            canMerge={selected.commits > 0 && !selected.dirty}
            dirty={selected.dirty}
          />
        </footer>
      )}
      {!selected && overviewActions && (
        <footer className="bd-panel-foot">
          {shaping ? (
            <ShapeEpic slug={b.slug} build={b.id} />
          ) : (
            <div className="bd-actionrow">
              {b.live && <StopAll slug={b.slug} build={b.id} />}
              {canRun && ready.length > 1 && (
                <>
                  <RunButton slug={b.slug} build={b.id} mode="sequence" label={`Run ${ready.length} in order`} primary />
                  <RunButton slug={b.slug} build={b.id} mode="parallel" label="All at once" />
                </>
              )}
              {canRun && ready.length === 1 && <RunButton slug={b.slug} build={b.id} brief={ready[0].n} label={`Run ${ready[0].n}`} primary />}
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

export default async function BuildPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const { thread: threadParam, open, view: viewParam } = await searchParams;
  const view = viewParam === "subtasks" ? "subtasks" : "epics";
  const company = await getCompany(slug);
  if (!company) notFound();
  const builds = await getBuilds(slug);
  const m = threadParam?.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/);
  const from = m ? await getThread(m[1], m[2]) : undefined;
  const [openId, openN] = (open || "").split(".");
  const opened = builds.find((b) => b.id === openId);
  const runs = builds.flatMap((b) => b.runs);
  const waiting = builds.filter((b) => b.status === "review" || (b.status === "proposed" && !b.approved)).length;
  const running = runs.filter((r) => r.live).length;

  return (
    <div className={`bd-page${opened ? " has-open" : ""}`}>
      <LiveRefresh live={builds.some((b) => b.live)} />
      <MenuDismiss />
      <PageHeader
        kicker={company.name}
        title="Board"
        meta={[
          <span key="e">{`${builds.length} epic${builds.length === 1 ? "" : "s"}`}</span>,
          <span key="s">{`${runs.length} subtask${runs.length === 1 ? "" : "s"}`}</span>,
          waiting > 0 && (
            <span key="w" className="warn">
              {waiting} waiting on you
            </span>
          ),
          running > 0 && `${running} running`,
        ]}
        actions={<OpenProject slug={slug} />}
      />

      <div className="bd-bar">
        <NewBuild
          key={from?.path || "new"}
          slug={slug}
          thread={from ? from.path : ""}
          goal={from ? `${from.decision || from.title}\n\nFrom the thread “${from.title}”: ${from.summary}` : ""}
        />
        <nav className="bd-seg bd-view" aria-label="Board view">
          <Link href={`?${openId ? `open=${open}` : ""}`} scroll={false} className={view === "epics" ? "on" : ""}>
            Epics
          </Link>
          <Link href={`?view=subtasks${openId ? `&open=${open}` : ""}`} scroll={false} className={view === "subtasks" ? "on" : ""}>
            Epics + subtasks
          </Link>
        </nav>
      </div>

      <div className="bd-split">
        <div className="bd-board">
          <div className={`bd-kanban${builds.length ? "" : " is-blank"}`}>
            {COLUMNS.map((c) => {
              const epics = builds.filter((b) => b.stage === c);
              const subs = view === "subtasks" ? builds.flatMap((b) => b.runs.filter((r) => r.column === c).map((r) => ({ b, r }))) : [];
              const n = epics.length + subs.length;
              return (
                <section key={c} className={`bd-col${n ? "" : " is-empty"}`} aria-label={stageLabels[c]}>
                  <h3 className="bd-col-head">
                    <StageIcon stage={c} />
                    {stageLabels[c]}
                    {n > 0 && <span className="mono">{n}</span>}
                  </h3>
                  <ol className="bd-col-list">
                    {!builds.length && c === "proposed" && <li className="bd-col-none">Nothing yet</li>}
                    {epics.map((b) => (
                      <EpicCard key={b.id} b={b} view={view} open={b.id === openId && !openN} />
                    ))}
                    {subs.map(({ b, r }) => (
                      <SubCard key={`${b.id}.${r.n}`} b={b} r={r} view={view} open={b.id === openId && r.n === openN} />
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        </div>
        {opened && (
          <aside className="bd-detail">
            <EpicDetail b={opened} openN={openN} view={view} />
          </aside>
        )}
      </div>
    </div>
  );
}
