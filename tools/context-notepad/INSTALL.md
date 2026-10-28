# Installing context-notepad (for an AI agent)

context-notepad is a small vendored toolkit: a transcript digest, thread
notepads, an activity log, hooks, and skills, for Claude Code and Codex. Installing copies plain files
into a target repository and records a lock file. Python 3 stdlib only.

## Steps

1. Dry run, from this repository:

   ```
   python3 install.py --target /absolute/path/to/repo
   ```

   Read the plan. It lists files to add, the CLAUDE.md and AGENTS.md blocks to
   insert or create, and the config file to create. Nothing is written.

2. Apply:

   ```
   python3 install.py --target /absolute/path/to/repo --apply
   ```

3. Edit `tools/context-notepad/config.json` in the target:
   - `repo_prefixes`: starts as the target's absolute path. If the project was
     renamed or moved, add every old absolute path; transcripts are matched by
     the working directory recorded in them, and prefix matching also covers
     subdirectories and worktrees.
   - `notepad_dir`: where thread folders live (default `context-notepad/threads`).
   - `mockup_dir`: empty keeps mockups in each thread's `mockups/`; set a repo
     folder such as `prototypes` if the project keeps them elsewhere.
   - `activity_log`, `context_soft_tokens` (150000), `context_hard_tokens` (200000).
   - `roles`: model per role. The `codex` entries are placeholders
     (`CODEX_*_MODEL`); ask the owner for the real model ids. `escalation` is the
     retry order.
   - `extra_drop_prefixes`: opening text of machine-composed prompts that should
     not count as owner turns.

4. Verify:

   ```
   python3 tools/context-notepad/session_digest.py --list
   ```

   You should see recent sessions for this project with plausible owner-turn
   counts. `python3 tools/context-notepad/session_digest.py --previous` prints
   the last session's timeline. Run `install.py --target REPO --status` to see
   the installed version and any local modifications.

5. Hooks (optional, recommended). Dry run first, read the diff, then apply:

   ```
   python3 install.py --target /absolute/path/to/repo --hooks
   python3 install.py --target /absolute/path/to/repo --hooks --apply
   ```

   This merges SubagentStart, SubagentStop and UserPromptSubmit entries into
   `.claude/settings.json`, and PreToolUse (`spawn_agent`) and UserPromptSubmit
   entries into `.codex/hooks.json`, keeping every hook already there. Codex
   loads project hooks only when the project's `.codex/` layer is trusted, and
   each hook must be reviewed with `/hooks` in the Codex CLI first. To use
   `~/.codex/hooks.json` instead, copy the entries by hand; the installer never
   writes to the home directory.

6. Optional: rebuild launch history from past sessions and check context size.

   ```
   python3 tools/context-notepad/activity_log.py backfill --since 2026-10-01
   python3 tools/context-notepad/session_digest.py --context
   ```

   Backfill is a dry run until `--apply`. If the project has 0.1.0 single-file
   threads, run `python3 tools/context-notepad/notepad.py migrate --apply`.

7. Tell the owner what was added. Do not commit unless asked.

## Updating later

```
python3 install.py --target /absolute/path/to/repo --update          # dry run
python3 install.py --target /absolute/path/to/repo --update --apply
```

Files unchanged since install are replaced. A file the owner edited is never
overwritten: the update prints a unified diff and lists it as needing a manual
merge. Files removed from the payload are reported and left in place.
`config.json` keeps all its values; keys that are new in this version are added
with their defaults and listed in the output. Add `--hooks` to merge hook entries
in the same run.

## What gets installed

| Source | Destination |
|---|---|
| `payload/tools/context-notepad/` (hooks included) | `tools/context-notepad/` (plus `.lock.json`, `config.json`) |
| each folder in `payload/skills/` | `.agents/skills/<name>/` and `.claude/skills/<name>/` |
| `payload/agents-block.md` | marked block in `CLAUDE.md` and `AGENTS.md` |

The block sits between `<!-- context-notepad:begin vX.Y.Z -->` and
`<!-- context-notepad:end -->`; updates replace only that region.
