"use client";
import { useEffect, useTransition } from "react";
import { Hourglass, LoaderCircle, Play, TriangleAlert, Users } from "lucide-react";
import type { DockChat } from "@/app/dock/actions";
import { continueThread } from "@/app/threads/actions";
import { DockBrief } from "./dock-brief";
import { Fold, Said, Source } from "@/components/ds";
import { RetryNowButton, Ticker } from "@/components/run-status";
import { retryClock } from "@/lib/retry-clock";
import { scopeOf } from "@/lib/file-paths";
import { isGenerated } from "@/lib/voice";
import { SpellNote } from "@/components/spell-fixes";
import { AttachmentChips } from "@/components/attachment-chips";

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

// The conversation, oldest first: the owner's words in serif with the page each was sent from, the agent's as Markdown.
export function DockMessages({ chat, starting, onRetry }: { chat?: DockChat; starting: boolean; onRetry: () => void }) {
  const scope = scopeOf(chat?.path || "");
  return (
    <>
      {chat?.messages.map((m, i) =>
        ["owner", "alex"].includes(m.from) ? (
          <div key={i} className="dock-msg from-owner">
            <Said
              text={m.body}
              date={m.date}
              where={m.page?.title || undefined}
              href={m.page?.url}
              auto={!!m.body && isGenerated(m.body)}
              note={<SpellNote typed={m.typed} body={m.body} fixes={m.fixes} />}
              attached={<AttachmentChips refs={m.refs} />}
            />
            {/* A message from before attachments were recorded in the body: just their names. */}
            {m.attachments.length > 0 && !m.refs.length && (
              <p className="dock-attached code-text">{m.attachments.map((a) => tilde(a).split("/").pop()).join(" · ")}</p>
            )}
          </div>
        ) : (
          <div key={i} className="dock-msg from-agent">
            <Source who="agent" label={m.from.toUpperCase()} date={m.date} />
            <DockBrief body={m.body} scope={scope} />
            <Consults items={chat.consults.filter((c) => c.feeds === i + 1)} />
          </div>
        ),
      )}
      {/* Questions to COOs inside the turn that is still running: who the agent is talking to right now. */}
      {chat && <Consults items={chat.consults.filter((c) => c.feeds > chat.messages.length)} live={!!chat.running?.alive} />}
      <DockStatus chat={chat} starting={starting} onRetry={onRetry} />
    </>
  );
}

// The CEO's questions to project COOs: an aside naming who it asked, working while the answer is out, the answer
// folded once it lands (it's agent prose the reply already draws on).
function Consults({ items, live = false }: { items: DockChat["consults"]; live?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="dock-consults">
      {items.map((c, i) => {
        const who = `${c.name} COO`;
        const working = c.status === "running" && live;
        const head = (
          <span className="dock-consult-head">
            {working ? (
              <LoaderCircle size={12} className="spin" aria-hidden />
            ) : c.status === "failed" ? (
              <TriangleAlert size={12} aria-hidden />
            ) : (
              <Users size={12} aria-hidden />
            )}
            {working ? `Asking ${who}…` : c.status === "failed" ? `${who} didn't answer` : c.status === "running" ? `Asked ${who}, no answer` : `Asked ${who}`}
          </span>
        );
        return (
          <div key={i} className={`dock-consult is-${working ? "live" : c.status}`}>
            {c.status === "done" ? (
              <Fold summary={head}>
                <p className="dock-consult-q">{c.question}</p>
                <DockBrief body={c.answer} scope={`project:${c.project}`} />
              </Fold>
            ) : (
              <>
                {head}
                <p className="dock-consult-q">{c.status === "failed" && c.error ? c.error.slice(0, 200) : c.question}</p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DockStatus({ chat, starting, onRetry }: { chat?: DockChat; starting: boolean; onRetry: () => void }) {
  const running = chat?.running;
  if (running?.alive)
    return (
      <p className="dock-status is-live" role="status">
        <LoaderCircle size={14} className="spin" aria-hidden />
        <span>
          {running.role.toUpperCase()} working · <span className="mono">{running.since ? <Ticker since={running.since} /> : "…"}</span> ·{" "}
          {running.model}
        </span>
      </p>
    );
  if (chat?.waiting) return <Waiting chat={chat} onRetry={onRetry} />;
  if (starting)
    return (
      <p className="dock-status is-live" role="status">
        <LoaderCircle size={14} className="spin" aria-hidden /> Starting
      </p>
    );
  if (!chat) return null;
  if (running && !running.alive)
    return <Problem text={`The ${running.role.toUpperCase()} stopped without replying.`} chat={chat} onRetry={onRetry} />;
  if (chat.failed && chat.next) return <Problem text={chat.failed} chat={chat} onRetry={onRetry} />;
  return null;
}

// The last turn hit the usage limit: the message is kept and the reply comes after the reset (converse.py retry).
// A little after that time the dock follows along as if Retry had been pressed.
function Waiting({ chat, onRetry }: { chat: DockChat; onRetry: () => void }) {
  const at = chat.waiting!.retryAt;
  useEffect(() => {
    const wait = new Date(at).getTime() + 75_000 - Date.now();
    if (Number.isNaN(wait)) return;
    const t = setTimeout(onRetry, Math.max(5_000, Math.min(wait, 2_000_000_000)));
    return () => clearTimeout(t);
  }, [at, onRetry]);
  return (
    <div className="dock-status is-waiting" role="status">
      <Hourglass size={14} aria-hidden />
      <span className="dock-problem" suppressHydrationWarning>
        Limit reached · retrying at {retryClock(at)}
      </span>
      <RetryNowButton scope={chat.scope} id={chat.id} onDone={onRetry} className="dock-retry" />
    </div>
  );
}

function Problem({ text, chat, onRetry }: { text: string; chat: DockChat; onRetry: () => void }) {
  const [pending, start] = useTransition();
  return (
    <div className="dock-status is-failed" role="alert">
      <TriangleAlert size={14} aria-hidden />
      <span className="dock-problem">{text.slice(0, 300)}</span>
      <button
        type="button"
        className="button secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const form = new FormData();
            form.set("scope", chat.scope);
            form.set("id", chat.id);
            await continueThread({}, form);
            onRetry();
          })
        }
      >
        <Play size={13} aria-hidden /> {pending ? "Starting" : "Retry"}
      </button>
    </div>
  );
}
