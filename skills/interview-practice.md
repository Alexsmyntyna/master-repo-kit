---
name: interview-practice
title: Interview practice
scope: identity
status: ready
params: [project]
kind: session
when: "The owner wants to practise interview questions about their work, rehearse explaining a project, prepare for a specific role, or debrief after an interview (\"ask me about the finance app\", \"practise a recruiter call\")."
---

Practise talking about the owner's work, `{project}` if they named one, as a real conversation.

**First use: migrate.** The material still lives in `archive/career-coach-2026-09/`, which is read-only. The first time this skill runs, copy what's needed into `identity/career/` with a line at the top citing the source path: `interviews/practice.md` (modes and feedback rules), `interviews/story-bank.md` (conversation threads, not scripts), `evidence/claims.md` (claim IDs the story bank cites), and any role file such as `interviews/neon.md` only when that role comes up. The old `AGENTS.md` there, section "Interview practice", has the rules this skill is built from. After migrating, update `identity/career/README.md` to point at the new files and read from `identity/career/` from then on.

Before starting, read the story bank, `identity/narrative.md`, `identity/profile.md`, and the project's `company.json` and wiki story so follow-ups are informed.

1. Ask only for missing context: recruiter, hiring manager, technical depth, founder, résumé walkthrough, or debrief, and whether they want feedback straight away or after a few turns. Default to a few turns, then one or two concrete observations.
2. Ask one question. Wait for their answer. Follow up on a specific detail they gave (what someone uses it for, what made it hard, why that choice), not the next item on a list. Don't make every conversation a technical quiz, and don't test them on file names.
3. Never show a model answer before they try, never score silently, never ask several questions at once. A quiet-recruiter exercise only if they ask for it.
4. Feedback says where a listener could picture it and where they'd lose the thread. In text you can't judge how they sounded or how long they took; don't pretend to.
5. Keep to what they're actually done. Don't invent experience, numbers, customers, results or interviewer reactions, and don't put words in their mouth they haven't used. Name real gaps plainly and once (research isn't production use; exposure isn't depth; `local/owner.md` lists known limits). For a specific role, compare its requirements against supported evidence, adjacent experience and gaps.

Save only what's worth keeping, in `identity/career/`: a newly confirmed example or detail added to the story bank with its source, a phrase they liked, a factual correction, and one thing to practise next time. A lesson in their own words goes to `identity/lessons.json` (`source: owner`). Don't save every hesitant sentence or keep a list of weaknesses. Résumé or website copy is separate work; don't rewrite it here unless they ask.
