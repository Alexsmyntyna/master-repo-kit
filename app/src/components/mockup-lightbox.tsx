"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { mockupHref, mockupLink, type Mockup, type MockupFrame } from "@/lib/mockups";

type Item = Mockup & MockupFrame;
const newTab = { target: "_blank", rel: "noreferrer" };
const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

// The strip of thumbnails and, on a click, one mockup live and large in a modal <dialog> (app/DESIGN.md, Lightbox).
export function MockupLightbox({ items }: { items: Item[] }) {
  const [at, setAt] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const thumbs = useRef<(HTMLAnchorElement | null)[]>([]);
  const opened = useRef(0);
  const scroll = useRef("");

  const show = (i: number) => {
    const d = dialog.current;
    if (!d) return;
    opened.current = i;
    setAt(i);
    if (!d.open) {
      scroll.current = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      d.showModal();
    }
    closeButton.current?.focus();
  };
  const close = () => dialog.current?.close();
  // Escape, the close button and a backdrop click all end here, through the dialog's close event.
  const onClose = () => {
    document.documentElement.style.overflow = scroll.current;
    setAt(null);
    thumbs.current[opened.current]?.focus();
  };
  const step = useCallback((by: number) => setAt((i) => (i === null ? i : (i + by + items.length) % items.length)), [items.length]);

  useEffect(() => {
    if (at !== null) opened.current = at;
  }, [at]);
  useEffect(() => () => void (dialog.current?.open && (document.documentElement.style.overflow = scroll.current)), []);

  const item = at === null ? undefined : items[at];
  const many = items.length > 1;
  return (
    <>
      <div className="mockups">
        {items.map((m, i) => {
          const href = mockupLink(m.path);
          const tab = href.startsWith("/mockups?") ? newTab : {};
          return (
            <figure key={m.path} className="mockup">
              <a
                ref={(el) => void (thumbs.current[i] = el)}
                className="mockup-frame"
                href={href}
                {...tab}
                aria-label={`${m.letter}: ${m.label}`}
                onClick={(e) => {
                  if (!plainClick(e)) return;
                  e.preventDefault();
                  show(i);
                }}
              >
                <iframe src={mockupHref(m.path)} title={m.label} sandbox="allow-scripts" loading="lazy" tabIndex={-1} />
              </a>
              <figcaption>
                <span className="mockup-letter mono">{m.letter}</span>
                <span>{m.label}</span>
                <a href={href} {...tab} aria-label="Open">
                  <ArrowUpRight size={14} />
                </a>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <dialog
        ref={dialog}
        className="mlb"
        aria-label={item ? `Option ${item.letter}: ${item.label}` : "Mockup"}
        onClose={onClose}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t === e.currentTarget || t.classList.contains("mlb-stage")) close();
        }}
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === "ArrowRight") (e.preventDefault(), step(1));
          if (e.key === "ArrowLeft") (e.preventDefault(), step(-1));
        }}
      >
        <div className="mlb-bar">
          {item && (
            <p className="mlb-title">
              <span className="mockup-letter mono">{item.letter}</span>
              <span className="mlb-label">{item.label}</span>
            </p>
          )}
          <div className="mlb-tools">
            {item && (
              <>
                <a className="mlb-link" href={mockupHref(item.path)} {...newTab}>
                  Open <ArrowUpRight size={14} />
                </a>
                {mockupLink(item.path) !== mockupHref(item.path) && (
                  <a className="mlb-link" href={mockupLink(item.path)}>
                    Review
                  </a>
                )}
              </>
            )}
            {many && at !== null && (
              <span className="mlb-step">
                <button className="icon-button" onClick={() => step(-1)} aria-label="Previous option">
                  <ChevronLeft size={18} />
                </button>
                <span className="mlb-count mono">
                  {at + 1} of {items.length}
                </span>
                <button className="icon-button" onClick={() => step(1)} aria-label="Next option">
                  <ChevronRight size={18} />
                </button>
              </span>
            )}
            <button ref={closeButton} className="icon-button" onClick={close} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        {item && <Stage key={item.path} item={item} />}
      </dialog>
    </>
  );
}

// The mockup at its own frame: a phone at its natural width, centred, scaled down only when the window is smaller;
// a desktop mockup fills the stage, and is laid out at 1280 and scaled down when the stage is narrower than 960.
function Stage({ item }: { item: Item }) {
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<[number, number] | null>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setBox([el.clientWidth, el.clientHeight]);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [W, H] = item.size;
  let frame: { width: number; height: number; scale: number } | null = null;
  if (box) {
    const [sw, sh] = box;
    if (item.frame === "phone") {
      const scale = Math.min(1, sw / W, sh / H);
      frame = { width: W, height: H, scale };
    } else {
      const scale = sw >= 960 ? 1 : sw / W;
      frame = { width: sw / scale, height: sh / scale, scale };
    }
  }
  return (
    <div ref={stage} className="mlb-stage">
      {frame && (
        <div className={`mlb-device mlb-${item.frame}`} style={{ width: frame.width * frame.scale, height: frame.height * frame.scale }}>
          <iframe
            src={mockupHref(item.path)}
            title={item.label}
            sandbox="allow-scripts"
            style={{ width: frame.width, height: frame.height, transform: `scale(${frame.scale})` }}
          />
        </div>
      )}
    </div>
  );
}
