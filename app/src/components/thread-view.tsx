import { AttachmentChips } from "@/components/attachment-chips";
import { BriefView } from "@/components/brief";
import { Source, State, type Tone } from "@/components/ds";
import { MockupStrip } from "@/components/mockups";
import { SpellNote } from "@/components/spell-fixes";
import { parseMockups, stripMockups } from "@/lib/mockups";
import { dateLabel, label } from "@/lib/model";
import { isGenerated } from "@/lib/voice";
import { roleNames, statusLabels, type Consult, type Message } from "@/lib/threads";
import "@/styles/messages.css";

const attachmentHref = (messagePath: string, i: number) =>
  `/threads/attachment?message=${encodeURIComponent(messagePath)}&i=${i}`;

// the owner's own words (not a prompt a tool wrote for them) are set in serif.
const ownWords = (m: Message) => ["owner", "alex"].includes(m.from) && (!m.body || !isGenerated(m.body));

// What the CEO asked the project COOs before writing a message (tools/converse.py consult): one row per question,
// each opening to the COO's whole answer.
export function Consults({ consults, names }: { consults: Consult[]; names: Record<string, string> }) {
  if (!consults.length) return null;
  const projects = new Set(consults.map((c) => c.project)).size;
  return (
    <div className="consults">
      <p className="consults-head">
        CEO asked {projects === 1 ? "a COO" : `${projects} COOs`}
        {consults.length > projects ? `, ${consults.length} questions` : ""}
      </p>
      <div className="consults-list">
        {consults.map((c) => (
          <details key={c.path} className={`consult is-${c.status}`}>
            <summary>
              <span className="consult-who">
                <span className="role-name role-coo">{names[c.project] || c.project} COO</span>
                <span className="consult-state">
                  {c.status === "running" ? "working…" : c.status === "failed" ? "failed" : c.model}
                </span>
              </span>
              <span className="consult-q">{c.question}</span>
            </summary>
            <div className="consult-body">
              {c.status === "failed" ? (
                <p className="consult-error">{c.error}</p>
              ) : (
                <>
                  <BriefView body={stripMockups(c.answer)} path={c.path} lead={false} />
                  <MockupStrip mockups={parseMockups(c.answer)} />
                </>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function Attachments({ m }: { m: Message }) {
  if (!m.attachments.length) return null;
  return (
    <div className="msg-attachments">
      {m.attachments.map((a, i) =>
        a.kind === "image" ? (
          <a key={i} href={attachmentHref(m.path, i)} target="_blank" rel="noreferrer" className="msg-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachmentHref(m.path, i)} alt={a.path.split("/").pop()} loading="lazy" />
          </a>
        ) : (
          <span key={i} className="msg-file code-text" title={a.path}>
            {a.path.replace(/^\/Users\/[^/]+/, "~")}
            {a.kind === "folder" ? "/" : ""}
          </span>
        ),
      )}
    </div>
  );
}

// What the turn cost, as one faint line: model, time, list price. The rest (engine, tool turns, cost per model) is
// in the tooltip.
function Usage({ usage }: { usage: Record<string, unknown> }) {
  if (typeof usage.engine !== "string") return null;
  const price = typeof usage.list_price_usd === "number" ? usage.list_price_usd : undefined;
  const parts = [
    usage.model ? String(usage.model) : "",
    usage.seconds ? `${usage.seconds}s` : "",
    price !== undefined ? `$${price.toFixed(2)}` : "",
  ].filter(Boolean);
  const detail = [
    String(usage.engine),
    usage.turns ? `${usage.turns} tool turns` : "",
    price !== undefined ? `$${price} at list price, paid by subscription` : "",
    usage.by_model && typeof usage.by_model === "object"
      ? Object.entries(usage.by_model as Record<string, number>)
          .map(([model, cost]) => `${model.replace(/-\d.*$/, "")} $${cost}`)
          .join(", ")
      : "",
  ].filter(Boolean);
  return (
    <p className="msg-usage mono" title={detail.join(" · ")}>
      {parts.join(" · ")}
    </p>
  );
}

function Who({ m }: { m: Message }) {
  return (
    <span className="msg-who">
      {["owner", "alex"].includes(m.from) && isGenerated(m.body) ? (
        <Source who="auto" cite="Written by a tool or button, not typed by you" />
      ) : (
        <span className={`role-name role-${m.from === "alex" ? "owner" : m.from}`}>{roleNames[m.from]}</span>
      )}
      <span className="msg-to">to {roleNames[m.to]}</span>
    </span>
  );
}

const kindLabel = (k: string) => label(k);

// A message's content: what the CEO asked COOs first, the brief, mockups, attachments and what the turn cost.
function MessageBody({ m, consults, names, children }: { m: Message; consults: Consult[]; names: Record<string, string>; children?: React.ReactNode }) {
  return (
    <>
      <Consults consults={consults} names={names} />
      {!m.body ? null : ownWords(m) ? (
        <div className="said-body">
          <BriefView body={m.body} path={m.path} lead={false} />
        </div>
      ) : (
        <BriefView body={stripMockups(m.body)} path={m.path} />
      )}
      <MockupStrip mockups={parseMockups(m.body)} />
      {children}
      {/* The record lines at the end of the body as chips; a message from before those lines, its attachments. */}
      {m.refs.length ? <AttachmentChips refs={m.refs} /> : <Attachments m={m} />}
      <Usage usage={m.usage} />
    </>
  );
}

// The newest message, open, as the page's centre: the answer form sits inside it when it waits on the owner.
export function LatestMessage({
  m,
  n,
  consults = [],
  names = {},
  children,
}: {
  m: Message;
  n: number;
  consults?: Consult[];
  names?: Record<string, string>;
  children?: React.ReactNode;
}) {
  return (
    <article className={`msg-latest role-${m.from === "alex" ? "owner" : m.from} kind-${m.kind}`} id={`m${n}`}>
      <header className="msg-line">
        <Who m={m} />
        <span className={`msg-kind kind-${m.kind}`}>{kindLabel(m.kind)}</span>
        <span className="msg-date">
          <SpellNote typed={m.typed} body={m.body} fixes={m.fixes} />
          <span className="mono">#{n}</span> · {dateLabel(m.date)}
        </span>
      </header>
      {m.subject && <h2 className="msg-subject">{m.subject}</h2>}
      <MessageBody m={m} consults={consults} names={names}>
        {children}
      </MessageBody>
    </article>
  );
}

// An earlier message: one hairline row with who, kind, subject and a preview; opens to the full brief.
export function MessageCard({
  m,
  n,
  consults = [],
  names = {},
}: {
  m: Message;
  n: number;
  consults?: Consult[];
  names?: Record<string, string>;
}) {
  const preview = stripMockups(m.body)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_`>|-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || m.refs.map((r) => r.label).join(" · ");
  return (
    <li className={`msg-row role-${m.from === "alex" ? "owner" : m.from}`}>
      <details className={`msg kind-${m.kind} ${ownWords(m) ? "is-said" : ""}`} id={`m${n}`}>
        <summary className="msg-sum">
          <span className="msg-n mono">#{n}</span>
          <Who m={m} />
          <span className="msg-preview">
            {m.subject && <strong>{m.subject}</strong>}
            <span>{preview}</span>
          </span>
          <span className="msg-meta">
            <span className={`msg-kind kind-${m.kind}`}>{kindLabel(m.kind)}</span>
            <SpellNote typed={m.typed} body={m.body} fixes={m.fixes} />
            {consults.length > 0 && (
              <span>
                asked {consults.length} COO{consults.length > 1 ? "s" : ""}
              </span>
            )}
            <span>{dateLabel(m.date)}</span>
          </span>
        </summary>
        <div className="msg-body">
          {m.subject && <h3 className="msg-subject is-small">{m.subject}</h3>}
          <MessageBody m={m} consults={consults} names={names} />
        </div>
      </details>
    </li>
  );
}

const statusTone: Record<string, Tone | undefined> = {
  "awaiting-alex": "attention",
  "awaiting-owner": "attention",
  talking: "attention",
  open: "agent",
  decided: "ok",
  closed: "idle",
};

export function ThreadStatus({ status }: { status: string }) {
  return <State tone={statusTone[status] || "idle"}>{statusLabels[status] || label(status)}</State>;
}
