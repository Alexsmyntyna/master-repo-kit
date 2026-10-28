import { getDocument } from "@/lib/repository";
import { Markdown } from "@/components/markdown";
import { Fold, KV, PageHeader, Section, Split } from "@/components/ds";
import "@/styles/more.css";

export const metadata = { title: "Guide" };

// The guide in a few lines: how to open things, what to say, where it ends up. The tables come from
// guide/how-to-use.md, so the page stays in step with it; the whole guide is folded below.

const section = (md: string, heading: RegExp) => {
  const parts = md.split(/^## /m);
  return parts.find((p) => heading.test(p.split("\n")[0])) || "";
};
const tableRows = (md: string) =>
  md
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .slice(2)
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
const plain = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "");
const quotes = (s: string) =>
  plain(s)
    .split(/\s+\/\s+/)
    .map((q) => q.trim())
    .filter(Boolean);

// Inline code in a cell reads as a path; the rest as text.
function Cell({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? (
          <code key={i} className="code-text">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part.replace(/\*\*/g, "")}</span>
        ),
      )}
    </>
  );
}

export default async function Guide() {
  const doc = await getDocument("guide/how-to-use.md");
  const say = tableRows(section(doc.content, /^Talking/));
  const where = tableRows(section(doc.content, /^Where things live/));
  return (
    <>
      <PageHeader title="Guide" />
      <Split
        rail={
          <Section title="Locations">
            <KV className="guide-where" items={where.map(([what, path]) => [plain(what), <Cell key={what} text={path} />])} />
          </Section>
        }
      >
        <Section title="Start">
          <KV
            className="guide-start"
            items={[
              [
                "Open",
                <>
                  <code className="code-text">master</code> in a terminal, or <b>Master Repo</b> in ~/Applications
                </>,
              ],
              [
                "Talk",
                <>
                  <code className="code-text">cd ~/Documents/GitHub/Master-Repo &amp;&amp; claude</code> (or <code className="code-text">codex</code>)
                </>,
              ],
              [
                "Server",
                <>
                  <code className="code-text">master stop</code> · <code className="code-text">master status</code> ·{" "}
                  <code className="code-text">master logs</code> · <code className="code-text">master help</code>
                </>,
              ],
              ["Weekly", <>&ldquo;do the weekly check&rdquo;</>],
            ]}
          />
        </Section>
        <Section title="Phrases" note={say.length}>
          <div className="guide-say">
            <div className="guide-say-row guide-say-head" aria-hidden>
              <span>You say</span>
              <span>Skill</span>
              <span>Result</span>
            </div>
            {say.map(([said, skill, shows]) => (
              <div key={said} className="guide-say-row">
                <span className="guide-quote">
                  {quotes(said).map((q, i) =>
                    /^["“]/.test(q) ? (
                      <q key={i}>{q.replace(/^["“]|["”]$/g, "")}</q>
                    ) : (
                      <span key={i} className="guide-when">
                        {q}
                      </span>
                    ),
                  )}
                </span>
                <span className="code-text guide-skill">{plain(skill)}</span>
                <span className="guide-shows">
                  <Cell text={shows} />
                </span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Full guide">
          <Fold summary="Open">
            <Markdown content={doc.content.replace(/^#\s+.+\n*/, "")} path={doc.path} />
          </Fold>
        </Section>
      </Split>
    </>
  );
}
