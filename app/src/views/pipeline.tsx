import { Source } from "@/components/ds";
import { readJson } from "@/lib/repository";
import type { ViewProps } from "./registry";
import "@/styles/views.css";

// A project's data pipeline drawn from a JSON file in the repo (option `file`, e.g.
// companies/shop-app/pipeline.json): boxes in four layers, left to right, and numbered arrows.
// The numbers key into the list under the drawing, which carries each arrow's label, state and evidence.

// `layer` and `row` are optional: without them a node goes in its kind's layer, below the ones before it.
type Node = { id: string; label: string; kind: string; layer?: string; row?: number; detail?: string; ref?: string };
type Edge = { from: string; to: string; label: string; state: string; ref?: string };
type Pipeline = { updated?: string; nodes: Node[]; edges: Edge[] };

const LAYERS = ["capture", "processing", "storage", "publish"] as const;
const LAYER_NAMES = ["Capture", "Processing", "Storage", "Publish and sell"];
// Where a node goes when the file doesn't say.
const KIND_LAYER: Record<string, number> = { app: 0, server: 1, service: 1, store: 2, site: 3, external: 3 };
const STATES = ["built", "untested", "planned", "unknown"] as const;
const stateOf = (s: string) => ((STATES as readonly string[]).includes(s) ? s : "unknown");

const W = 1000,
  BOX_W = 176,
  BOX_H = 54,
  ROW = 100,
  TOP = 34;

type Pt = { x: number; y: number };
const bezier = (p: Pt[], t: number): Pt => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
};
// Where along a curve its number goes: the first point that is off every box and clear of earlier numbers.
const BADGE_TS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.15, 0.85];

function layerOf(n: Node) {
  const i = LAYERS.indexOf(n.layer as (typeof LAYERS)[number]);
  return i >= 0 ? i : (KIND_LAYER[n.kind] ?? 1);
}

function isPipeline(d: unknown): d is Pipeline {
  const p = d as Pipeline;
  return !!p && Array.isArray(p.nodes) && Array.isArray(p.edges);
}

