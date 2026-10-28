import Link from "next/link";
import { DataTable, PageHeader, Row, Rows, Section } from "@/components/ds";
import { getCodebases } from "@/lib/codebases";
import { recordOf } from "@/lib/model";
import { getQueue, getSkills, readJson } from "@/lib/repository";
import { getRetries, retryWaiterAlive, type Retry } from "@/lib/runs";
import { getAllScreens } from "@/lib/screens";
import { ensureRetryWaiter } from "@/lib/spawn";
import { getThreads } from "@/lib/threads";
import { threadHrefOf } from "@/lib/brief";
import { systemPages } from "@/lib/system";

export const metadata = { title: "System" };

const count = (n: number, word: string) => `${n} ${word}`;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "?"
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
// A queued thread links to its page; a Board subtask to its card on the project's Board.
function hrefOf(r: Retry): string {
  const build = r.thread.match(/^companies\/([a-z0-9-]+)\/builds\/([a-z0-9-]+)$/);
  if (build) return `/companies/${build[1]}/build?open=${build[2]}${r.brief ? `.${r.brief}` : ""}#detail`;
  return threadHrefOf(r.thread);
}

export default async function System() {
  const [codebases, queue, threads, screens, skills, lessons, retries, waiter] = await Promise.all([
    getCodebases(),
    getQueue(),
    getThreads(),
    getAllScreens(),
    getSkills(),
    readJson("identity/lessons.json"),
    getRetries(),
    ensureRetryWaiter().then(retryWaiterAlive),
  ]);
  const lessonList = recordOf(lessons).lessons;
  const running = threads.filter((t) => t.running?.alive).length;
  const titles = Object.fromEntries(threads.map((t) => [t.path, t.title]));
  const facts: Record<string, string[]> = {
    "/codebases": [count(codebases.codebases.length, "repos")],
    "/queue": [
      count(queue.filter((q) => ["open", "in_progress", "in-progress"].includes(String(q.meta.status || "open"))).length, "open"),
    ],
    "/runs": [running ? count(running, "running") : "none running", ...(retries.length ? [count(retries.length, "waiting on a limit")] : [])],
    "/screens": [count(screens.filter((s) => s.screens).length, "mapped")],
    "/skills": [count(skills.length, "skills")],
    "/identity": Array.isArray(lessonList) ? [count(lessonList.length, "lessons")] : [],
  };
  return (
    <>
      <PageHeader title="System" />
      <Rows>
        {systemPages.map((p) => (
          <Row
            key={p.href}
            href={p.href}
            lead={<p.icon size={16} aria-hidden />}
            title={p.title}
            detail={p.detail}
            trail={facts[p.href] && <span className="mono">{facts[p.href].join(" · ")}</span>}
          />
        ))}
      </Rows>
      {retries.length > 0 && (
        <Section title="Waiting on a limit" note={waiter ? "waiter running" : "waiter starting"}>
          <DataTable>
            <thead>
              <tr>
                <th>Thread</th>
                <th>Role</th>
                <th>Retry at</th>
                <th className="num">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {retries.map((r) => (
                <tr key={`${r.thread}#${r.brief || ""}`}>
                  <td>
                    <Link href={hrefOf(r) || "#"}>
                      {titles[r.thread] || r.thread.split("/").pop()}
                      {r.brief ? ` · subtask ${r.brief}` : ""}
                    </Link>
                  </td>
                  <td>{r.role.toUpperCase()}</td>
                  <td className="mono">{when(r.retryAt)}</td>
                  <td className="num mono">{r.attempts}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>
      )}
    </>
  );
}
