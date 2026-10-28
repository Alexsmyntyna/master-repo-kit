"use client";
import { useState } from "react";
import { Chips, Empty, FilterBar, Row, Rows, SearchBox } from "./ds";
import { ProjectMark, Status } from "./ui";

export type CompanyPreview = {
  id: string;
  name: string;
  stage: string;
  summary: string;
  repos: number;
  developed: boolean;
};
type Filter = "all" | "developed" | "empty";

// Every project as a row: its mark, name, one line, stage and how many repos it has. Searchable.
export function CompanyCatalog({ companies }: { companies: CompanyPreview[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const q = search.trim().toLowerCase();
  const visible = companies.filter(
    (c) =>
      (!q || `${c.name} ${c.summary} ${c.stage}`.toLowerCase().includes(q)) &&
      (filter === "all" || (filter === "developed" ? c.developed : !c.developed)),
  );
  const developed = companies.filter((c) => c.developed).length;
  return (
    <>
      <FilterBar>
        <SearchBox label="Search projects" placeholder="Search" value={search} onChange={setSearch} />
        <Chips<Filter>
          label="Filter projects"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: companies.length },
            { value: "developed", label: "Written up", count: developed },
            { value: "empty", label: "Empty", count: companies.length - developed },
          ]}
        />
      </FilterBar>
      <Rows>
        {visible.map((c) => (
          <Row
            key={c.id}
            href={`/companies/${c.id}`}
            lead={<ProjectMark company={c} />}
            title={c.name}
            detail={c.summary || <span className="faint">No story yet</span>}
            trail={
              <span className="cat-trail">
                <Status value={c.stage} />
                <span className="mono">
                  {c.repos} repo{c.repos === 1 ? "" : "s"}
                </span>
              </span>
            }
          />
        ))}
      </Rows>
      {!visible.length && (
        <Empty
          action={
            <button
              className="button secondary"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear filters
            </button>
          }
        >
          No matching projects.
        </Empty>
      )}
    </>
  );
}
