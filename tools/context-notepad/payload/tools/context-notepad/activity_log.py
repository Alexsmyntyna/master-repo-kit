#!/usr/bin/env python3
"""Append-only activity log: who launched what, and how the work was judged.

One JSONL file per project (config `activity_log`, default
context-notepad/activity.jsonl), written only through this module. Each line is
one event: session_start, small_task, subagent_launch, subagent_done, review,
handoff. An entry has a title and at most four bullets; `parent` links an entry
to the one that caused it, so a query renders a tree (a coordinator session, the
builders it launched, their reviews).

For `review` events, `model` is the model whose work was judged, and `verdict`
is accepted, fixed_by_reviewer or escalated (with `escalated_to` and `reason`).

Commands:
  add       append one entry (dry run unless --apply)
  query     entries from the last N hours, as a tree or JSON
  backfill  derive subagent_launch events from past Claude and Codex sessions
  models    per-model launches and review verdicts (experimental)

Why it exists: an agent can audit recent work from a compact digest, and the
owner can see whether a cheaper model is earning its cost. Appends are one line
per write under a small lock file, so hooks and agents can log at the same time.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from transcript_sources import (  # noqa: E402
    Config,
    build_sources,
    effective_prefixes,
    find_git_root,
    resolve_project_path,
    load_config,
    trim,
)

EVENTS = ("session_start", "small_task", "subagent_launch", "subagent_done", "review", "handoff")
VERDICTS = ("accepted", "fixed_by_reviewer", "escalated")
REVIEW_ONLY_FIELDS = ("verdict", "escalated_to", "reason")
MAX_BULLETS = 4
MAX_BULLET_CHARS = 200
FIELD_ORDER = ("at", "agent", "model", "event", "thread", "parent", "id", "title", "bullets",
               "verdict", "escalated_to", "reason", "session", "key")

ALWAYS_PRESENT_FIELDS = ("at", "agent", "model", "event", "thread", "parent", "id", "title", "bullets")

LOCK_SUFFIX = ".lock"
LOCK_RETRIES = 100
LOCK_RETRY_SECONDS = 0.05
LOCK_STALE_SECONDS = 10


# ---------------------------------------------------------------------------
# Paths and time
# ---------------------------------------------------------------------------

def activity_path(project: Path, config: Config) -> Path:
    return resolve_project_path(find_git_root(project), config.activity_log)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def local_iso(timestamp: str) -> str:
    """A transcript timestamp (usually UTC, Z suffix) as local ISO time with offset."""
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone().isoformat(timespec="seconds")
    except ValueError:
        return now_iso()


def parse_at(text: str) -> datetime:
    moment = datetime.fromisoformat(text)
    return moment if moment.tzinfo else moment.astimezone()


# ---------------------------------------------------------------------------
# Reading and appending
# ---------------------------------------------------------------------------

def read_entries(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    entries = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            entries.append(entry)
    return entries


def next_entry_id(entries: list[dict]) -> str:
    numbers = [int(e["id"][1:]) for e in entries if str(e.get("id", "")).startswith("e") and str(e["id"])[1:].isdigit()]
    return f"e{max(numbers, default=0) + 1}"


def validate(fields: dict) -> None:
    """Raise ValueError when an entry breaks the format. Nothing is truncated silently."""
    if fields.get("event") not in EVENTS:
        raise ValueError(f"event must be one of: {', '.join(EVENTS)}")
    if not str(fields.get("title") or "").strip():
        raise ValueError("title is required")
    if len(fields.get("bullets") or []) > MAX_BULLETS:
        raise ValueError(f"at most {MAX_BULLETS} bullets")
    if fields.get("verdict") and fields["verdict"] not in VERDICTS:
        raise ValueError(f"verdict must be one of: {', '.join(VERDICTS)}")
    if fields.get("event") != "review" and any(fields.get(name) for name in REVIEW_ONLY_FIELDS):
        raise ValueError("verdict, escalated_to and reason belong to review events only")


class LogLock:
    """A lock file created with O_EXCL; a lock older than a few seconds is treated as abandoned."""

    def __init__(self, log: Path):
        self.path = log.with_name(log.name + LOCK_SUFFIX)

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(LOCK_RETRIES):
            try:
                os.close(os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                return self
            except FileExistsError:
                self._remove_if_stale()
                time.sleep(LOCK_RETRY_SECONDS)
        raise TimeoutError(f"could not lock {self.path}")

    def _remove_if_stale(self) -> None:
        try:
            if time.time() - self.path.stat().st_mtime > LOCK_STALE_SECONDS:
                self.path.unlink()
        except FileNotFoundError:
            pass

    def __exit__(self, *exc_info):
        self.path.unlink(missing_ok=True)


def build_entry(fields: dict, entry_id: str) -> dict:
    entry = {"at": now_iso(), "agent": "", "model": None, "thread": None, "parent": None, **fields, "id": entry_id}
    entry["bullets"] = [trim(b, MAX_BULLET_CHARS) for b in fields.get("bullets") or []]
    ordered = {name: entry.get(name) for name in FIELD_ORDER if name in ALWAYS_PRESENT_FIELDS or entry.get(name) not in (None, "")}
    return ordered


def append_entry(path: Path, fields: dict) -> dict:
    """Validate, assign the next id under the lock, and append one line. Returns the entry."""
    validate(fields)
    with LogLock(path):
        entry = build_entry(fields, next_entry_id(read_entries(path)))
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def find_by_key(entries: list[dict], key: str) -> dict | None:
    return next((e for e in entries if e.get("key") == key), None)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def command_add(args, config: Config) -> int:
    path = activity_path(args.project, config)
    fields = {
        "agent": args.agent, "model": args.model, "event": args.event, "thread": args.thread,
        "parent": args.parent, "title": args.title, "bullets": args.bullet,
        "verdict": args.verdict, "escalated_to": args.escalated_to, "reason": args.reason,
    }
    if args.at:
        fields["at"] = args.at
    try:
        validate(fields)
        if not args.apply:
            preview = build_entry(fields, next_entry_id(read_entries(path)))
            print(f"Would append to {path}:\n{json.dumps(preview, ensure_ascii=False)}")
            return 0
        entry = append_entry(path, fields)
    except ValueError as error:
        print(f"Not logged: {error}", file=sys.stderr)
        return 1
    print(f"Logged {entry['id']} to {path}")
    return 0


def select_window(entries: list[dict], hours: float, thread: str | None, event: str | None) -> list[dict]:
    cutoff = datetime.now().astimezone() - timedelta(hours=hours)
    selected = []
    for entry in entries:
        if thread and entry.get("thread") != thread:
            continue
        if event and entry.get("event") != event:
            continue
        try:
            if parse_at(entry["at"]) >= cutoff:
                selected.append(entry)
        except (KeyError, ValueError):
            continue
    return selected


def describe(entry: dict) -> str:
    who = "/".join(part for part in (entry.get("agent"), entry.get("model")) if part)
    when = parse_at(entry["at"]).strftime("%Y-%m-%d %H:%M")
    thread = f" [{entry['thread']}]" if entry.get("thread") else ""
    verdict = f" -> {entry['verdict']}" if entry.get("verdict") else ""
    escalated = f" (to {entry['escalated_to']})" if entry.get("escalated_to") else ""
    return f"{entry['id']} {entry['event']} {when} {who}{thread}: {entry['title']}{verdict}{escalated}"


def render_tree(entries: list[dict]) -> str:
    """Markdown tree: children nested under their parent; entries whose parent is out of the window are roots."""
    present = {e["id"] for e in entries}
    children: dict[str, list[dict]] = defaultdict(list)
    roots = []
    for entry in entries:
        parent = entry.get("parent")
        (children[parent] if parent in present else roots).append(entry)

    lines: list[str] = []

    def walk(entry: dict, depth: int) -> None:
        indent = "  " * depth
        lines.append(f"{indent}- {describe(entry)}")
        if entry.get("reason"):
            lines.append(f"{indent}  reason: {entry['reason']}")
        lines.extend(f"{indent}  - {bullet}" for bullet in entry.get("bullets") or [])
        for child in children[entry["id"]]:
            walk(child, depth + 1)

    for root in roots:
        walk(root, 0)
    return "\n".join(lines) if lines else "(no entries in this window)"


def command_query(args, config: Config) -> int:
    entries = select_window(read_entries(activity_path(args.project, config)), args.hours, args.thread, args.event)
    if args.format == "json":
        print(json.dumps(entries, indent=2, ensure_ascii=False))
    else:
        print(render_tree(entries))
    return 0


def plan_backfill(config: Config, project: Path, since: str, existing: list[dict]) -> list[dict]:
    """Entries to add, in time order. A session_start precedes a session's launches.

    A planned launch carries `_parent_key` (the session key) instead of a parent id,
    which is resolved to a real id when appended.
    """
    cutoff = datetime.strptime(since, "%Y-%m-%d").astimezone()
    prefixes = effective_prefixes(config, project, [])
    known_keys = {e["key"] for e in existing if e.get("key")}
    planned = []
    for source in build_sources(config, "all"):
        for ref in source.discover(prefixes):
            if datetime.fromtimestamp(ref.modified).astimezone() < cutoff:
                continue
            launches = [launch for launch in source.launches(ref)
                        if launch.key not in known_keys and parse_at(local_iso(launch.timestamp)) >= cutoff]
            if not launches:
                continue
            session_key = f"session:{ref.agent}:{ref.session_id}"
            session = source.load(ref)
            if session_key not in known_keys:
                planned.append({
                    "at": local_iso(session.started), "agent": ref.agent, "event": "session_start",
                    "title": trim(session.title or f"Session {ref.session_id[:8]}", 120),
                    "bullets": [], "session": f"{ref.agent}:{ref.session_id}", "key": session_key,
                })
            for launch in launches:
                planned.append({
                    "at": local_iso(launch.timestamp), "agent": ref.agent, "model": launch.model or None,
                    "event": "subagent_launch", "title": launch.title,
                    "bullets": [launch.detail] if launch.detail else [],
                    "session": f"{ref.agent}:{ref.session_id}", "key": launch.key, "_parent_key": session_key,
                })
    return sorted(planned, key=lambda entry: (entry["at"], entry["event"] != "session_start"))


def command_backfill(args, config: Config) -> int:
    path = activity_path(args.project, config)
    existing = read_entries(path)
    planned = plan_backfill(config, args.project, args.since, existing)
    if not planned:
        print("Nothing to backfill: no new subagent launches since that date.")
        return 0
    for entry in planned:
        who = "/".join(part for part in (entry["agent"], entry.get("model")) if part)
        print(f"{'add' if args.apply else 'would add'}  {entry['event']:<16} {entry['at'][:16]}  {who}  {entry['title']}")
    if not args.apply:
        print(f"\n{len(planned)} entr{'y' if len(planned) == 1 else 'ies'}. Re-run with --apply to append to {path}.")
        return 0
    ids_by_key = {e["key"]: e["id"] for e in existing if e.get("key")}
    for entry in planned:
        parent_key = entry.pop("_parent_key", None)
        if parent_key:
            entry["parent"] = ids_by_key.get(parent_key)
        logged = append_entry(path, entry)
        ids_by_key[logged["key"]] = logged["id"]
    print(f"\nAppended {len(planned)} entries to {path}.")
    return 0


def command_models(args, config: Config) -> int:
    entries = select_window(read_entries(activity_path(args.project, config)), args.days * 24, None, None)
    launches: Counter = Counter()
    verdicts: dict[str, Counter] = defaultdict(Counter)
    for entry in entries:
        model = entry.get("model") or "(unknown)"
        if entry.get("event") == "subagent_launch":
            launches[model] += 1
        elif entry.get("event") == "review" and entry.get("verdict"):
            verdicts[model][entry["verdict"]] += 1
    print(f"Per-model record, last {args.days} day(s). EXPERIMENTAL: only as complete as the review events logged.\n")
    print(f"{'model':<24} {'launches':>8} {'accepted':>9} {'fixed_by_reviewer':>18} {'escalated':>10}")
    for model in sorted(set(launches) | set(verdicts)):
        counts = verdicts[model]
        print(f"{model:<24} {launches[model]:>8} {counts['accepted']:>9} {counts['fixed_by_reviewer']:>18} {counts['escalated']:>10}")
    return 0


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--project", type=Path, default=Path.cwd(), help="project directory (default: cwd)")
    common.add_argument("--config", type=Path, help="config.json path (default: next to this script)")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", parents=[common], help="append one entry (dry run unless --apply)")
    add.add_argument("--event", required=True, choices=EVENTS)
    add.add_argument("--title", required=True)
    add.add_argument("--agent", default="claude", help="claude or codex (default: claude)")
    add.add_argument("--model")
    add.add_argument("--thread")
    add.add_argument("--parent", help="id of the entry that caused this one, e.g. e17")
    add.add_argument("--bullet", action="append", default=[], help=f"up to {MAX_BULLETS}, repeatable")
    add.add_argument("--verdict", choices=VERDICTS, help="review events only")
    add.add_argument("--escalated-to", dest="escalated_to", help="review events only: the model tried next")
    add.add_argument("--reason", help="review events only: why the work was fixed or escalated")
    add.add_argument("--at", help="ISO time with offset (default: now)")
    add.add_argument("--apply", action="store_true")
    add.set_defaults(handler=command_add)

    query = commands.add_parser("query", parents=[common], help="entries from the last N hours")
    query.add_argument("--hours", type=float, required=True)
    query.add_argument("--thread")
    query.add_argument("--event", choices=EVENTS)
    query.add_argument("--format", choices=("markdown", "json"), default="markdown")
    query.set_defaults(handler=command_query)

    backfill = commands.add_parser("backfill", parents=[common],
                                   help="derive subagent_launch events from past sessions (dry run unless --apply)")
    backfill.add_argument("--since", required=True, metavar="YYYY-MM-DD")
    backfill.add_argument("--apply", action="store_true")
    backfill.set_defaults(handler=command_backfill)

    models = commands.add_parser("models", parents=[common], help="per-model launches and review verdicts (experimental)")
    models.add_argument("--days", type=float, default=30)
    models.set_defaults(handler=command_models)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.handler(args, load_config(args.config))


if __name__ == "__main__":
    raise SystemExit(main())
