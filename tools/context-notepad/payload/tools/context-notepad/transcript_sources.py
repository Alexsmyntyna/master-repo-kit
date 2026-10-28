#!/usr/bin/env python3
"""Read Claude Code and Codex transcripts into one common model.

Both agents record every session as JSONL, in different shapes. This module
hides that: each adapter turns a transcript into a Session made of Exchanges,
where an Exchange is one owner turn (verbatim) plus what the agent did before
the next owner turn (files edited, shell commands, subagents, denied tool
calls, interrupts, the closing reply, compactions).

Why it exists: the digest, the notepad and the skill must not care which agent
produced a piece of history. Everything agent-specific lives here.

Read-only. Nothing in this module writes to a transcript or to disk.

Scoping: a session belongs to a project when its recorded cwd starts with one
of the configured prefixes. Plain string prefix matching is deliberate: it
covers subdirectories, per-agent worktrees (project/.claude/worktrees/...) and
sibling worktree directories named project-something. Scoping uses the cwd
recorded inside each transcript, never the transcript folder name, so a
renamed or moved project is still found by adding its old path as a prefix.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

# ---------------------------------------------------------------------------
# Constants: every agent-specific fact lives here, not in the logic below.
# ---------------------------------------------------------------------------

CONFIG_FILE_NAME = "config.json"

DEFAULT_CLAUDE_PROJECTS_DIR = "~/.claude/projects"
DEFAULT_CODEX_SESSION_DIRS = ("~/.codex/sessions", "~/.codex/archived_sessions")
DEFAULT_NOTEPAD_DIR = "context-notepad/threads"
DEFAULT_MAX_REPLY_CHARS = 400
DEFAULT_ACTIVITY_LOG = "context-notepad/activity.jsonl"
DEFAULT_CONTEXT_SOFT_TOKENS = 150_000
DEFAULT_CONTEXT_HARD_TOKENS = 200_000
# Placeholder model ids for Codex: the owner fills these in config.json.
DEFAULT_ROLES = {
    "claude": {"coordinator": "opus", "builder": "sonnet", "small_builder": "haiku", "scout": "haiku"},
    "codex": {"coordinator": "CODEX_COORDINATOR_MODEL", "builder": "CODEX_BUILDER_MODEL", "scout": "CODEX_SCOUT_MODEL"},
}
DEFAULT_ESCALATION = ("haiku", "sonnet", "opus")

# An owner turn that opens with one of these is probably correcting the agent.
# Anchored at the start of the turn; matched case-insensitively.
DEFAULT_CORRECTION_PATTERNS = (
    r"no\b",
    r"nope\b",
    r"not what\b",
    r"i meant\b",
    r"actually\b",
    r"that'?s wrong\b",
    r"stop\b",
    r"wait\b",
    r"instead\b",
    r"why did you\b",
)

MAX_COMMANDS_KEPT = 5
MAX_COMMAND_CHARS = 160
MAX_DENIAL_LABEL_CHARS = 120
MAX_SUBAGENT_LABEL_CHARS = 120
DEDUPE_KEY_CHARS = 300

# Claude Code ------------------------------------------------------------

CLAUDE_FILE_TOOLS = {
    "Edit": "file_path",
    "Write": "file_path",
    "MultiEdit": "file_path",
    "NotebookEdit": "notebook_path",
}
CLAUDE_SHELL_TOOLS = {"Bash"}
CLAUDE_SUBAGENT_TOOLS = {"Agent", "Task"}

# The "user" role also carries machine-authored turns. promptSource and
# turnOrigin say who really wrote the turn.
CLAUDE_NON_OWNER_PROMPT_SOURCES = {"system", "sdk"}
CLAUDE_NON_OWNER_TURN_ORIGINS = {
    "system", "sdk", "task_notification", "scheduled", "peer", "auto_continuation",
}

# CLI-injected wrappers that arrive in the user role but are not typed prose.
CLAUDE_NOISE_TAGS = re.compile(
    r"<(local-command-stdout|local-command-caveat|command-message|"
    r"system-reminder|user-prompt-submit-hook|command-contents|task-notification)>.*?</\1>",
    re.S,
)
CLAUDE_COMMAND_NAME = re.compile(r"<command-name>(.*?)</command-name>", re.S)
CLAUDE_COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)

# A slash command is CLI machinery. A bare "/clear" is dropped; a command
# followed by a real prompt keeps the prompt. The token must end at whitespace
# or end of text, so a pasted path such as "/workspace/me/file" is not a command.
SLASH_COMMAND = re.compile(r"^/([A-Za-z0-9:_-]+)(?:[ \t]+(.*))?$", re.S)
SLASH_COMMAND_MIN_PROMPT_CHARS = 20

INTERRUPT_PREFIX = "[Request interrupted"
COMPACT_SUMMARY_PREFIX = "This session is being continued from a previous conversation"
# Whole turns that are machinery. Projects add their own through the config
# key "extra_drop_prefixes" (for example prompts a skill composes for the owner).
CLAUDE_DROP_PREFIXES = ("API Error", "Caveat: The messages below")
ATTACHMENT_ONLY = re.compile(r"^(\[(Image|Pasted text|Attachment)[^\]]*\]\s*)+$")

CLAUDE_DENIAL_TEXT_PREFIX = "The user doesn't want to proceed"
CLAUDE_DENIAL_KIND_FIELD = "toolDenialKind"
CLAUDE_DENIED_DECISIONS = {"deny", "denied", "reject", "rejected"}

# Codex ------------------------------------------------------------------

# User-role content the harness injects ahead of or between owner messages.
CODEX_INJECTED_BLOCK_PREFIXES = (
    "# AGENTS.md instructions",
    "<environment_context",
    "<recommended_plugins",
    "<subagent_notification",
    "<codex_internal_context",
    "<user_instructions",
    "<permissions",
    "<skills_instructions",
    "<skill>",
    "<collaboration_mode",
    "<image",
    "</image",
)
# Whole turns an orchestrating agent submits as a brief to a worker session.
CODEX_MACHINE_TURN_PREFIXES = ("<task>",)
CODEX_ABORT_MARKER = "<turn_aborted"
CODEX_PATCH_FILE_LINE = re.compile(r"\*\*\* (?:Update|Add|Delete) File: ([^\n\\\"]+)")
CODEX_PATCH_MOVE_LINE = re.compile(r"\*\*\* Move to: ([^\n\\\"]+)")
# Commands appear as {"cmd": "..."} / {"command": "..."} JSON, or as a JS
# object literal ({cmd: "..."}) inside the exec wrapper.
CODEX_COMMAND_LITERAL = re.compile(r'\b(?:cmd|command)"?\s*:\s*("(?:[^"\\]|\\.)*")')
CODEX_SPAWN_MESSAGE_LITERAL = re.compile(
    r'spawn_agent\(\s*\{.*?\bmessage"?\s*:\s*("(?:[^"\\]|\\.)*")', re.S
)
CODEX_SHELL_CALL_NAMES = {"shell", "shell_command", "exec_command", "local_shell"}
CODEX_DENIAL_OUTPUT = re.compile(r"Rejected\(|Sandbox\(Denied|rejected by (?:the )?user|user declined", re.I)
DEFAULT_CODEX_SESSION_INDEX = "~/.codex/session_index.jsonl"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class Config:
    repo_prefixes: list[str] = field(default_factory=list)
    notepad_dir: str = DEFAULT_NOTEPAD_DIR
    claude_projects_dir: str = DEFAULT_CLAUDE_PROJECTS_DIR
    codex_session_dirs: list[str] = field(default_factory=lambda: list(DEFAULT_CODEX_SESSION_DIRS))
    extra_drop_prefixes: list[str] = field(default_factory=list)
    correction_patterns: list[str] = field(default_factory=lambda: list(DEFAULT_CORRECTION_PATTERNS))
    max_reply_chars: int = DEFAULT_MAX_REPLY_CHARS
    codex_session_index: str = DEFAULT_CODEX_SESSION_INDEX
    include_codex_exec_sessions: bool = False
    # Empty means each thread's own mockups/ folder. Otherwise a repo-relative
    # folder (or an absolute/~ path); "{thread}" is replaced by the thread name.
    mockup_dir: str = ""
    activity_log: str = DEFAULT_ACTIVITY_LOG
    context_soft_tokens: int = DEFAULT_CONTEXT_SOFT_TOKENS
    context_hard_tokens: int = DEFAULT_CONTEXT_HARD_TOKENS
    roles: dict = field(default_factory=lambda: json.loads(json.dumps(DEFAULT_ROLES)))
    escalation: list[str] = field(default_factory=lambda: list(DEFAULT_ESCALATION))


def default_config_path() -> Path:
    return Path(__file__).resolve().parent / CONFIG_FILE_NAME


def load_config(path: Path | None = None) -> Config:
    """Load config.json next to the scripts. A missing file means defaults."""
    config_path = path or default_config_path()
    config = Config()
    if not config_path.is_file():
        return config
    data = json.loads(config_path.read_text(encoding="utf-8"))
    for key, value in data.items():
        if key.startswith("_") or not hasattr(config, key):
            continue
        setattr(config, key, value)
    return config


def resolve_project_path(project_root: Path, configured: str) -> Path:
    """A configured path: absolute or ~ paths stand alone, others are relative to the project root."""
    path = Path(configured).expanduser()
    return path if path.is_absolute() else project_root / path


def find_git_root(start: Path) -> Path:
    """Nearest ancestor holding a .git entry (directory or worktree file)."""
    start = start.resolve()
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    return start


def effective_prefixes(config: Config, project: Path, extra: list[str]) -> list[str]:
    """Configured prefixes, the project's git root, and any command-line extras."""
    prefixes = [*config.repo_prefixes, str(find_git_root(project)), *extra]
    return list(dict.fromkeys(str(Path(p).expanduser()) for p in prefixes))


