"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Code2,
  GitCommitHorizontal,
  GitMerge,
  ListOrdered,
  MessageSquare,
  Play,
  Rows3,
  Send,
  SlidersHorizontal,
  Square,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { control, direct, openCode, planBuild, shapeEpic, startBuild, type BuildState } from "@/app/companies/[slug]/build/actions";
import { Menu } from "@/components/ds";
import { hasDraft, useFormDraft } from "@/lib/use-draft";
import { useSpellFix } from "@/lib/use-spell-fix";

// Board drafts are kept per project (and per epic or subtask), wherever the form shows.
const boardDraft = (slug: string, ...parts: string[]) => ["draft:board", slug, ...parts].join(":");

function Result({ state }: { state: BuildState }) {
  if (state.error) return <span className="form-error">{state.error}</span>;
  if (state.done) return <span className="form-done">{state.done}</span>;
  return null;
}

// Keeps the page live while anything is working.
export function LiveRefresh({ live, every = 4000 }: { live: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [live, every, router]);
  return null;
}

// Open menus (ds Menu) close on a click outside them or on Escape. Mounted once by the Board.
export function useMenuDismiss() {
  useEffect(() => {
    const close = (keep?: EventTarget | null) =>
      document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
        if (!(keep instanceof Node && d.contains(keep))) d.open = false;
      });
    const onDown = (e: PointerEvent) => close(e.target);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}
export function MenuDismiss() {
  useMenuDismiss();
  return null;
}

// ⌘↩ / Ctrl↩ sends the form a textarea sits in.
const submitOnCmdEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
};

// One row under the header: what to build (grows when focused), Epic or Task, the agents' settings, Plan.
export function NewBuild({ slug, goal = "", thread = "" }: { slug: string; goal?: string; thread?: string }) {
  const [state, action, pending] = useActionState<BuildState, FormData>(planBuild, {});
  const [kind, setKind] = useState<"epic" | "task">("epic");
  const [model, setModel] = useState("sonnet");
  const [run, setRun] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state.done && box.current) box.current.value = "";
  }, [state]);
  const changed = model !== "sonnet" || run;
  const draft = useFormDraft("goal", { key: boardDraft(slug, "goal"), result: state });
  const spell = useSpellFix(); // the goal goes through the spelling fixer; what they typed is kept as `typed`
  return (
    <form ref={draft.ref} action={action} className="bd-new" onSubmit={(e) => spell.intercept(e, ["goal"])}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="thread" value={thread} />
      <textarea
        ref={box}
        name="goal"
        rows={1}
        defaultValue={goal}
        className="bd-new-goal"
        aria-label={kind === "epic" ? "The epic" : "The task"}
        placeholder={kind === "epic" ? "What to build" : "What to fix or add"}
        spellCheck
        onKeyDown={submitOnCmdEnter}
      />
      <div className="bd-seg" role="radiogroup" aria-label="Epic or one-off task">
        {(
          [
            ["epic", "Epic", "The COO plans subtasks"],
            ["task", "Task", "One agent, no plan"],
          ] as const
        ).map(([k, label, hint]) => (
          <label key={k} className={kind === k ? "on" : ""} title={hint}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
            {label}
          </label>
        ))}
      </div>
      <Menu
        align="start"
        button={`icon-button bd-settings${changed ? " is-changed" : ""}`}
        title="Agent settings"
        label={<SlidersHorizontal size={15} />}
      >
        <label className="menu-field">
          Model
          <select name="model" data-draft="off" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="sonnet">Sonnet agents</option>
            <option value="opus">Opus agents</option>
          </select>
        </label>
        <label className="menu-check">
          <input type="checkbox" name="run" checked={run} onChange={(e) => setRun(e.target.checked)} />
          {kind === "epic" ? "Run without approval" : "Start now"}
        </label>
      </Menu>
      <button className="button primary" disabled={pending || spell.checking}>
        {pending ? "Starting…" : kind === "epic" ? "Plan" : "Add"}
      </button>
      <Result state={state} />
    </form>
  );
}

