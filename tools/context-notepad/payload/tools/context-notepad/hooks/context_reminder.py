#!/usr/bin/env python3
"""Hook: state the context size as a fact once it passes the configured target.

Runs on UserPromptSubmit (Claude Code and Codex). It reads the transcript named
in the hook JSON, measures the current context from its usage records, and when
the size is at or above `context_soft_tokens` (default 150000) prints
additionalContext such as "Context is at 182K tokens (target 150K, hard limit
200K); thread demo has 4 open items." Below the target it prints nothing.

The wording states facts and gives no instruction; the skill says what to do.
It repeats only after the context grows another REMINDER_STEP_TOKENS.
It never fails the agent: any error is swallowed and the exit code is 0.
"""

from __future__ import annotations

import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import notepad  # noqa: E402
from context_usage import BELOW_TARGET, format_tokens, handoff_state, read_context  # noqa: E402
from transcript_sources import find_git_root, load_config  # noqa: E402

THREADS_NAMED = 3
# Restate the size only after it grows by this much, so the reminder does not
# repeat on every prompt past the target.
REMINDER_STEP_TOKENS = 10_000
REMINDER_STATE_DIR = Path(os.environ.get("CONTEXT_NOTEPAD_STATE_DIR")
                          or Path(tempfile.gettempdir()) / "context-notepad-reminders")


SAFE_SESSION_ID = re.compile(r"[^A-Za-z0-9_-]")
MAX_SESSION_ID_CHARS = 100


def state_file_for(session_id: str) -> Path | None:
    """The per-session state file inside a private state directory, or None when that is not safe.

    The directory defaults to a predictable place in the shared temp folder, so it is created
    owner-only and refused when it is a symlink or belongs to someone else. The session id
    becomes a plain filename: every character outside letters, digits, `_` and `-` is replaced.
    """
    safe_id = SAFE_SESSION_ID.sub("_", session_id)[:MAX_SESSION_ID_CHARS]
    if not safe_id:
        return None
    try:
        REMINDER_STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = REMINDER_STATE_DIR.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            return None
        if hasattr(os, "getuid") and info.st_uid != os.getuid():
            return None
    except OSError:
        return None
    return REMINDER_STATE_DIR / f"{safe_id}.txt"


def should_remind(session_id: str, tokens: int) -> bool:
    """True the first time a session reaches each new step past the target.

    When the state file cannot be used safely the reminder is not deduplicated.
    """
    if not session_id:
        return True
    state_file = state_file_for(session_id)
    if state_file is None:
        return True
    step = tokens // REMINDER_STEP_TOKENS
    try:
        last_step = int(state_file.read_text())
    except (OSError, ValueError):
        last_step = -1
    if step <= last_step:
        return False
    try:
        state_file.write_text(str(step))
    except OSError:
        pass
    return True


def open_items_phrase(root: Path) -> str:
    counts: dict[str, int] = {}
    for slug, _ in notepad.collect_open_items(root):
        counts[slug] = counts.get(slug, 0) + 1
    if not counts:
        return "no thread has open items"
    if len(counts) == 1:
        slug, count = next(iter(counts.items()))
        return f"thread {slug} has {count} open item{'s' if count != 1 else ''}"
    top = sorted(counts.items(), key=lambda pair: -pair[1])[:THREADS_NAMED]
    return "open items: " + ", ".join(f"{slug} {count}" for slug, count in top)


def build_message(payload: dict) -> str | None:
    config = load_config()
    reading = read_context(Path(str(payload.get("transcript_path") or "")).expanduser())
    if not reading:
        return None
    soft, hard = config.context_soft_tokens, config.context_hard_tokens
    if handoff_state(reading.tokens, soft, hard) == BELOW_TARGET:
        return None
    if not should_remind(str(payload.get("session_id") or ""), reading.tokens):
        return None
    root = notepad.notepad_root(find_git_root(Path(payload.get("cwd") or ".")), config.notepad_dir)
    return (f"Context is at {format_tokens(reading.tokens)} tokens "
            f"(target {format_tokens(soft)}, hard limit {format_tokens(hard)}); {open_items_phrase(root)}.")


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        message = build_message(payload if isinstance(payload, dict) else {})
        if message:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": message}}))
    except Exception:  # noqa: BLE001 - a reminder must never fail the agent
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