def cwd_in_scope(cwd: str, prefixes: list[str]) -> bool:
    """True for the prefix itself or a path below it; a sibling like `reader-app2` is out."""
    if not cwd:
        return False
    return any(cwd == prefix or cwd.startswith(prefix.rstrip("/") + "/") for prefix in prefixes)


# ---------------------------------------------------------------------------
# Common model
# ---------------------------------------------------------------------------

@dataclass
class Exchange:
    """One owner turn and the agent activity up to the next owner turn."""

    number: int = 0
    owner_text: str = ""
    owner_timestamp: str = ""
    edited_files: list[str] = field(default_factory=list)
    command_count: int = 0
    commands: list[str] = field(default_factory=list)
    subagents: list[str] = field(default_factory=list)
    denials: list[str] = field(default_factory=list)
    interrupted: bool = False
    final_reply: str = ""
    compactions: int = 0
    is_duplicate: bool = False
    # Sent while the agent was still working; Claude Code delivers it mid-turn.
    sent_mid_turn: bool = False


@dataclass
class Session:
    agent: str
    session_id: str
    title: str
    cwd: str
    started: str
    ended: str
    path: str
    exchanges: list[Exchange] = field(default_factory=list)

    @property
    def owner_turn_count(self) -> int:
        return len(self.exchanges)


