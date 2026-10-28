"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass, LoaderCircle, Pause, Play, RotateCw, TriangleAlert } from "lucide-react";
import { continueThread, startCheckin, type ThreadState } from "@/app/threads/actions";
import { retryNow } from "@/app/threads/retry";
import type { Running, Waiting } from "@/lib/threads";
import { retryClock } from "@/lib/retry-clock";
import "@/styles/run-status.css";

const roleLabel = (r: string) => r.toUpperCase();

function elapsed(since: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// Refreshes the page's server data every few seconds while something is running.
export function AutoRefresh({ active, every = 4000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}

export function Ticker({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{elapsed(since, now)}</>;
}

function ContinueButton({ scope, id, label }: { scope: string; id: string; label: string }) {
  const [state, action, pending] = useActionState<ThreadState, FormData>(continueThread, {});
  return (
    <form action={action} className="rs-form">
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="id" value={id} />
      <button className="button secondary" disabled={pending}>
        <Play size={14} /> {pending ? "Starting…" : label}
      </button>
      {state.error && <span className="rs-error">{state.error}</span>}
    </form>
  );
}

// The page re-reads its data a little after the retry time, so the answer shows without a reload.
function RefreshAfter({ iso }: { iso: string }) {
  const router = useRouter();
  useEffect(() => {
    const wait = new Date(iso).getTime() + 75_000 - Date.now();
    if (Number.isNaN(wait)) return;
    const t = setTimeout(() => router.refresh(), Math.max(5_000, Math.min(wait, 2_000_000_000)));
    return () => clearTimeout(t);
  }, [iso, router]);
  return null;
}

// "Retry now": runs the queued turn at once (tools/converse.py retry <thread>).
export function RetryNowButton({
  scope,
  id,
  onDone,
  className = "rs-form",
}: {
  scope: string;
  id: string;
  onDone?: () => void;
  className?: string;
}) {
  const [state, action, pending] = useActionState(async (prev: { error?: string }, form: FormData) => {
    const result = await retryNow(prev, form);
    onDone?.();
    return result;
  }, {});
  return (
    <form action={action} className={className}>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="id" value={id} />
      <button className="button secondary" disabled={pending}>
        <RotateCw size={13} aria-hidden /> {pending ? "Starting…" : "Retry now"}
      </button>
      {state.error && <span className="rs-error">{state.error}</span>}
    </form>
  );
}

export function RunStatus({
  scope,
  id,
  running,
  failed,
  waiting,
  next,
  status,
}: {
  scope: string;
  id: string;
  running?: Running;
  failed?: { role: string; at: string; error: string };
  waiting?: Waiting;
  next?: string;
  status: string;
}) {
  const waitingOnAgent = status === "open" && (next === "ceo" || next === "coo");
  if (waiting && !running?.alive) {
    return (
      <div className="rs is-waiting">
        <RefreshAfter iso={waiting.retryAt} />
        <Hourglass size={16} aria-hidden />
        <div className="rs-text">
          <strong suppressHydrationWarning>Limit reached · retrying at {retryClock(waiting.retryAt)}</strong>
          <span>The {roleLabel(waiting.role)}’s turn is queued{waiting.message ? ` · ${waiting.message}` : ""}</span>
        </div>
        <RetryNowButton scope={scope} id={id} />
      </div>
    );
  }
  if (running?.alive) {
    return (
      <div className="rs is-live">
        <AutoRefresh active />
        <LoaderCircle size={16} className="spin" aria-hidden />
        <div className="rs-text">
          <strong>The {roleLabel(running.role)} is working</strong>
          <span>
            <span className="mono">
              <Ticker since={running.since} />
            </span>{" "}
            · {running.model}
          </span>
        </div>
      </div>
    );
  }
  if (running && !running.alive) {
    return (
      <div className="rs is-failed">
        <TriangleAlert size={16} aria-hidden />
        <div className="rs-text">
          <strong>The {roleLabel(running.role)} stopped without replying</strong>
                  </div>
        <ContinueButton scope={scope} id={id} label="Run again" />
      </div>
    );
  }
  if (failed && waitingOnAgent) {
    return (
      <div className="rs is-failed">
        <TriangleAlert size={16} aria-hidden />
        <div className="rs-text">
          <strong>The {roleLabel(failed.role)} failed</strong>
          <span className="code-text">{failed.error}</span>
        </div>
        <ContinueButton scope={scope} id={id} label="Retry" />
      </div>
    );
  }
  if (waitingOnAgent) {
    return (
      <div className="rs is-idle">
        <Pause size={16} aria-hidden />
        <div className="rs-text">
          <strong>Waiting for the {roleLabel(next!)}</strong>
                  </div>
        <ContinueButton scope={scope} id={id} label="Continue" />
      </div>
    );
  }
  return null;
}

export function CheckinButton({ slug, label = "Run check-in" }: { slug: string; label?: string }) {
  const [state, action, pending] = useActionState<ThreadState, FormData>(startCheckin, {});
  return (
    <form action={action} className="rs-form">
      <input type="hidden" name="slug" value={slug} />
      <button className="button secondary" disabled={pending}>
        <Play size={14} /> {pending ? "Starting…" : label}
      </button>
      {state.error && <span className="rs-error">{state.error}</span>}
      {state.done && <span className="rs-done">{state.done}</span>}
    </form>
  );
}
