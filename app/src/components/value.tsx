import { hasValue, isClaim, label, type Claim } from "@/lib/model";
import { Fold, KV, Row, Rows, Section, Source, Statement } from "./ds";

// ---- claims from company.json, in order of trust (the strategic model page)

export type Labelled = { label?: string; claim: Claim };
const trust = (c: Claim) => ({ owner: 0, alex: 0, code: 1, public: 2 })[c.source || ""] ?? 3;
export const isAgent = (c: Claim) => trust(c) === 3;

// Flattens a field (a claim, a list, or an object of either) into labelled claims, the owner's first, agents' last.
export function claimsOf(value: unknown, name?: string): Labelled[] {
  const walk = (v: unknown, l?: string): Labelled[] => {
    if (!hasValue(v)) return [];
    if (isClaim(v)) return [{ label: l, claim: v }];
    if (Array.isArray(v)) return v.flatMap((x) => walk(x, l));
    if (typeof v === "object" && v) {
      const r = v as Record<string, unknown>;
      // A plain record such as { name, path, note } reads as one line.
      if (l && Object.values(r).every((x) => x === null || typeof x !== "object"))
        return [{ label: l, claim: { text: Object.values(r).filter((x) => x !== null && x !== "").join(" · ") } }];
      return Object.entries(r).flatMap(([k, x]) => walk(x, label(k)));
    }
    return [{ label: l, claim: { text: String(v) } }];
  };
  return walk(value, name)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => trust(a.x.claim) - trust(b.x.claim) || a.i - b.i)
    .map(({ x }) => x);
}

// Every claim under a value, for counting by source.
export function allClaims(value: unknown): Claim[] {
  if (isClaim(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(allClaims);
  if (value && typeof value === "object") return Object.values(value).flatMap(allClaims);
  return [];
}

// A titled block of claims. the owner's and code's statements show in full; when an agent's readings sit beside
// them they fold. Sub-fields with nothing recorded are named in one faint line.
export function ClaimSection({ title, fields }: { title: string; fields: [string, unknown][] }) {
  const claims = fields.flatMap(([k, v]) => claimsOf(v, fields.length > 1 && k !== title ? k : undefined));
  const missing = fields.filter(([, v]) => !hasValue(v)).map(([k]) => k.toLowerCase());
  const trusted = claims.filter((c) => !isAgent(c.claim));
  const agent = claims.filter((c) => isAgent(c.claim));
  const foldAgent = trusted.length > 0 && agent.length > 2;
  const list = (xs: Labelled[]) => xs.map((c, i) => <Statement key={i} label={c.label} value={c.claim} />);
  return (
    <Section title={title}>
      {claims.length ? (
        <div className="claims">
          {list(trusted)}
          {foldAgent ? (
            <Fold summary={`${agent.length} agent readings`}>{list(agent)}</Fold>
          ) : (
            list(agent)
          )}
        </div>
      ) : null}
      {missing.length > 0 && (
        <p className="claims-missing">
          {missing.length === fields.length ? "Not recorded" : `Not recorded: ${missing.join(", ")}`}
        </p>
      )}
    </Section>
  );
}

// An agent's assumptions, risks, questions or proposals: quieter rows, each marked with its source.
export function QuietClaims({ title, value, empty }: { title: string; value: unknown; empty?: string }) {
  const claims = claimsOf(value);
  if (!claims.length && !empty) return null;
  return (
    <Section title={title} note={claims.length || undefined} className="quiet-claims">
      {claims.length ? (
        <Rows dense>
          {claims.map((c, i) => (
            <Row
              key={i}
              title={c.claim.text}
              meta={[c.label, <Source key="s" who={c.claim.source} date={c.claim.date} cite={c.claim.ref} />]}
            />
          ))}
        </Rows>
      ) : (
        <p className="claims-missing">{empty}</p>
      )}
    </Section>
  );
}
// Any stored value as it is: a claim in its source's voice, a list, or labelled fields.
export function Value({ value }: { value: unknown }) {
  if (!hasValue(value)) return <p className="empty-inline">Not recorded</p>;
  if (isClaim(value)) return <Statement value={value} />;
  if (Array.isArray(value))
    return (
      <div className="value-list">
        {value.map((entry, i) => (
          <div className="value-item" key={i}>
            <Value value={entry} />
          </div>
        ))}
      </div>
    );
  if (typeof value === "object" && value)
    return <KV items={Object.entries(value).map(([key, entry]) => [label(key), <Value key={key} value={entry} />])} />;
  return <p className="plain-value">{String(value)}</p>;
}