@dataclass
class SubagentLaunch:
    """A subagent spawn found in a transcript, with a key that never changes."""

    key: str
    timestamp: str
    title: str
    model: str
    detail: str


@dataclass
class SessionRef:
    """A discovered transcript, cheap to produce, loaded on demand."""

    agent: str
    session_id: str
    path: Path
    cwd: str
    modified: float


def normalize_whitespace(text: str) -> str:
    return " ".join(text.split())


def trim(text: str, limit: int) -> str:
    text = normalize_whitespace(text)
    return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."


def exchange_key(exchange: Exchange) -> tuple[str, str]:
    """Identity of a replayed turn: opening text plus its original timestamp."""
    return (normalize_whitespace(exchange.owner_text)[:DEDUPE_KEY_CHARS].lower(), exchange.owner_timestamp)


class ExchangeBuilder:
    """Accumulates exchanges while a transcript is read top to bottom."""

    def __init__(self) -> None:
        self.exchanges: list[Exchange] = []
        self._seen_keys: set[tuple[str, str]] = set()
        self._current: Exchange | None = None

    @property
    def current(self) -> Exchange | None:
        return self._current

    def start(self, owner_text: str, timestamp: str) -> Exchange:
        exchange = Exchange(owner_text=owner_text, owner_timestamp=timestamp)
        key = exchange_key(exchange)
        # Resumed sessions replay earlier turns with their original timestamps.
        # The replayed turn and the activity after it are collected, then dropped.
        exchange.is_duplicate = key in self._seen_keys
        self._seen_keys.add(key)
        self.exchanges.append(exchange)
        self._current = exchange
        return exchange

    def note_edit(self, path: str) -> None:
        if self._current and path and path not in self._current.edited_files:
            self._current.edited_files.append(path)

    def note_command(self, command: str) -> None:
        if not self._current:
            return
        self._current.command_count += 1
        if len(self._current.commands) < MAX_COMMANDS_KEPT:
            self._current.commands.append(trim(command, MAX_COMMAND_CHARS))

    def note_subagent(self, label: str) -> None:
        if self._current and label:
            self._current.subagents.append(trim(label, MAX_SUBAGENT_LABEL_CHARS))

    def note_denial(self, label: str) -> None:
        if self._current:
            self._current.denials.append(trim(label, MAX_DENIAL_LABEL_CHARS))

    def note_interrupt(self) -> None:
        if self._current:
            self._current.interrupted = True

    def note_compaction(self) -> None:
        if self._current:
            self._current.compactions += 1

    def note_reply(self, text: str) -> None:
        if self._current and text.strip():
            self._current.final_reply = text.strip()

    def finish(self) -> list[Exchange]:
        kept = [e for e in self.exchanges if not e.is_duplicate]
        for number, exchange in enumerate(kept, start=1):
            exchange.number = number
        return kept


