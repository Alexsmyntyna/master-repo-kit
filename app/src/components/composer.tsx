"use client";
import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Folder, LoaderCircle, Paperclip, X } from "lucide-react";
import { createThread, respond, suggestPaths, type ThreadState } from "@/app/threads/actions";
import { uploadFiles } from "@/app/files/actions";
import { attachmentKind, attachmentName, uploadOf } from "@/lib/attachment-refs";
import { uploadHref } from "@/lib/file-paths";
import { clearDraftKey, useClearOnLeave, useDraft, useDraftKey, useDraftSaver } from "@/lib/use-draft";
import { MODELS, modelLabel } from "@/lib/models";
import { useSpellFix } from "@/lib/use-spell-fix";
import "@/styles/composer.css";

type Project = { id: string; name: string; focus: boolean; repos?: string[] };

const modelHint: Record<string, string> = {
  "": "Auto: each role's default (holding/models.json, else Opus for the CEO and Sonnet for the COO).",
  haiku: "Haiku: fastest, for quick lookups.",
  sonnet: "Sonnet: most research and planning.",
  opus: "Opus: hard calls; uses more of your limit.",
  fable: "Fable: planning and analysis; uses the most of your limit.",
};
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

// Pasted text over this many characters becomes a file (DESIGN.md, Pasted material): saved under
// holding/uploads/<date>/ like a dropped file, named "pasted-" and its first line (converse.py reads that as kind
// `pasted`), .md when it reads as markdown.
const PASTE_AS_FILE = 400;
function pastedFile(text: string): File {
  const first = text.split("\n").find((l) => l.trim()) || "";
  const slug = first
    .replace(/^[#>\-*\s]+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // At most 40 characters with "pasted-" (saveUploads' limit), cut at a word.
  const name = slug.length > 33 ? slug.slice(0, 34).replace(/-[^-]*$/, "") : slug;
  const md = /^(#{1,6} |[-*] |> |\d+\. )|\*\*|\]\(/m.test(text);
  return new File([text], `pasted-${name || "text"}${md ? ".md" : ".txt"}`, { type: md ? "text/markdown" : "text/plain" });
}

// A message field is still saving a pasted or dropped file: its form waits before sending.
export const stillUploading = (form: HTMLFormElement | null) => !!form?.querySelector(".cmp-message[data-uploading]");
// The draft key of a message field's attachments, beside its text's (`<draft>:attach`).
export const attachDraftKey = (draft: string) => `${draft}:attach`;

function Segmented({
  name,
  value,
  options,
  onChange,
  label,
}: {
  name: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="cmp-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <label key={v} className={value === v ? "is-on" : ""} title={name === "model" ? modelHint[v] : undefined}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          {text}
        </label>
      ))}
    </div>
  );
}

