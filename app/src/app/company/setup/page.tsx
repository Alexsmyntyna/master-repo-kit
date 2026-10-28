import { getSetup, ordered, setupCounts, waitingOn } from "@/lib/company";
import { holdingFileHref } from "@/lib/file-paths";
import { dateLabel } from "@/lib/model";
import { HOLDING, wikiHref } from "@/lib/wiki";
import { StepCheck } from "@/components/company";
import { Empty, Meta, More, PageHeader, Section, Source } from "@/components/ds";
import "@/styles/company.css";

export const metadata = { title: "Setup · Company" };

// The front that explains each group (holding/wiki/fronts/<file>.md).
const fronts: Record<string, [string, string]> = {
  name: ["name", "Name"],
  entity: ["entity", "Entity"],
  presence: ["public-presence", "Public presence"],
  stores: ["store-accounts", "Store accounts"],
};

// Where a step's source points: a public page (its host), a page in the app, or a repo/vault path as code.
function SourceRef({ source }: { source: string }) {
  if (!source) return null;
  if (/^https?:\/\//.test(source)) {
    const host = new URL(source).hostname.replace(/^www\./, "");
    return (
      <a href={source} target="_blank" rel="noreferrer" className="step-src">
        {host}
      </a>
    );
  }
  const first = source.split(";")[0].trim();
  const href = holdingFileHref(first) || (/^holding\/threads\/([a-z0-9-]+)/.exec(first) ? `/threads/holding/${first.split("/")[2]}` : undefined);
  return href ? (
    <a href={href} className="step-src code-text">
      {first}
    </a>
  ) : (
    <span className="step-src code-text">{source}</span>
  );
}

// holding/setup.json as a checklist: groups in order, a box per step that the owner ticks. A step an agent can do may
// also be recorded done by the agent, with the path to what it delivered (`done_by: agent`, `evidence`).
export default async function CompanySetup() {
  const setup = await getSetup();
  const counts = setupCounts(setup);
  return (
    <div className="company-setup">
      <PageHeader
        title="Setup"
        meta={[
          <span key="c">
            <span className="num">{counts.done}</span> of <span className="num">{counts.total}</span> done
          </span>,
          setup.updated && `updated ${dateLabel(setup.updated)}`,
          <span key="f" className="code-text">holding/setup.json</span>,
        ]}
      />
      {!setup.groups.length && <Empty>No steps yet</Empty>}
      {setup.groups.map((g) => {
        const done = g.steps.filter((s) => s.done).length;
        return (
          <Section
            key={g.id}
            id={`group-${g.id}`}
            title={g.title}
            note={`${done} of ${g.steps.length}`}
            action={fronts[g.id] && <More href={wikiHref(HOLDING, `fronts/${fronts[g.id][0]}`)}>{fronts[g.id][1]}</More>}
          >
            <div className="rows setup-rows">
              {ordered(g.steps).map((s) => {
                const waits = waitingOn(setup, s);
                return (
                  <div key={s.id} id={`step-${s.id}`} className={`row setup-step ${s.done ? "is-done" : ""}`}>
                    <span className="row-lead">
                      <StepCheck id={s.id} done={s.done} text={s.text} />
                    </span>
                    <span className="row-body">
                      <span className="row-title">{s.text}</span>
                      <Meta
                        items={[
                          s.who === "agent" ? <Source key="w" who="agent" label="An agent can do this" /> : <span key="w">You</span>,
                          !s.done && waits.length > 0 && (
                            <span key="b" className="step-blocked">
                              after {waits.map((w) => w.text.charAt(0).toLowerCase() + w.text.slice(1)).join("; ")}
                            </span>
                          ),
                          s.done && s.done_by === "agent" ? (
                            <span key="d" className="step-by-agent">
                              done · agent · {s.evidence ? <SourceRef source={s.evidence} /> : "no evidence"}
                            </span>
                          ) : (
                            s.done && s.done_on && `done ${dateLabel(s.done_on)}`
                          ),
                          s.note,
                          <SourceRef key="s" source={s.source} />,
                        ]}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
