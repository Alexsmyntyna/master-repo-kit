# Changelog

## 0.2.3 — 2026-10-28

- Landing page and GitHub Pages files (`docs/`), checked claim by claim against the code.
- Mockup review: a mockup with many screens no longer spills under the notes panel; the screen tabs scroll instead.
- `master update` tells you when a release changes a shipped skill you have overridden in `local/skills/`, with the `git diff` to compare. The override is kept and the update is never blocked.

## 0.2.2 — 2026-10-28

- Security: agents' `git branch` allows are exact commands with no wildcard, since git accepts bundled flags (`-vD`) and shortened options (`--del`) that slipped past 0.2.1's deny patterns. Filtered listing goes through `git for-each-ref`.

## 0.2.1 — 2026-10-28

- Security: read-only agent runs (thread turns, fan-out lanes, recheck, the contradiction judge, screens) no longer load user or project Claude Code settings, whose permission rules could let them run commands such as `rm` or `git commit`. Agents list branches only in read-only forms; flags that create, rename or delete a branch, and `--output`, are denied anywhere in the command.

## 0.2.0 — 2026-10-28

- The CEO can consult several projects at once: a `FANOUT:` line starts one COO per project in parallel, each in that project's repo, and the thread shows them as live lanes. Then the CEO answers once.
- Roles come from `agents/*.md`. New: Marketing and Research. Add your own; front matter sets model, turns, tools and the folders it may write (`writes`).
- Contradiction check: `master contradict check` pairs things you said on different days about the same topic; `--run` has an agent judge them, and open ones show on the project card to settle.
- `master init` asks for the hub's name and your code folder, finds your repos, makes a project for each one you pick, and can add the pointer block to their CLAUDE.md and AGENTS.md.
- Coding agents' project context includes the latest decisions.
- Next.js 16.4.3 and patched sharp and source-map-js: `npm audit` reports 0 vulnerabilities.

## 0.1.1 — 2026-10-28

- README: both install paths (with and without `gh`), starting the app with `tools/master`, and an honest "not yet" list.
- `master update` keeps working when you have local skill overrides: the generated skill index and wrappers are rebuilt instead of counted as engine edits.
- `master update` names the kit release it merged.
- The check-in schedule's launchd label can be set with `MASTER_REPO_SCHEDULE_LABEL`; the default is `local.<id>.checkins`.

## 0.1.0 — 2026-10-28

First release.

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
