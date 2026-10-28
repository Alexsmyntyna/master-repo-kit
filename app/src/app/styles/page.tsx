import {
  Archivo,
  Chakra_Petch,
  DM_Sans,
  Fraunces,
  Geist,
  Geist_Mono,
  IBM_Plex_Sans,
  Inter,
  Instrument_Serif,
  JetBrains_Mono,
  Lora,
  Manrope,
  Newsreader,
  Outfit,
  Sora,
  Space_Grotesk,
  Space_Mono,
  Syne,
  Work_Sans,
} from "next/font/google";
import s from "./styles.module.css";

// A style picker for Master-Repo's redesign: 20 dark directions, each a small working sample.
const inter = Inter({ subsets: ["latin"] });
const jet = JetBrains_Mono({ subsets: ["latin"] });
const fraunces = Fraunces({ subsets: ["latin"] });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"] });
const spaceG = Space_Grotesk({ subsets: ["latin"] });
const manrope = Manrope({ subsets: ["latin"] });
const dm = DM_Sans({ subsets: ["latin"] });
const syne = Syne({ subsets: ["latin"] });
const news = Newsreader({ subsets: ["latin"] });
const archivo = Archivo({ subsets: ["latin"] });
const geist = Geist({ subsets: ["latin"] });
const geistMono = Geist_Mono({ subsets: ["latin"] });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400" });
const sora = Sora({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"] });
const lora = Lora({ subsets: ["latin"] });
const chakra = Chakra_Petch({ subsets: ["latin"], weight: ["400", "600"] });
const work = Work_Sans({ subsets: ["latin"] });
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600"] });

type Chart = "bars" | "line" | "area" | "dots" | "steps" | "thin" | "blocks";
type Style = {
  name: string;
  note: string;
  bg: string;
  surface: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  a2: string;
  a3: string;
  head: string;
  body: string;
  radius: number;
  border?: number;
  chart: Chart;
  caps?: boolean;
  glass?: boolean;
  glow?: boolean;
};
const f = (x: { style: { fontFamily: string } }) => x.style.fontFamily;

const styles: Style[] = [
  { name: "Graphite", note: "Quiet product tool. Violet accent, thin lines, nothing extra.", bg: "#0b0b0f", surface: "#15151b", line: "#26262f", text: "#ececf1", muted: "#8a8a99", accent: "#8b7cff", a2: "#4fd1c5", a3: "#f5a35c", head: f(inter), body: f(inter), radius: 8, chart: "bars" },
  { name: "Phosphor", note: "Terminal-native. Everything mono, green on black.", bg: "#050806", surface: "#0a110c", line: "#163020", text: "#b8f5c8", muted: "#5d8f6c", accent: "#39ff88", a2: "#ffd84a", a3: "#ff5f56", head: f(jet), body: f(jet), radius: 2, chart: "steps", caps: true, glow: true },
  { name: "Nord Frost", note: "Cool, calm blue-grey. Easy on the eyes for long sessions.", bg: "#242933", surface: "#2e3440", line: "#3b4252", text: "#eceff4", muted: "#97a1b4", accent: "#88c0d0", a2: "#a3be8c", a3: "#ebcb8b", head: f(manrope), body: f(manrope), radius: 10, chart: "area" },
  { name: "Editorial", note: "Reads like a magazine. Serif headlines, one red accent.", bg: "#12100e", surface: "#1a1714", line: "#2e2924", text: "#efe8dd", muted: "#9c9184", accent: "#e5484d", a2: "#d6b36a", a3: "#7fa7c9", head: f(fraunces), body: f(news), radius: 2, chart: "thin" },
  { name: "Swiss", note: "Hard grid, pure black, signal orange. Decisive.", bg: "#000000", surface: "#0d0d0d", line: "#2a2a2a", text: "#ffffff", muted: "#8c8c8c", accent: "#ff4d00", a2: "#ffffff", a3: "#666666", head: f(archivo), body: f(archivo), radius: 0, border: 2, chart: "blocks", caps: true },
  { name: "Midnight Glass", note: "Layered translucent panels over a deep gradient.", bg: "linear-gradient(140deg,#0b1030,#1a0f3a 60%,#062a3a)", surface: "rgba(255,255,255,0.06)", line: "rgba(255,255,255,0.12)", text: "#eef1ff", muted: "#a2a8d0", accent: "#7dd3fc", a2: "#c084fc", a3: "#f9a8d4", head: f(sora), body: f(sora), radius: 16, chart: "area", glass: true },
  { name: "Bento", note: "Big soft rounded tiles, pastel on charcoal. Friendly.", bg: "#141416", surface: "#1e1e22", line: "#2a2a30", text: "#f4f4f6", muted: "#9b9ba6", accent: "#b9a6ff", a2: "#9fe3c1", a3: "#ffc8a2", head: f(outfit), body: f(outfit), radius: 22, chart: "bars" },
  { name: "Brutalist", note: "Thick borders, mono type, caution yellow. Loud and honest.", bg: "#0e0e0e", surface: "#161616", line: "#f5e400", text: "#f5f5f5", muted: "#a0a0a0", accent: "#f5e400", a2: "#ffffff", a3: "#ff3b3b", head: f(spaceMono), body: f(spaceMono), radius: 0, border: 3, chart: "blocks", caps: true },
  { name: "Solarized", note: "The classic dev palette. Warm accents on deep teal.", bg: "#002b36", surface: "#073642", line: "#0d4654", text: "#eee8d5", muted: "#93a1a1", accent: "#b58900", a2: "#2aa198", a3: "#d33682", head: f(work), body: f(work), radius: 6, chart: "line" },
  { name: "Dracula", note: "Purple base, candy accents. Playful, high contrast.", bg: "#1e1f29", surface: "#282a36", line: "#3a3c4e", text: "#f8f8f2", muted: "#9ea3c4", accent: "#ff79c6", a2: "#50fa7b", a3: "#bd93f9", head: f(spaceG), body: f(spaceG), radius: 10, chart: "dots" },
  { name: "Darkroom", note: "Photographer's safelight: deep red-black, warm and focused.", bg: "#0f0606", surface: "#1a0b0b", line: "#3a1414", text: "#f3dcd6", muted: "#a07a72", accent: "#ff3b30", a2: "#ff9f6b", a3: "#ffd7a1", head: f(instrument), body: f(dm), radius: 4, chart: "thin" },
  { name: "Carbon", note: "IBM-style enterprise rigour. Square, blue, dense.", bg: "#161616", surface: "#262626", line: "#393939", text: "#f4f4f4", muted: "#a8a8a8", accent: "#4589ff", a2: "#08bdba", a3: "#ff832b", head: f(plex), body: f(plex), radius: 0, chart: "bars" },
  { name: "Ember", note: "Warm brown and amber. Cosy studio, like a lit desk at night.", bg: "#14100c", surface: "#1f1914", line: "#33291f", text: "#f4e9db", muted: "#a8957f", accent: "#ff9e3d", a2: "#e8c07a", a3: "#c96f4a", head: f(syne), body: f(dm), radius: 12, chart: "area" },
  { name: "Moss", note: "Earthy greens and a book serif. Slow, considered.", bg: "#0d120e", surface: "#151d17", line: "#24332a", text: "#e5ede3", muted: "#8ea28f", accent: "#9fd47a", a2: "#d9c27a", a3: "#7ab8a6", head: f(lora), body: f(lora), radius: 6, chart: "line" },
  { name: "Oceanic", note: "Deep teal water with a bright aqua signal.", bg: "#06161b", surface: "#0b222a", line: "#143540", text: "#e1f4f7", muted: "#84a9b2", accent: "#2ee6d6", a2: "#5ab2ff", a3: "#ffc26b", head: f(sora), body: f(manrope), radius: 12, chart: "area" },
  { name: "Ash", note: "Greyscale only, white as the single accent. Pure focus.", bg: "#0a0a0a", surface: "#141414", line: "#242424", text: "#fafafa", muted: "#7a7a7a", accent: "#ffffff", a2: "#a3a3a3", a3: "#525252", head: f(geist), body: f(geist), radius: 6, chart: "thin" },
  { name: "Synthwave", note: "Neon magenta and cyan glow. Energetic, a bit much.", bg: "#0d0221", surface: "#190535", line: "#33106a", text: "#fbeaff", muted: "#b593d6", accent: "#ff2bd6", a2: "#00f0ff", a3: "#ffe14d", head: f(chakra), body: f(chakra), radius: 4, chart: "line", caps: true, glow: true },
  { name: "Paper Dark", note: "Notion-like: soft grey, generous space, almost no chrome.", bg: "#191919", surface: "#202020", line: "#2f2f2f", text: "#e6e6e4", muted: "#8f8f8c", accent: "#529cca", a2: "#6bb38a", a3: "#d9a35b", head: f(inter), body: f(inter), radius: 4, chart: "dots" },
  { name: "Mission Control", note: "Aerospace console: dense data, small caps, cyan and orange.", bg: "#070b10", surface: "#0d141c", line: "#1c2a38", text: "#d8e6f3", muted: "#6f8599", accent: "#00d1ff", a2: "#ff8a00", a3: "#7cff6b", head: f(geistMono), body: f(geistMono), radius: 2, chart: "steps", caps: true },
  { name: "Rosé Pine", note: "Muted rose, gold and pine. Soft, a little romantic.", bg: "#191724", surface: "#1f1d2e", line: "#2a273f", text: "#e0def4", muted: "#908caa", accent: "#ebbcba", a2: "#f6c177", a3: "#9ccfd8", head: f(fraunces), body: f(manrope), radius: 14, chart: "bars" },
];

const data = [3, 5, 4, 7, 6, 9, 8, 11, 10, 13];

function MiniChart({ type, a, b }: { type: Chart; a: string; b: string }) {
  const w = 220,
    h = 64,
    max = 14,
    step = w / data.length;
  const pts = data.map((v, i) => [i * step + step / 2, h - (v / max) * h] as const);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={s.chart} aria-hidden="true">
      {type === "bars" &&
        pts.map(([x, y], i) => (
          <rect key={i} x={x - step * 0.3} y={y} width={step * 0.6} height={h - y} rx={3} fill={i === data.length - 1 ? a : b} opacity={i === data.length - 1 ? 1 : 0.45} />
        ))}
      {type === "thin" &&
        pts.map(([x, y], i) => <rect key={i} x={x - 1} y={y} width={2} height={h - y} fill={i === data.length - 1 ? a : b} />)}
      {type === "blocks" &&
        pts.map(([x, y], i) => <rect key={i} x={x - step * 0.45} y={y} width={step * 0.9} height={h - y} fill={i % 3 === 2 ? a : b} />)}
      {(type === "line" || type === "area") && (
        <>
          {type === "area" && <path d={`${path} L${pts.at(-1)![0]},${h} L${pts[0][0]},${h} Z`} fill={a} opacity={0.18} />}
          <path d={path} fill="none" stroke={a} strokeWidth={2} strokeLinejoin="round" />
          <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r={3.5} fill={a} />
        </>
      )}
      {type === "steps" && (
        <path
          d={pts.map(([x, y], i) => (i ? `H${x} V${y}` : `M${x - step / 2},${y} H${x}`)).join(" ")}
          fill="none"
          stroke={a}
          strokeWidth={1.5}
        />
      )}
      {type === "dots" && pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === data.length - 1 ? 5 : 3.5} fill={i === data.length - 1 ? a : b} />)}
    </svg>
  );
}

