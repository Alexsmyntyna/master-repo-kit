# context-notepad

Origin: moved into Master-Repo on 2026-10-27 from `~/Documents/GitHub/context-notepad`
(branch master, last commit `0ab6e10` = 0.4.0). The old repo stays as history.
Install from here: `python3 tools/context-notepad/install.py --target PROJECT`.
Notepad data for ReaderApp lives in `companies/reader-app/notepads/` (its `config.json`
points `notepad_dir` and `activity_log` there).

Status: 0.5.0, working
Last verified: 2026-10-27

A lightweight notepad for long agent work in Claude Code and Codex. It keeps
what the owner said, verbatim, next to what the agent did with it, so a new
session can pick up the direction and the owner can see where the agent misread
the intent. It records and surfaces; it never plans or steers on its own.

It is vendored into a project, never a dependency: an agent reads
[`INSTALL.md`](INSTALL.md), runs the installer, and the project
ends up owning plain files plus a lock recording which version they came from.

## Pieces

1. **`session_digest.py`** (read-only, deterministic, no model). Prints a
   timeline for one session: each owner turn verbatim, then what the agent did
   before the next owner turn (files edited, commands run, subagents spawned,
   the closing reply, trimmed). Flags *drift candidates*: interrupts, denied
   tool calls, and owner turns that open with a correction ("no", "I meant",
   "actually"). The agent judges which were real misunderstandings.

2. **Thread folders**: one folder per line of work, spanning sessions and
   both agents: `<notepad_dir>/<thread>/{notepad.md, briefs/, mockups/}` plus
   `<notepad_dir>/INDEX.md` (one line per thread: title, status, scope words).
   `notepad.md` sections, in order: *Vision* (the owner's own words, quoted
   verbatim, never paraphrased), *Interpretation*, *Drift*, *Next*, *Done*,
   *Artifacts*, *Sessions*. Next is a checklist with ids (`- [ ] N3 text`):
   `check` needs evidence and moves the item to Done, `drop` and `block` keep it
   with a reason, nothing is deleted. `brief` writes a subagent brief from the
   thread (Vision quotes copied verbatim by number), `route` ranks threads
   against a request, `audit` lists open items, `migrate` converts 0.1.0
   single-file threads.

3. **`activity_log.py`**: an append-only JSONL log of session starts, small
   tasks, subagent launches and completions, reviews (accepted, fixed by
   reviewer, escalated) and handoffs, queried as a tree (`query --hours N`).
   `backfill` rebuilds launch events from past transcripts; `models` shows
   per-model counts (experimental).

4. **Context readout**: `session_digest.py --context` reports the current
   session's context size from its own usage records, with the 150K target and
   200K hard thresholds from config.

5. **Hooks** (`hooks/`, installed with `install.py --hooks`):
   `log_subagent.py` logs launches and completions and never fails the agent;
   `context_reminder.py` adds one factual line past the target.

6. **Skills**: `context-notepad` (size the task, route, delegate with briefs,
   log, hand off) with reference files for the long material, and the separate
   `codebase-prune` skill for cleanup requests.

## Two agents, one notepad

