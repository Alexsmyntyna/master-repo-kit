// The ```options block that ends a decision (tools/converse.py OPTIONS_RULE), parsed. No server imports, so the
// chat dock can draw it too; lib/decisions.ts re-exports all of it.
export type Level = "low" | "medium" | "high";
export type Option = {
  key: string;
  label: string;
  recommended: boolean;
  time: string;
  weeks: number | null; // upper bound of `time` in weeks, so options can be drawn to scale
  complexity: Level | null;
  growth: Level | null;
  costs: string;
};
export type Card = { ask: string; options: Option[]; revisit: string };

const level = (v: string | undefined): Level | null => {
  const s = (v || "").trim().toLowerCase();
  if (/^(low|small|simple|none)/.test(s)) return "low";
  if (/^(med|moderate|some)/.test(s)) return "medium";
  if (/^(high|large|big|hard)/.test(s)) return "high";
  return null;
};

// "1 week", "3–5 months", "2-3 days", "10 hours" → weeks (upper bound). Days are working days; hours are a 40-hour week.
export function toWeeks(time: string): number | null {
  const m = time.match(/(\d+(?:\.\d+)?)(?:\s*(?:–|-|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h\b|days?|d\b|weeks?|wks?|w\b|months?|mos?|quarters?)/i);
  if (!m) return null;
  const n = Number(m[2] || m[1]);
  const unit = m[3].toLowerCase();
  const per = unit.startsWith("h") ? 1 / 40 : unit.startsWith("d") ? 1 / 5 : unit.startsWith("w") ? 1 : unit.startsWith("q") ? 13 : 4.33;
  return Math.round(n * per * 100) / 100;
}

const BLOCK = /```options\n([\s\S]*?)(?:```|$)/;

export function parseCard(body: string): Card | undefined {
  const m = body.match(BLOCK);
  if (!m) return undefined;
  const card: Card = { ask: "", options: [], revisit: "" };
  for (const raw of m[1].split("\n")) {
    const line = raw.replace(/^\s*[-*]\s+(?=[A-Z]\*?\s*\|)/, "").trim();
    const kv = line.match(/^(ask|revisit):\s*(.+)$/i);
    if (kv) {
      card[kv[1].toLowerCase() as "ask" | "revisit"] = kv[2].trim();
      continue;
    }
    const opt = line.match(/^([A-Z])(\*)?\s*\|(.*)$/);
    if (!opt) continue;
    const [label = "", ...rest] = opt[3].split("|").map((s) => s.trim());
    const fields: Record<string, string> = {};
    for (const part of rest) {
      const f = part.match(/^([a-z ]+):\s*(.*)$/i);
      if (f) fields[f[1].trim().toLowerCase()] = f[2].trim();
    }
    const time = fields.time || "";
    card.options.push({
      key: opt[1],
      label,
      recommended: !!opt[2],
      time,
      weeks: time ? toWeeks(time) : null,
      complexity: level(fields.complexity),
      growth: level(fields.growth),
      costs: fields.costs || fields["gives up"] || "",
    });
  }
  if (!card.options.length) return undefined;
  if (!card.options.some((o) => o.recommended)) card.options[0].recommended = true;
  return card;
}

// The message without its machine blocks, for reading.
export const stripBlocks = (body: string) =>
  body.replace(/```(?:options|release|mockups|reconcile)\n[\s\S]*?(?:```|$)/g, "").trim();
