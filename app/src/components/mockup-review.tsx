"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ImagePlus, MapPin, Maximize2, Minimize2, MousePointer2, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { mockupHref, type MockupReview, type Pin } from "@/lib/mockups";
import { saveReview, uploadPinImages } from "@/app/companies/[slug]/mockups/actions";
import { useDraftSaver } from "@/lib/use-draft";
import { useSpellFix, type SpellSend } from "@/lib/use-spell-fix";
import "@/styles/mockups.css";

type Draft = Omit<Pin, "n">;
const today = () => new Date().toLocaleDateString("en-CA");
const kept_ = (p: { text: string; images?: string[] }) => !!(p.text.trim() || p.images?.length);

// The mockup large on the left, in a phone or desktop frame (sandboxed iframe); the review on the right.
// In "Pin" mode a click on the mockup drops a numbered note there; in "Use" mode the mockup takes the clicks.
// The panel can be hidden so the mockup takes the page's width (remembered in localStorage). Full screen fills the
// window with the mockup (scaled up past its size) and hides the panel; pins and modes still work.
export function MockupReviewer({
  review,
  header,
  tradeoffs,
}: {
  review: MockupReview;
  header: React.ReactNode;
  tradeoffs: React.ReactNode;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState(review.screens[0].file);
  const [mode, setMode] = useState<"pin" | "use">("pin");
  const [pins, setPins] = useState<Draft[]>(review.notes.pins);
  const [active, setActive] = useState<number | null>(null);
  const [answers, setAnswers] = useState(review.questions.map((_, i) => review.notes.answers[i] || ""));
  const [note, setNote] = useState(review.notes.note);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ error?: string; done?: string }>({});
  const [saving, startSaving] = useTransition();
  const [autosaving, setAutosaving] = useState(false);
  const edits = useRef(0); // bumped on every change, so an autosave that lands after a newer edit leaves it unsaved
  const now = useRef(false); // the next autosave goes at once (a pin kept, deleted or given an image)
  const [nudge, setNudge] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false); // one upload at a time, even if the file input fires twice
  const spell = useSpellFix(); // answers, notes and the overall note go through the spelling fixer on save
  const [scale, setScale] = useState(1);
  const [full, setFull] = useState(false);
  const [side, setSide] = useState(true);
  const [scrollY, setScrollY] = useState(0); // the mockup's own scroll, as it reports it (lib/mockups.ts withScrollReporter)
  const [uploading, setUploading] = useState(false);
  const [W, H] = review.size;

  // Unsaved answers, pins and the overall note are drafts per review (lib/use-draft.ts), cleared once saved.
  const draftBase = `draft:mockup:${review.slug}/${review.id}`;
  const restored = <T,>(set: (v: T) => void, ok: (v: unknown) => boolean) => (text: string) => {
    try {
      const v = JSON.parse(text);
      if (ok(v)) (set(v), setDirty(true));
    } catch {}
  };
  const answersDraft = useDraftSaver(
    `${draftBase}:answers`,
    JSON.stringify(review.questions.map((_, i) => review.notes.answers[i] || "")),
    restored(setAnswers, (v) => Array.isArray(v) && v.length === review.questions.length && v.every((x) => typeof x === "string")),
  );
  const pinsDraft = useDraftSaver(
    `${draftBase}:pins`,
    JSON.stringify(review.notes.pins),
    restored(setPins, (v) => Array.isArray(v) && v.every((p) => p && typeof p.text === "string" && typeof p.x === "number")),
  );
  const noteDraft = useDraftSaver(`${draftBase}:note`, review.notes.note || "", (text) => (setNote(text), setDirty(true)));
  useEffect(() => {
    if (!dirty) return;
    answersDraft.save(JSON.stringify(answers));
    pinsDraft.save(JSON.stringify(pins));
    noteDraft.save(note);
  }, [answers, pins, note, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave: notes.md is written as typed (no spelling fixer, no status change, nothing posted), at once when a pin
  // is kept, deleted or given an image, otherwise a second and a half after the last keystroke. Done/Send below is the
  // final save.
  const hasWords = () => answers.some((a) => a.trim()) || pins.some(kept_) || !!note.trim();
  useEffect(() => {
    if (!dirty) return;
    const at = ++edits.current;
    if (!hasWords() && !review.notes.updated) return;
    const wait = now.current ? 0 : 1500;
    now.current = false;
    const timer = setTimeout(async () => {
      setAutosaving(true);
      const result = await saveReview({ slug: review.slug, id: review.id, answers, pins, note });
      setAutosaving(false);
      if (result.error) return setMessage(result);
      if (edits.current !== at) return;
      answersDraft.clear();
      pinsDraft.clear();
      noteDraft.clear();
      setDirty(false);
      setMessage({ done: "Saved" });
    }, wait);
    return () => clearTimeout(timer);
  }, [answers, pins, note, dirty, nudge]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveNow = () => {
    now.current = true;
    setDirty(true);
    setNudge((n) => n + 1);
  };

  // Fit the frame to the space left of the panel and under the top of the stage.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const pad = review.frame === "phone" ? 24 : 0;
      if (full) {
        const h = window.innerHeight - el.getBoundingClientRect().top - 16 - pad;
        setScale(Math.min((el.clientWidth - pad) / W, h / H));
        return;
      }
      const h = Math.max(480, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 40);
      setScale(Math.min(1, (el.clientWidth - pad) / W, h / H));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [W, H, review.frame, full]);

  useEffect(() => {
    try {
      if (localStorage.getItem("mockup-review:panel") === "hidden") setSide(false);
    } catch {}
  }, []);
  const toggleSide = () => {
    setSide(!side);
    try {
      localStorage.setItem("mockup-review:panel", side ? "hidden" : "shown");
    } catch {}
  };

  // Full screen: the page behind stops scrolling, and Escape closes it (a pin's own Escape is handled first).
  useEffect(() => {
    if (!full) return;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  // A mockup may say which screen it is on (parent.postMessage({ mockupScreen: "shift" }, "*")), so pins land on it.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (typeof e.data?.mockupScroll === "number") return setScrollY(Math.max(0, e.data.mockupScroll));
      if (typeof e.data?.mockupScreen !== "string") return;
      const match = review.screens.find((s) => s.file.split("#")[1] === e.data.mockupScreen);
      if (match) setScreen(match.file);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [review.screens]);

  const edit = () => {
    setDirty(true);
    setMessage({});
  };
  const drop = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width,
      y = (e.clientY - box.top) / box.height;
    const kept = pins.filter((q, j) => j !== active || kept_(q));
    setPins([...kept, { screen, x, y, ...(scrollY ? { scroll: Math.round(scrollY) } : {}), text: "", date: today() }]);
    setActive(kept.length);
    edit();
  };
  // The pin layer sits over the mockup and would swallow the scroll wheel. It catches the wheel itself and asks the
  // mockup to scroll by the same amount at the same point (lib/mockups.ts withScrollReporter), so a trackpad gesture
  // and its momentum keep scrolling and pins stay clickable throughout. Wheels over the note box are left alone.
  useEffect(() => {
    const layer = overlay.current;
    if (!layer || mode !== "pin") return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".mr-pop")) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
      const box = layer.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * W,
        y = ((e.clientY - box.top) / box.height) * H;
      frame.current?.contentWindow?.postMessage(
        { mockupScrollBy: { dx: (e.deltaX * unit) / scale, dy: (e.deltaY * unit) / scale, x, y } },
        "*",
      );
    };
    layer.addEventListener("wheel", onWheel, { passive: false });
    return () => layer.removeEventListener("wheel", onWheel);
  }, [mode, scale, W, H]);
  // Images on a pin are uploaded at once (holding/uploads/, like thread attachments) and kept by path.
  const attach = async (files: File[]) => {
    const i = active;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (i === null || !images.length || busy.current) return;
    busy.current = true;
    const form = new FormData();
    images.forEach((f) => form.append("files", f));
    setUploading(true);
    const result = await uploadPinImages(form).finally(() => (busy.current = false));
    setUploading(false);
    if (!result.paths) return setMessage({ error: result.error });
    setPins((p) => p.map((q, j) => (j === i ? { ...q, images: [...new Set([...(q.images || []), ...result.paths!])].slice(0, 4) } : q)));
    edit();
    saveNow();
  };
  const dropImage = (i: number, src: string) => {
    setPins((p) => p.map((q, j) => (j === i ? { ...q, images: (q.images || []).filter((x) => x !== src) } : q)));
    edit();
    saveNow();
  };
  const setPinText = (i: number, text: string) => {
    setPins((p) => p.map((q, j) => (j === i ? { ...q, text } : q)));
    edit();
  };
  const remove = (i: number) => {
    setPins((p) => p.filter((_, j) => j !== i));
    setActive(null);
    edit();
    saveNow();
  };
  const close = () => {
    setPins((p) => p.filter((q, j) => j !== active || kept_(q)));
    setActive(null);
    if (dirty) saveNow();
  };
  const open = (i: number) => {
    setScreen(pins[i].screen);
    setActive(i);
    // Scroll the mockup so the pin is in view (a third down), if it isn't already.
    const at = (pins[i].y * H + (pins[i].scroll || 0) - scrollY) / H;
    if (at < 0 || at > 1)
      frame.current?.contentWindow?.postMessage({ mockupScrollTo: Math.max(0, pins[i].y * H + (pins[i].scroll || 0) - H / 3) }, "*");
  };
  // Save: every field with words goes through the spelling fixer and the fixed text is saved at once, with what they
  // typed going along as `typed`. The fields keep what they typed until it's saved.
  const save = () => {
    const fields: Record<string, string> = {};
    answers.forEach((text, i) => text.trim() && (fields[`a${i}`] = text));
    pins.forEach((p, i) => p.text.trim() && (fields[`p${i}`] = p.text));
    if (note.trim()) fields.note = note;
    spell.check(fields, (out: Record<string, SpellSend>) => {
      const fixed = {
        answers: answers.map((a, i) => out[`a${i}`]?.text ?? a),
        pins: pins.map((p, i) => ({ ...p, text: out[`p${i}`]?.text ?? p.text })),
        note: out.note?.text ?? note,
      };
      const typed = {
        answers: answers.map((_, i) => out[`a${i}`]?.typed ?? ""),
        pins: pins.map((_, i) => out[`p${i}`]?.typed ?? ""),
        note: out.note?.typed ?? "",
      };
      startSaving(async () => {
        edits.current++;
        const result = await saveReview({ slug: review.slug, id: review.id, ...fixed, typed, done: true });
        setMessage(result);
        if (result.done) {
          answersDraft.clear();
          pinsDraft.clear();
          noteDraft.clear();
          setDirty(false);
          setActive(null);
          setAnswers(fixed.answers);
          setPins(fixed.pins);
          setNote(fixed.note);
          router.refresh();
        }
      });
    });
  };

  const label = (file: string) => review.screens.find((s) => s.file === file)?.label || file;
  // Where a pin is in the frame now: its page position less the current scroll; off the frame means scrolled away.
  const inFrame = (p: Draft) => (p.y * H + (p.scroll || 0) - scrollY) / H;
  const here = pins
    .map((p, i) => ({ ...p, i, at: inFrame(p) }))
    .filter((p) => p.screen === screen && p.at >= 0 && p.at <= 1);
  const current = active !== null ? pins[active] : undefined;
  const currentAt = current ? inFrame(current) : 0;
  const numbered = (i: number) => i + 1;
  const src = mockupHref(`${review.dir}/${screen.split("#")[0]}`) + (screen.includes("#") ? "#" + screen.split("#")[1] : "");

  return (
    <div className={`mr-review ${full ? "is-full" : ""} ${side ? "" : "no-panel"}`}>
      <div className="mr-stage-col">
        <div className="mr-bar">
          <div className="mr-mode" role="radiogroup" aria-label="What a click does">
            <button role="radio" aria-checked={mode === "pin"} onClick={() => setMode("pin")}>
              <MapPin size={14} aria-hidden /> Pin a note
            </button>
            <button
              role="radio"
              aria-checked={mode === "use"}
              onClick={() => {
                setMode("use");
                close();
              }}
            >
              <MousePointer2 size={14} aria-hidden /> Use it
            </button>
          </div>
          {review.screens.length > 1 && (
            <div className="mr-screens" role="tablist" aria-label="Screens">
              {review.screens.map((s) => (
                <button
                  key={s.file}
                  role="tab"
                  aria-selected={s.file === screen}
                  onClick={() => {
                    setScreen(s.file);
                    close();
                  }}
                >
                  {s.label}
                  {pins.some((p) => p.screen === s.file && p.text.trim()) && (
                    <span className="mr-count mono">{pins.filter((p) => p.screen === s.file && p.text.trim()).length}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {!full && (
            <button className="mr-tip mr-side" data-tip={side ? "Hide questions" : "Show questions"} onClick={toggleSide} aria-label={side ? "Hide questions" : "Show questions"}>
              {side ? <PanelRightClose size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />}
            </button>
          )}
        </div>
        <div className="mr-stage" ref={stage}>
          <div className={`mr-device mr-${review.frame}`} style={{ width: W * scale, height: H * scale }}>
            <div className="mr-screen" style={{ width: W, height: H, transform: `scale(${scale})` }}>
              <iframe
                ref={frame}
                src={src}
                title={`${review.title}: ${label(screen)}`}
                sandbox="allow-scripts"
                width={W}
                height={H}
              />
            </div>
            <div className="mr-corner">
              <button
                className="mr-tip"
                data-tip={full ? "Exit full screen (Esc)" : "Full screen"}
                aria-label={full ? "Exit full screen" : "Full screen"}
                onClick={() => setFull(!full)}
              >
                {full ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
              </button>
              {!full && (
                <a className="mr-tip" data-tip="Open in a new tab" aria-label="Open in a new tab" href={src} target="_blank" rel="noreferrer">
                  <ArrowUpRight size={15} aria-hidden />
                </a>
              )}
            </div>
            <div ref={overlay} className={`mr-overlay ${mode === "pin" ? "is-pinning" : ""}`} onClick={mode === "pin" ? drop : undefined}>
              {here.map((p) => (
                <button
                  key={p.i}
                  className={`mr-pin ${p.i === active ? `is-active to-${p.at > 0.62 ? "n" : "s"}${p.x > 0.55 ? "w" : "e"}` : ""}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.at * 100}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(p.i === active ? null : p.i);
                  }}
                  aria-label={`Note ${numbered(p.i)}`}
                >
                  {numbered(p.i)}
                </button>
              ))}
              {current && current.screen === screen && currentAt >= 0 && currentAt <= 1 && (
                <div
                  className={`mr-pop ${current.x > 0.55 ? "is-left" : ""} ${currentAt > 0.62 ? "is-up" : ""}`}
                  style={{ left: `${current.x * 100}%`, top: `${currentAt * 100}%` }}
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-label={`Note ${numbered(active!)}`}
                >
                  <textarea
                    autoFocus
                    rows={2}
                    spellCheck
                    value={current.text}
                    placeholder="What should change here?"
                    onChange={(e) => setPinText(active!, e.target.value)}
                    onPaste={(e) => {
                      const files = [...e.clipboardData.files];
                      if (files.some((f) => f.type.startsWith("image/"))) {
                        e.preventDefault();
                        attach(files);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                        e.preventDefault();
                        close();
                      }
                    }}
                  />
                  {!!current.images?.length && (
                    <div className="mr-pop-images">
                      {current.images.map((img) => (
                        <span key={img}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/files/${img}`} alt="" />
                          <button onClick={() => dropImage(active!, img)} aria-label="Remove image">
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mr-pop-tools">
                    <button
                      className="mr-pop-icon"
                      onClick={() => imageInput.current?.click()}
                      disabled={uploading || (current.images?.length || 0) >= 4}
                      aria-label="Attach an image"
                      title="Attach an image (or paste one)"
                    >
                      <ImagePlus size={16} />
                    </button>
                    <input
                      ref={imageInput}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        attach([...(e.target.files || [])]);
                        e.target.value = "";
                      }}
                    />
                    {uploading && <span className="mr-pop-busy">Adding…</span>}
                    <button className="mr-pop-save" onClick={close} disabled={!kept_(current)}>
                      Save
                    </button>
                  </div>
                  <button className="mr-pop-x" onClick={() => remove(active!)} aria-label="Delete note" title="Delete note">
                    <X size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside className="mr-panel" ref={panel}>
        {header}
        {review.questions.length > 0 && (
          <section className="mr-sec">
            <h2>Questions</h2>
            <ol className="mr-questions">
              {review.questions.map((q, i) => (
                <li key={i}>
                  <p className="mr-ask">{q.ask}</p>
                  {q.shown && (
                    <p className="mr-shown">
                      {q.screen ? (
                        <button onClick={() => setScreen(q.screen)}>Shown on {label(q.screen)}</button>
                      ) : (
                        "Shown"
                      )}
                      : {q.shown}
                    </p>
                  )}
                  <textarea
                    className="mr-words"
                    rows={2}
                    spellCheck
                    value={answers[i]}
                    placeholder="Your answer"
                    onChange={(e) => {
                      setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)));
                      edit();
                    }}
                  />
                </li>
              ))}
            </ol>
          </section>
        )}
        <section className="mr-sec">
          <h2>
            Notes <span className="sec-note">{pins.filter((p) => p.text.trim()).length || ""}</span>
          </h2>
          {pins.length ? (
            <ol className="mr-notes">
              {pins.map((p, i) => (
                  <li key={i} className={i === active ? "is-active" : ""}>
                    <button className="mr-pin is-static" onClick={() => open(i)} aria-label={`Show note ${numbered(i)}`}>
                      {numbered(i)}
                    </button>
                    <div>
                      <textarea
                        className="mr-words"
                        rows={2}
                        spellCheck
                        value={p.text}
                        onFocus={() => open(i)}
                        onChange={(e) => setPinText(i, e.target.value)}
                      />
                      {!!p.images?.length && (
                        <div className="mr-pop-images is-small">
                          {p.images.map((img) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={img} src={`/files/${img}`} alt="" />
                          ))}
                        </div>
                      )}
                      <span className="mr-where">{label(p.screen)}</span>
                    </div>
                    <button className="mr-x" onClick={() => remove(i)} aria-label="Remove note">
                      <X size={14} />
                    </button>
                  </li>
              ))}
            </ol>
          ) : (
            <p className="mr-hint">Click the mockup to pin a note</p>
          )}
          <textarea
            className="mr-words mr-overall"
            rows={3}
            spellCheck
            value={note}
            placeholder="Anything overall"
            onChange={(e) => {
              setNote(e.target.value);
              edit();
            }}
          />
        </section>
        <section className="mr-sec">
          <h2>Trade-offs</h2>
          {tradeoffs}
        </section>
        <div className="mr-save">
          <button
            className="mr-save-btn"
            onClick={save}
            disabled={saving || spell.checking || !hasWords() || (!dirty && review.status === "answered")}
          >
            {saving ? "Sending…" : review.thread ? "Send" : "Done"}
          </button>
          <span className={message.error ? "is-error" : ""}>
            {autosaving
              ? "Saving…"
              : message.error || (dirty ? "Not saved yet" : message.done || (review.notes.updated ? "Saved" : ""))}
          </span>
        </div>
      </aside>
    </div>
  );
}
