---
name: mockup-review
title: Mockup review
scope: company
status: ready
params: [project, question]
kind: task
when: "A design question needs the owner's eye (\"what could the phone app look like?\", \"mock up the end-of-shift screen\", \"draw it\"), or any agent is about to make mockups, prototypes or design options for a project."
---

Make one mockup that answers `{question}` for `{project}`, with honest trade-offs, so the owner has something concrete to riff on. Three variations side by side are hard to compare; make one (`local/owner.md` has the owner's words on this).

## Rules

- **One mockup, your best answer.** No A/B/C variations and no decision hub (the context-notepad hub with tabs, radio options and "Copy for the agent" is retired for this). Name the alternatives you didn't draw in the trade-off table.
- **It looks like the real product.** Read its code first: tokens, components, copy, and the data types and field names (`companies/{project}/screens/` shows how it looks now). Use believable sample data in those shapes. Say what you invented. Not a generic template, not lorem ipsum.
- **Small.** A phone prototype is a handful of screens in one file; a desktop one is one or two pages.

## The review folder

`companies/{project}/mockups/<YYYY-MM-DD>-<topic>/` (a coding agent in the project repo writes it to `master-repo-mockups/<…>/` in its worktree instead; `tools/build.py` copies it over after the run):

- `index.html`: self-contained (inline CSS and JS; external fonts, images and requests are blocked, so use data: URIs). It fills its viewport; the app draws the phone (402x874) or desktop (1280x800) frame. Several screens in one file route on `location.hash` and call `parent.postMessage({ mockupScreen: "<hash>" }, "*")` on each change, so the owner's pins land on the right screen. Extra `<name>.html` files only when a screen can't share the file.
- `review.md`: frontmatter `title`, `date`, `status: open`, `thread` (the thread it came from, or `""`), `frame: phone | desktop`, optional `size: 402x874`, `screens` (list of `{ file: "index.html#home", label: Home }`), `questions` (2–6 of `{ ask, shown, screen }`: the question, how the mockup answers it, the screen that shows it). Body: `| Choice in the mockup | Gains | Costs |`, then one line on what it leaves out.
- `notes.md`: written by the app when the owner saves (their answers and numbered pins with positions). Never write or edit it. When the review has a `thread`, the same notes are posted there (`converse.py post`), so the next turn picks them up.

In a thread, end the message with a ```mockups block whose one line points at the review's `index.html`; the app links it to the review page.

## After the owner answers

Read `notes.md`. Make the next round as a new review folder (new date or topic), not by editing the answered one, so the archive at `/companies/{project}/mockups` and the project timeline keep the history.

When the owner says a round is finished or superseded ("move the nav mockups to archive", 2026-10-22), set its `status: archived`; the folder stays where it is and the app lists it under Archive.
