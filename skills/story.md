---
name: story
title: Story
scope: company
status: ready
params: [project]
kind: session
when: "The owner wants to write or rewrite why a project exists and where it's going, or a project has no wiki landing page yet."
---

Write or rewrite `{project}`'s story: the landing page of its wiki at `companies/{project}/wiki/index.md`. Follow `skills/writing.md`; the story page shape is there.

The story is built from the owner's words and the code, not written for them. It says, in their words, why the project exists and where they want it to go, and, from the code, what exists. At most about 250 words.

1. Collect their words, newest first: their messages in `companies/{project}/threads/*/*-owner.md`, `decisions.json`, `company.json` fields with `source: owner`, and their own vault notes (`skills/vault-reading.md`). Their newest direction overrides older summaries and the current page.
2. Collect what exists from the code: `companies/{project}/git/snapshot.json`, recent commits (sha and date), and the main files or screens. Use `skills/investigate-repo.md` when a question needs it.
3. Fill the four sections: `## In your words` (dated quotes), `## What exists` (a table with evidence), `## Where it's going` (their newest direction; at most two sentences marked Agent:), `## Open questions`. Where their words are missing, leave an open question; don't fill the gap with prose.
4. Show the owner the draft and ask one question at a time about what's missing or wrong.
5. Save with frontmatter `kind: story`, a one-sentence `summary`, `date`, `updated`, `written_by: agent` (`owner` only if they wrote the body). If the direction changed, add a short `history` page saying what shifted and citing their message.
