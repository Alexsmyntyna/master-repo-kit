# Skills

Each file here is one skill: a way of running a session or doing a focused job in Master-Repo. The owner doesn't pick or copy them. They say what they want to work on, and the agent reads [INDEX.md](INDEX.md) and loads whatever fits.

- One source of truth: `skills/<name>.md`. Its frontmatter `when` line decides when agents use it.
- `python3 tools/skills.py sync` regenerates `INDEX.md` (for every agent, via `AGENTS.md`) and `.claude/skills/*/SKILL.md` (so Claude Code loads skills natively). `check` fails when they're stale.
- To add one, follow [write-skill](write-skill.md). Agents are expected to write new skills when a session reveals a repeatable way of working.