| | Claude Code | Codex |
|---|---|---|
| Transcripts | `~/.claude/projects/<path-slug>/<session>.jsonl` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Scope to a repo by | record `cwd` | `session_meta.payload.cwd` |
| Owner turns | `type: user`, not `isSidechain`, typed prompt | `response_item` with `role: user` |
| Repo skills | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` |
| Instructions file | `CLAUDE.md` | `AGENTS.md` |
| Hooks | `.claude/settings.json` (`SubagentStart`, `SubagentStop`, `UserPromptSubmit`) | `<repo>/.codex/hooks.json` (project layer, must be trusted) or `~/.codex/hooks.json`; `PreToolUse` with `spawn_agent`, `UserPromptSubmit` |
| Context size | last main-chain assistant `message.usage` | last `token_count` event, `last_token_usage.input_tokens` |

The digest reads transcripts through a small source interface, one adapter per
agent, and the notepad and skill never care which agent produced the history.
The skill is written once in the shared `SKILL.md` format (`name` and
`description` frontmatter, optional `scripts/`), and installed to both skill
directories.

## Install and update

- `install.py --target <repo>`: dry run by default, `--apply` to write.
  Copies tools (hooks included) into `tools/context-notepad/`, every skill under
  `payload/skills/` into `.agents/skills/` and `.claude/skills/`, and writes
  `.lock.json` with the version and a hash per installed file.
- `--hooks` merges the hook entries into the target's `.claude/settings.json` and
  `.codex/hooks.json` (diff first, existing hooks kept). Nothing is written to
  the home directory.
- `CLAUDE.md` and `AGENTS.md` get a marked block,
  `<!-- context-notepad:begin vX -->` ... `<!-- context-notepad:end -->`;
  updates replace only that block.
- Project-specific values (past repo paths, notepad location) live in a config
  file the installer never overwrites.
- `install.py --update`: replaces files whose hash still matches the lock, and
  shows a diff for locally edited files instead of overwriting them. Missing
  default keys are added to `config.json`; existing values are never changed.

## Layout and usage (0.5.0)

```
payload/tools/context-notepad/   session_digest.py, transcript_sources.py, context_usage.py, notepad.py,
                                 activity_log.py, hooks/, config.example.json (+ codebase-prune's tools)
payload/skills/                  context-notepad/ (SKILL.md, references/), codebase-prune/
payload/agents-block.md          managed block for CLAUDE.md / AGENTS.md
install.py  INSTALL.md  VERSION  tests/
```

- `session_digest.py [--list | --previous | --session ID | --last N | --since DATE | --context]
  [--agent claude|codex|all] [--format markdown|json] [--max-reply N]
  [--project PATH] [--prefix PATH] [--config PATH]`. Owner turns print verbatim in a
  fenced block. Sessions with no owner turns are skipped; resumed-session replays
  are removed by (opening text, timestamp).
- `notepad.py new|list|show|meta|index|add|quote|next|check|drop|block|audit|artifact|mockup-dir|brief|route|migrate`.
  Every write is a dry run until `--apply`. Vision only accepts `quote`.
  `add --replace` works for Interpretation and first copies the old file to the
  thread's `.history/`; so does every edit of existing lines (check, drop, block).
- `activity_log.py add|query|backfill|models`; appends are one line per write under
  a lock file, ids are monotonic (`e1`, `e2`, ...), at most four bullets per entry.
- Config (`tools/context-notepad/config.json`, never overwritten): `notepad_dir`
  and `activity_log` (relative to the project root, or an absolute or `~` path so the
  data can live outside the project),
  `mockup_dir` (empty means each thread's `mockups/`; otherwise a repo folder,
  `{thread}` allowed, e.g. `prototypes`), `activity_log`, `context_soft_tokens`
  (150000), `context_hard_tokens` (200000), `roles` (claude: coordinator, builder,
  small_builder, scout; codex: coordinator, builder, scout with placeholder model
  ids to fill in), `escalation` (haiku, sonnet, opus), plus the transcript settings.
- Scoping is by recorded cwd with plain string prefix matching, from `config.json`
  `repo_prefixes`, the git root of `--project`, and `--prefix`.
- Codex subagent sessions and `codex exec` runs are not treated as owner sessions
  (config `include_codex_exec_sessions` overrides). Codex subagent names come from
  `spawn_agent` task names because their briefs are encrypted in the rollout.
- Tests: `python3 -m unittest discover tests` (synthetic fixtures only).

## Build order

1. `session_digest.py` with Claude Code and Codex adapters, tested against
   ReaderApp's real transcripts.
2. Notepad format and skill.
3. `install.py`, `INSTALL.md`, then ReaderApp as the first install.
4. 0.2.0: thread folders, checklists, briefs, activity log, hooks, context
   readout, model roles, second skill.
5. 0.3.0: decision hub template, `hub new` and `hub import`; reminder state kept
   in a private directory; the installer refuses destinations that resolve
   outside the target.
6. 0.4.0: the hub becomes tabs with click-to-pick mockup cards, a corner widget,
   and "Explore more"; feedback v2 carries the question and what each pick means.
7. 0.5.0: moved into Master-Repo as `tools/context-notepad/`. The decision hub
   (`hub new`, `hub import`, `payload/templates/`) is removed; mockup decisions
   follow Master-Repo's `skills/mockup-review.md`. `notepad_dir`, `activity_log`
   and `mockup_dir` accept absolute and `~` paths.

Background and papers: [`docs/research.md`](docs/research.md).