// One card, or the whole epic in sequence or in parallel.
export function RunButton({
  slug,
  build,
  brief,
  mode = "parallel",
  label,
  primary = false,
}: {
  slug: string;
  build: string;
  brief?: string;
  mode?: "parallel" | "sequence";
  label: string;
  primary?: boolean;
}) {
  const [state, action, pending] = useActionState<BuildState, FormData>(startBuild, {});
  const Icon = brief ? Play : mode === "sequence" ? ListOrdered : Rows3;
  return (
    <form action={action} className="inline-form">
      <Hidden slug={slug} build={build} brief={brief} />
      <input type="hidden" name="mode" value={mode} />
      <button className={`button ${primary ? "primary" : "secondary"}`} disabled={pending}>
        <Icon size={14} /> {pending ? "Starting…" : label}
      </button>
      <Result state={state} />
    </form>
  );
}

// The COO proposed subtasks: approve them, or (after "Change direction") send the epic another way.
export function ShapeEpic({ slug, build }: { slug: string; build: string }) {
  const [state, action, pending] = useActionState<BuildState, FormData>(shapeEpic, {});
  const [writing, setWriting] = useState(false);
  const key = boardDraft(slug, build, "direction");
  const draft = useFormDraft("direction", { key, result: state });
  useEffect(() => {
    if (hasDraft(key)) setWriting(true);
  }, [key]);
  return (
    <form ref={draft.ref} key={writing ? "writing" : "actions"} action={action} className="bd-foot-form">
      <Hidden slug={slug} build={build} />
      {writing && (
        <div className="bd-compose">
          <textarea
            name="direction"
            rows={3}
            autoFocus
            aria-label="New direction for this epic"
            placeholder="Which way instead?"
            spellCheck
            onKeyDown={submitOnCmdEnter}
          />
        </div>
      )}
      <div className="bd-actionrow">
        {writing ? (
          <>
            <button className="button primary" name="intent" value="replan" disabled={pending}>
              <Send size={14} /> Re-plan
            </button>
            <button type="button" className="button secondary" onClick={() => setWriting(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="button primary" name="intent" value="approve" disabled={pending}>
              <Check size={14} /> Approve
            </button>
            <button type="button" className="button secondary" onClick={() => setWriting(true)}>
              <MessageSquare size={14} /> Change direction
            </button>
          </>
        )}
        <Result state={state} />
      </div>
    </form>
  );
}

function Hidden({ slug, build, brief }: { slug: string; build?: string; brief?: string }) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} />
      {build && <input type="hidden" name="build" value={build} />}
      {brief && <input type="hidden" name="brief" value={brief} />}
    </>
  );
}

const COMMIT_PRESET =
  "Commit everything you made for this brief on your branch, in clear commits, then give the short report again.";

