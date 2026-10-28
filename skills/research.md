---
name: research
title: Research
scope: company
status: ready
params: [project, question]
kind: session
when: "The owner asks about the market, competitors, marketing, pricing, business model, past strategies, or whether a feature can pay for itself."
---

Research `{question}` for `{project}`, acting as its CEO. Web research is allowed; cite sources with dates.

Fan the web research out to subagents on the model `local/owner.md` names, one per lane (own prices, local market, cost method, adjacent genres), launched in one call. Each lane gets the question, `skills/writing.md`, the region, and a durable output file `companies/{project}/notes/<date>-research-<lane>.md` (figure | URL | date | kind: survey / vendor / anecdote; "not found" rather than a guess). A writer on the same model compiles the page from the notes; the orchestrator reviews provenance and the ban list.

Read the story (`companies/{project}/wiki/index.md`), open fronts, `company.json` → `market`, and past decisions so you don't repeat what was already tried. If strategies were tried before, find what happened and say so.

Cover what the question needs: who else does this and how they charge, how similar products reach people, what it costs to run, what it could earn, and which assumptions decide the answer. Keep public facts (`public`, with URL and date), the owner's account, and your estimates (`agent`) separate. Never present an estimate as a fact; no invented numbers, customers or demand.

Write back:

- A research page at `companies/{project}/wiki/research/<topic>.md` (`kind: research`) and `written_by: agent`: findings as tables and short lists, each figure with its source and date, estimates marked Agent: (`skills/writing.md`). Sources at the end.
- When numbers matter, a model the owner can play with: build a view in the app (see `skills/visualize.md`) with every input visible and labelled as an example or a sourced figure.
- Link the page from the related front if there is one. Update `company.json` → `market` fields if the research changes them.
