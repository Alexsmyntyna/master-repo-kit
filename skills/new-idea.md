---
name: new-idea
title: New idea
scope: idea
status: ready
params: [idea]
kind: session
when: "The owner has a new idea, or wants to consolidate several ideas into one app instead of starting another."
---

The owner has a new idea. First find its central intent. Ask one question if it's unclear. Keep their concrete details and unresolved tensions.

Then compare it against the corpus: every `companies/*/company.json` (thesis, customer, product, developer.technologies) and `discovery/ideas/`. For each serious overlap, note audience, job, reusable code or knowledge, and upkeep.

Recommend one of: **its own project**, **part of an existing project** (which one and why), or **a tool** (build it small and stop). Say what it would take attention from and the smallest way to test it.

Write back to `ideas/<slug>/` (older ideas sit in `discovery/ideas/`):

- `index.md`: the small landing page the app shows under Ideas. Frontmatter `title`, `name`, `summary`, `status` (`exploring | building | parked | dropped`), `date`, `updated`, `raised_by`, `written_by: agent`, `site` (if a sales page exists), `links` (related company slugs). Body: their words quoted, an at-a-glance table, linked projects, open questions.
- `brief.md`: the idea quoted in the owner's words, the comparison as a table, and the recommendation marked as the agent's (`skills/writing.md`).
- `research/<lane>.md`: one note per research lane (Sonnet subagents).
- `site/` (when the owner wants the idea pitched or shown to someone): a standalone sales page, `index.html` plus its own CSS/JS, built by a strong model. It has to look like a real product launch page, use only sourced facts, and be checked in headless Chrome at desktop and phone width.

If the owner decides to pursue it as a project, create `companies/<slug>/` from `_template` and link the idea.
