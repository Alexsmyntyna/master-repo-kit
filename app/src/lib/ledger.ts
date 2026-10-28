// A standards file (standards/*.md) read as a ledger: headings, then rule lines "- text (who: ref, date)". Anything
// else (intro paragraphs, nested lists) stays Markdown. Client-safe.

export type LedgerRule = { text: string; who: string; ref: string; date: string; struck: boolean };
export type LedgerBlock = { type: "heading"; text: string } | { type: "rules"; rules: LedgerRule[] } | { type: "markdown"; content: string };

const SOURCE = /\s*\((alex|owner|code|agent|public|kit)(?:\s*[:,]\s*|(?=\)))([^()]*(?:\([^()]*\)[^()]*)*)\)\s*\.?\s*$/;
const DATE = /,?\s*(\d{4}-\d{2}(?:-\d{2})?)\s*$/;

export function ruleOf(line: string): LedgerRule {
  let text = line.replace(/^\s*[-*]\s+/, "").trim();
  let who = "",
    ref = "",
    date = "";
  const m = text.match(SOURCE);
  if (m) {
    who = m[1];
    ref = m[2].trim();
    text = text.slice(0, m.index).trim();
    const d = ref.match(DATE);
    if (d) {
      date = d[1];
      ref = ref.slice(0, d.index).trim();
    }
  }
  const struck = /^~~.*~~\.?$/.test(text);
  return { text: struck ? text.replace(/^~~|~~(\.?)$/g, "$1") : text, who, ref, date, struck };
}

export function parseLedger(markdown: string): LedgerBlock[] {
  const out: LedgerBlock[] = [];
  let md: string[] = [];
  const flush = () => {
    const content = md.join("\n").trim();
    if (content) out.push({ type: "markdown", content });
    md = [];
  };
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^#{2,3}\s+(.+)$/);
    if (h) {
      flush();
      out.push({ type: "heading", text: h[1].trim() });
    } else if (/^[-*]\s+/.test(line) && !/^\s+/.test(lines[i + 1] || "")) {
      flush();
      const last = out.at(-1);
      const rule = ruleOf(line);
      if (last?.type === "rules") last.rules.push(rule);
      else out.push({ type: "rules", rules: [rule] });
    } else md.push(line);
  }
  flush();
  return out;
}
