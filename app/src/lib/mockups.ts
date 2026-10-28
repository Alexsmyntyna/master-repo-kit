// Agents end a message with a ```mockups block (tools/converse.py MOCKUP_RULE): "A | label | path" per line,
// pointing at self-contained HTML files under companies/<slug>/mockups/ or holding/mockups/.
export type Mockup = { letter: string; label: string; path: string };

export const MOCKUP_PATH = /^(companies\/[a-z0-9-]+|holding)\/mockups\/[a-z0-9-]+\/[a-z0-9-]+\.html$/;
const BLOCK = /```mockups\n([\s\S]*?)(?:```|$)/;

export function parseMockups(body: string): Mockup[] {
  const m = body.match(BLOCK);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => line.split("|").map((s) => s.trim()))
    .filter((parts) => parts.length >= 3 && MOCKUP_PATH.test(parts[2].replace(/^\.\//, "")))
    .map(([letter, label, p]) => ({ letter: letter.replace(/\*$/, ""), label, path: p.replace(/^\.\//, "") }));
}

export const stripMockups = (body: string) => body.replace(/```mockups\n[\s\S]*?(?:```|$)/g, "").trim();
export const mockupHref = (p: string) => `/mockups?path=${encodeURIComponent(p)}`;

// The device a mockup is drawn for, sized in the lightbox (components/mockup-lightbox.tsx). A review's index.html
// takes review.md's frame and size. A bare file is a phone when its style draws a phone, a box 300–480px wide and
// 700px tall or more (".ph{width:390px;height:844px}"), counted with the body's padding; anything else is desktop.
export type MockupFrame = { frame: "phone" | "desktop"; size: [number, number] };
export const DESKTOP_FRAME: MockupFrame = { frame: "desktop", size: [1280, 800] };

export function sniffFrame(html: string): MockupFrame {
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const pad = Number(style.match(/\bbody\s*\{[^}]*?\bpadding:\s*(\d{1,3})px/)?.[1] || 0);
  for (const m of style.matchAll(/\{[^}]*?\bwidth:\s*(\d{3})px;\s*height:\s*(\d{3,4})px/g)) {
    const [w, h] = [Number(m[1]), Number(m[2])];
    if (w >= 300 && w <= 480 && h >= 700) return { frame: "phone", size: [w + 2 * pad, h + 2 * pad] };
  }
  return DESKTOP_FRAME;
}

// ---------- Mockup reviews (skills/mockup-review.md). companies/<slug>/mockups/<YYYY-MM-DD>-<topic>/ holds one mockup
// (index.html, maybe a few more screens) and review.md: frontmatter title, date, status open|answered|archived, thread, frame,
// screens and questions; the body is the trade-offs. the owner's answers and pinned notes go to notes.md beside them.

export const REVIEW_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
const SCREEN = /^[a-z0-9-]+\.html(#[a-z0-9-]+)?$/;
const THREAD = /^(companies\/[a-z0-9-]+|holding)\/threads\/[a-z0-9-]+$/;

export type ReviewScreen = { file: string; label: string };
export type ReviewQuestion = { ask: string; shown: string; screen: string };
// x and y are fractions of the frame; scroll is how far the mockup was scrolled (px) when the pin was dropped, so the
// pin sits at y * height + scroll in the page and moves with it. Missing means the top of the page.
// images are uploads (holding/uploads/…, at most four) shown with the note.
export type Pin = { n: number; screen: string; x: number; y: number; scroll?: number; text: string; images?: string[]; date: string };
export type ReviewNotes = { updated: string; answers: string[]; pins: Pin[]; note: string; typed?: TypedNotes };
// What the owner typed where the spelling fixer changed it (app/DESIGN.md, Spelling): answers and pins by index, and the
// overall note. Kept in notes.md's frontmatter only; the body and the thread post carry the fixed text.
export type TypedNotes = { answers?: Record<number, string>; pins?: Record<number, string>; note?: string };
export type MockupReview = {
  slug: string;
  id: string;
  dir: string; // repo-relative folder
  title: string;
  date: string;
  status: "open" | "answered" | "archived";
  answered: string;
  thread: string;
  frame: "phone" | "desktop";
  size: [number, number];
  screens: ReviewScreen[];
  questions: ReviewQuestion[];
  tradeoffs: string;
  source: string;
  notes: ReviewNotes;
};

const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function toReview(
  slug: string,
  id: string,
  meta: Record<string, unknown>,
  body: string,
  notesMeta?: Record<string, unknown>,
): MockupReview {
  const frame = meta.frame === "desktop" ? "desktop" : "phone";
  const size = String(meta.size || "").match(/^(\d{3,4})x(\d{3,4})$/);
  const screens = list(meta.screens)
    .map((s) => (typeof s === "string" ? { file: s, label: s } : { file: str(rec(s).file), label: str(rec(s).label) }))
    .filter((s) => SCREEN.test(s.file))
    .map((s) => ({ file: s.file, label: s.label || s.file }));
  if (!screens.length) screens.push({ file: "index.html", label: "Mockup" });
  const questions = list(meta.questions)
    .map((q) =>
      typeof q === "string" ? { ask: q, shown: "", screen: "" } : { ask: str(rec(q).ask), shown: str(rec(q).shown), screen: str(rec(q).screen) },
    )
    .filter((q) => q.ask)
    .map((q) => ({ ...q, screen: screens.some((s) => s.file === q.screen) ? q.screen : "" }));
  const n = rec(notesMeta);
  return {
    slug,
    id,
    dir: `companies/${slug}/mockups/${id}`,
    title: str(meta.title) || id,
    date: str(meta.date) || id.slice(0, 10),
    status: meta.status === "answered" || meta.status === "archived" ? meta.status : "open",
    answered: str(meta.answered),
    thread: THREAD.test(str(meta.thread)) ? str(meta.thread) : "",
    frame,
    size: size ? [Number(size[1]), Number(size[2])] : frame === "phone" ? [402, 874] : [1280, 800],
    screens,
    questions,
    tradeoffs: body.trim(),
    source: str(meta.source),
    notes: {
      updated: str(n.updated),
      answers: list(n.answers).map((a) => (typeof a === "string" ? a : "")),
      pins: cleanPins(n.pins, screens),
      note: str(n.note),
      ...(() => {
        const typed = cleanTyped(n.typed);
        return typed ? { typed } : {};
      })(),
    },
  };
}

// The typed map as notes.md holds it (YAML turns the indexes into string keys), or undefined when there is none.
export function cleanTyped(raw: unknown): TypedNotes | undefined {
  const byIndex = (v: unknown) => {
    const out: Record<number, string> = {};
    for (const [k, text] of Object.entries(rec(v)))
      if (/^\d{1,3}$/.test(k) && typeof text === "string" && text.trim()) out[Number(k)] = text;
    return Object.keys(out).length ? out : undefined;
  };
  const t = rec(raw);
  const answers = byIndex(t.answers);
  const pins = byIndex(t.pins);
  const typed: TypedNotes = {
    ...(answers ? { answers } : {}),
    ...(pins ? { pins } : {}),
    ...(typeof t.note === "string" && t.note.trim() ? { note: t.note } : {}),
  };
  return Object.keys(typed).length ? typed : undefined;
}

// The typed map from what was typed and what was saved, index by index; undefined when nothing changed. Spread it
// into the notes only when set (`...(typed ? { typed } : {})`): matter.stringify throws on an undefined value.
export function typedNotes(
  typed: { answers?: string[]; pins?: string[]; note?: string },
  saved: { answers: string[]; pins: string[]; note: string },
): TypedNotes | undefined {
  const changed = (a: string[] = [], b: string[]) =>
    Object.fromEntries(a.flatMap((text, i) => (text.trim() && text.trim() !== (b[i] ?? "").trim() ? [[i, text]] : [])));
  return cleanTyped({
    answers: changed(typed.answers, saved.answers),
    pins: changed(typed.pins, saved.pins),
    note: typed.note?.trim() && typed.note.trim() !== saved.note.trim() ? typed.note : undefined,
  });
}

const PIN_IMAGE = /^holding\/uploads\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.(png|jpe?g|gif|webp|heic)$/i;
const pinImages = (v: unknown) => list(v).filter((s): s is string => typeof s === "string" && PIN_IMAGE.test(s)).slice(0, 4);

// Pins as the browser sent them (or notes.md holds them): kept to the review's screens, numbered in order.
export function cleanPins(raw: unknown, screens: ReviewScreen[], today = ""): Pin[] {
  const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
  return list(raw)
    .map(rec)
    .filter((p) => (str(p.text) || pinImages(p.images).length) && screens.some((s) => s.file === p.screen))
    .slice(0, 60)
    .map((p, i) => ({
      n: i + 1,
      screen: String(p.screen),
      x: Math.round(clamp(p.x) * 1000) / 1000,
      y: Math.round(clamp(p.y) * 1000) / 1000,
      ...(Number(p.scroll) > 0 ? { scroll: Math.min(100000, Math.round(Number(p.scroll))) } : {}),
      text: str(p.text).slice(0, 2000),
      ...(pinImages(p.images).length ? { images: pinImages(p.images) } : {}),
      date: /^\d{4}-\d{2}-\d{2}$/.test(str(p.date)) ? str(p.date) : today,
    }));
}

// notes.md's body, which is also what goes to the thread: plain enough for the agent to act on.
// `who` is the owner's short name (local/owner.json); the browser loads this file too, so it's passed in.
export function notesMarkdown(r: MockupReview, notes: ReviewNotes, who = ""): string {
  const label = (file: string) => r.screens.find((s) => s.file === file)?.label || file;
  const whose = !who ? "Notes" : who === "You" ? "Your notes" : `${who}'s notes`;
  const parts = [`# ${whose} on "${r.title}"`, "", `Mockup: \`${r.dir}/\` (in the app: /companies/${r.slug}/mockups/${r.id}).`];
  const answered = r.questions.map((q, i) => [q, (notes.answers[i] || "").trim()] as const).filter(([, a]) => a);
  if (answered.length) parts.push("", "## Answers", ...answered.map(([q, a]) => `- **${q.ask}** ${a}`));
  if (notes.pins.length)
    parts.push(
      "",
      "## Pinned on the mockup",
      ...notes.pins.map((p) => `${p.n}. ${label(p.screen)}, ${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down${p.scroll ? ` (scrolled ${p.scroll}px)` : ""}: ${p.text}${p.images?.length ? ` [images: ${p.images.join(", ")}]` : ""}`),
    );
  if (notes.note.trim()) parts.push("", "## Overall", notes.note.trim());
  return parts.join("\n") + "\n";
}

export const noteCount = (n: ReviewNotes) => n.pins.length + (n.note ? 1 : 0);

// A mockups-block line pointing at a review's index.html opens the review, not the bare file.
export function reviewOf(p: string): { slug: string; id: string } | undefined {
  const m = p.match(/^companies\/([a-z0-9-]+)\/mockups\/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\/index\.html$/);
  return m ? { slug: m[1], id: m[2] } : undefined;
}
export function mockupLink(p: string): string {
  const r = reviewOf(p);
  return r ? `/companies/${r.slug}/mockups/${r.id}` : mockupHref(p);
}

// Added to every mockup the app serves (app/mockups/route.ts): it tells the review page how far it is scrolled, so pins
// stay on the part of the page they were dropped on, and scrolls to a pin when the page asks.
const SCROLL_REPORTER = `<script>(function(){function s(){parent.postMessage({mockupScroll:scrollY},"*")}addEventListener("scroll",s,{passive:true});addEventListener("load",s);addEventListener("hashchange",function(){setTimeout(s,0)});addEventListener("message",function(e){var d=e.data;if(!d)return;if(typeof d.mockupScrollTo==="number")scrollTo(0,d.mockupScrollTo);var b=d.mockupScrollBy;if(b&&typeof b.dy==="number"){for(var el=document.elementFromPoint(b.x,b.y);el&&el!==document.body&&el!==document.documentElement;el=el.parentElement){var o=getComputedStyle(el).overflowY;if((o==="auto"||o==="scroll")&&el.scrollHeight>el.clientHeight&&(b.dy<0?el.scrollTop>0:el.scrollTop+el.clientHeight<el.scrollHeight)){el.scrollBy(b.dx,b.dy);return}}scrollBy(b.dx,b.dy)}})})()</script>`;

export function withScrollReporter(html: string): string {
  const at = html.lastIndexOf("</body>");
  return at < 0 ? html + SCROLL_REPORTER : html.slice(0, at) + SCROLL_REPORTER + html.slice(at);
}
