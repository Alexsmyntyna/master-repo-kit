import { dateLabel } from "@/lib/model";

// Whose statement this is, and when: the one rendering of the You / Code / Agent tag. `Source` in ds.tsx is this
// component under its older name. "auto" is a message a tool or button wrote in the owner's name (isGenerated in
// lib/voice.ts): not their words.
export type Who = "owner" | "alex" | "code" | "agent" | "public" | "auto";
export const whoLabels: Record<Who, string> = { owner: "You", alex: "You", code: "Code", agent: "Agent", public: "Public", auto: "Automatic" };
export const whoOf = (s?: string): Who => (s === "alex" ? "owner" : s === "owner" || s === "code" || s === "public" || s === "auto" ? s : "agent");

// The tag: a small square in the source's colour, its name, the date. `label` names the agent ("CEO"); `cite` is the
// file or message it comes from, shown on hover.
export function Provenance({ who, date, cite, label }: { who?: string; date?: unknown; cite?: string; label?: string }) {
  const w = whoOf(who);
  const label_ = date ? dateLabel(date) : "";
  // A month alone ("2026-10") isn't a date dateLabel reads; show it as written.
  const when = label_ === "Not recorded" && typeof date === "string" && /^\d{4}-\d{2}$/.test(date) ? date : label_;
  return (
    <span className={`src src-${w}`} title={cite || undefined}>
      <i aria-hidden />
      {label || whoLabels[w]}
      {!!when && when !== "Not recorded" && <span className="src-date">{when}</span>}
    </span>
  );
}

// A line in its source's voice with its tag after it: the owner's words in serif, code in mono, an agent's in the sans.
export function Voiced({ text, who, date, cite }: { text: React.ReactNode; who?: string; date?: unknown; cite?: string }) {
  const w = whoOf(who);
  return (
    <>
      <span className={`voiced voice-${w}`}>{text}</span>
      <Provenance who={w} date={date} cite={cite} />
    </>
  );
}
