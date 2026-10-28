import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Markdown } from "@/components/markdown";
import { parseBrief, type Block, type Reconciled, type Tone } from "@/lib/brief";
import { Flow, Stats } from "@/components/brief-blocks";
import { documentHref } from "@/lib/files";
export { Flow, Stats };
import "@/styles/brief.css";

// The lead line with its inline markdown (code spans, bold, links) drawn, and nothing block-level. Code stays plain
// code here: `/blog` in a headline is a route, not a file to open.
function Lead({ text, path }: { text: string; path: string }) {
  return (
    <p className="brief-lead">
      <ReactMarkdown
        allowedElements={["p", "code", "strong", "em", "a"]}
        unwrapDisallowed
        components={{
          p: ({ children }) => <>{children}</>,
          a: ({ href, children }) => {
            const safe = href ? documentHref(href, path) : undefined;
            return safe ? (
              <a href={safe} {...(safe.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </p>
  );
}

// An agent's report (a CEO or COO message, a codebase note, a build brief) read as a brief: a lead line, then
// labelled parts on hairlines. Labels are plain words with a small dot; amber only for questions waiting on the owner.

function Label({ label, tone }: { label: string; tone: Tone }) {
  return (
    <h4 className={`brief-label tone-${tone}`}>
      <i aria-hidden />
      {label}
    </h4>
  );
}

// What the owner's answer did to their other open questions: withdrawn ones are closed, reshaped ones asked again.
export function ReconcileList({ items }: { items: Reconciled[] }) {
  return (
    <section className="brief-part">
      <Label label="Other questions" tone="plain" />
      <div className="brief-body brief-reconcile">
        {items.map((r) => (
          <Link key={r.thread} href={r.href} className={`reconcile-item is-${r.action}`}>
            <b>{r.action === "withdraw" ? "Withdrawn" : "Asking again"}</b>
            <span>{r.why}</span>
            <small className="code-text">{r.thread.split("/").pop()}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

function One({ b, path }: { b: Block; path: string }) {
  switch (b.type) {
    case "md":
      return <Markdown content={b.text} path={path} />;
    case "stats":
      return <Stats items={b.items} />;
    case "flow":
      return <Flow steps={b.steps} />;
    case "reconcile":
      return <ReconcileList items={b.items} />;
    case "callout":
    case "section":
      return (
        <section className={`brief-part is-${b.tone}`}>
          <Label label={b.label} tone={b.tone} />
          {b.text && (
            <div className="brief-body">
              <Markdown content={b.text} path={path} />
            </div>
          )}
        </section>
      );
  }
}

export function BriefView({ body, path, lead = true }: { body: string; path: string; lead?: boolean }) {
  const brief = parseBrief(body);
  return (
    <div className="brief">
      {lead && brief.lead && <Lead text={brief.lead} path={path} />}
      {!lead && brief.lead && <Markdown content={brief.lead} path={path} />}
      {brief.blocks.map((b, i) => (
        <One key={i} b={b} path={path} />
      ))}
    </div>
  );
}
