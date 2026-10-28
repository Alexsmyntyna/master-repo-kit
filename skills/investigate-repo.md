---
name: investigate-repo
title: Investigate repo
scope: any
status: ready
params: [project, question]
kind: task
when: "A concrete question needs an answer from a project's code (as its own job or inside another skill)."
---

Answer `{question}` about `{project}` from its code.

Find the repo path in `companies/{project}/company.json`. Read that repo's own `CLAUDE.md`/`AGENTS.md` first. Stay read-only. Don't install, build, or run anything without asking.

Record: repo, branch, commit (`git rev-parse HEAD`), date, whether the working tree was dirty, the files/symbols that matter, and what you did *not* check. Separate what the code does from what you infer.

Write back, by `skills/writing.md`: a short note in `companies/{project}/notes/YYYY-MM-DD-<topic>.md`, and update any `company.json` field it changes (with `code` provenance). If the investigation answers a `queue/` item, close it.
