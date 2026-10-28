// A project's finish line (publish, sell, client, tool, learn, maintain) as a small square-cornered chip. Solid when
// the owner said it, dashed when an agent proposed it and they hasn't confirmed.
export function KindChip({ kind, source }: { kind: string; source?: string }) {
  if (!kind) return null;
  const owned = ["owner", "alex"].includes(source || "");
  return (
    <span className={`kind-chip${owned ? "" : " is-proposed"}`} title={`Finish line: ${kind} · ${owned ? "you said" : "agent proposed"}`}>
      {kind}
    </span>
  );
}
