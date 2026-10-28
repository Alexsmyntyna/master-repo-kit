---
name: project-session
title: Project session (coding in a project repo)
scope: company
status: ready
params: [project]
kind: project
when: "An agent is coding in one of the owner's project repos and the repo's CLAUDE.md / AGENTS.md points at Master-Repo."
---

You're coding in a repo that belongs to `{project}`. Master-Repo is where its context, the owner's standards and everything that isn't source code live. Agents in project repos write reports, mockups and notes to Master-Repo so those directories stay clean of random files and things get put in timelines.

`<MR>` below is `$MASTER_REPO`, or `~/Documents/GitHub/Master-Repo` when that isn't set. Every command is `python3 <MR>/tools/inbox.py …`; it only writes inside Master-Repo and never runs git.

## Start

1. `inbox.py context {project}`: the card (goal, blocker, next step, open gates), open fronts, the last five dated items and the list of standards files. If the repo serves several projects, `MASTER-REPO.md` lists them; ask the owner which one unless the task makes it obvious.
2. Read the standards that touch the task, at all three levels, later wins: `<MR>/standards/<area>.md` (generic), `<MR>/local/standards/<area>.md` (the owner's), then `<MR>/companies/{project}/standards.md` (this project only). Areas: `design.md` for UI, `structure.md` for new folders or files, `deployment.md` before touching hosting, `stack.md` before adding a dependency, `testing.md`, `agent-files.md` before editing CLAUDE.md or AGENTS.md. Follow a rule over your own taste.

## During

- **Non-code output goes to Master-Repo, not this repo.** Reports, investigation write-ups, screenshots, mockups, design explorations, task lists, plans and session logs:
  - `inbox.py note {project} "<text>" --title "<title>" [--ref <path or commit>]` for a note; `--kind report` for a finished write-up; `--kind decision-needed` when the owner has to choose something.
  - `inbox.py mockup {project} <files…> --title "<topic>" --question "<what the owner should decide>" [--frame desktop]` for mockups and screenshots (5 MB per file). Follow `<MR>/skills/mockup-review.md` for what the mockup should be: one option, looks like the real product, honest trade-offs.
  - Pass `-` as the text to pipe a long note in on stdin.
- **The owner states a preference or a rule** ("always use system fonts", "never deploy on Fridays", "this one stays on Vercel"): record it once, in their words, with `inbox.py rule <area> "<rule>" --scope generic|owner|project [--project {project}] --source owner --ref "<where they said it, date>"`. Area is `design`, `structure`, `deployment`, `stack`, `testing` or `agent-files`. Pick the scope with one test: would the rule hold word for word in a repo with none of the owner's projects? Yes: generic (reword it with no names). About `{project}` only: project. Otherwise (taste, a stack choice): owner. If unsure, owner. Use `--source code` for a convention you found in the code, with the file as `--ref`.
- Keep this repo's `CLAUDE.md` / `AGENTS.md` to what `standards/agent-files.md` allows. Don't add session notes, plans or history to them; those go to Master-Repo.
- Don't edit other Master-Repo files from here unless the owner asks. Don't invent facts about the project; cite a commit or a path, or write "unknown".

## End

`inbox.py done {project} "<one line>"`: what changed, in one line. If the work moved a gate or the blocker (a domain is set up, Stripe works, a flow was hand-tested, a release build exists), say so in that line ("gate 'payments' done: Stripe checkout works in test mode") so the card can be updated from it.
