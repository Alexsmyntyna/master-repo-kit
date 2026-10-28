"""Hand-written synthetic transcript builders. No real transcript content."""
import json
from pathlib import Path

import _paths  # noqa: F401
from transcript_sources import Config

PROJECT = "/work/demo"


def write_jsonl(path: Path, records: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
    return path


def make_config(root: Path) -> Config:
    return Config(
        claude_projects_dir=str(root / "claude"),
        codex_session_dirs=[str(root / "codex")],
        codex_session_index=str(root / "missing-index.jsonl"),
    )


# --- Claude Code shapes -----------------------------------------------------

def claude_user(text, ts, **extra):
    record = {"type": "user", "cwd": PROJECT, "timestamp": ts, "isSidechain": False,
              "userType": "external", "promptId": "p", "promptSource": "typed",
              "message": {"role": "user", "content": text}}
    record.update(extra)
    return record


def claude_assistant(blocks, ts):
    return {"type": "assistant", "cwd": PROJECT, "timestamp": ts, "isSidechain": False,
            "message": {"role": "assistant", "content": blocks}}


def tool_use(name, tool_input, tool_id="t1"):
    return {"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}


def text_block(text):
    return {"type": "text", "text": text}


def claude_tool_result(tool_id, text, ts, is_error=False, **extra):
    record = {"type": "user", "cwd": PROJECT, "timestamp": ts, "isSidechain": False,
              "toolUseResult": text,
              "message": {"role": "user", "content": [
                  {"type": "tool_result", "tool_use_id": tool_id, "content": text, "is_error": is_error}]}}
    record.update(extra)
    return record


# --- Codex shapes -----------------------------------------------------------

def codex_meta(session_id, ts, cwd=PROJECT, **extra):
    payload = {"id": session_id, "timestamp": ts, "cwd": cwd, "source": "cli", "thread_source": "user"}
    payload.update(extra)
    return {"type": "session_meta", "timestamp": ts, "payload": payload}


def codex_message(role, blocks, ts, phase=None):
    kind = "input_text" if role in ("user", "developer") else "output_text"
    payload = {"type": "message", "role": role, "content": [{"type": kind, "text": t} for t in blocks]}
    if phase:
        payload["phase"] = phase
    return {"type": "response_item", "timestamp": ts, "payload": payload}


def codex_custom_call(name, text, ts, call_id="c1"):
    return {"type": "response_item", "timestamp": ts,
            "payload": {"type": "custom_tool_call", "name": name, "input": text, "call_id": call_id}}


def codex_function_call(name, arguments, ts, call_id="c1"):
    return {"type": "response_item", "timestamp": ts,
            "payload": {"type": "function_call", "name": name, "arguments": json.dumps(arguments), "call_id": call_id}}


def codex_output(text, ts, call_id="c1"):
    return {"type": "response_item", "timestamp": ts,
            "payload": {"type": "custom_tool_call_output", "call_id": call_id, "output": text}}
