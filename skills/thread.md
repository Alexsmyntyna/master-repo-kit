---
name: thread
title: Thread (CEO ↔ COO)
scope: any
status: ready
params: [project, question]
kind: task
when: "The owner wants a direction weighed before deciding (\"should the camera app go React Native?\", \"have the COO look into it\", \"what does the CEO think?\"), wants to talk ideas or revisions through with a project's agent (one project or several), or a coding agent needs to report back to Master-Repo."
---

Run a thread about `{question}` between `{project}`'s COO and its boss. The boss is the CEO when the project is in `focus` in `holding/portfolio.json`, and the owner otherwise (see "Who sits on which project" in `agents/README.md`). The roles are in `agents/ceo.md` and `agents/coo.md`; the format is in `agents/README.md`.

1. Check `python3 tools/converse.py list` for an open thread on the same question. Continue that one instead of starting a duplicate.
2. Start the thread with the owner's own words as the directive: `python3 tools/converse.py new {project} "<short title>" --body "<what the owner said>"`. Use `holding` instead of a project for questions across projects. Add `--to ceo` only if the owner asks for the CEO's view on a non-focus project. Don't add claims the owner didn't make. Agents in threads write by `skills/writing.md` (the prompts in `tools/converse.py` carry it).
3. Let the agents go back and forth: `python3 tools/converse.py run <thread>`. Each turn is a fresh headless `claude -p` on the owner's subscription. Use `--engine codex` to use their ChatGPT plan instead. It stops when a decision reaches the owner (from the CEO, or from the COO on a small project).
4. Tell the owner the decision in two or three lines and point them to `/decisions` in the app. They approve there or with `converse.py approve <thread>`. Never approve for them.
5. Approving records the decision in `companies/{project}/decisions.json` by itself. Update the matching front, as in `skills/resolution.md`.

When the owner just wants to talk something through (ideas, revisions, "what if…"), not get a decision, start a talk thread instead: `python3 tools/converse.py new {project} "<title>" --talk --about <other-slug>… --kind reply --body "<their words>"`, then `converse.py turn <thread>`. The agent answers them directly, keeps ideas as wiki pages, and only brings a decision when one is needed. See "Talking" in `agents/README.md`.

A coding agent working in a project repo orients with `inbox.py context <slug>` (see `skills/project-session.md`) and, when it was asked inside a thread, reports back with `converse.py post <thread> --as coo --kind report --body "..."`.