def drop_replayed_exchanges(sessions: list[Session]) -> None:
    """Remove exchanges an earlier session already holds (resume replays).

    Sessions are processed oldest first, so the original keeps its turn and the
    resumed copy loses it. Turn numbers are reassigned afterwards.
    """
    seen: set[tuple[str, str]] = set()
    for session in sorted(sessions, key=lambda s: s.started):
        kept = []
        for exchange in session.exchanges:
            key = exchange_key(exchange)
            if key not in seen:
                kept.append(exchange)
            seen.add(key)
        for number, exchange in enumerate(kept, start=1):
            exchange.number = number
        session.exchanges = kept


def read_jsonl(path: Path) -> Iterator[dict]:
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                yield record


def first_line(text: str, limit: int = 80) -> str:
    for line in text.splitlines():
        if line.strip():
            return trim(line, limit)
    return ""


# ---------------------------------------------------------------------------
# Claude Code
# ---------------------------------------------------------------------------

OWNER = "owner"
INTERRUPT = "interrupt"
COMPACTION = "compaction"
IGNORE = "ignore"


def classify_claude_user_text(raw: str, extra_drop_prefixes: tuple[str, ...] = ()) -> tuple[str, str]:
    """Decide what a user-role text is: an owner turn, a flag, or machinery."""
    text = CLAUDE_NOISE_TAGS.sub("", raw)
    text = CLAUDE_COMMAND_NAME.sub(r"\1", text)
    text = CLAUDE_COMMAND_ARGS.sub(r" \1", text).strip()

    match = SLASH_COMMAND.match(text)
    if match:
        prompt = (match.group(2) or "").strip()
        text = prompt if len(prompt) >= SLASH_COMMAND_MIN_PROMPT_CHARS else ""

    if not text:
        return IGNORE, ""
    if text.startswith(INTERRUPT_PREFIX):
        return INTERRUPT, ""
    if text.startswith(COMPACT_SUMMARY_PREFIX):
        return COMPACTION, ""
    if text.startswith((*CLAUDE_DROP_PREFIXES, *extra_drop_prefixes)):
        return IGNORE, ""
    if ATTACHMENT_ONLY.match(text):
        return IGNORE, ""
    return OWNER, text


