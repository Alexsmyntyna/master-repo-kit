---
name: resolution
title: Resolution
scope: company
status: ready
params: [project, front]
kind: session
when: "The owner wants to work down an open front or asks what it would take to fix something already recorded as a concern."
---

Work on one of `{project}`'s open fronts: `companies/{project}/wiki/fronts/{front}.md`. The concern session already recorded what's wrong; this session decides what to do about it.

1. Read the front, its evidence, and the story (`wiki/index.md`) so the resolution serves what the project is for.
2. With the owner, one question at a time, work out what it would take: a change in the code, a new piece (an app, a website, a server, a pricing model, marketing), cutting or shrinking a feature, merging with another project, or accepting it and parking the front. Research or inspect code when a question needs facts (read-only, use `skills/investigate-repo.md`).
3. Be concrete about the smallest thing that would show whether the resolution works.

Write back:

Write by `skills/writing.md`: their decision quoted, facts cited, a few sentences.

- Update the front: a "Where we landed" section, what it needs, and `status: working` if the owner is taking it on, `settled` if it's resolved, or `parked` with what would bring it back. Bump `updated`.
- Append the decision to `decisions.json`.
- If the resolution needs a new area of work (a server, a site, marketing), say so on the front in a sentence or two. Don't create task lists.
- If the story changed because of it, offer to update `wiki/index.md`.
