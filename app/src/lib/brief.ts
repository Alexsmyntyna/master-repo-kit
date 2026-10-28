// An agent message read as a brief: a lead, labelled callouts, sections that sit side by side, and two diagram
// blocks agents can draw (tools/converse.py VISUAL_RULE):
//
//   ```stats                         ```flow
//   82/100 | Dispo reviews at 3★ or less | last 100   Ship 1.3.x from main | week 1 | now
//   4.8★ | Lapse rating                    Bring in one 1.4 piece | week 2–3
//   ```                                  Re-check the RN question | after 1.4 | risk
//                                        ```
//
// Everything else stays markdown. Machine blocks (options, mockups, release) are drawn elsewhere and removed here.
export type Stat = { value: string; label: string; note: string };
export type StepState = "done" | "now" | "next" | "risk" | "";
export type Step = { label: string; note: string; state: StepState };
export type Tone = "decision" | "risk" | "cost" | "question" | "evidence" | "next" | "plain";
export type Block =
  | { type: "md"; text: string }
  | { type: "callout"; label: string; text: string; tone: Tone }
  | { type: "section"; label: string; text: string; tone: Tone }
  | { type: "stats"; items: Stat[] }
  | { type: "flow"; steps: Step[] }
  | { type: "reconcile"; items: Reconciled[] };
// Other open questions the CEO withdrew or recomputed because of the owner's answer (tools/converse.py RECONCILE_RULE).
export type Reconciled = { thread: string; action: "withdraw" | "redo"; why: string; href: string };
export type Brief = { lead: string; blocks: Block[] };

export function toneOf(label: string): Tone {
  const l = label.toLowerCase();
  if (/question|ask|unknown|open/.test(l)) return "question";
  if (/decision|recommend|proposal|verdict|decided|answer/.test(l)) return "decision";
  if (/risk|non-negotiable|blocker|warning|revisit|reopen|watch/.test(l)) return "risk";
  if (/cost|gives? up|trade/.test(l)) return "cost";
  if (/evidence|found|data|market|why|because|numbers?/.test(l)) return "evidence";
  if (/next|plan|step|week|then/.test(l)) return "next";
  return "plain";
}

const cells = (line: string) => line.split("|").map((s) => s.trim());
const STATES = new Set(["done", "now", "next", "risk"]);

export function parseStats(text: string): Stat[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [value = "", label = "", note = ""] = cells(l);
      return { value, label, note };
    })
    .filter((s) => s.value && s.label);
}

export function parseFlow(text: string): Step[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const parts = cells(l);
      const last = (parts.at(-1) || "").toLowerCase();
      const state = (parts.length > 1 && STATES.has(last) ? last : "") as StepState;
      if (state) parts.pop();
      return { label: parts[0] || "", note: parts.slice(1).join(" · "), state };
    })
    .filter((s) => s.label);
}

export function threadHrefOf(path: string): string {
  const m = path.match(/^(?:companies\/([a-z0-9-]+)|(holding))\/threads\/([a-z0-9-]+)$/);
  return m ? `/threads/${m[1] || m[2]}/${m[3]}` : "";
}

export function parseReconcile(text: string): Reconciled[] {
  return text
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim().replace(/^`|`$/g, "")))
    .filter((p) => p.length >= 3 && (p[1] === "withdraw" || p[1] === "redo"))
    .map((p) => ({ thread: p[0], action: p[1] as "withdraw" | "redo", why: p.slice(2).join(" | "), href: threadHrefOf(p[0]) }))
    .filter((r) => r.href);
}

// Paragraph chunks split on blank lines, keeping fenced code (which may hold blank lines) whole.
function chunks(body: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  const flush = () => {
    if (cur.join("").trim()) out.push(cur.join("\n").trim());
    cur = [];
  };
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (!fence) flush();
      cur.push(line);
      fence = !fence;
      if (!fence) flush();
      continue;
    }
    if (!fence && !line.trim()) flush();
    else cur.push(line);
  }
  flush();
  return out;
}

