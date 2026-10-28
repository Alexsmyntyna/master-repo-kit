---
title: Standards
summary: "Rules project agents read before working, in three levels: shipped generic, the owner's, and per project."
updated: 2026-10-28
written_by: agent
---

# Standards

Rules for agents in project repos, so a new idea or a refactor doesn't start from step one. They grow from the owner's words, not in a day. Agents read the files for their task before working; the owner reads them only when they want to correct one.

## Three levels

| Level | Where | Holds | Provenance |
| --- | --- | --- | --- |
| Generic | `standards/<area>.md` (this folder, shipped) | Rules that hold in any repo. No project names, no owner evidence | `(public)` |
| Owner | `local/standards/<area>.md` (this checkout only) | The owner's taste and stack choices, with the evidence kept | `owner`, `code`, `agent` |
| Project | `companies/<slug>/standards.md`, one `## <area>` heading per area | Rules about one project's data, screens or vendors, with the evidence kept | `owner`, `code`, `agent` |

Load order, later wins: shipped, then `local/standards/`, then `companies/<slug>/standards.md` (only when working in that project). A struck-through line (`~~...~~`) or an `override: <rule>` line at a later level replaces the earlier rule.

`local/standards/evidence.md` keeps the original sourced lines behind each shipped rule. `local/standards/notes.md` holds notes on how thin the evidence is; those are not rules and agents don't follow them.

### Scope test

Would this rule hold word for word in a repo with none of the owner's projects? Yes: generic. About one project: project. Otherwise (a taste or a stack choice): owner. When unsure, record it as owner; it is local and safe, and the review can promote it later.

## Areas

| File | Holds |
| --- | --- |
| [design.md](design.md) | Visual and interaction rules |
| [structure.md](structure.md) | Folders, agent files, env example, scripts |
| [deployment.md](deployment.md) | How things ship and who decides |
| [stack.md](stack.md) | Tooling rules that hold whatever the language |
| [testing.md](testing.md) | How flows are verified and when a build counts as releasable |
| [agent-files.md](agent-files.md) | What a clean CLAUDE.md / AGENTS.md holds, and its length |

## Format

One rule per line, one sentence, then its source in brackets:

`- <rule>. (<source>: <ref>, <date>)`

| Source | Meaning | Ref is |
| --- | --- | --- |
| `public` | A shipped generic rule. No ref | none: `(public)` |
| `owner` | Their words or a tight paraphrase | File and message where they said it |
| `code` | Seen in a repo; says "seen in <repo>" | Path or commit in that repo |
| `agent` | Inference. Few, and marked | What it was inferred from |

## Adding a rule

Record it with `python3 tools/inbox.py rule <area> "<rule>" --scope generic|owner|project [--project <slug>] --source owner|code|agent --ref "<where, date>"`. `--project` is required for `--scope project`. With no `--scope` the rule goes to owner.

1. Through the owner's words, in Master-Repo or in a project session: write the rule, quote or tightly paraphrase, cite the file and date.
2. From code seen in a repo: cite the repo and path or commit. Code shows what exists, not that they want it; keep it `code`.
3. Never add a rule from an agent's own taste without marking it `agent`.
4. Apply the scope test. A generic rule is reworded with no names before it goes in `standards/`; its sourced original goes in `local/standards/evidence.md`.
5. A new rule goes in the file where an agent would look for it. Don't repeat it across files or levels; link.

## Using them

- Cite the rule you followed (file and a few words of the line) in your report or commit note.
- If a rule doesn't fit the case, say so and ask the owner. Don't drop it silently.
- If the project's own CLAUDE.md or AGENTS.md disagrees with a rule, the later level or the owner's latest word wins; tell the owner so the rule can be fixed.

## Staleness and condensing

- Rules go stale. When the owner's newer words contradict a rule, strike it through (`~~...~~`) and add the newer line with its date beside it. Never delete a rule silently.
- Code-sourced rules can be outdated by a repo change; re-check the path before leaning on one older than a few months.
- `updated` in each file's frontmatter moves whenever a line is added or struck.
- Every so often the rules get condensed with `skills/rules-review.md`: duplicates merged, wording trimmed, rules promoted or demoted between levels. `tools/rules.py audit` shows what needs it.