// One subtask's agent: a single row of actions at the end of the panel. The message box opens only from Send message.
export function AgentControls({
  slug,
  build,
  brief,
  live,
  status,
  canMerge,
  dirty = false,
  commits = 0,
}: {
  slug: string;
  build: string;
  brief: string;
  live: boolean;
  status: string;
  canMerge: boolean;
  dirty?: boolean;
  commits?: number;
}) {
  const [said, say, saying] = useActionState<BuildState, FormData>(direct, {});
  const [done, act, acting] = useActionState<BuildState, FormData>(control, {});
  const [opened, openAction, opening] = useActionState<BuildState, FormData>(openCode, {});
  const [writing, setWriting] = useState(false);
  const finished = ["merged", "discarded"].includes(status);
  const canSay = !finished && !live && status !== "not started";
  const key = boardDraft(slug, build, brief, "message");
  const draft = useFormDraft("message", { key, result: said });
  const spell = useSpellFix(); // the message goes through the spelling fixer before the agent gets it
  useEffect(() => {
    if (said.done) setWriting(false); // sent: the box closes until the next message
  }, [said]);
  useEffect(() => {
    if (canSay && hasDraft(key)) setWriting(true); // an unsent message from before a reload
  }, [key, canSay]);
  return (
    <div className="bd-foot-form">
      {writing && (
        <form
          ref={draft.ref}
          action={say}
          className="bd-compose"
          id={`say-${build}-${brief}`}
          onSubmit={(e) => spell.intercept(e, ["text"])}
        >
          <Hidden slug={slug} build={build} brief={brief} />
          <textarea
            name="text"
            rows={3}
            autoFocus
            spellCheck
            placeholder={`Message ${brief}`}
            aria-label={`Message to ${brief}`}
            onKeyDown={submitOnCmdEnter}
          />
        </form>
      )}
      <div className="bd-actionrow">
        {writing ? (
          <>
            <button form={`say-${build}-${brief}`} className="button primary" disabled={saying || spell.checking}>
              <Send size={14} /> {saying ? "Sending…" : "Send"}
            </button>
            <button type="button" className="button secondary" onClick={() => setWriting(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {live && (
              <form action={act} className="inline-form">
                <Hidden slug={slug} build={build} brief={brief} />
                <button className="button secondary" name="action" value="stop" disabled={acting}>
                  <Square size={14} /> Stop
                </button>
              </form>
            )}
            {!live && !finished && canMerge && (
              <form action={act} className="inline-form">
                <Hidden slug={slug} build={build} brief={brief} />
                <button className="button primary" name="action" value="merge" disabled={acting} title="Merge this branch into main (only on a clean main)">
                  <GitMerge size={14} /> Merge into main
                </button>
              </form>
            )}
            {canSay && (
              <button type="button" className="button secondary" onClick={() => setWriting(true)}>
                <MessageSquare size={14} /> Send message
              </button>
            )}
            {canSay && dirty && (
              <form action={say} className="inline-form">
                <Hidden slug={slug} build={build} brief={brief} />
                <button className="button secondary" name="preset" value={COMMIT_PRESET} disabled={saying} title={commits ? "Ask the agent to commit what it left uncommitted" : "Ask the agent to commit its work"}>
                  <GitCommitHorizontal size={14} /> Commit
                </button>
              </form>
            )}
            {!live && status !== "discarded" && status !== "not started" && (
              <form action={act} className="inline-form">
                <Hidden slug={slug} build={build} brief={brief} />
                <button className="button secondary" name="action" value="discard" disabled={acting} title="Remove the worktree and, unless merged, the branch">
                  <Trash2 size={14} /> {status === "merged" ? "Clean up" : "Discard"}
                </button>
              </form>
            )}
            {!finished && status !== "not started" && (
              <Menu
                up
                className="bd-open-in"
                label={
                  <>
                    Open in <ChevronDown size={14} />
                  </>
                }
              >
                <form action={openAction} className="menu-form">
                  <Hidden slug={slug} build={build} brief={brief} />
                  <button className="menu-item" name="how" value="zed" disabled={opening}>
                    <Code2 size={15} /> Zed <small>This worktree</small>
                  </button>
                  <button className="menu-item" name="how" value="resume" disabled={opening || live} title="Continue this agent's session yourself">
                    <SquareTerminal size={15} /> Ghostty <small>Resume the agent</small>
                  </button>
                  <Result state={opened} />
                </form>
              </Menu>
            )}
          </>
        )}
        <Result state={said.error || said.done ? said : done} />
      </div>
    </div>
  );
}

export function StopAll({ slug, build }: { slug: string; build: string }) {
  const [state, action, pending] = useActionState<BuildState, FormData>(control, {});
  return (
    <form action={action} className="inline-form">
      <Hidden slug={slug} build={build} />
      <button className="button secondary" name="action" value="stop" disabled={pending}>
        <Square size={14} /> Stop all
      </button>
      <Result state={state} />
    </form>
  );
}

// The project itself: open it in Zed, or start Claude in Ghostty, with an optional prompt.
export function OpenProject({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<BuildState, FormData>(openCode, {});
  // The prompt is a draft until Claude has started with it; opening Zed leaves it alone.
  const [how, setHow] = useState("");
  const draft = useFormDraft("prompt", { key: boardDraft(slug, "open-prompt"), result: how === "terminal" ? state : undefined });
  return (
    <Menu
      label={
        <>
          Open in <ChevronDown size={14} />
        </>
      }
    >
      <form
        ref={draft.ref}
        action={action}
        className="menu-form bd-open-form"
        onSubmit={(e) => setHow(((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value || "")}
      >
        <input type="hidden" name="slug" value={slug} />
        <button className="menu-item" name="how" value="zed" disabled={pending}>
          <Code2 size={15} /> Zed <small>Editor</small>
        </button>
        <div className="menu-sep" />
        <label className="menu-field">
          Prompt (optional)
          <textarea name="prompt" rows={3} maxLength={8000} />
        </label>
        <button className="menu-item" name="how" value="terminal" disabled={pending}>
          <SquareTerminal size={15} /> Ghostty <small>Claude</small>
        </button>
        <Result state={state} />
      </form>
    </Menu>
  );
}