def claude_text_blocks(content) -> list[str]:
    if isinstance(content, str):
        return [content]
    if isinstance(content, list):
        return [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
    return []


def claude_tool_result_blocks(content) -> list[dict]:
    if not isinstance(content, list):
        return []
    return [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]


def claude_block_text(block: dict) -> str:
    inner = block.get("content")
    if isinstance(inner, str):
        return inner
    if isinstance(inner, list):
        return " ".join(x.get("text", "") for x in inner if isinstance(x, dict))
    return ""


def describe_claude_tool_use(block: dict) -> str:
    """Short label for a tool call, used when naming a denied call."""
    name = block.get("name", "tool")
    tool_input = block.get("input") or {}
    detail = (
        tool_input.get("file_path")
        or tool_input.get("notebook_path")
        or tool_input.get("command")
        or tool_input.get("description")
        or ""
    )
    return f"{name} {normalize_whitespace(str(detail))}".strip()


class ClaudeCodeSource:
    agent = "claude"

    def __init__(self, config: Config):
        self.root = Path(config.claude_projects_dir).expanduser()
        self.extra_drop_prefixes = tuple(config.extra_drop_prefixes)

    def discover(self, prefixes: list[str]) -> list[SessionRef]:
        # Session files sit one level below the project folder. Subagent
        # transcripts live deeper (<session>/subagents/) and are skipped by this glob.
        refs = []
        for path in self.root.glob("*/*.jsonl"):
            cwd = self._first_cwd(path)
            if cwd_in_scope(cwd, prefixes):
                refs.append(SessionRef(self.agent, path.stem, path, cwd, path.stat().st_mtime))
        return refs

    @staticmethod
    def _first_cwd(path: Path) -> str:
        for record in read_jsonl(path):
            if record.get("isSidechain"):
                continue
            if record.get("cwd"):
                return record["cwd"]
        return ""

    def load(self, ref: SessionRef) -> Session:
        builder = ExchangeBuilder()
        title = ""
        timestamps: list[str] = []
        tool_labels: dict[str, str] = {}

        for record in read_jsonl(ref.path):
            record_type = record.get("type")
            if record_type == "ai-title":
                title = record.get("aiTitle") or title
                continue
            if record.get("isSidechain"):
                continue
            if record.get("timestamp") and record_type in ("user", "assistant", "system"):
                timestamps.append(record["timestamp"])

            if record_type == "system" and record.get("subtype") == "compact_boundary":
                builder.note_compaction()
            elif record_type == "assistant":
                self._read_assistant(record, builder, tool_labels)
            elif record_type == "user":
                self._read_user(record, builder, tool_labels)
            elif record_type == "attachment":
                self._read_queued_owner_message(record, builder)

        exchanges = builder.finish()
        if not title and exchanges:
            title = first_line(exchanges[0].owner_text)
        return Session(
            agent=self.agent,
            session_id=ref.session_id,
            title=title,
            cwd=ref.cwd,
            started=min(timestamps, default=""),
            ended=max(timestamps, default=""),
            path=str(ref.path),
            exchanges=exchanges,
        )

    def launches(self, ref: SessionRef) -> list[SubagentLaunch]:
        found = []
        for record in read_jsonl(ref.path):
            if record.get("type") != "assistant" or record.get("isSidechain"):
                continue
            content = record.get("message", {}).get("content")
            for block in content if isinstance(content, list) else []:
                if not (isinstance(block, dict) and block.get("type") == "tool_use"
                        and block.get("name") in CLAUDE_SUBAGENT_TOOLS):
                    continue
                tool_input = block.get("input") or {}
                found.append(SubagentLaunch(
                    key=f"{self.agent}:{ref.session_id}:{block.get('id', len(found))}",
                    timestamp=record.get("timestamp", ""),
                    title=trim(tool_input.get("description") or tool_input.get("subagent_type") or "subagent",
                               MAX_SUBAGENT_LABEL_CHARS),
                    model=tool_input.get("model") or tool_input.get("subagent_type") or "",
                    detail=first_line(str(tool_input.get("prompt") or "")),
                ))
        return found

    def _read_assistant(self, record: dict, builder: ExchangeBuilder, tool_labels: dict[str, str]) -> None:
        content = record.get("message", {}).get("content")
        if not isinstance(content, list):
            return
        reply_parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                reply_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                self._read_tool_use(block, builder, tool_labels)
        builder.note_reply("\n".join(reply_parts))

    @staticmethod
    def _read_tool_use(block: dict, builder: ExchangeBuilder, tool_labels: dict[str, str]) -> None:
        name = block.get("name", "")
        tool_input = block.get("input") or {}
        if block.get("id"):
            tool_labels[block["id"]] = describe_claude_tool_use(block)
        if name in CLAUDE_FILE_TOOLS:
            builder.note_edit(tool_input.get(CLAUDE_FILE_TOOLS[name], ""))
        elif name in CLAUDE_SHELL_TOOLS:
            builder.note_command(tool_input.get("command", ""))
        elif name in CLAUDE_SUBAGENT_TOOLS:
            builder.note_subagent(tool_input.get("description") or tool_input.get("subagent_type", ""))

    def _read_user(self, record: dict, builder: ExchangeBuilder, tool_labels: dict[str, str]) -> None:
        content = record.get("message", {}).get("content")

        results = claude_tool_result_blocks(content)
        if results or "toolUseResult" in record:
            self._read_tool_results(record, results, builder, tool_labels)
            return

        if record.get("isMeta"):
            return
        if record.get("isCompactSummary"):
            self._note_summary_compaction(builder)
            return
        if record.get("promptSource") in CLAUDE_NON_OWNER_PROMPT_SOURCES:
            return
        if record.get("turnOrigin") in CLAUDE_NON_OWNER_TURN_ORIGINS:
            return
        if record.get("userType") not in (None, "external"):
            return

        raw = "\n".join(t for t in claude_text_blocks(content) if t)
        kind, text = classify_claude_user_text(raw, self.extra_drop_prefixes)
        if kind == OWNER:
            builder.start(text, record.get("timestamp", ""))
        elif kind == INTERRUPT:
            builder.note_interrupt()
        elif kind == COMPACTION:
            self._note_summary_compaction(builder)

    @staticmethod
    def _read_queued_owner_message(record: dict, builder: ExchangeBuilder) -> None:
        """Messages typed while the agent works arrive as queued_command attachments."""
        attachment = record.get("attachment")
        if not isinstance(attachment, dict) or attachment.get("type") != "queued_command":
            return
        if not attachment.get("humanTurn") and (attachment.get("origin") or {}).get("kind") != "human":
            return
        text = "\n".join(t for t in claude_text_blocks(attachment.get("prompt")) if t).strip()
        if not text:
            return
        exchange = builder.start(text, attachment.get("timestamp") or record.get("timestamp", ""))
        exchange.sent_mid_turn = True

    @staticmethod
    def _note_summary_compaction(builder: ExchangeBuilder) -> None:
        # A compact_boundary record normally announces the compaction first.
        # Count the summary turn only when it did not.
        if builder.current and not builder.current.compactions:
            builder.note_compaction()

    @staticmethod
    def _read_tool_results(record: dict, results: list[dict], builder: ExchangeBuilder,
                           tool_labels: dict[str, str]) -> None:
        decision = record.get("permissionDecision")
        decision_denied = isinstance(decision, dict) and str(decision.get("decision", "")).lower() in CLAUDE_DENIED_DECISIONS
        record_denied = bool(record.get(CLAUDE_DENIAL_KIND_FIELD)) or decision_denied

        for block in results:
            text = claude_block_text(block)
            denied = block.get("is_error") and (record_denied or text.startswith(CLAUDE_DENIAL_TEXT_PREFIX))
            if denied:
                builder.note_denial(tool_labels.get(block.get("tool_use_id", ""), "tool call"))
            if INTERRUPT_PREFIX in text[:80] and block.get("is_error"):
                builder.note_interrupt()


# ---------------------------------------------------------------------------
# Codex
# ---------------------------------------------------------------------------

def codex_session_meta(path: Path) -> dict | None:
    """The session_meta payload, or None for legacy or empty rollouts."""
    for record in read_jsonl(path):
        if record.get("type") == "session_meta" and isinstance(record.get("payload"), dict):
            return record["payload"]
        return None
    return None


def codex_owner_text(content) -> str:
    """Owner-typed text from a user-role message, with injected blocks removed."""
    if not isinstance(content, list):
        return ""
    kept = []
    for block in content:
        text = block.get("text", "") if isinstance(block, dict) else ""
        if not text.strip() or text.lstrip().startswith(CODEX_INJECTED_BLOCK_PREFIXES):
            continue
        kept.append(text.strip())
    return "\n\n".join(kept)


def decode_js_string(literal: str) -> str:
    try:
        return json.loads(literal)
    except json.JSONDecodeError:
        return literal.strip('"')


def codex_patch_paths(text: str) -> list[str]:
    """File paths named in apply_patch text, in the raw or JS-escaped form."""
    paths = CODEX_PATCH_FILE_LINE.findall(text) + CODEX_PATCH_MOVE_LINE.findall(text)
    return [p.strip() for p in paths]


def codex_commands(tool_name: str, payload_text: str) -> list[str]:
    if tool_name == "exec" or tool_name in CODEX_SHELL_CALL_NAMES or tool_name.startswith("multi_agent"):
        return [decode_js_string(m) for m in CODEX_COMMAND_LITERAL.findall(payload_text)]
    return []


def codex_shell_array_command(arguments: str) -> str:
    """Command from a shell call whose arguments carry argv as a JSON list."""
    try:
        data = json.loads(arguments)
    except json.JSONDecodeError:
        return ""
    command = data.get("command") if isinstance(data, dict) else None
    if isinstance(command, list):
        return " ".join(str(part) for part in command[-1:])
    return ""


class CodexSource:
    agent = "codex"

    def __init__(self, config: Config):
        self.roots = [Path(p).expanduser() for p in config.codex_session_dirs]
        self.include_exec_sessions = config.include_codex_exec_sessions
        self.drop_prefixes = (*CODEX_MACHINE_TURN_PREFIXES, *config.extra_drop_prefixes)
        self.thread_names = self._read_thread_names(Path(config.codex_session_index).expanduser())

    @staticmethod
    def _read_thread_names(index: Path) -> dict[str, str]:
        if not index.is_file():
            return {}
        return {r["id"]: r["thread_name"] for r in read_jsonl(index) if r.get("id") and r.get("thread_name")}

    def discover(self, prefixes: list[str]) -> list[SessionRef]:
        refs = []
        for root in self.roots:
            for path in root.rglob("rollout-*.jsonl"):
                meta = codex_session_meta(path)
                if not meta or not self._is_owner_session(meta):
                    continue
                if cwd_in_scope(meta.get("cwd", ""), prefixes):
                    session_id = meta.get("id") or meta.get("session_id") or path.stem
                    refs.append(SessionRef(self.agent, session_id, path, meta["cwd"], path.stat().st_mtime))
        return refs

    def _is_owner_session(self, meta: dict) -> bool:
        if meta.get("thread_source") == "subagent" or isinstance(meta.get("source"), dict):
            return False
        return self.include_exec_sessions or meta.get("source") != "exec"

    def load(self, ref: SessionRef) -> Session:
        builder = ExchangeBuilder()
        timestamps: list[str] = []
        call_labels: dict[str, str] = {}
        saw_compacted_record = False

        for record in read_jsonl(ref.path):
            payload = record.get("payload")
            if not isinstance(payload, dict):
                continue
            if record.get("timestamp"):
                timestamps.append(record["timestamp"])
            record_type = record.get("type")

            if record_type == "response_item":
                self._read_response_item(payload, record.get("timestamp", ""), builder, call_labels)
            elif record_type == "compacted":
                saw_compacted_record = True
                builder.note_compaction()
            elif record_type == "event_msg":
                event = payload.get("type")
                if event == "turn_aborted":
                    builder.note_interrupt()
                elif event == "context_compacted" and not saw_compacted_record:
                    builder.note_compaction()

        exchanges = builder.finish()
        title = self.thread_names.get(ref.session_id) or (first_line(exchanges[0].owner_text) if exchanges else "")
        return Session(
            agent=self.agent,
            session_id=ref.session_id,
            title=title,
            cwd=ref.cwd,
            started=min(timestamps, default=""),
            ended=max(timestamps, default=""),
            path=str(ref.path),
            exchanges=exchanges,
        )

    def launches(self, ref: SessionRef) -> list[SubagentLaunch]:
        found = []
        for record in read_jsonl(ref.path):
            payload = record.get("payload")
            if record.get("type") != "response_item" or not isinstance(payload, dict):
                continue
            if payload.get("type") not in ("function_call", "custom_tool_call"):
                continue
            body = payload.get("arguments") or payload.get("input") or ""
            if not isinstance(body, str):
                body = json.dumps(body)
            if "spawn_agent" not in payload.get("name", "") and "spawn_agent(" not in body:
                continue
            title, model, detail = codex_spawn_details(body)
            found.append(SubagentLaunch(
                key=f"{self.agent}:{ref.session_id}:{payload.get('call_id', len(found))}",
                timestamp=record.get("timestamp", ""), title=title, model=model, detail=detail,
            ))
        return found

    def _read_response_item(self, payload: dict, timestamp: str, builder: ExchangeBuilder,
                            call_labels: dict[str, str]) -> None:
        item_type = payload.get("type")
        if item_type == "message":
            self._read_message(payload, timestamp, builder)
        elif item_type in ("function_call", "custom_tool_call"):
            self._read_tool_call(payload, builder, call_labels)
        elif item_type in ("function_call_output", "custom_tool_call_output"):
            output = payload.get("output")
            if CODEX_DENIAL_OUTPUT.search(str(output)[:400]):
                builder.note_denial(call_labels.get(payload.get("call_id", ""), "tool call"))

    def _read_message(self, payload: dict, timestamp: str, builder: ExchangeBuilder) -> None:
        role = payload.get("role")
        if role == "assistant":
            # Commentary messages narrate mid-turn; the final answer is the reply.
            if payload.get("phase") == "final_answer" or not (builder.current and builder.current.final_reply):
                builder.note_reply("\n".join(b.get("text", "") for b in payload.get("content", []) if isinstance(b, dict)))
            return
        if role != "user":
            return
        content = payload.get("content")
        if any(
            isinstance(b, dict) and b.get("text", "").lstrip().startswith(CODEX_ABORT_MARKER)
            for b in (content if isinstance(content, list) else [])
        ):
            builder.note_interrupt()
            return
        text = codex_owner_text(content)
        if text and not text.startswith(self.drop_prefixes):
            builder.start(text, timestamp)

    @staticmethod
    def _read_tool_call(payload: dict, builder: ExchangeBuilder, call_labels: dict[str, str]) -> None:
        name = payload.get("name", "")
        body = payload.get("arguments") or payload.get("input") or ""
        if not isinstance(body, str):
            body = json.dumps(body)

        paths = codex_patch_paths(body)
        for path in paths:
            builder.note_edit(path)

        commands = codex_commands(name, body)
        if not commands and name in CODEX_SHELL_CALL_NAMES:
            array_command = codex_shell_array_command(body)
            commands = [array_command] if array_command else []
        for command in commands:
            builder.note_command(command)

        if "spawn_agent" in name or "spawn_agent(" in body:
            builder.note_subagent(codex_subagent_label(body))

        if payload.get("call_id"):
            call_labels[payload["call_id"]] = (commands[0] if commands else name)[:MAX_DENIAL_LABEL_CHARS]


def codex_subagent_label(body: str) -> str:
    """Name of a spawned agent: the task name if present, else the brief's opening."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict) and data.get("task_name"):
        return str(data["task_name"])
    match = CODEX_SPAWN_MESSAGE_LITERAL.search(body)
    return first_line(decode_js_string(match.group(1))) if match else "subagent"


CODEX_SPAWN_MODEL_LITERAL = re.compile(r'spawn_agent\(\s*\{.*?\bmodel"?\s*:\s*("(?:[^"\\]|\\.)*")', re.S)


def codex_spawn_details(body: str) -> tuple[str, str, str]:
    """(title, model, first line of the brief) for a spawn_agent call body."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict):
        return (
            trim(str(data.get("task_name") or "subagent"), MAX_SUBAGENT_LABEL_CHARS),
            str(data.get("model") or ""),
            first_line(str(data.get("message") or "")),
        )
    model_match = CODEX_SPAWN_MODEL_LITERAL.search(body)
    message_match = CODEX_SPAWN_MESSAGE_LITERAL.search(body)
    return (
        codex_subagent_label(body),
        decode_js_string(model_match.group(1)) if model_match else "",
        first_line(decode_js_string(message_match.group(1))) if message_match else "",
    )


# ---------------------------------------------------------------------------
# Discovery across agents
# ---------------------------------------------------------------------------

AGENT_CHOICES = ("claude", "codex", "all")


def build_sources(config: Config, agent: str) -> list:
    sources = []
    if agent in ("claude", "all"):
        sources.append(ClaudeCodeSource(config))
    if agent in ("codex", "all"):
        sources.append(CodexSource(config))
    return sources


def discover_sessions(config: Config, prefixes: list[str], agent: str = "all") -> list[tuple[object, SessionRef]]:
    """(source, ref) pairs for in-scope sessions, most recently modified first."""
    found = [(source, ref) for source in build_sources(config, agent) for ref in source.discover(prefixes)]
    return sorted(found, key=lambda pair: pair[1].modified, reverse=True)
