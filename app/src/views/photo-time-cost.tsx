"use client";
import { useState } from "react";
import "@/styles/views.css";

// Time and price model for the owner's services. Inputs: companies/<slug>/pricing-model.json (passed in as a prop)
// (source owner = their 2026-10-14 dump, source agent = examples). The arithmetic is shown row by row.

type Input = { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; source: string; ref: string; date: string };
type Current = { label: string; price: number; hours: number; images?: number; upTo?: boolean; ref: string; date: string };
type Preset = { label: string; mode: string; deliveredLabel: string; inputs: Input[]; current: Current[] };
export type PricingModel = { presets: Record<"wedding" | "portrait", Preset> };
type Key = keyof PricingModel["presets"];

const STAGES = [
  { id: "onsite", label: "On site", cls: "ptc-s1" },
  { id: "drive", label: "Drive", cls: "ptc-s2" },
  { id: "consult", label: "Consult", cls: "ptc-s3" },
  { id: "logistics", label: "Logistics", cls: "ptc-s4" },
  { id: "cull", label: "Cull", cls: "ptc-s5" },
  { id: "refine", label: "Refine", cls: "ptc-s6" },
  { id: "grade", label: "Grade", cls: "ptc-s7" },
  { id: "retouch", label: "Retouch", cls: "ptc-s8" },
] as const;

export function compute(mode: string, v: Record<string, number>) {
  const onsite = v.coverage, drive = v.drive, consult = v.consult, logistics = v.logistics;
  let cull: number, refine: number, grade: number, retouch: number, delivered: number, retouchNote: string;
  if (mode === "days") {
    const total = v.editDays * v.hpd;
    cull = v.cullDays * v.hpd;
    retouch = (v.retouchCount * v.retouchMin) / 60;
    const rest = Math.max(0, total - cull - retouch);
    refine = rest / 2;
    grade = rest / 2;
    delivered = v.moments;
    retouchNote = `${v.retouchCount} images × ${v.retouchMin} min`;
  } else {
    cull = (v.frames * v.cullSec) / 3600;
    refine = (v.firstCull * v.refineMin) / 60;
    grade = (v.firstCull * v.gradeMin) / 60;
    retouch = (v.closeEdit * v.retouchMin) / 60;
    delivered = v.firstCull;
    retouchNote = `${v.closeEdit} images × ${v.retouchMin} min`;
  }
  const stages = { onsite, drive, consult, logistics, cull, refine, grade, retouch };
  const onJob = onsite + drive + consult + logistics;
  const post = cull + refine + grade + retouch;
  const hours = onJob + post;
  const labour = hours * v.rate;
  const overhead = v.overhead;
  const mileage = drive * v.mileage;
  const travel = (v.travelDays || 0) * (v.lodging || 0) + (v.flights || 0);
  const floor = labour + overhead + mileage + travel;
  const price = floor / (1 - v.tax / 100);
  // One more coverage hour adds its own on-site hour plus culling for the extra frames; refinement, grading and
  // retouching follow the delivered counts they set, so they don't grow with it.
  const extraHours = 1 + cull / onsite;
  const extra = (extraHours * v.rate) / (1 - v.tax / 100);
  return { stages, onJob, post, hours, labour, overhead, mileage, travel, floor, price, perCoverage: price / onsite, delivered, perImage: price / delivered, extraHours, extra, retouchNote };
}

const money = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
const hrs = (x: number) => (Math.round(x * 10) / 10).toString() + " h";