export async function PipelineView({ options }: ViewProps) {
  const file = options.file;
  if (!file) return <p className="view-empty">Set <code>file:</code> to a pipeline JSON path.</p>;
  let data: unknown;
  try {
    data = await readJson(file);
  } catch {
    return <p className="view-empty">No pipeline file at <code>{file}</code>.</p>;
  }
  if (!isPipeline(data)) return <p className="view-empty"><code>{file}</code> has no nodes and edges.</p>;

  // Place boxes: one column per layer, stacked in file order.
  const columns: Node[][] = LAYERS.map(() => []);
  data.nodes.forEach((n) => columns[layerOf(n)].push(n));
  const colX = (c: number) => 4 + (c * (W - 8 - BOX_W)) / (LAYERS.length - 1);
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, c) => {
    let next = 0;
    col.forEach((n) => {
      const r = typeof n.row === "number" && n.row >= 0 ? n.row : next;
      next = Math.floor(r) + 1;
      pos.set(n.id, { x: colX(c), y: TOP + r * ROW });
    });
  });
  const H = Math.max(...[...pos.values()].map((p) => p.y)) + BOX_H + 12;
  const onBox = (q: Pt) => [...pos.values()].some((b) => q.x > b.x - 10 && q.x < b.x + BOX_W + 10 && q.y > b.y - 10 && q.y < b.y + BOX_H + 10);
  const badges: Pt[] = [];

  // Arrows between the same two boxes are spread apart so they don't sit on top of each other.
  const edges = data.edges.filter((e) => pos.has(e.from) && pos.has(e.to));
  const pairCount = new Map<string, number>();
  const pairKey = (e: Edge) => [e.from, e.to].sort().join("|");
  edges.forEach((e) => pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) || 0) + 1));
  const pairSeen = new Map<string, number>();

  const paths = edges.map((e, i) => {
    const a = pos.get(e.from)!,
      b = pos.get(e.to)!;
    const key = pairKey(e);
    const k = pairSeen.get(key) || 0;
    pairSeen.set(key, k + 1);
    const off = (k - ((pairCount.get(key) || 1) - 1) / 2) * 16;
    let p0: Pt, p3: Pt, c1: Pt, c2: Pt;
    if (Math.abs(a.x - b.x) < 1) {
      // Same column: straight down (or up) from one box to the next.
      const down = b.y > a.y;
      p0 = { x: a.x + BOX_W / 2 + off, y: down ? a.y + BOX_H : a.y };
      p3 = { x: b.x + BOX_W / 2 + off, y: down ? b.y : b.y + BOX_H };
      const dy = ((p3.y - p0.y) / 3) || 1;
      c1 = { x: p0.x, y: p0.y + dy };
      c2 = { x: p3.x, y: p3.y - dy };
    } else {
      const forward = b.x > a.x;
      p0 = { x: forward ? a.x + BOX_W : a.x, y: a.y + BOX_H / 2 + off };
      p3 = { x: forward ? b.x : b.x + BOX_W, y: b.y + BOX_H / 2 + off };
      const dx = Math.max(40, Math.abs(p3.x - p0.x) / 2) * (forward ? 1 : -1);
      c1 = { x: p0.x + dx, y: p0.y };
      c2 = { x: p3.x - dx, y: p3.y };
    }
    const curve = [p0, c1, c2, p3];
    const free = (q: Pt) => !onBox(q) && badges.every((o) => Math.hypot(o.x - q.x, o.y - q.y) > 21);
    const mid = BADGE_TS.map((t) => bezier(curve, t)).find(free) || bezier(curve, 0.5);
    badges.push(mid);
    return { e, n: i + 1, state: stateOf(e.state), d: `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`, mid };
  });

  const label = (id: string) => data.nodes.find((n) => n.id === id)?.label || id;
  const idBase = `pl-${file.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <figure className="vfig">
      <div className="vblock">
        <div className="pl-scroll">
          <svg className="vchart pl" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Data pipeline diagram; each numbered arrow is listed below">
            <defs>
              {STATES.map((s) => (
                <marker key={s} id={`${idBase}-${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className={`pl-head pl-${s}`} />
                </marker>
              ))}
            </defs>
            {LAYER_NAMES.map((name, c) => (
              <text key={name} x={colX(c) + BOX_W / 2} y={14} textAnchor="middle" className="pl-layer">
                {name}
              </text>
            ))}
            {paths.map((p) => (
              <path key={p.n} d={p.d} className={`pl-edge pl-${p.state}`} markerEnd={`url(#${idBase}-${p.state})`}>
                <title>{`${p.n}. ${label(p.e.from)} → ${label(p.e.to)}: ${p.e.label} (${p.state})`}</title>
              </path>
            ))}
            {data.nodes.map((n) => {
              const at = pos.get(n.id)!;
              return (
                <g key={n.id}>
                  <title>{[n.label, n.detail, n.ref].filter(Boolean).join("\n")}</title>
                  <rect x={at.x} y={at.y} width={BOX_W} height={BOX_H} rx={8} className={`pl-box pl-kind-${n.kind}`} />
                  <text x={at.x + 12} y={at.y + 23} className="pl-label">
                    {n.label}
                  </text>
                  <text x={at.x + 12} y={at.y + 41} className="pl-kind">
                    {n.kind}
                  </text>
                </g>
              );
            })}
            {paths.map((p) => (
              <g key={p.n}>
                <circle cx={p.mid.x} cy={p.mid.y} r={9} className={`pl-badge pl-${p.state}`} />
                <text x={p.mid.x} y={p.mid.y + 3.5} textAnchor="middle" className="pl-num">
                  {p.n}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <div className="vfoot">
          <span className="vlegend">
            {STATES.map((s) => (
              <span key={s}>
                <svg width="26" height="8" aria-hidden>
                  <line x1="1" x2="25" y1="4" y2="4" className={`pl-edge pl-${s}`} />
                </svg>
                {s}
              </span>
            ))}
          </span>
          <Source who="code" date={data.updated} cite={file} />
        </div>
        <ol className="pl-list">
          {paths.map((p) => (
            <li key={p.n}>
              <span className="pl-n">{p.n}</span>
              <span>
                <strong>
                  {label(p.e.from)} → {label(p.e.to)}
                </strong>{" "}
                {p.e.label} <span className={`pl-state pl-${p.state}`}>{p.state}</span>
                {p.e.ref && <span className="pl-ref">{p.e.ref}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
