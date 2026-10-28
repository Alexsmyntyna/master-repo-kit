"use client";
import { useState } from "react";
import type { Document } from "@/lib/model";
import { dateLabel, label } from "@/lib/model";
import { Chips, Empty, FilterBar, Row, Rows, State, type Tone } from "./ds";

const statusTone: Record<string, Tone> = { open: "accent", in_progress: "ok", "in-progress": "ok", done: "idle", dropped: "idle" };
const statusOf = (d: Document) => String(d.meta.status || "open");

// Saved questions as rows, filtered by status.
export function QueueList({ docs, names }: { docs: Document[]; names: Record<string, string> }) {
  const [filter, setFilter] = useState("all");
  const visible = docs.filter((d) => filter === "all" || statusOf(d) === filter);
  const statuses = Array.from(new Set(docs.map(statusOf)));
  return (
    <>
      {docs.length > 0 && (
        <FilterBar>
          <Chips
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: docs.length },
              ...statuses.map((s) => ({ value: s, label: label(s), count: docs.filter((d) => statusOf(d) === s).length })),
            ]}
          />
        </FilterBar>
      )}
      <Rows>
        {visible.map((d) => {
          const projects = (Array.isArray(d.meta.project) ? d.meta.project : String(d.meta.project || "").split(","))
            .map((p) => String(p).trim())
            .filter((p) => p && p !== "null");
          const saved = d.path.match(/\d{4}-\d{2}-\d{2}/)?.[0];
          return (
            <Row
              key={d.path}
              href={`/documents/${d.path}`}
              title={d.title}
              detail={d.content.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.replace(/`/g, "")}
              meta={[projects.length ? projects.map((p) => names[p] || p).join(", ") : "All projects", saved && `saved ${dateLabel(saved)}`]}
              trail={<State tone={statusTone[statusOf(d)]}>{label(statusOf(d))}</State>}
            />
          );
        })}
      </Rows>
      {!visible.length && <Empty>Nothing {filter === "all" ? "saved" : label(filter).toLowerCase()}</Empty>}
    </>
  );
}
