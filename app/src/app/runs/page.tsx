import Link from "next/link";
import { CircleCheck, CircleX, Hourglass, LoaderCircle } from "lucide-react";
import { getCompanies } from "@/lib/repository";
import { getThreads, threadHref } from "@/lib/threads";
import { getRuns, getSchedule, getStartLogs } from "@/lib/runs";
import { getPulse } from "@/lib/pulse";
import { Empty, Fold, KV, PageHeader, Row, Rows, Section, Split, State, Stats } from "@/components/ds";
import { AutoRefresh, CheckinButton, Ticker } from "@/components/run-status";
import "@/styles/more.css";

export const metadata = { title: "Runs" };

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function Runs() {
  const [threads, runs, schedule, starts, companies, pulse] = await Promise.all([
    getThreads(),
    getRuns(),
    getSchedule(),
    getStartLogs(),
    getCompanies(),
    getPulse(),
  ]);
  const name = (scope: string) => companies.find((c) => c.id === scope)?.name || "Parent company";
  const working = threads.filter((t) => t.running?.alive);
  const stalled = threads.filter((t) => t.running && !t.running.alive);
  const awaiting = new Set(threads.filter((t) => t.checkin && t.status !== "decided" && t.status !== "closed").map((t) => t.scope));
  const due = Object.values(pulse).filter((p) => {
    if (awaiting.has(p.slug)) return false; // its check-in is already open
    const c = companies.find((x) => x.id === p.slug) as Record<string, unknown> | undefined;
    const release = (c?.release || {}) as Record<string, string | null>;
    return !release.last_check || (release.next_check && release.next_check <= new Date().toISOString().slice(0, 10)) || p.unread >= 3;
  });
  const today = runs.filter((r) => r.started.slice(0, 10) === new Date().toISOString().slice(0, 10));
  const failedToday = today.filter((r) => !r.ok && !r.limit).length; // a limit hit is queued, not failed
  return (
    <>
      <AutoRefresh active={working.length > 0} every={5000} />
      <PageHeader
        title="Runs"
        meta={[working.length ? `${working.length} running` : "nothing running", stalled.length > 0 && <span className="warn">{stalled.length} stopped</span>]}
        actions={<CheckinButton slug="due" label="Check in all due" />}
      />
      <Stats
        items={[
          { value: working.length, label: "Running" },
          { value: today.length, label: "Turns today" },
          { value: failedToday, label: "Failed today", tone: failedToday ? "attention" : undefined },
          { value: due.length, label: "Due" },
          { value: awaiting.size, label: "Waiting on you", tone: awaiting.size ? "attention" : undefined, href: "/decisions" },
        ]}
      />
      <Split
        rail={
          <>
            <Section title="Check-ins" action={<State tone={schedule.on ? "ok" : "idle"}>{schedule.on ? "On · 7:30" : "Off"}</State>}>
              <KV
                items={[
                  [`Turn ${schedule.on ? "off" : "on"}`, `master schedule ${schedule.on ? "off" : "on"}`, "code-text"],
                  [
                    "Due",
                    due.length
                      ? due.map((p, i) => (
                          <span key={p.slug}>
                            {i ? ", " : ""}
                            <Link href={`/companies/${p.slug}`}>{name(p.slug)}</Link>
                          </span>
                        ))
                      : "None",
                  ],
                ]}
              />
              {schedule.log.length > 0 && (
                <div className="runs-fold">
                  <Fold summary="Log">
                    <pre className="log-tail">{schedule.log.join("\n")}</pre>
                  </Fold>
                </div>
              )}
            </Section>
            <Section title="App runs" note={starts.length || undefined}>
              {starts.length ? (
                <div className="runs-logs">
                  {starts.map((s) => (
                    <Fold key={s.name} summary={<span className="code-text">{s.name.replace(/\.log$/, "")}</span>}>
                      <pre className="log-tail">{s.lines.join("\n") || "(no output yet)"}</pre>
                    </Fold>
                  ))}
                </div>
              ) : (
                <p className="rail-text faint">None</p>
              )}
              <p className="path-note">~/Library/Logs/master-repo/app-runs</p>
            </Section>
          </>
        }
      >
        <Section title="Running" note={working.length + stalled.length || undefined}>
          {working.length || stalled.length ? (
            <Rows>
              {[...working, ...stalled].map((t) => (
                <Row
                  key={t.path}
                  href={threadHref(t)}
                  tone={t.running!.alive ? undefined : "risk"}
                  lead={t.running!.alive ? <LoaderCircle size={15} className="spin run-ok" /> : <CircleX size={15} className="run-bad" />}
                  title={t.title}
                  meta={[t.running!.role.toUpperCase(), name(t.scope), t.running!.model]}
                  trail={<span className="mono">{t.running!.alive ? <Ticker since={t.running!.since} /> : "stopped"}</span>}
                />
              ))}
            </Rows>
          ) : (
            <Empty>Nothing running</Empty>
          )}
        </Section>
        <Section title="Turns" note={runs.length ? `last ${Math.min(30, runs.length)}` : undefined}>
          {runs.length ? (
            <div className="turns">
              <div className="turn turn-head" aria-hidden>
                <span />
                <span>Role</span>
                <span>Where</span>
                <span>Started</span>
                <span>Took</span>
                <span>Model</span>
              </div>
              {runs.slice(0, 30).map((r, i) => (
                <Link
                  key={i}
                  href={r.thread ? `/threads/${r.scope}/${r.thread.split("/").pop()}` : `/companies/${r.scope}/screens`}
                  className={`turn ${r.ok || r.limit ? "" : "is-failed"}`}
                >
                  {r.ok ? (
                    <CircleCheck size={14} className="run-ok" />
                  ) : r.limit ? (
                    <Hourglass size={14} aria-label="Limit reached" />
                  ) : (
                    <CircleX size={14} className="run-bad" />
                  )}
                  <span>{r.role.toUpperCase()}</span>
                  <span className="turn-where">
                    {name(r.scope)}
                    {r.task === "screens-review" ? " · screen review" : ""}
                    {r.limit && r.retry_at && <small>Limit reached · queued for {time(r.retry_at)}</small>}
                    {!r.ok && !r.limit && r.error && <small>{r.error}</small>}
                  </span>
                  <span className="mono">{time(r.started)}</span>
                  <span className="mono">{r.seconds ?? "?"}s</span>
                  <span>{r.model}</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>No turns yet</Empty>
          )}
        </Section>
      </Split>
    </>
  );
}
