---
name: write-skill
title: Write a skill
scope: any
status: ready
params: [what]
kind: task
when: "A session revealed a repeatable way of working that no existing skill covers, a skill turned out wrong or incomplete, or the owner asks for a new skill."
---

Write or improve a Master-Repo skill for `{what}`. Skills are how every agent here (Claude, Codex, others) decides what to do when the owner names a topic, so the `when` line matters most.

1. Check `skills/INDEX.md` first. If an existing skill nearly fits, improve it instead of adding a near-duplicate.
2. Create `skills/<name>.md` (kebab-case; the file name is the name) with frontmatter:
   - `name`, `title`, `kind` (`session` for a whole conversation, `task` for a focused job, `project` for agents coding in a project repo), `scope` (`holding | company | idea | identity | any`), `params` (what gets filled from what the owner said), `status` (`ready | placeholder`).
   - `when`: one sentence, in quotes, saying when to use it, in the words the owner would actually say. This is what agents match against.
3. Write the body to the agent: what to read, what to do, what to write back and where, and what not to do. Keep it short. Rules that apply everywhere belong in `AGENTS.md`, not in each skill. Point to other skills by name when one should call another.
4. Run `python3 tools/skills.py sync`. It regenerates `skills/INDEX.md` (read by every agent) and the Claude Code wrappers in `.claude/skills/`. Never edit those generated files by hand.
5. Mention the new or changed skill in your session summary.
