#!/usr/bin/env python3
"""Hook: append subagent_launch / subagent_done events to the activity log.

Reads the hook JSON on stdin and logs through activity_log.py.
  Claude Code: SubagentStart and SubagentStop (agent_id, agent_type; the stop
               event also carries agent_transcript_path and last_assistant_message).
  Codex:       PreToolUse with tool_name spawn_agent (tool_input has task_name,
               model, message), or SubagentStart / SubagentStop.

Why it never fails: a logging hook must not break the agent. It always exits 0,
prints nothing, and writes any error to hook-errors.log next to the activity log
(or beside this script when the project cannot be resolved).
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import activity_log  # noqa: E402
from transcript_sources import find_git_root, first_line, load_config, trim  # noqa: E402

ERROR_LOG_NAME = "hook-errors.log"
SPAWN_TOOL_NAMES = ("spawn_agent",)
DETAIL_CHARS = 160


def agent_name(payload: dict, declared: str | None) -> str:
    if declared:
        return declared
    return "codex" if ".codex" in str(payload.get("transcript_path", "")) else "claude"


def project_dir(payload: dict) -> Path:
    return find_git_root(Path(payload.get("cwd") or "."))


def session_entry(entries: list[dict], agent: str, session_id: str) -> dict | None:
    wanted = f"{agent}:{session_id}"
    return next((e for e in reversed(entries) if e.get("event") == "session_start" and e.get("session") == wanted), None)


def ensure_session_start(path: Path, agent: str, session_id: str) -> str:
    """Id of this session's session_start entry, created when the log has none."""
    found = session_entry(activity_log.read_entries(path), agent, session_id)
    if found:
        return found["id"]
    entry = activity_log.append_entry(path, {
        "agent": agent, "event": "session_start", "title": f"Session {session_id[:8]}",
        "bullets": [], "session": f"{agent}:{session_id}", "key": f"session:{agent}:{session_id}",
    })
    return entry["id"]


def model_from_agent_transcript(path_text: str) -> str | None:
    path = Path(path_text).expanduser() if path_text else None
    if not path or not path.is_file():
        return None
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                model = (json.loads(line).get("message") or {}).get("model")
            except (json.JSONDecodeError, AttributeError):
                continue
            if model and not str(model).startswith("<"):
                return str(model)
    return None


def launch_fields(payload: dict, agent: str) -> dict | None:
    """Fields for a launch event, or None when the payload is not a launch."""
    event = payload.get("hook_event_name")
    if event == "PreToolUse" and payload.get("tool_name") in SPAWN_TOOL_NAMES:
        tool_input = payload.get("tool_input") or {}
        return {
            "title": trim(str(tool_input.get("task_name") or "subagent"), 120),
            "model": tool_input.get("model") or None,
            "bullets": [trim(first_line(str(tool_input.get("message") or "")), DETAIL_CHARS)] if tool_input.get("message") else [],
            "key": f"{agent}:{payload.get('session_id')}:{payload.get('tool_use_id')}",
        }
    if event == "SubagentStart":
        return {
            "title": trim(str(payload.get("agent_type") or "subagent"), 120),
            "model": payload.get("model") or None,
            "bullets": [],
            "key": f"{agent}:{payload.get('session_id')}:agent:{payload.get('agent_id')}",
            "agent_id": payload.get("agent_id"),
        }
    return None


def handle(payload: dict, declared_agent: str | None) -> None:
    event = payload.get("hook_event_name")
    agent = agent_name(payload, declared_agent)
    session_id = str(payload.get("session_id") or "unknown")
    config = load_config()
    path = activity_log.activity_path(project_dir(payload), config)

    if event in ("SubagentStop",):
        launch_key = f"{agent}:{session_id}:agent:{payload.get('agent_id')}"
        launch = activity_log.find_by_key(activity_log.read_entries(path), launch_key)
        model = (launch or {}).get("model") or payload.get("model") or model_from_agent_transcript(payload.get("agent_transcript_path", ""))
        last = str(payload.get("last_assistant_message") or "")
        activity_log.append_entry(path, {
            "agent": agent, "model": model, "event": "subagent_done",
            "thread": (launch or {}).get("thread"), "parent": (launch or {}).get("id"),
            "title": (launch or {}).get("title") or trim(str(payload.get("agent_type") or "subagent"), 120),
            "bullets": [trim(first_line(last), DETAIL_CHARS)] if last.strip() else [],
            "session": f"{agent}:{session_id}",
        })
        return

    fields = launch_fields(payload, agent)
    if not fields:
        return
    fields.pop("agent_id", None)
    activity_log.append_entry(path, {
        **fields, "agent": agent, "event": "subagent_launch",
        "parent": ensure_session_start(path, agent, session_id), "session": f"{agent}:{session_id}",
    })


def record_error(payload: dict) -> None:
    try:
        target = activity_log.activity_path(project_dir(payload), load_config()).with_name(ERROR_LOG_NAME)
    except Exception:  # noqa: BLE001 - last resort, must not raise
        target = Path(__file__).resolve().parent / ERROR_LOG_NAME
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(f"{datetime.now().isoformat(timespec='seconds')}\n{traceback.format_exc()}\n")
    except OSError:
        pass


def main() -> int:
    payload: dict = {}
    try:
        parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
        parser.add_argument("--agent", choices=("claude", "codex"), help="which agent runs the hook (default: guessed from the transcript path)")
        args, _ = parser.parse_known_args()
        payload = json.loads(sys.stdin.read() or "{}")
        handle(payload if isinstance(payload, dict) else {}, args.agent)
    except SystemExit:
        pass  # --help or a bad flag: still exit 0 below
    except Exception:  # noqa: BLE001 - a logging hook must never fail the agent
        record_error(payload if isinstance(payload, dict) else {})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