const MACHINE = /```(?:options|release|mockups)\n[\s\S]*?(?:```|$)/g;
const HEADING = /^(?:#{2,4}\s+(.+?)|\*\*([^*\n]{1,70}?):?\*\*:?)\s*$/; // a label on its own line opens a section
const CALLOUT = /^\*\*([^*\n]{1,48}?):\*\*\s+([\s\S]+)$|^\*\*([^*\n]{1,48}?)\*\*:\s+([\s\S]+)$/;

// A label sits beside its text only where labels come in a run: two or more labelled parts with nothing but other
// labelled parts or diagrams between them. A lone label ("**Smallest test:** read 30 days of traffic") stays a plain
// paragraph with its bold label, as the writer put it.
function demoteLoneLabels(blocks: Block[], raw: WeakMap<Block, string>): Block[] {
  const out: Block[] = [];
  let run: Block[] = [];
  const flush = () => {
    const lone = run.filter((b) => b.type === "callout" || b.type === "section").length < 2;
    for (const b of run) {
      if (lone && b.type === "callout") out.push({ type: "md", text: raw.get(b) || `**${b.label}:** ${b.text}` });
      else if (lone && b.type === "section") out.push({ type: "md", text: [raw.get(b) || `**${b.label}**`, b.text].filter(Boolean).join("\n\n") });
      else out.push(b);
    }
    run = [];
  };
  for (const b of blocks) {
    if (b.type !== "md") run.push(b);
    else {
      flush();
      out.push(b);
    }
  }
  flush();
  // A demoted label rejoins the plain text around it.
  return out.reduce<Block[]>((acc, b) => {
    const prev = acc.at(-1);
    if (b.type === "md" && prev?.type === "md") prev.text += `\n\n${b.text}`;
    else acc.push(b.type === "md" ? { ...b } : b);
    return acc;
  }, []);
}

export function parseBrief(body: string): Brief {
  let blocks: Block[] = [];
  const raw = new WeakMap<Block, string>(); // a callout's markdown, a section's label line: to put a lone one back as written
  let section: Extract<Block, { type: "section" }> | undefined;
  for (const chunk of chunks(body.replace(MACHINE, "").trim())) {
    const fenced = chunk.match(/^```(stats|flow|reconcile)\n([\s\S]*?)\n?(?:```)?$/);
    if (fenced) {
      section = undefined;
      if (fenced[1] === "reconcile") {
        const items = parseReconcile(fenced[2]);
        if (items.length) blocks.push({ type: "reconcile", items });
      } else if (fenced[1] === "stats") {
        const items = parseStats(fenced[2]);
        if (items.length) blocks.push({ type: "stats", items });
      } else {
        const steps = parseFlow(fenced[2]);
        if (steps.length) blocks.push({ type: "flow", steps });
      }
      continue;
    }
    const lines = chunk.split("\n");
    const head = lines[0].match(HEADING);
    if (head && !chunk.startsWith("```")) {
      const label = (head[1] || head[2]).replace(/:$/, "").trim();
      section = { type: "section", label, text: lines.slice(1).join("\n").trim(), tone: toneOf(label) };
      raw.set(section, lines[0]);
      blocks.push(section);
      continue;
    }
    const call = chunk.match(CALLOUT);
    if (call) {
      section = undefined;
      const label = (call[1] || call[3]).trim();
      const callout: Block = { type: "callout", label, text: (call[2] || call[4]).trim(), tone: toneOf(label) };
      raw.set(callout, chunk);
      blocks.push(callout);
      continue;
    }
    if (section) section.text = section.text ? `${section.text}\n\n${chunk}` : chunk;
    else {
      const prev = blocks.at(-1);
      if (prev?.type === "md") prev.text += `\n\n${chunk}`;
      else blocks.push({ type: "md", text: chunk });
    }
  }
  blocks = demoteLoneLabels(blocks, raw);
  // The opening plain paragraph is the lead: what the message says, in a sentence or two.
  let lead = "";
  const first = blocks[0];
  if (first?.type === "md") {
    const [para, ...rest] = chunks(first.text);
    if (para && !/^(\s*[-*>|#]|\s*\d+[.)]\s|```)/.test(para)) {
      lead = para;
      if (rest.length) first.text = rest.join("\n\n");
      else blocks.shift();
    }
  }
  return { lead, blocks };
}
