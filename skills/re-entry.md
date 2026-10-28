---
name: re-entry
title: Re-entry
scope: company
status: ready
params: [project]
kind: session
when: "The owner wants to get back into a project they haven't touched in a while (\"where was I with the time-tracking app?\")."
---

The owner wants to get back into `{project}`. Help them pick up where they left off.

Read `companies/{project}/company.json` (especially `reentry`, `roadmap`, `open_questions`) and the latest review. Then inspect the repo(s) read-only: recent commits and dates, current branch, uncommitted work, TODOs, open branches or worktrees, and what was changing most recently. Don't run builds or install anything without asking.

Tell the owner, briefly and by `skills/writing.md` (commits with sha and date): when it was last active, what was mid-flight, what state the working tree is in, and the most sensible first step back in. Ask what they remember about why they stopped; don't guess.

Write back: update `reentry` (with `code` provenance and commit) and add anything learned to `open_questions`.
