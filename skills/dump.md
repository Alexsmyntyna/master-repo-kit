---
name: dump
title: Dump
scope: any
status: ready
params: []
kind: session
when: "The owner talks or pastes at length (20–50 minutes of speech, several projects at once, 30–100k characters) and wants it digested: stored, compressed, filed to the projects it touches, and turned into work."
---

Digest one long talk or paste. The point is that nothing they said is lost and nothing is started before it's filed. Writing follows `skills/writing.md`; where things go follows "Where things go" in `AGENTS.md`.

1. **Store the raw text verbatim** at `holding/uploads/<YYYY-MM-DD>/dump-<slug>.md`. Frontmatter: `title`, `kind: dump`, `source: owner`, `how: spoken | pasted`, `date`, `written_by: owner`, `sidecar: <path>`. It is their words; quote from it with that path. Fix nothing in it.
2. **Write the sidecar** at `holding/dumps/<YYYY-MM-DD>-<slug>.md`: a numbered table of every item in the order they said it (`#`, paragraph pointer, compressed item, project, where it went). Nothing is dropped; a half-formed thought is still a row. Fix obvious transcription errors in the compression, mark an unclear name as unclear, and never guess a product or model name.
3. **Route each row to its home.**

   | What it is | Where it goes |
   | --- | --- |
   | Their words about a project | that project's story, newest first |
   | A fact or field | `company.json`, with `source: owner` |
   | A concern | a front (at most five open; group before writing) |
   | An idea that belongs to no project | `discovery/ideas/` or `holding/wiki/ideas/` |
   | Something only they can do | `reentry.first_step_back` |
   | A question about code | an `investigate-repo` task |
   | Feedback about Master-Repo itself | `holding/reviews/<date>-master-repo-<topic>.md` |

   Fill the "where it went" column with links.
4. **Only then start work.** Investigations now (read-only). Board epics and threads only where they asked for a decision or a build. Say in the sidecar what was not started and why. Never post into a thread as them.
5. **If the dump answers a waiting decision,** say so in the recap and point them to `/decisions`. Don't approve for them.
6. **Fan the pages out to subagents,** one per project, giving each the raw path, the sidecar path and `skills/writing.md`. Review what they wrote before committing. Commit and push to `main`.
7. **Recap to the owner:** one line per project with what was written, what's waiting on them, and the sidecar path.
