# Changelog

## 0.1.0 — unreleased

Not released. This is what the code does today.

Ships:

- Skills in `skills/`: re-entry, research, new idea, concern, resolution, story, brand, mockup review, screens, dump, holding review, GitHub discovery, git reading, identity, interview practice, and others. `skills/INDEX.md` is generated.
- Your own skills and overrides in `local/skills/` (`tools/skills.py override`, `disabled: true`).
- Python tools in `tools/`: git history, cards (goal, blocker, last touched), footprint, hygiene, recheck, refresh, rules, codebase discovery, pointer install, threads, builds, agenda, market.
- `tools/pointer.py install`: adds a marked block to each tracked repo's `AGENTS.md` / `CLAUDE.md` and writes `MASTER-REPO.md` at the repo root.
- Role prompts for a CEO and a COO in `agents/`, run as threads by `tools/converse.py` with Claude or Codex.
- Generic standards in `standards/`, with owner and project levels.
- The local app in `app/`: projects, wiki, timeline, threads, decisions, mockup review with pinned notes, screens, calendar, skills, standards, identity.
- `MASTER_REPO_ROOT` to keep data outside the code folder.
- `kit/starter/`: a minimal data directory.

Does not ship yet:

- `tools/master init` and `tools/master update` (in progress).
- The CEO thread showing its agents running side by side. A CEO can spawn threads; there is no lane view.
- A check that flags when a new statement contradicts an old one.
- Marketing and Research roles. Research exists as a skill, not a role.
- A note when an update changes a skill you copied.
- MIT licence (`LICENSE`).

See [CLAIMS.md](CLAIMS.md) for the line-by-line check.
