"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Maximize2, MessageCircle, Minimize2, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import { loadDock, saveDefaultModels, sendChat, type Dock as DockData } from "@/app/dock/actions";
import { createThread, startCheckin, startMarketCheck } from "@/app/threads/actions";
import { MessageField, attachDraftKey, stillUploading } from "@/components/composer";
import { clearDraftKey, putDraft } from "@/lib/use-draft";
import { useSpellFix } from "@/lib/use-spell-fix";
import { commandHint, commands, matchCommands, parseCommand, type Command } from "./commands";
import { MODELS, isModel, modelLabel, type Model, type Role } from "@/lib/models";
import { DockMessages } from "./dock-messages";
import "@/styles/dock.css";

// Labels too generic for the chip: the page's own heading says more.
const GENERIC = new Set(["Wiki page", "Document", "Thread", "Mockup", "This page"]);
// The side panel is 360px up to about 60% of the window wide.
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, 360), Math.max(360, window.innerWidth * 0.6)));
const pageHeading = () => document.querySelector("main h1")?.textContent?.trim() || document.title.split(" · ")[0] || "";

// The chat dock: a round button bottom right that opens a chat panel on any page. One conversation per project
// (plus one for the parent company), and the page the owner is on is the context of what they say (tools/converse.py
// chat). The panel stays mounted when closed so a reply that lands meanwhile is there when it opens again.
export function Dock() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [width, setWidth] = useState(440);
  const [dock, setDock] = useState<DockData | undefined>();
  const [heading, setHeading] = useState("");
  const [usePage, setUsePage] = useState(true);
  const [text, setText] = useState("");
  const [attachedCount, setAttachedCount] = useState(0);
  const [field, setField] = useState({ key: 0, initial: "" });
  const [menu, setMenu] = useState(false);
  const [models, setModels] = useState(false);
  // Models picked for the next message, per role; sent with it (converse.py --model), after which the chat keeps them.
  const [chosen, setChosen] = useState<Partial<Record<Role, Model>>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState<{ text: string; href?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [pending, start] = useTransition();
  const spell = useSpellFix();
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const escTaken = useRef(false);

  const refresh = useCallback(async () => {
    const next = await loadDock(pathname);
    setDock(next);
    const c = next?.chat;
    if (!c || c.running || c.failed || c.waiting || !["owner", "alex"].includes(c.messages.at(-1)?.from || "")) setStarting(false);
    return next;
  }, [pathname]);

  // Context follows the page: reload on navigation while open. The heading is read once the new page has rendered.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("chat") === "open") setOpen(true);
    setUsePage(true);
    setHeading(pageHeading());
    const t = setTimeout(() => setHeading(pageHeading()), 300);
    return () => clearTimeout(t);
  }, [pathname]);
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);
  // A page can open the dock after sending a message itself (the calendar's Ask box).
  useEffect(() => {
    const show = () => {
      setOpen(true);
      refresh();
    };
    window.addEventListener("dock:open", show);
    return () => window.removeEventListener("dock:open", show);
  }, [refresh]);
  // Open stays open across full page loads (plain links, reloads) in this tab; width and mode are remembered.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("dock-open") === "1") setOpen(true);
      const w = Number(localStorage.getItem("dock-width"));
      if (w) setWidth(clampWidth(w));
      if (localStorage.getItem("dock-mode") === "full") setFull(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem("dock-open", open ? "1" : "0");
      localStorage.setItem("dock-mode", full ? "full" : "panel");
    } catch {}
  }, [open, full]);
  // On wide screens the open side panel pushes the page instead of covering it (shell.css reads these).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.dock = open ? (full ? "full" : "open") : "closed";
    root.style.setProperty("--dock-w", `${width}px`);
  }, [open, full, width]);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setWidth(clampWidth(window.innerWidth - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.documentElement.classList.remove("is-resizing-dock");
      setWidth((w) => {
        try {
          localStorage.setItem("dock-width", String(w));
        } catch {}
        return w;
      });
    };
    document.documentElement.classList.add("is-resizing-dock");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const chat = dock?.chat;
  const busy = !!chat?.running?.alive || starting;
  // While the agent works, check every few seconds (open or not, so the button can show it).
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  useEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open, chat?.messages.length, busy]);

  // Cmd+J toggles; Escape closes unless it was closing a suggestion list inside the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        if (escTaken.current) escTaken.current = false;
        else if (panel.current?.querySelector(".spell-note-tip:popover-open")) return; // it closes itself
        else if (full) setFull(false); // full screen steps back to the side panel; the next Escape closes
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, full]);
  useEffect(() => {
    if (open) requestAnimationFrame(() => panel.current?.querySelector("textarea")?.focus());
    else if (panel.current?.contains(document.activeElement)) fab.current?.focus();
  }, [open]);

  const scope = dock?.ctx.scope || "holding";
  useEffect(() => setChosen({}), [scope]);
  // Who answers here: the CEO, and on a project's pages the COO it consults.
  const roles: { role: Role; label: string }[] = [
    { role: "ceo", label: "CEO" },
    ...(scope === "holding" ? [] : [{ role: "coo" as const, label: `${dock?.ctx.name || "Project"} COO` }]),
  ];
  const modelOf = Object.fromEntries(
    (["ceo", "coo"] as const).map((r) => {
      const kept = chat?.models[r];
      return [r, chosen[r] ?? (isModel(kept) ? kept : dock?.defaults[r] ?? (r === "ceo" ? "opus" : "sonnet"))];
    }),
  ) as Record<Role, Model>;
  const matches = menu ? commands.filter((c) => !(c.projectOnly && scope === "holding")) : matchCommands(text, scope);
  // What's typed is kept per scope (draft:dock:<scope>), once the dock knows its scope. Replacing the field's text
  // (a picked command, or emptying it after a send that worked) replaces the draft too.
  const draftKey = dock ? `draft:dock:${scope}` : null;
  // A new scope remounts the field with its own draft; keep the focus that the old field had.
  useEffect(() => {
    const at = document.activeElement;
    if (open && draftKey && (!at || at === document.body)) panel.current?.querySelector("textarea")?.focus();
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const setDraft = (initial: string) => {
    if (draftKey) putDraft(draftKey, initial);
    setField((f) => ({ key: f.key + 1, initial }));
  };
  const pick = (c: Command) => {
    setMenu(false);
    setDraft(c.arg ? `/${c.name} ` : `/${c.name}`);
  };

  const runCommand = async (name: string, arg: string) => {
    const data = new FormData();
    if (name === "decide") {
      setDraft("");
      setOpen(false);
      router.push(`/threads/new?scope=${scope}${arg ? `&title=${encodeURIComponent(arg)}` : ""}`);
      return;
    }
    if (name === "check-in" || name === "market") {
      data.set("slug", name === "check-in" && scope === "holding" ? "due" : scope);
      const r = name === "market" ? await startMarketCheck({}, data) : await startCheckin({}, data);
      if (r.error) return setError(r.error);
      setDraft("");
      setNote({ text: r.done || "Started", href: "/threads" });
      return;
    }
    if (name === "thread") {
      const last = chat?.messages.findLast((m) => ["owner", "alex"].includes(m.from));
      if (!last) return setError("Nothing to move yet.");
      data.set("scope", scope);
      data.set("title", (arg || last.body.split(/\s+/).slice(0, 8).join(" ")).slice(0, 120));
      data.set("body", last.body);
      data.set("kind", "directive");
      data.set("mode", "decide");
      data.set("run", "on");
      const r = await createThread({}, data); // redirects to the new thread when it works
      if (r?.error) setError(r.error);
      else setDraft("");
    }
  };

  // A message goes through the spelling fixer on its way (useSpellFix): the fixed text is sent at once with what they
  // typed as `typed`. Commands go as typed.
  // A file alone (no words) may be sent: its record line is the message (DESIGN.md, Attachments).
  const submit = () => {
    if (!form.current || pending || spell.checking || !dock || stillUploading(form.current)) return;
    const data = new FormData(form.current);
    const body = String(data.get("body") || "").trim();
    if (!body && !data.getAll("attach").length) return;
    const cmd = body ? parseCommand(body) : undefined;
    if (!cmd && busy) return setError("Still answering the last message.");
    setError("");
    setNote(null);
    if (cmd) return start(() => runCommand(cmd.name, cmd.arg));
    if (!body) return send(data, "");
    spell.check({ body }, ({ body: fixed }) => send(data, fixed.text, fixed.typed));
  };
  const send = (data: FormData, body: string, typed?: string) => {
    data.set("body", body);
    if (typed) data.set("typed", typed);
    start(async () => {
      data.set("url", pathname);
      data.set("title", heading || dock?.ctx.label || "");
      data.set("page", usePage ? "on" : "off");
      const r = await sendChat(data);
      if (r.error) return setError(r.error);
      if (draftKey) clearDraftKey(attachDraftKey(draftKey)); // the attached files went with it
      setDraft("");
      setUsePage(true);
      setStarting(true);
      await refresh();
      setChosen({}); // the chat keeps them now
    });
  };

  const ctx = dock?.ctx;
  const label = ctx && (GENERIC.has(ctx.label) && heading ? heading : ctx.label);
  return (
    <>
      <button
        ref={fab}
        type="button"
        className={`dock-fab${open ? " is-hidden" : ""}${busy ? " is-busy" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="Open chat"
        title="Chat (⌘J)"
      >
        <MessageCircle size={20} aria-hidden />
      </button>
      <aside
        ref={panel}
        className={`dock${open ? " is-open" : ""}${full ? " is-full" : ""}`}
        style={{ "--dock-w": `${width}px` } as React.CSSProperties}
        aria-label="Chat"
        inert={!open}
        onKeyDownCapture={(e) => {
          if (e.key !== "Escape") return;
          // A suggestion list, a menu or a spelling popover ("2 fixed") closes first; the dock stays.
          if (panel.current?.querySelector(".cmp-suggest, .spell-note-tip:popover-open") || matches.length || models) {
            escTaken.current = true;
            setMenu(false);
            setModels(false);
          }
        }}
      >
        {!full && <div className="dock-grip" onPointerDown={startResize} aria-hidden title="Drag to resize" />}
        <header className="dock-head">
          <h2>Chat</h2>
          {chat && (
            <Link href={`/threads/${chat.scope}/${chat.id}`} className="dock-icon" aria-label="Open as a thread" title="Open as a thread">
              <SquareArrowOutUpRight size={14} />
            </Link>
          )}
          <button
            type="button"
            className="dock-icon"
            onClick={() => setFull(!full)}
            aria-label={full ? "Side panel" : "Full screen"}
            title={full ? "Side panel" : "Full screen"}
          >
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" className="dock-icon" onClick={() => setOpen(false)} aria-label="Close chat" title="Close (Esc)">
            <X size={16} />
          </button>
        </header>
        {ctx && (
          <div className="dock-context">
            <span className={`dock-chip${usePage ? "" : " is-off"}`} title={usePage && ctx.file ? ctx.file : undefined}>
              <i aria-hidden />
              <b>{ctx.name}</b>
              <span>{usePage ? label : "No page"}</span>
              <button
                type="button"
                onClick={() => setUsePage(!usePage)}
                aria-label={usePage ? "Leave this page out of the next message" : "Use this page again"}
                title={usePage ? "Leave the page out of the next message" : "Use this page"}
              >
                {usePage ? <X size={12} /> : <Plus size={12} />}
              </button>
            </span>
          </div>
        )}
        <div className="dock-list" ref={list}>
          {dock && !chat?.messages.length && !starting && (
            <p className="dock-empty">Ask about this page, or type / for commands.</p>
          )}
          <DockMessages chat={chat} starting={starting} onRetry={() => (setStarting(true), refresh())} />
        </div>
        <form
          ref={form}
          className="dock-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.defaultPrevented || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (matches.length && !parseCommand(text)) pick(matches[0]);
            else submit();
          }}
        >
          {matches.length > 0 && (
            <ul className="dock-commands" role="listbox" aria-label="Commands">
              {matches.map((c) => (
                <li key={c.name}>
                  <button type="button" onMouseDown={(e) => (e.preventDefault(), pick(c))}>
                    <code>/{c.name}</code>
                    {c.arg && <span className="dock-arg">{c.arg}</span>}
                    <span className="dock-hint">{commandHint(c, scope)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {models && dock && (
            <ModelMenu
              roles={roles}
              values={modelOf}
              defaults={dock.defaults}
              onPick={(role, m) => setChosen((c) => ({ ...c, [role]: m }))}
              onDefault={async () => {
                const r = await saveDefaultModels(Object.fromEntries(roles.map(({ role }) => [role, modelOf[role]])));
                if (r.error) setError(r.error);
                else refresh();
              }}
              onClose={() => setModels(false)}
            />
          )}
          {(error || note || busy) && (
            <p className={`dock-line${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
              {error || (note ? note.href ? <Link href={note.href}>{note.text}</Link> : note.text : `${(chat?.running?.role || "ceo").toUpperCase()} is answering…`)}
            </p>
          )}
          {chosen.ceo && <input type="hidden" name="model" value={chosen.ceo} />}
          {chosen.coo && scope !== "holding" && <input type="hidden" name="coo_model" value={chosen.coo} />}
          <MessageField
            key={`${draftKey}:${field.key}`}
            draft={draftKey}
            initial={field.initial}
            placeholder="Message"
            grow={[2, 10]}
            compact
            autoFocus={field.key > 0}
            onText={setText}
            onAttach={setAttachedCount}
            toolsStart={
              <button
                type="button"
                className="cmp-icon"
                aria-label="Commands"
                aria-expanded={menu}
                title="Commands"
                onClick={() => (setModels(false), setMenu(!menu))}
              >
                <Plus size={16} />
              </button>
            }
            toolsAfter={
              dock && (
                  <button
                    type="button"
                    className="cmp-icon is-text"
                    aria-expanded={models}
                    aria-haspopup="dialog"
                    title="Models for this chat"
                    onClick={() => (setMenu(false), setModels(!models))}
                  >
                    CEO · {modelLabel[modelOf.ceo]}
                  </button>
              )
            }
            toolsEnd={
                <button
                  className="dock-go"
                  disabled={pending || spell.checking || (!text.trim() && !attachedCount) || (busy && !parseCommand(text))}
                  aria-label="Send"
                  title="Send (Enter)"
                >
                  <ArrowUp size={16} aria-hidden />
                </button>
            }
          />
        </form>
      </aside>
    </>
  );
}

// The models popover: one row per role that answers here, a choice of model each, and "Use as default", which is
// ticked while the choices are the defaults and, when ticked, makes them so (holding/models.json).
function ModelMenu({
  roles,
  values,
  defaults,
  onPick,
  onDefault,
  onClose,
}: {
  roles: { role: Role; label: string }[];
  values: Record<Role, Model>;
  defaults: Record<Role, Model>;
  onPick: (role: Role, model: Model) => void;
  onDefault: () => Promise<void>;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const isDefault = roles.every(({ role }) => values[role] === defaults[role]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest("[aria-haspopup='dialog']")) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);
  return (
    <div ref={box} className="dock-models" role="dialog" aria-label="Models for this chat">
      {roles.map(({ role, label }) => (
        <div key={role} className="dock-model-row">
          <span>{label}</span>
          <div className="cmp-seg" role="radiogroup" aria-label={`${label} model`}>
            {MODELS.map((m) => (
              <label key={m} className={values[role] === m ? "is-on" : ""}>
                <input type="radio" name={`dock-model-${role}`} checked={values[role] === m} onChange={() => onPick(role, m)} />
                {modelLabel[m]}
              </label>
            ))}
          </div>
        </div>
      ))}
      <label className="dock-model-default">
        <input
          type="checkbox"
          checked={isDefault}
          disabled={isDefault || saving}
          onChange={async () => {
            setSaving(true);
            await onDefault();
            setSaving(false);
          }}
        />
        Use as default
      </label>
    </div>
  );
}
