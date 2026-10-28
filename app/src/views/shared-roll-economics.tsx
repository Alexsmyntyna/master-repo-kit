"use client";
import { useState } from "react";
import "@/styles/views.css";

// Example-input cost model: shared-roll server cost vs ad revenue per 1,000 people.
const inputs = [
  { id: "rolls", label: "Shared rolls per person / month", min: 0.5, max: 8, step: 0.5, value: 2 },
  { id: "frames", label: "Frames per roll", min: 8, max: 72, step: 4, value: 24 },
  { id: "mb", label: "MB per uploaded frame", min: 0.5, max: 12, step: 0.5, value: 3 },
  { id: "members", label: "People per roll", min: 2, max: 12, step: 1, value: 4 },
  { id: "views", label: "Ads seen per person / month", min: 0, max: 120, step: 5, value: 20 },
  { id: "ecpm", label: "Ad revenue per 1,000 views ($)", min: 0.5, max: 20, step: 0.5, value: 4 },
] as const;
type Id = (typeof inputs)[number]["id"];
const STORAGE_GB_MONTH = 0.021; // placeholder, check current pricing
const EGRESS_GB = 0.09; // placeholder, check current pricing

const money = (x: number) =>
  "$" + (x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2));

export function SharedRollEconomics() {
  const [v, setV] = useState<Record<Id, number>>(
    () => Object.fromEntries(inputs.map((i) => [i.id, i.value])) as Record<Id, number>,
  );
  const people = 1000;
  const gb = (people * v.rolls * v.frames * v.mb) / 1024;
  const storage = gb * STORAGE_GB_MONTH;
  const egress = gb * (v.members - 1) * EGRESS_GB;
  const cost = storage + egress;
  const revenue = (people * v.views * v.ecpm) / 1000;
  const net = revenue - cost;
  const max = Math.max(cost, revenue, 1);
  const W = 560,
    x0 = 110;
  const w = (x: number) => Math.max(0, (x / max) * W);
  const ticks = [0, 1, 2, 3, 4];
  return (
    <div className="vecon">
      <div className="vecon-inputs">
        {inputs.map((i) => (
          <div className="vecon-field" key={i.id}>
            <label htmlFor={`econ-${i.id}`}>
              {i.label}
              <output>{v[i.id]}</output>
            </label>
            <input
              id={`econ-${i.id}`}
              type="range"
              min={i.min}
              max={i.max}
              step={i.step}
              value={v[i.id]}
              onChange={(e) => setV({ ...v, [i.id]: Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
      <div className="vecon-out">
        <div className="vecon-sum">
          <div>
            <strong>{money(cost)}</strong>
            <span>Server cost</span>
          </div>
          <div>
            <strong>{money(revenue)}</strong>
            <span>Ad revenue</span>
          </div>
          <div>
            <strong className={net >= 0 ? "is-ok" : "is-risk"}>
              {net >= 0 ? "+" : "−"}
              {money(Math.abs(net))}
            </strong>
            <span>Difference</span>
          </div>
          <div>
            <strong>{Math.round(gb)} GB</strong>
            <span>Uploaded</span>
          </div>
        </div>
        <svg className="vchart" viewBox="0 0 700 172" role="img" aria-label={`Server cost ${money(cost)} versus ad revenue ${money(revenue)} per month`}>
          {ticks.map((t) => {
            const x = x0 + (W * t) / 4;
            return (
              <g key={t}>
                <line x1={x} y1={10} x2={x} y2={140} className={t ? "vgrid" : "vbase"} />
                <text x={x} y={160} textAnchor="middle" className="vtick">
                  {money((max * t) / 4)}
                </text>
              </g>
            );
          })}
          <text x={0} y={44} className="vlabel">Server cost</text>
          <rect x={x0} y={26} width={w(storage)} height={24} rx={2} className="vbar-risk" />
          <rect x={x0 + w(storage)} y={26} width={w(egress)} height={24} rx={2} className="vbar-risk-soft" />
          <text x={x0} y={68} className="vtick">
            storage {money(storage)} · downloads {money(egress)}
          </text>
          <text x={0} y={110} className="vlabel">Ad revenue</text>
          <rect x={x0} y={92} width={w(revenue)} height={24} rx={2} className="vbar-ok" />
        </svg>
        <p className="vcaveat">
          Per 1,000 people sharing, per month. Example inputs, not CameraApp&apos;s numbers. Storage at ${STORAGE_GB_MONTH}/GB-month and
          downloads at ${EGRESS_GB}/GB are placeholders. Not included: platform fee, compute, support, moderation.
        </p>
      </div>
    </div>
  );
}
