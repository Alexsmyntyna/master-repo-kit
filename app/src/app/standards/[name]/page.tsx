import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Empty, More, PageHeader } from "@/components/ds";
import { Provenance } from "@/components/provenance";
import { parseLedger, type LedgerRule } from "@/lib/ledger";
import { getStandards } from "@/lib/repository";
import { dateLabel } from "@/lib/model";
import "@/styles/more.css";

const find = async (name: string, file?: string) =>
  /^[a-z0-9-]+$/i.test(name) ? (await getStandards()).find((s) => s.path === (file || `standards/${name}.md`)) : undefined;
type Props = { params: Promise<{ name: string }>; searchParams: Promise<{ file?: string }> };

export async function generateMetadata({ params, searchParams }: Props) {
  const s = await find((await params).name, (await searchParams).file);
  return { title: s?.title || "Standard not found" };
}

export default async function StandardPage({ params, searchParams }: Props) {
  const s = await find((await params).name, (await searchParams).file);
  if (!s) notFound();
  return (
    <article className="doc-page">
      <PageHeader
        kicker={<More href="/standards">Standards</More>}
        title={s.title}
        meta={[<span key="p" className="code-text">{s.path}</span>, s.meta.updated ? `updated ${dateLabel(s.meta.updated)}` : null]}
      />
      <Ledger content={s.content.replace(/^# .*\n+/, "")} path={s.path} />
    </article>
  );
}

// Inline code and strikes inside a rule line; the rest is plain text.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|~~[^~]+~~)/).map((part, i) =>
        part.startsWith("`") ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : part.startsWith("~~") ? (
          <s key={i}>{part.slice(2, -2)}</s>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Rule({ rule }: { rule: LedgerRule }) {
  return (
    <li className={`ledger-rule${rule.struck ? " is-struck" : ""}`}>
      <span className="ledger-text">
        <Inline text={rule.text} />
      </span>
      <span className="ledger-src">
        {rule.who ? <Provenance who={rule.who} date={rule.date} cite={rule.ref} /> : <span className="faint">no source</span>}
        {rule.ref && <span className="ledger-ref">{rule.ref}</span>}
      </span>
    </li>
  );
}

// Rule lines as a ledger: the rule, then a small source tag with its date and where it came from.
function Ledger({ content, path }: { content: string; path: string }) {
  const blocks = parseLedger(content);
  if (!blocks.length) return <Empty>No rules yet</Empty>;
  return (
    <div className="ledger">
      {blocks.map((b, i) =>
        b.type === "heading" ? (
          <h2 key={i} className="ledger-head">
            {b.text}
          </h2>
        ) : b.type === "rules" ? (
          <ol key={i} className="ledger-rules">
            {b.rules.map((r, j) => (
              <Rule key={j} rule={r} />
            ))}
          </ol>
        ) : (
          <Markdown key={i} content={b.content} path={path} />
        ),
      )}
    </div>
  );
}