// The message box: write, type @ to reference a file or folder by path, paste or drop images and files.
// Everything referenced or dropped is attached. A pasted, dropped or picked file is saved at once
// (holding/uploads/<date>/, uploadFiles) and the field keeps its path as a chip, sent as an `attach` input.
// The chat dock uses it compact: fewer rows, no word count, and `onText` to see what's typed (slash commands),
// `onAttach` to see how many files are attached (a message may be just those).
// What's typed is a draft (lib/use-draft.ts): `draft:<pathname>:message` unless `draft` names another key; the
// attached paths are a draft beside it (`<key>:attach`), since the files are already on disk.
// When `sent` changes to something truthy (the action's success), the field empties and both drafts go.
export function MessageField({
  placeholder,
  initial = "",
  shortcuts = [],
  rows = 6,
  compact = false,
  autoFocus = false,
  onText,
  onAttach,
  draft,
  sent,
  grow,
  toolsStart,
  toolsAfter,
  toolsEnd,
}: {
  placeholder: string;
  initial?: string;
  shortcuts?: string[];
  rows?: number;
  compact?: boolean;
  autoFocus?: boolean;
  onText?: (text: string) => void;
  onAttach?: (count: number) => void;
  draft?: string | null;
  sent?: unknown;
  grow?: [number, number]; // auto-grow between these many rows, no resize handle
  toolsStart?: React.ReactNode; // the bottom bar, before Attach
  toolsAfter?: React.ReactNode; // the bottom bar, after Attach
  toolsEnd?: React.ReactNode; // the bottom bar, right end (a send button)
}) {
  const [text, setText, clearDraft] = useDraft("message", initial, { key: draft });
  useEffect(() => onText?.(text), [text, onText]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !grow) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 24;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight, grow[0] * line + pad), grow[1] * line + pad);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > h + 1 ? "auto" : "hidden";
  }, [text, grow]);
  const [paths, setPathState] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ path: string; dir: boolean }[]>([]);
  const [pick, setPick] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachKey = useDraftKey("attach", draft ? attachDraftKey(draft) : draft);
  const attached = useDraftSaver(attachKey, "", (saved) => {
    try {
      const list = JSON.parse(saved);
      if (Array.isArray(list)) setPathState(list.filter((p): p is string => typeof p === "string").slice(0, 20));
    } catch {}
  });
  const setPaths = (change: (cur: string[]) => string[]) =>
    setPathState((cur) => {
      const next = change(cur);
      attached.save(next.length ? JSON.stringify(next) : "");
      return next;
    });
  useEffect(() => onAttach?.(paths.length), [paths.length, onAttach]);

  useEffect(() => {
    if (!sent) return;
    setText("");
    clearDraft();
    setPathState([]);
    attached.clear();
  }, [sent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (query === null) return setSuggestions([]);
    let live = true;
    const t = setTimeout(() => suggestPaths(query || "~/").then((s) => live && (setSuggestions(s), setPick(0))), 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const tokenAtCaret = (value: string, caret: number) => value.slice(0, caret).match(/@([~/][^\s]*)?$/);
  const onType = (value: string) => {
    setText(value);
    const m = tokenAtCaret(value, area.current?.selectionStart ?? value.length);
    setQuery(m ? m[1] || "~/" : null);
  };
  const choose = (s: { path: string; dir: boolean }, attach: boolean) => {
    const el = area.current!;
    const caret = el.selectionStart;
    const m = tokenAtCaret(text, caret)!;
    const display = tilde(s.path) + (s.dir && !attach ? "/" : "");
    const next = text.slice(0, caret - m[0].length) + "@" + display + (attach ? " " : "") + text.slice(caret);
    setText(next);
    if (attach) {
      setPaths((cur) => (cur.includes(s.path) ? cur : [...cur, s.path]));
      setQuery(null);
    } else setQuery(display);
    requestAnimationFrame(() => {
      el.focus();
      const pos = caret - m[0].length + display.length + 1 + (attach ? 1 : 0);
      el.setSelectionRange(pos, pos);
    });
  };
  // Files go to disk right away; the chip appears once the path is back.
  const take = (list: FileList | File[]) => {
    const add = Array.from(list).filter((f) => f.size > 0);
    if (!add.length) return false;
    const form = new FormData();
    add.forEach((f) => form.append("files", f, f.name || "image.png"));
    setUploadError("");
    setUploading((n) => n + 1);
    uploadFiles(form)
      .then((r) => {
        if (r.error || !r.paths) return setUploadError(r.error || "Couldn't save the file.");
        setPaths((cur) => [...cur, ...r.paths!.filter((p) => !cur.includes(p))].slice(0, 20));
      })
      .catch(() => setUploadError("Couldn't save the file."))
      .finally(() => setUploading((n) => n - 1));
    return true;
  };
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const open = query !== null && suggestions.length > 0;
  const extra = shortcuts.filter((r) => !paths.includes(r));

  return (
    <div
      className="cmp-message"
      data-uploading={uploading > 0 ? "" : undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          take(e.dataTransfer.files);
        }
      }}
    >
      <textarea
        ref={area}
        name="body"
        rows={grow ? grow[0] : rows}
        className={grow ? "is-growing" : undefined}
        autoFocus={autoFocus}
        maxLength={5000}
        spellCheck
        value={text}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => onType(e.target.value)}
        onPaste={(e) => {
          if (e.clipboardData.files.length && take(e.clipboardData.files)) return e.preventDefault();
          // A long paste is material they brought (an article, a log), not their words: it goes as an attached file.
          const pasted = e.clipboardData.getData("text/plain");
          if (pasted.length > PASTE_AS_FILE && take([pastedFile(pasted)])) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setPick((p) => (p + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
          } else if (e.key === "Tab") {
            e.preventDefault();
            choose(suggestions[pick], false);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(suggestions[pick], true);
          } else if (e.key === "Escape") setQuery(null);
        }}
      />
      {open && (
        <div className="cmp-suggest">
          <ul>
            {suggestions.map((s, i) => (
              <li key={s.path} className={i === pick ? "is-on" : ""}>
                <button type="button" className="cmp-suggest-path" onMouseDown={(e) => (e.preventDefault(), choose(s, !s.dir))}>
                  {s.dir ? <Folder size={13} /> : <FileText size={13} />}
                  <span>
                    {s.path.split("/").pop()}
                    {s.dir ? "/" : ""}
                  </span>
                </button>
                {s.dir && (
                  <button type="button" className="cmp-suggest-add" onMouseDown={(e) => (e.preventDefault(), choose(s, true))}>
                    Attach folder
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p>Tab opens a folder · Enter attaches · Esc closes</p>
        </div>
      )}
      {(paths.length > 0 || uploading > 0 || uploadError) && (
        <div className="cmp-attached">
          {paths.map((p) => {
            const upload = uploadOf(p);
            const kind = attachmentKind(p);
            const thumb = kind === "image" && upload ? uploadHref(upload) : undefined;
            return (
              <span key={p} className="cmp-chip">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" />
                ) : kind === "folder" ? (
                  <Folder size={12} aria-hidden />
                ) : (
                  <FileText size={12} aria-hidden />
                )}
                <span className={upload ? undefined : "code-text"} title={upload || p}>
                  {upload ? `${kind === "pasted" ? "Pasted · " : ""}${attachmentName(p)}` : tilde(p)}
                </span>
                <button type="button" aria-label={`Remove ${attachmentName(p)}`} onClick={() => setPaths((cur) => cur.filter((x) => x !== p))}>
                  <X size={12} />
                </button>
                <input type="hidden" name="attach" value={p} />
              </span>
            );
          })}
          {uploading > 0 && (
            <span className="cmp-chip is-saving" role="status">
              <LoaderCircle size={12} className="spin" aria-hidden />
              <span>Saving</span>
            </span>
          )}
          {uploadError && (
            <span className="cmp-chip is-error" role="alert">
              <span>{uploadError}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setUploadError("")}>
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}
      <div className={`cmp-tools${compact ? " is-compact" : ""}`}>
        {toolsStart}
        {compact ? (
          <button type="button" className="cmp-icon" aria-label="Attach" title="Attach files or images" onClick={() => fileInput.current?.click()}>
            <Paperclip size={16} aria-hidden />
          </button>
        ) : (
          <button type="button" className="cmp-tool" onClick={() => fileInput.current?.click()}>
            <Paperclip size={14} aria-hidden /> Attach
          </button>
        )}
        {toolsAfter}
        {extra.map((r) => (
          <button key={r} type="button" className="cmp-tool is-repo" title={`Attach ${tilde(r)}`} onClick={() => setPaths((cur) => [...cur, r])}>
            + <span className="code-text">{r.split("/").pop()}</span>
          </button>
        ))}
        {!compact && (
          <span className="cmp-count">
            <span className="cmp-tip">
              <kbd>@</kbd> a path · paste or drop images
            </span>
            <span className={`mono ${words > 250 ? "is-over" : ""}`}>{words} words</span>
          </span>
        )}
        {toolsEnd && <span className="cmp-tools-end">{toolsEnd}</span>}
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// The send row: kind and model on the left, the two switches, then the send button with its result.
function Controls({
  to,
  kinds,
  sticky,
  send,
  pending,
  runLabel,
  state,
}: {
  to: string;
  kinds: [string, string][];
  sticky?: Record<string, string>;
  send: React.ReactNode;
  pending: boolean;
  runLabel: string;
  state: ThreadState;
}) {
  const [kind, setKind] = useState(kinds[0][0]);
  const [model, setModel] = useState("");
  const current = sticky?.[to];
  return (
    <div className="cmp-foot">
      <div className="cmp-options">
        {kinds.length > 1 ? (
          <div className="cmp-opt">
            <span className="cmp-label">Kind</span>
            <Segmented name="kind" label="Kind" value={kind} options={kinds} onChange={setKind} />
          </div>
        ) : (
          <input type="hidden" name="kind" value={kinds[0][0]} />
        )}
        <div className="cmp-opt">
          <span className="cmp-label">
            Model{!model && current ? <span className="cmp-label-note"> · keeps {current}</span> : null}
          </span>
          <Segmented
            name="model"
            label="Model"
            value={model}
            options={[["", "Auto"], ...MODELS.map((m): [string, string] => [m, modelLabel[m]])]}
            onChange={setModel}
          />
        </div>
        <div className="cmp-checks">
          <label className="cmp-check" title="Haiku scouts and a Sonnet researcher do the bulk reading; the main agent oversees and checks.">
            <input
              type="checkbox"
              name="helpers_on"
              defaultChecked
              onChange={(e) => {
                const hidden = e.currentTarget.form?.elements.namedItem("no_helpers") as HTMLInputElement | null;
                if (hidden) hidden.value = e.currentTarget.checked ? "" : "on";
              }}
            />
            Helper agents
          </label>
          <input type="hidden" name="no_helpers" defaultValue="" />
          <label className="cmp-check">
            <input type="checkbox" name="run" defaultChecked /> {runLabel}
          </label>
        </div>
      </div>
      <div className="cmp-send">
        {pending && <span className="cmp-status">Working…</span>}
        {state.error && (
          <span className="cmp-status is-error" role="alert">
            {state.error}
          </span>
        )}
        {state.done && (
          <span className="cmp-status is-done" role="status">
            {state.done}
          </span>
        )}
        {send}
      </div>
    </div>
  );
}

// A thread toward a decision. Talking things through happens in the chat dock (components/dock/).
export function NewThread({
  projects,
  initialScope,
  initialTitle = "",
  initialBody = "",
}: {
  projects: Project[];
  initialScope: string;
  initialTitle?: string;
  initialBody?: string;
}) {
  const [state, action, pending] = useActionState(createThread, {});
  const spell = useSpellFix();
  const [scope, setScope, clearScope] = useDraft("scope", initialScope);
  const [title, setTitle, clearTitle] = useDraft("title", initialTitle);
  const bodyKey = useDraftKey("message");
  // createThread redirects to the new thread when it works: the drafts go once this form has left the page.
  const onSubmit = useClearOnLeave(() => {
    clearScope();
    clearTitle();
    if (bodyKey) clearDraftKey(bodyKey);
    if (bodyKey) clearDraftKey(attachDraftKey(bodyKey));
  }, state);
  return (
    <form
      action={action}
      className="cmp"
      onSubmit={(e) => (stillUploading(e.currentTarget) ? e.preventDefault() : spell.intercept(e, ["body"]) || onSubmit())}
    >
      <input type="hidden" name="mode" value="decide" />
      <div className="cmp-fields">
        <label className="cmp-field">
          <span className="cmp-label">About</span>
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="holding">Parent company</option>
            <optgroup label="Focus · CEO + COO">
              {projects
                .filter((p) => p.focus)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Other projects">
              {projects
                .filter((p) => !p.focus)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <label className="cmp-field">
          <span className="cmp-label">Subject</span>
          <input name="title" maxLength={120} placeholder="A few words" spellCheck value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
      </div>
      <MessageField
        key={scope}
        placeholder="What should be decided"
        initial={initialBody}
        draft={bodyKey}
        shortcuts={projects.find((p) => p.id === scope)?.repos || []}
      />
      <Controls
        to="ceo"
        kinds={[["directive", "Directive"], ["question", "Question"]]}
        pending={pending}
        runLabel="Start now"
        state={state}
        send={
          <button className="button primary" disabled={pending || spell.checking}>
            {pending ? "Starting…" : "Start"}
          </button>
        }
      />
    </form>
  );
}

export function Reply({
  scope,
  id,
  awaiting,
  canApprove = awaiting,
  busy,
  repos = [],
  models,
}: {
  scope: string;
  id: string;
  awaiting: boolean;
  canApprove?: boolean;
  focus: boolean;
  lastFrom?: string;
  busy: boolean;
  repos?: string[];
  models?: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(respond, {});
  const spell = useSpellFix();
  const [subject, setSubject, clearSubject] = useDraft("reply-subject");
  const sent = state.done ? state : undefined;
  useEffect(() => {
    if (!sent) return;
    setSubject("");
    clearSubject();
  }, [sent]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form
      action={action}
      className="cmp is-reply"
      onSubmit={(e) => (stillUploading(e.currentTarget) ? e.preventDefault() : spell.intercept(e, ["body"]))}
    >
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="id" value={id} />
      <div className="cmp-reply-head">
        <h2>{awaiting ? "Answer" : "Reply"}</h2>
        {canApprove && (
          <button className="button primary" name="intent" value="approve" disabled={pending || busy || spell.checking} title="Approve the proposed decision as it stands">
            Approve
          </button>
        )}
      </div>
      <label className="cmp-field">
        <span className="cmp-label">Subject</span>
        <input name="subject" maxLength={140} placeholder="Optional" spellCheck value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <MessageField
        placeholder={
          awaiting
            ? "What you want instead, or your answers"
            : "Reply"
        }
        shortcuts={repos}
        sent={sent}
      />
      <Controls
        to="ceo"
        kinds={[
          ["reply", "Reply"],
          ["directive", "Directive"],
          ["question", "Question"],
        ]}
        sticky={models}
        pending={pending}
        runLabel="Reply now"
        state={state}
        send={
          <button className={`button ${canApprove ? "secondary" : "primary"}`} name="intent" value="send" disabled={pending || busy || spell.checking}>
            {pending ? "Sending…" : awaiting ? "Send back" : "Send"}
          </button>
        }
      />
    </form>
  );
}
