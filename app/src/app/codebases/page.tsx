import Link from "next/link";
import { FourWeekRun } from "@/components/activity";
import { BriefView } from "@/components/brief";
import { CodebaseTable, type CodebaseItem } from "@/components/codebase-table";
import { Fold, KV, PageHeader, Statement, Stats } from "@/components/ds";
import { getCodebases, verdictLabels, verdictOrder, type Codebase } from "@/lib/codebases";
import { getCompanies } from "@/lib/repository";
import { dateLabel } from "@/lib/model";
import "@/styles/more.css";

export const metadata = { title: "Codebases" };

const kindLabels: Record<string, string> = { own: "yours", fork: "fork", folder: "no git", clone: "clone" };

// What opens under a row: the summary in its source's voice, what it informs, its recent run, the agent's note.
function Detail({ cb, names }: { cb: Codebase; names: Record<string, string> }) {
  return (
    <div className="cbd">
      <div className="cbd-main">
        {cb.note?.summary ? (
          <Statement label="Summary" value={{ text: cb.note.summary, source: "agent" }} />
        ) : cb.readme ? (
          <Statement label="README" value={{ text: cb.readme, source: "code" }} />
        ) : (
          <p className="faint">No README or note</p>
        )}
        {cb.note?.learn && <Statement label="Learn" value={{ text: cb.note.learn, source: "agent" }} />}
        {cb.note?.body && (
          <Fold summary="Full note">
            <BriefView body={cb.note.body} path={cb.note.path} />
          </Fold>
        )}
      </div>
      <KV
        className="cbd-facts"
        items={[
          cb.project && ["Project", <Link key="p" href={`/companies/${cb.project}`}>{names[cb.project] || cb.project}</Link>],
          !!cb.note?.related.length && [
            "Informs",
            cb.note.related.map((r, i) => (
              <span key={r}>
                {i ? ", " : ""}
                {names[r] ? <Link href={`/companies/${r}`}>{names[r]}</Link> : r}
              </span>
            )),
          ],
          [
            "Commits",
            `${cb.commits ? `${cb.commits}${cb.mine && cb.mine !== cb.commits ? ` (${cb.mine} yours)` : ""}` : "none"}${cb.first ? ` · since ${dateLabel(cb.first)}` : ""}`,
            "mono",
          ],
          ["Files", cb.files, "mono"],
          ["Path", cb.path.replace(/^\/Users\/[^/]+/, "~"), "code-text"],
          cb.kind !== "clone" && !!cb.last && ["Four weeks", <FourWeekRun key="r" a={cb.activity} compact />],
        ]}
      />
    </div>
  );
}

export default async function CodebasesPage() {
  const [{ generated, codebases }, companies] = await Promise.all([getCodebases(), getCompanies()]);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  const group = (c: Codebase): CodebaseItem["group"] => (c.project ? "project" : c.kind === "clone" ? "clone" : "mine");
  const items: CodebaseItem[] = codebases.map((cb) => ({
    slug: cb.slug,
    name: cb.name,
    group: group(cb),
    kind: kindLabels[cb.kind] || cb.kind,
    languages: cb.languages,
    last: cb.last,
    lastLabel: cb.last ? dateLabel(cb.last) : "",
    commits: cb.commits,
    verdict: cb.note?.verdict || "",
    verdictLabel: verdictLabels[cb.note?.verdict || ""],
    learn: cb.note?.learn || "",
    summary: cb.note?.summary || cb.readme || "",
    activity: cb.activity.total,
    detail: <Detail cb={cb} names={names} />,
  }));
  const mine = items.filter((i) => i.group === "mine");
  const count = (v: string) => mine.filter((i) => i.verdict === v).length;
  return (
    <>
      <PageHeader
        title="Codebases"
        meta={[
          <span key="p" className="code-text">
            ~/Documents/GitHub
          </span>,
          generated && `scanned ${dateLabel(generated.slice(0, 10))}`,
          `${codebases.length} repos`,
        ]}
      />
      <Stats
        items={[
          { value: mine.length, label: "Yours" },
          { value: count("revive"), label: verdictLabels.revive },
          { value: count("parts"), label: verdictLabels.parts },
          { value: count(""), label: verdictLabels[""] },
        ]}
      />
      <CodebaseTable items={items} verdicts={verdictOrder.map((v) => [v, verdictLabels[v]])} />
      <p className="path-note">python3 tools/codebases.py scan · notes in holding/codebases/</p>
    </>
  );
}