export function PhotoTimeCost({ model }: { model: PricingModel }) {
  const presets = model.presets;
  const initial = (k: Key) => Object.fromEntries(presets[k].inputs.map((i) => [i.id, i.value])) as Record<string, number>;
  const [key, setKey] = useState<Key>("wedding");
  const [vals, setVals] = useState<Record<Key, Record<string, number>>>(() => ({ wedding: initial("wedding"), portrait: initial("portrait") }));
  const p = presets[key];
  const v = vals[key];
  const r = compute(p.mode, v);
  const set = (id: string, n: number) => setVals({ ...vals, [key]: { ...v, [id]: n } });
  const groups = [
    { title: "Your numbers", items: p.inputs.filter((i) => ["owner"].includes(i.source)) },
    { title: "Examples, change them", items: p.inputs.filter((i) => !["owner"].includes(i.source)) },
  ];
  const num = (i: Input) => (i.unit === "$" ? money(v[i.id]) : `${v[i.id].toLocaleString("en-US")} ${i.unit}`);

  const W = 640, H = 34;
  const total = Math.max(r.hours, 0.001);
  let x = 0;
  const segs = STAGES.map((s) => {
    const w = (r.stages[s.id] / total) * W;
    const seg = { ...s, x, w, h: r.stages[s.id] };
    x += w;
    return seg;
  });

  const rows: { label: string; value: string; how?: string; strong?: boolean }[] = [
    { label: "Coverage", value: hrs(r.stages.onsite) },
    { label: "Driving", value: hrs(r.stages.drive) },
    { label: "Consultation", value: hrs(r.stages.consult) },
    { label: "Logistics", value: hrs(r.stages.logistics) },
    { label: "On-the-job hours", value: hrs(r.onJob), how: "coverage + driving + consultation + logistics", strong: true },
    { label: "Culling", value: hrs(r.stages.cull), how: p.mode === "days" ? `${v.cullDays} days × ${v.hpd} h` : `${v.frames.toLocaleString("en-US")} frames × ${v.cullSec} s` },
    { label: "Refinement", value: hrs(r.stages.refine), how: p.mode === "days" ? `half of the edit time left after culling and retouching (${v.editDays} days × ${v.hpd} h)` : `${v.firstCull} images × ${v.refineMin} min` },
    { label: "Colour grading", value: hrs(r.stages.grade), how: p.mode === "days" ? "the other half of that remainder" : `${v.firstCull} images × ${v.gradeMin} min` },
    { label: "Final retouching", value: hrs(r.stages.retouch), how: r.retouchNote },
    { label: "Post hours", value: hrs(r.post), how: "culling + refinement + grading + retouching", strong: true },
    { label: "Total hours", value: hrs(r.hours), how: "on the job + post", strong: true },
    { label: "Labour", value: money(r.labour), how: `${hrs(r.hours)} × ${money(v.rate)} per hour` },
    { label: "Overheads", value: money(r.overhead) },
    { label: "Mileage", value: money(r.mileage), how: `${hrs(r.stages.drive)} driving × ${money(v.mileage)}` },
    ...(p.mode === "days" ? [{ label: "Travel costs", value: money(r.travel), how: `${v.travelDays} days × ${money(v.lodging)} lodging + ${money(v.flights)} flights` }] : []),
    { label: "Cost floor before tax", value: money(r.floor), how: "labour + overheads + mileage + travel", strong: true },
    { label: "Price that nets the target", value: money(r.price), how: `floor ÷ (1 − ${v.tax}%)`, strong: true },
    { label: "Per hour of coverage", value: money(r.perCoverage), how: `price ÷ ${hrs(r.stages.onsite)}` },
    { label: `Per delivered ${p.deliveredLabel}`, value: "$" + r.perImage.toFixed(2), how: `price ÷ ${r.delivered.toLocaleString("en-US")}` },
    { label: "One more coverage hour adds", value: money(r.extra), how: `1 on-site hour + ${(r.extraHours - 1).toFixed(1)} h of culling (cull ÷ coverage), × rate, ÷ (1 − tax); refine, grade and retouch stay with the delivered count` },
  ];

  return (
    <div className="vecon">
      <div className="vecon-inputs">
        <div className="ptc-switch" role="group" aria-label="Job type">
          {(Object.keys(presets) as Key[]).map((k) => (
            <button key={k} type="button" className={k === key ? "is-on" : ""} aria-pressed={k === key} onClick={() => setKey(k)}>
              {presets[k].label}
            </button>
          ))}
        </div>
        {groups.map((g) => (
          <div className="ptc-group" key={g.title}>
            <h4>{g.title}</h4>
            {g.items.map((i) => (
              <div className="vecon-field" key={`${key}-${i.id}`}>
                <label htmlFor={`ptc-${key}-${i.id}`}>
                  {i.label}
                  <output>{num(i)}</output>
                </label>
                <input id={`ptc-${key}-${i.id}`} type="range" min={i.min} max={i.max} step={i.step} value={v[i.id]} onChange={(e) => set(i.id, Number(e.target.value))} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="vecon-out">
        <div className="vecon-sum">
          <div>
            <strong>{hrs(r.hours)}</strong>
            <span>Total hours</span>
          </div>
          <div>
            <strong>{money(r.price)}</strong>
            <span>Price that nets {money(v.rate)} an hour</span>
          </div>
          <div>
            <strong>{money(r.perCoverage)}</strong>
            <span>Per hour of coverage</span>
          </div>
          <div>
            <strong>{money(r.extra)}</strong>
            <span>One more coverage hour</span>
          </div>
        </div>
        <svg className="vchart" viewBox={`0 0 ${W} ${H + 46}`} role="img" aria-label={`Hours by stage, ${hrs(r.hours)} in total`}>
          {segs.map((s) => (
            <rect key={s.id} x={s.x} y={0} width={Math.max(0, s.w)} height={H} className={s.cls} stroke="var(--bg)" strokeWidth={1}>
              <title>{`${s.label}: ${hrs(s.h)}`}</title>
            </rect>
          ))}
          {segs.map((s, n) => (
            <g key={s.id} transform={`translate(${(n % 4) * 160}, ${H + 14 + Math.floor(n / 4) * 18})`}>
              <rect width={10} height={10} y={-9} className={s.cls} />
              <text x={15} y={0} className="vtick">{`${s.label} ${hrs(s.h)}`}</text>
            </g>
          ))}
        </svg>
        <table className="ptc-table">
          <thead>
            <tr><th>Line</th><th>Value</th><th>How</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.strong ? "is-total" : ""}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
                <td>{row.how || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="ptc-table">
          <thead>
            <tr><th>Current site price (code, 2026-09-26)</th><th>Price</th><th>Hours</th><th>Per hour</th></tr>
          </thead>
          <tbody>
            {p.current.map((c) => (
              <tr key={c.label}>
                <th scope="row">{c.label}{c.images ? `, ${c.images} images` : ""}</th>
                <td>{money(c.price)}</td>
                <td>{c.upTo ? "up to " : ""}{c.hours} h</td>
                <td>{money(c.price / c.hours)}</td>
              </tr>
            ))}
            <tr className="is-total">
              <th scope="row">This model, {hrs(r.stages.onsite)} of coverage</th>
              <td>{money(r.price)}</td>
              <td>{hrs(r.stages.onsite)}</td>
              <td>{money(r.perCoverage)}</td>
            </tr>
          </tbody>
        </table>
        <p className="vcaveat">
          Inputs under &quot;Your numbers&quot; come from your 2026-10-14 dump; the rest are examples, not figures from you. Site prices are from
          <code> src/data/services-cost.ts</code> at commit 122d852 (2026-09-26), per hour sold. Tax share is a flat percentage, not a tax calculation. Days away from home are not priced beyond lodging and flights.
        </p>
      </div>
    </div>
  );
}
