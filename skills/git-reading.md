---
name: git-reading
title: Git reading
scope: company
status: ready
params: [project]
kind: task
when: "A project's git history hasn't been read into its story, or it's time for the weekly git check."
---

Read the part of `{project}`'s git history nobody has read yet, and turn it into a dated entry in its story. The tool does the counting; you do the interpreting.

1. `python3 tools/git_history.py segments {project} --unread` to see what's left. On a first deep dive there may be many segments. Take a few at a time, oldest first, rather than the whole history at once.
2. `python3 tools/git_history.py report {project} --segment <ids>` (or `--unread`) for the digest: momentum, feature-style commits, rework hotspots, files written once.
3. Use `git show` / `git log -- <file>` on the repo only where the digest raises a real question: a hotspot, a revert run, a burst that stops suddenly.
4. Write what you found in `companies/{project}/notes/YYYY-MM-DD-git-<range>.md`, by `skills/writing.md` (a list or table per point, no narrative):
   - what this stretch of work added, each item with a sha and date
   - when the work started and stopped (dates and counts, not reasons)
   - what landed cleanly, and what took repeated fixes (a likely confidence gap for the owner)
   - questions to raise with the owner; don't guess their reasons
   Mark every claim as `code` with the commit range. Commit messages say what changed, not why the owner did it. Fix-style counts come from commit messages and file touches; say so when that matters.
5. `python3 tools/git_history.py mark {project} --segment <ids> --ref <that note>`.

6. `python3 tools/git_history.py snapshot {project}` so the app's timeline and momentum update.

Don't mark a segment read that you only skimmed. For the weekly check: run `python3 tools/git_history.py weekly`, read what's new for each project as above, run `snapshot` for all projects, and tell the owner only what's worth their attention (a fix-heavy burst, a project gone quiet, something that looks wrong). Offer a front if something needs one; don't create it unasked.
