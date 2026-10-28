"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Bar, Chips, DataTable, Empty, FilterBar, SearchBox, Source, State, Tag, type Tone } from "./ds";
import "@/styles/more.css";

// Every codebase in ~/Documents/GitHub as one table row: name, language, last commit, the agent's verdict and what
// to learn from it. Filters narrow it; a row opens in place to the summary, the four-week run and the agent's note.

export type CodebaseItem = {
  slug: string;
  name: string;
  group: "mine" | "project" | "clone";
  kind: string; // yours, fork, no git, clone
  languages: string[];
  last: string;
  lastLabel: string;
  commits: number;
  verdict: string;
  verdictLabel: string;
  learn: string;
  summary: string;
  activity: number;
  detail: React.ReactNode;
};
type Group = "mine" | "project" | "clone" | "all";
type Sort = "verdict" | "last" | "name";

const verdictTone: Record<string, Tone | undefined> = { revive: "ok", parts: "accent", reference: undefined, archive: "idle" };
const verdictRank: Record<string, number> = { revive: 0, parts: 1, reference: 2, archive: 3, "": 4 };
const groupLabels: Record<Group, string> = { mine: "Yours", project: "Projects", clone: "Cloned", all: "All" };

export function CodebaseTable({ items, verdicts }: { items: CodebaseItem[]; verdicts: [string, string][] }) {
  const [group, setGroup] = useState<Group>("mine");
  const [verdict, setVerdict] = useState("all");
  const [lang, setLang] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("verdict");
  const [open, setOpen] = useState<string | null>(null);

  // /codebases#slug (from the overview) opens that row, whatever the filters were.
  useEffect(() => {
    const slug = decodeURIComponent(window.location.hash.slice(1));
    const hit = slug && items.find((i) => i.slug === slug);
    if (!hit) return;
    setGroup("all");
    setVerdict("all");
    setLang("all");
    setOpen(slug);
    requestAnimationFrame(() => document.getElementById(slug)?.scrollIntoView({ block: "center" }));
  }, [items]);

  const inGroup = items.filter((i) => group === "all" || i.group === group);
  const languages = useMemo(() => {
    const n: Record<string, number> = {};
    inGroup.forEach((i) => i.languages.slice(0, 1).forEach((l) => (n[l] = (n[l] || 0) + 1)));
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }, [inGroup]);
  const q = search.trim().toLowerCase();
  const visible = inGroup
    .filter((i) => verdict === "all" || i.verdict === verdict)
    .filter((i) => lang === "all" || i.languages[0] === lang)
    .filter((i) => !q || `${i.name} ${i.languages.join(" ")} ${i.learn} ${i.summary}`.toLowerCase().includes(q))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "last"
          ? b.last.localeCompare(a.last)
          : verdictRank[a.verdict] - verdictRank[b.verdict] || b.activity - a.activity || b.last.localeCompare(a.last),
    );

  // Commit counts run from one to thousands, so their bars are on a log scale.
  const maxLog = Math.log10(Math.max(10, ...items.map((i) => i.commits + 1)));
  const head = (key: Sort, text: string) => (
    <button type="button" className={sort === key ? "is-on" : ""} aria-pressed={sort === key} onClick={() => setSort(key)}>
      {text}
    </button>
  );

  return (
    <>
      <FilterBar>
        <SearchBox label="Search codebases" placeholder="Search" value={search} onChange={setSearch} />
        <Chips<Group>
          label="Whose"
          value={group}
          onChange={(g) => {
            setGroup(g);
            setLang("all");
          }}
          options={(["mine", "project", "clone", "all"] as Group[]).map((g) => ({
            value: g,
            label: groupLabels[g],
            count: g === "all" ? items.length : items.filter((i) => i.group === g).length,
          }))}
        />
      </FilterBar>
      <FilterBar>
        <Chips
          label="Verdict"
          value={verdict}
          onChange={setVerdict}
          options={[
            { value: "all", label: "Any", count: inGroup.length },
            ...verdicts
              .map(([v, text]) => ({ value: v, label: text, count: inGroup.filter((i) => i.verdict === v).length }))
              .filter((o) => o.count > 0),
          ]}
        />
        <label className="fbar-select">
          <span>Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="all">Any</option>
            {languages.map(([l, n]) => (
              <option key={l} value={l}>
                {l} ({n})
              </option>
            ))}
          </select>
        </label>
      </FilterBar>

      <DataTable className="cbt">
        <thead>
          <tr>
            <th>{head("name", "Name")}</th>
            <th className="cbt-lang">Language</th>
            <th>{head("last", "Last commit")}</th>
            <th className="num cbt-commits">Commits</th>
            <th>{head("verdict", "Verdict")}</th>
            <th className="cbt-learn">
              <span className="cbt-learn-head">
                Learn <Source who="agent" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((i) => {
            const isOpen = open === i.slug;
            const toggle = () => setOpen(isOpen ? null : i.slug);
            return (
              <Fragment key={i.slug}>
                <tr id={i.slug} className={`cbt-item ${isOpen ? "is-open" : ""}`} onClick={toggle}>
                  <td>
                    <button type="button" className="cbt-name" aria-expanded={isOpen} onClick={(e) => (e.stopPropagation(), toggle())}>
                      <ChevronRight size={13} className="cbt-chev" aria-hidden />
                      <strong>{i.name}</strong>
                      {i.kind !== "yours" && i.kind !== "clone" && <Tag>{i.kind}</Tag>}
                    </button>
                  </td>
                  <td className="cbt-lang">{i.languages.slice(0, 2).join(", ") || <span className="faint">–</span>}</td>
                  <td className="cbt-last">{i.last ? i.lastLabel : <span className="faint">uncommitted</span>}</td>
                  <td className="num cbt-commits">
                    {i.commits > 0 ? <Bar part={Math.log10(i.commits + 1) / maxLog}>{i.commits}</Bar> : <span className="faint">–</span>}
                  </td>
                  <td>
                    <State tone={verdictTone[i.verdict]}>{i.verdictLabel}</State>
                  </td>
                  <td className="cbt-learn">{i.learn || <span className="faint">{i.summary}</span>}</td>
                </tr>
                {isOpen && (
                  <tr className="cbt-detail">
                    <td colSpan={6}>{i.detail}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </DataTable>
      {!visible.length && <Empty>No matches.</Empty>}
    </>
  );
}
