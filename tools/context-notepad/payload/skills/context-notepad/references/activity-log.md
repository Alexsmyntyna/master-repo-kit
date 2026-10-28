# Activity log

The file named by config `activity_log`. One JSON object per line, written only by `activity_log.py` (appends are locked, ids are monotonic: e1, e2, ...).

Fields: `at` (ISO with offset), `agent`, `model`, `event`, `thread`, `parent`, `id`, `title`, `bullets` (at most 4), and for `review` events `verdict` (accepted, fixed_by_reviewer, escalated), `escalated_to`, `reason`. Hook and backfill entries also carry `session` and `key`.

Events: `session_start`, `small_task`, `subagent_launch`, `subagent_done`, `review`, `handoff`. `parent` is the id of the entry that caused this one, so a query reads as a tree.

```
activity_log.py add --event session_start --model opus --thread T --title "..." --apply
activity_log.py add --event subagent_launch --model sonnet --thread T --parent e17 --title "..." --bullet "..." --apply
activity_log.py query --hours 24 [--thread T] [--event review] [--format markdown|json]
activity_log.py backfill --since 2026-10-01          # dry run; --apply appends, skipping logged keys
activity_log.py models --days 30                     # experimental per-model counts
```

For a `review` event, `--model` is the model whose work was judged. The `models` table is only as complete as the review events logged, so log every review.

Hooks (`tools/context-notepad/hooks/`): `log_subagent.py` logs launches and completions and never fails the agent; `context_reminder.py` prints one factual line when context passes the target. Install them with `install.py --target REPO --hooks`.
