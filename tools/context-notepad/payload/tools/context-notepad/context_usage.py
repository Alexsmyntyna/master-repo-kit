#!/usr/bin/env python3
"""Read how large the current context is from a transcript's own usage records.

Claude Code records `message.usage` on every assistant record; the context a
request carried is input_tokens + cache_read_input_tokens +
cache_creation_input_tokens of the last main-chain assistant record. Codex
records `token_count` events; `last_token_usage.input_tokens` is the size of the
last request (it already includes cached tokens).

Why it exists: a handoff should be triggered by a measured number, not a feeling,
and both `session_digest.py --context` and the context reminder hook need the
same answer. Read-only; no model.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

TAIL_BYTES = 2_000_000
CLAUDE_USAGE_FIELDS = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")

BELOW_TARGET = "below target"
PAST_TARGET = "past target"
PAST_HARD_LIMIT = "past hard limit"


@dataclass
class ContextReading:
    agent: str
    tokens: int
    window: int = 0  # model context window when the transcript records it


def tail_lines(path: Path, chunk_bytes: int = TAIL_BYTES) -> Iterator[str]:
    """Lines of a file from the end, reading a growing tail until the caller stops."""
    size = path.stat().st_size
    with path.open("rb") as handle:
        read_from = max(0, size - chunk_bytes)
        while True:
            handle.seek(read_from)
            data = handle.read(size - read_from)
            lines = data.decode("utf-8", errors="replace").splitlines()
            if read_from > 0:
                lines = lines[1:]  # first line is probably cut in half
            yield from reversed(lines)
            if read_from == 0:
                return
            # Still iterating means the tail held nothing useful: continue with the older rest.
            size, read_from = read_from, 0


def parse_line(line: str) -> dict | None:
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return None
    return record if isinstance(record, dict) else None


def claude_tokens(record: dict) -> int:
    usage = (record.get("message") or {}).get("usage") or {}
    return sum(int(usage.get(name) or 0) for name in CLAUDE_USAGE_FIELDS)


def read_context(path: Path) -> ContextReading | None:
    """Newest context size found in the transcript, or None when it has no usage records."""
    if not path.is_file():
        return None
    for line in tail_lines(path):
        record = parse_line(line)
        if not record:
            continue
        if record.get("type") == "assistant" and not record.get("isSidechain"):
            tokens = claude_tokens(record)
            if tokens:
                return ContextReading("claude", tokens)
        payload = record.get("payload")
        if record.get("type") == "event_msg" and isinstance(payload, dict) and payload.get("type") == "token_count":
            info = payload.get("info") or {}
            tokens = int((info.get("last_token_usage") or {}).get("input_tokens") or 0)
            if tokens:
                return ContextReading("codex", tokens, int(info.get("model_context_window") or 0))
    return None


def handoff_state(tokens: int, soft: int, hard: int) -> str:
    if tokens >= hard:
        return PAST_HARD_LIMIT
    return PAST_TARGET if tokens >= soft else BELOW_TARGET


def format_tokens(tokens: int) -> str:
    return f"{round(tokens / 1000)}K"
