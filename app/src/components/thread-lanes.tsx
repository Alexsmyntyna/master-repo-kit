import Link from "next/link";
import type { Lane, Message } from "@/lib/threads";
import { BriefView } from "@/components/brief";
import { Markdown } from "@/components/markdown";
import { AutoRefresh } from "@/components/run-status";
import "@/styles/thread-lanes.css";

const labels: Record<Lane["status"], string> = {
  queued: "Queued", running: "Working", done: "Done", failed: "Failed", limited: "Waiting for usage reset",
};

export function Lanes({ lanes, messages, names }: { lanes: Lane[]; messages: Message[]; names: Record<string, string> }) {
  if (!lanes.length) return null;
  const active = lanes.some((lane) => ["queued", "running", "limited"].includes(lane.status));
  return (
    <section className="thread-lanes" aria-label="Project investigations">
      <AutoRefresh active={active} />
      <h2>Project investigations</h2>
      <div className="thread-lanes-grid">
        {lanes.map((lane) => {
          const reports = messages.map((message, i) => ({ message, n: i + 1 })).filter(({ message }) => message.lane === lane.slug && (!message.run_id || !lane.run_id || message.run_id === lane.run_id));
          const report = reports.at(-1);
          // A finished report reads in full below; the card keeps its opening paragraph. Errors and limits show whole.
          const lead = lane.result && report && lane.status === "done" ? lane.result.split(/\n\s*\n/)[0] : lane.result;
          const working = ["queued", "running"].includes(lane.status);
          return (
            <article key={lane.slug} className={`thread-lane is-${lane.status}`}>
              <header>
                <Link href={`/companies/${lane.slug}`}>{names[lane.slug] || lane.slug}</Link>
                <span role="status">{labels[lane.status]}</span>
              </header>
              <p className="muted">{lane.role.toUpperCase()} · {lane.repo ? "Local code available" : "Wiki only · no local repo"}</p>
              {working && lane.steps.length > 0 && <ol aria-label="Recent activity">{lane.steps.slice(-6).map((step, i) => <li key={i}>{step}</li>)}</ol>}
              {lead && <div className="thread-lane-result"><Markdown content={lead} path={report?.message.path ?? ""} /></div>}
              {report && (
                <details id={`m${report.n}`}>
                  <summary>Full COO report · #{report.n}</summary>
                  <BriefView body={report.message.body} path={report.message.path} lead={false} />
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
