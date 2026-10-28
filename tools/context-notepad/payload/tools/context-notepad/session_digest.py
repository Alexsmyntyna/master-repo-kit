#!/usr/bin/env python3
"""Print a read-only timeline of an agent session: what the owner said, what the agent did.

Reads Claude Code and Codex transcripts for one project and prints each owner
turn verbatim, followed by a compact list of what the agent did before the next
owner turn (files edited, commands, subagents, denied calls) and its trimmed
closing reply. A final section lists drift candidates: exchanges that ended in
an interrupt or a denied tool call, or whose next owner turn opens with a
correction ("no", "I meant", "actually"). The reader judges which were real
misunderstandings.

With --context it instead prints the size of the current (newest, or --session)
session's context from its own usage records, the configured thresholds, and
whether a handoff is due.

Why it exists: a new session can pick up the owner's direction from their own
words, and the owner can see where the agent misread the intent. Deterministic,
no model involved, and it writes nothing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from context_usage import format_tokens, handoff_state, read_context  # noqa: E402
from transcript_sources import (  # noqa: E402
    AGENT_CHOICES,
    Config,
    Exchange,
    Session,
    SessionRef,
    discover_sessions,
    drop_replayed_exchanges,
    effective_prefixes,
    load_config,
    trim,
)

DEFAULT_LIST_COUNT = 20
REPLAY_LOOKBACK_SESSIONS = 5
SHORT_ID_CHARS = 8
LIST_TITLE_CHARS = 50
EDITED_FILES_SHOWN = 8
COMMANDS_SHOWN = 3
COMMAND_SHOWN_CHARS = 80
CORRECTION_SNIPPET_CHARS = 100


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------

def parse_date(text: str) -> str:
    """Validate a YYYY-MM-DD date and return it unchanged for string comparison."""
    datetime.strptime(text, "%Y-%m-%d")
    return text


def load_sessions(pairs: list, count: int) -> list[Session]:
    """Load the newest `count` sessions that have owner turns.

    Sessions with no owner turns (started and abandoned, or machine-driven) are
    skipped. A few older sessions are loaded as well so that a resumed session's
    replayed turns are recognised and dropped. Returned oldest first.
    """
    chosen: list[Session] = []
    older: list[Session] = []
    for source, ref in pairs:
        if len(chosen) >= count and len(older) >= REPLAY_LOOKBACK_SESSIONS:
            break
        session = source.load(ref)
        if not session.exchanges:
            continue
        (chosen if len(chosen) < count else older).append(session)
    drop_replayed_exchanges(chosen + older)
    chosen = [s for s in chosen if s.exchanges]
    return sorted(chosen, key=lambda s: s.started)


def select_sessions(args, config: Config, prefixes: list[str]) -> list[Session]:
    pairs = discover_sessions(config, prefixes, args.agent)
    if args.session:
        pairs = [(s, r) for s, r in pairs if r.session_id.startswith(args.session)]
    if args.previous:
        pairs = pairs[1:]
    if args.since:
        cutoff = datetime.strptime(args.since, "%Y-%m-%d").timestamp()
        pairs = [(s, r) for s, r in pairs if r.modified >= cutoff]
    count = args.last if args.last else (DEFAULT_LIST_COUNT if args.list else 1)
    if args.session and not args.last:
        count = len(pairs)
    return load_sessions(pairs, count)


# ---------------------------------------------------------------------------
# Drift candidates
# ---------------------------------------------------------------------------

def opens_with_correction(text: str, patterns: list[str]) -> bool:
    opening = text.lstrip(" \t\n\"'(*_-")
    return any(re.match(pattern, opening, re.I) for pattern in patterns)


def find_drift_candidates(session: Session, patterns: list[str]) -> list[tuple[Exchange, list[str]]]:
    """Exchanges worth a second look, each with the reasons it was flagged."""
    candidates = []
    exchanges = session.exchanges
    for position, exchange in enumerate(exchanges):
        reasons = []
        if exchange.interrupted:
            reasons.append("owner interrupted the agent")
        if exchange.denials:
            reasons.append(f"{len(exchange.denials)} tool call(s) denied")
        following = exchanges[position + 1] if position + 1 < len(exchanges) else None
        if following and opens_with_correction(following.owner_text, patterns):
            reasons.append(f"next owner turn (#{following.number}) opens with a correction")
        if reasons:
            candidates.append((exchange, reasons))
    return candidates


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------

def format_time(timestamp: str) -> str:
    if not timestamp:
        return "unknown"
    try:
        moment = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return timestamp
    return moment.strftime("%Y-%m-%d %H:%M")


def fence_for(text: str) -> str:
    """A code fence longer than any backtick run inside the text."""
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    return "`" * max(3, longest + 1)


def relative_path(path: str, cwd: str) -> str:
    prefix = cwd.rstrip("/") + "/"
    return path[len(prefix):] if cwd and path.startswith(prefix) else path


def render_exchange(exchange: Exchange, session: Session, max_reply: int) -> list[str]:
    fence = fence_for(exchange.owner_text)
    lines = [
        f"### {exchange.number}. Owner{' (sent mid-turn)' if exchange.sent_mid_turn else ''} ({format_time(exchange.owner_timestamp)})",
        "",
        f"{fence}text",
        exchange.owner_text,
        fence,
        "",
        "Agent did:",
    ]
    did = []
    if exchange.edited_files:
        shown = [relative_path(p, session.cwd) for p in exchange.edited_files[:EDITED_FILES_SHOWN]]
        extra = len(exchange.edited_files) - len(shown)
        did.append("edited: " + ", ".join(shown) + (f" (+{extra} more)" if extra > 0 else ""))
    if exchange.command_count:
        examples = "; ".join(trim(c, COMMAND_SHOWN_CHARS) for c in exchange.commands[:COMMANDS_SHOWN])
        did.append(f"{exchange.command_count} command(s): {examples}")
    for label in exchange.subagents:
        did.append(f"subagent: {label}")
    for label in exchange.denials:
        did.append(f"denied: {label}")
    if exchange.interrupted:
        did.append("owner interrupted")
    if exchange.compactions:
        did.append(f"context compacted x{exchange.compactions}")
    lines += [f"- {item}" for item in did] or ["- (no file edits, commands or subagents)"]

    if exchange.final_reply:
        lines += ["", f"Closing reply: {trim(exchange.final_reply, max_reply)}"]
    lines.append("")
    return lines


def render_session_markdown(session: Session, patterns: list[str], max_reply: int) -> str:
    lines = [
        f"## Session {session.agent}:{session.session_id}",
        "",
        f"- agent: {session.agent}",
        f"- title: {session.title or '(untitled)'}",
        f"- cwd: {session.cwd}",
        f"- time: {format_time(session.started)} to {format_time(session.ended)}",
        f"- owner turns: {session.owner_turn_count}",
        "",
    ]
    for exchange in session.exchanges:
        lines += render_exchange(exchange, session, max_reply)

    lines += ["### Drift candidates", ""]
    candidates = find_drift_candidates(session, patterns)
    if not candidates:
        lines.append("None flagged.")
    for exchange, reasons in candidates:
        lines.append(f"- turn {exchange.number}: " + "; ".join(reasons))
        following = next((e for e in session.exchanges if e.number == exchange.number + 1), None)
        if following and any("opens with a correction" in r for r in reasons):
            lines.append(f"  next owner turn begins: {trim(following.owner_text, CORRECTION_SNIPPET_CHARS)}")
    lines.append("")
    return "\n".join(lines)


def render_list(sessions: list[Session]) -> str:
    header = f"{'agent':<7} {'id':<{SHORT_ID_CHARS}} {'date':<16} {'turns':>5}  title"
    rows = [header]
    for session in sorted(sessions, key=lambda s: s.started, reverse=True):
        rows.append(
            f"{session.agent:<7} {session.session_id[:SHORT_ID_CHARS]:<{SHORT_ID_CHARS}} "
            f"{format_time(session.started):<16} {session.owner_turn_count:>5}  "
            f"{trim(session.title or '(untitled)', LIST_TITLE_CHARS)}"
        )
    return "\n".join(rows)


def render_json(sessions: list[Session], patterns: list[str]) -> str:
    payload = []
    for session in sessions:
        data = asdict(session)
        for exchange in data["exchanges"]:
            exchange.pop("is_duplicate", None)
        data["drift_candidates"] = [
            {"turn": e.number, "reasons": reasons} for e, reasons in find_drift_candidates(session, patterns)
        ]
        payload.append(data)
    return json.dumps(payload, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Context readout
# ---------------------------------------------------------------------------

HANDOFF_ADVICE = {
    "below target": "no handoff due",
    "past target": "handoff due at the next subtask boundary",
    "past hard limit": "handoff due now",
}


def print_context(args, config: Config, prefixes: list[str]) -> int:
    pairs = discover_sessions(config, prefixes, args.agent)
    if args.session:
        pairs = [(s, r) for s, r in pairs if r.session_id.startswith(args.session)]
    if not pairs:
        print("No sessions found for prefixes: " + ", ".join(prefixes), file=sys.stderr)
        return 1
    _, ref = pairs[0]
    reading = read_context(ref.path)
    if not reading:
        print(f"{ref.agent}:{ref.session_id} has no usage records yet.", file=sys.stderr)
        return 1
    soft, hard = config.context_soft_tokens, config.context_hard_tokens
    state = handoff_state(reading.tokens, soft, hard)
    print(f"session: {ref.agent}:{ref.session_id}")
    print(f"context: {reading.tokens} tokens ({format_tokens(reading.tokens)})"
          + (f" of a {format_tokens(reading.window)} window" if reading.window else ""))
    print(f"thresholds: target {format_tokens(soft)}, hard {format_tokens(hard)}")
    print(f"state: {state}; {HANDOFF_ADVICE[state]}")
    return 0


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  session_digest.py --list\n  session_digest.py --previous\n"
               "  session_digest.py --session 3f2a --agent claude --max-reply 800",
    )
    parser.add_argument("--project", type=Path, default=Path.cwd(), help="project directory (default: cwd)")
    parser.add_argument("--session", help="session id or id prefix")
    parser.add_argument("--agent", choices=AGENT_CHOICES, default="all", help="which agent's transcripts (default: all)")
    parser.add_argument("--list", action="store_true", help="table of recent sessions instead of a digest")
    parser.add_argument("--context", action="store_true",
                        help="print the newest (or --session) session's context size and handoff state")
    parser.add_argument("--last", type=int, metavar="N", help="digest the newest N sessions")
    parser.add_argument("--previous", action="store_true",
                        help="skip the newest session (the one you are in) and use the one before it")
    parser.add_argument("--since", type=parse_date, metavar="YYYY-MM-DD", help="only sessions modified on or after this date")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--max-reply", type=int, help="characters of each closing reply to show (default from config, 400)")
    parser.add_argument("--prefix", action="append", default=[], help="extra repo path prefix, repeatable")
    parser.add_argument("--config", type=Path, help="config.json path (default: next to this script)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = load_config(args.config)
    prefixes = effective_prefixes(config, args.project, args.prefix)
    max_reply = args.max_reply or config.max_reply_chars
    if args.context:
        return print_context(args, config, prefixes)

    sessions = select_sessions(args, config, prefixes)
    if not sessions:
        print("No sessions found for prefixes: " + ", ".join(prefixes), file=sys.stderr)
        return 1

    if args.list:
        print(render_list(sessions))
    elif args.format == "json":
        print(render_json(sessions, config.correction_patterns))
    else:
        print("\n".join(render_session_markdown(s, config.correction_patterns, max_reply) for s in sessions))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
