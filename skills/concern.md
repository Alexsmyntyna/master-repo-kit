---
name: concern
title: Concern
scope: company
status: ready
params: [project, concern]
kind: session
when: "The owner says they aren't confident about something, are worried about a feature, or wonder why a project stalled (\"I don't trust the payments code\", \"the sync scares me\")."
---

Talk through something the owner isn't confident about in `{project}`: {concern}.

This is a Socratic conversation, not a fix. Ask one question at a time. Find out what exactly they don't trust, what they'd need to see to trust it, whether it's part of why the project stalled, and what the project would need for it to work the way they want (an app, a website, a server, marketing, a pricing model, cutting a feature, merging with another project).

Use evidence when it helps: `python3 tools/git_history.py report {project} --unread`, the relevant code (read-only), and the project's own context docs. Keep their account and your findings separate.

Write back:

- If it's a new big theme, create a front at `companies/{project}/wiki/fronts/<slug>.md` with `kind: front`, `status: open`, `raised_by: owner`, a `summary`, and `written_by: agent`, and short sections: the concern quoted in their words with the date, "Dealt with when" (one observable condition), "Might need", "Evidence" (cited). A few sentences, not an essay (`skills/writing.md`). Keep at most five open fronts; propose merging or parking one before adding a sixth.
- If it belongs to an existing front, update that page instead and bump `updated`.
- If a decision was made, append it to `decisions.json`.
- If the conversation resolves a front, set `status: settled` (or `parked`, with what would bring it back) and add a "How it was settled" section.

No task lists, no subtasks, no dates to hit.