function Sample({ st, n }: { st: Style; n: number }) {
  const vars = {
    "--bg": st.bg,
    "--sf": st.surface,
    "--ln": st.line,
    "--tx": st.text,
    "--mu": st.muted,
    "--ac": st.accent,
    "--a2": st.a2,
    "--a3": st.a3,
    "--r": `${st.radius}px`,
    "--bw": `${st.border ?? 1}px`,
    "--head": st.head,
    "--body": st.body,
  } as React.CSSProperties;
  return (
    <article
      className={`${s.card} ${st.caps ? s.caps : ""} ${st.glass ? s.glass : ""} ${st.glow ? s.glow : ""}`}
      style={vars}
      id={`style-${n}`}
    >
      <header className={s.top}>
        <span className={s.num}>{String(n).padStart(2, "0")}</span>
        <div>
          <h2 className={s.name}>{st.name}</h2>
          <p className={s.note}>{st.note}</p>
        </div>
      </header>
      <div className={s.swatches}>
        {[st.surface, st.line, st.text, st.accent, st.a2, st.a3].map((c, i) => (
          <span key={i} style={{ background: c }} title={c} />
        ))}
      </div>
      <div className={s.panel}>
        <div className={s.row}>
          <span className={s.label}>CameraApp · this week</span>
          <span className={s.pill}>v1.3.2 ready</span>
        </div>
        <div className={s.stat}>
          13 <small>commits shipped</small>
        </div>
        <MiniChart type={st.chart} a={st.accent} b={st.a2} />
      </div>
      <div className={s.msg}>
        <div className={s.msgHead}>
          <span style={{ color: st.a2 }}>COO</span> → <span style={{ color: st.accent }}>CEO</span>
          <span className={s.kind}>report</span>
        </div>
        <p>Cut 1.3.x from main this week; port one 1.4 piece at a time.</p>
      </div>
      <div className={s.projects}>
        {[
          ["FinanceApp", st.a2, "Agents talking"],
          ["ReaderApp", st.accent, "Waiting on you"],
          ["TimeApp", st.a3, "Parked"],
        ].map(([p, c, t]) => (
          <div key={p} className={s.project}>
            <i style={{ background: c }} />
            <span>{p}</span>
            <small>{t}</small>
          </div>
        ))}
      </div>
      <div className={s.actions}>
        <button className={s.primary}>Approve</button>
        <button className={s.secondary}>Reply</button>
      </div>
    </article>
  );
}

export const metadata = { title: "Styles" };

export default function Styles() {
  return (
    <div className={s.page}>
      <header className={s.intro}>
        <h1>Styles</h1>
      </header>
      <div className={s.grid}>
        {styles.map((st, i) => (
          <Sample key={st.name} st={st} n={i + 1} />
        ))}
      </div>
    </div>
  );
}
