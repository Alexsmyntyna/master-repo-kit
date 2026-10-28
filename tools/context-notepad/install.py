#!/usr/bin/env python3
"""Vendor context-notepad into a repository, and update it later.

Copies the tools and the skill into the target repo, records a lock file with
the version and a sha256 per installed file, and keeps a marked block in the
repo's CLAUDE.md and AGENTS.md. The target ends up owning plain files; nothing
here is a runtime dependency.

Every folder under payload/skills/ is installed to both .agents/skills/ and
.claude/skills/; payload/tools/context-notepad/ (hooks included) goes to
tools/context-notepad/.

Modes:
  --target REPO              install (dry run unless --apply)
  --target REPO --update     refresh files from this payload; a file you edited
                             is never overwritten, its diff is printed instead.
                             New default keys are added to config.json; existing
                             values are never changed
  --target REPO --status     report installed version and local modifications
  --hooks                    also merge the hook entries into the target's
                             .claude/settings.json and .codex/hooks.json (a diff
                             is shown first; existing hooks are kept). Alone on an
                             installed repo it only does the hooks. Nothing is ever
                             written to the home directory.

Why a lock: with a hash per installed file, an update can tell "untouched since
install, safe to replace" from "edited locally, needs a human merge".
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
PAYLOAD_DIR = REPO_ROOT / "payload"
VERSION_FILE = REPO_ROOT / "VERSION"

TOOL_NAME = "context-notepad"
TOOLS_SOURCE = Path("tools") / TOOL_NAME
SKILLS_SOURCE = Path("skills")
BLOCK_SOURCE = "agents-block.md"
SKILL_DESTINATION_ROOTS = (Path(".agents/skills"), Path(".claude/skills"))
LOCK_FILE = Path("tools") / TOOL_NAME / ".lock.json"
CONFIG_FILE = Path("tools") / TOOL_NAME / "config.json"
CONFIG_EXAMPLE = "config.example.json"
INSTRUCTION_FILES = ("CLAUDE.md", "AGENTS.md")
IGNORED_NAMES = {"__pycache__", ".DS_Store", ".lock.json", "config.json"}
IGNORED_SUFFIXES = (".pyc",)

BLOCK_PATTERN = re.compile(
    rf"<!-- {TOOL_NAME}:begin[^>]*-->.*?<!-- {TOOL_NAME}:end -->", re.S
)

ADD, UNCHANGED, REPLACE, CONFLICT = "add", "unchanged", "replace", "conflict"


# ---------------------------------------------------------------------------
# Hashing and payload discovery
# ---------------------------------------------------------------------------

def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_version(version_file: Path = VERSION_FILE) -> str:
    return version_file.read_text(encoding="utf-8").strip()


def install_map(payload_dir: Path) -> list[tuple[Path, tuple[Path, ...]]]:
    """(payload subfolder, destination folders in the target) for the tools and every skill."""
    skills = sorted(p for p in (payload_dir / SKILLS_SOURCE).iterdir() if p.is_dir())
    return [
        (TOOLS_SOURCE, (Path("tools") / TOOL_NAME,)),
        *((SKILLS_SOURCE / skill.name, tuple(root / skill.name for root in SKILL_DESTINATION_ROOTS)) for skill in skills),
    ]


def payload_files(payload_dir: Path) -> dict[str, Path]:
    """Destination path (relative to the target, posix) -> source file."""
    files: dict[str, Path] = {}
    for source_rel, destinations in install_map(payload_dir):
        source_root = payload_dir / source_rel
        for source in sorted(p for p in source_root.rglob("*") if p.is_file()):
            relative = source.relative_to(source_root)
            if IGNORED_NAMES & set(relative.parts) or source.suffix in IGNORED_SUFFIXES:
                continue
            for destination in destinations:
                files[(destination / relative).as_posix()] = source
    return files


def read_lock(target: Path) -> dict | None:
    lock_path = target / LOCK_FILE
    if not lock_path.is_file():
        return None
    return json.loads(lock_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

@dataclass
class FileAction:
    path: str
    kind: str
    source: Path | None = None
    diff: str = ""


@dataclass
class BlockAction:
    path: Path
    existed: bool
    new_text: str
    changed: bool


def unified_diff(current: Path, source: Path, label: str) -> str:
    current_lines = current.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    source_lines = source.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    return "".join(difflib.unified_diff(current_lines, source_lines, f"{label} (yours)", f"{label} (payload)"))


def plan_files(payload_dir: Path, target: Path, lock: dict | None) -> list[FileAction]:
    locked_hashes = (lock or {}).get("files", {})
    actions = []
    for relative, source in payload_files(payload_dir).items():
        destination = target / relative
        if not destination.exists():
            actions.append(FileAction(relative, ADD, source))
        elif sha256_of(destination) == sha256_of(source):
            actions.append(FileAction(relative, UNCHANGED, source))
        elif locked_hashes.get(relative) == sha256_of(destination):
            actions.append(FileAction(relative, REPLACE, source))
        else:
            actions.append(FileAction(relative, CONFLICT, source, unified_diff(destination, source, relative)))
    return actions


def removed_from_payload(payload_dir: Path, lock: dict | None) -> list[str]:
    shipped = set(payload_files(payload_dir))
    return sorted(set((lock or {}).get("files", {})) - shipped)


def managed_block(version: str, body: str) -> str:
    return f"<!-- {TOOL_NAME}:begin v{version} -->\n{body.strip()}\n<!-- {TOOL_NAME}:end -->"


def insert_block(existing: str, block: str) -> str:
    """Replace the marked block, or append it when the markers are absent."""
    if BLOCK_PATTERN.search(existing):
        return BLOCK_PATTERN.sub(lambda _: block, existing, count=1)
    if not existing:
        return block + "\n"
    return existing.rstrip("\n") + "\n\n" + block + "\n"


def block_text(payload_dir: Path, target: Path) -> str:
    """The block body with `{notepad_dir}` and `{activity_log}` set from the target's config (or the defaults)."""
    config_path = target / CONFIG_FILE
    config = json.loads((payload_dir / TOOLS_SOURCE / CONFIG_EXAMPLE).read_text(encoding="utf-8"))
    if config_path.is_file():
        config.update(json.loads(config_path.read_text(encoding="utf-8")))
    body = (payload_dir / BLOCK_SOURCE).read_text(encoding="utf-8")
    for key in ("notepad_dir", "activity_log"):
        body = body.replace("{" + key + "}", str(config[key]).rstrip("/"))
    return body


def plan_blocks(payload_dir: Path, target: Path, version: str) -> list[BlockAction]:
    block = managed_block(version, block_text(payload_dir, target))
    actions = []
    seen: set[Path] = set()
    for name in INSTRUCTION_FILES:
        path = target / name
        # AGENTS.md is sometimes a symlink to CLAUDE.md; write the file once.
        if path.exists() and path.resolve() in seen:
            continue
        seen.add(path.resolve())
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        new_text = insert_block(existing, block)
        actions.append(BlockAction(path, path.exists(), new_text, new_text != existing))
    return actions


def plan_config(payload_dir: Path, target: Path) -> str | None:
    """Text for a new config.json, or None when one already exists."""
    if (target / CONFIG_FILE).exists():
        return None
    example = json.loads((payload_dir / TOOLS_SOURCE / CONFIG_EXAMPLE).read_text(encoding="utf-8"))
    example["repo_prefixes"] = [str(target.resolve())]
    return json.dumps(example, indent=2) + "\n"


def merge_defaults(existing: dict, defaults: dict, prefix: str = "") -> list[str]:
    """Add keys missing from `existing` (recursively for nested objects); never change a value."""
    added = []
    for key, value in defaults.items():
        if key not in existing:
            existing[key] = value
            added.append(prefix + key)
        elif isinstance(existing[key], dict) and isinstance(value, dict):
            added += merge_defaults(existing[key], value, f"{prefix}{key}.")
    return added


def plan_config_merge(payload_dir: Path, target: Path) -> tuple[str, list[str]] | None:
    """(new config text, added keys) when an existing config.json lacks default keys."""
    path = target / CONFIG_FILE
    if not path.exists():
        return None
    existing = json.loads(path.read_text(encoding="utf-8"))
    defaults = json.loads((payload_dir / TOOLS_SOURCE / CONFIG_EXAMPLE).read_text(encoding="utf-8"))
    defaults.pop("repo_prefixes", None)
    added = merge_defaults(existing, defaults)
    return (json.dumps(existing, indent=2) + "\n", added) if added else None


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

HOOK_DIR = f"tools/{TOOL_NAME}/hooks"
HOOK_TIMEOUT_SECONDS = 10
CLAUDE_SETTINGS = Path(".claude/settings.json")
CODEX_HOOKS = Path(".codex/hooks.json")
CLAUDE_HOOK_ENTRIES = (
    ("SubagentStart", "", "log_subagent.py", "claude"),
    ("SubagentStop", "", "log_subagent.py", "claude"),
    ("UserPromptSubmit", "", "context_reminder.py", "claude"),
)
CODEX_HOOK_ENTRIES = (
    ("PreToolUse", "spawn_agent", "log_subagent.py", "codex"),
    ("UserPromptSubmit", "", "context_reminder.py", "codex"),
)
CODEX_PROJECT_ROOT = '"$(git rev-parse --show-toplevel)"'
CLAUDE_PROJECT_ROOT = '"$CLAUDE_PROJECT_DIR"'


@dataclass
class HookFilePlan:
    path: Path
    old_text: str
    new_text: str
    added: list[str]
    error: str = ""


def hook_command(root_expression: str, script: str, agent: str) -> str:
    quoted_root = root_expression[:-1]  # drop the closing quote so the path continues inside it
    return f'python3 {quoted_root}/{HOOK_DIR}/{script}" --agent {agent}'


def merge_hook_entries(settings: dict, entries: tuple, root_expression: str) -> list[str]:
    """Add missing entries to settings["hooks"]; an event already running our script is left alone."""
    added = []
    events = settings.setdefault("hooks", {})
    for event, matcher, script, agent in entries:
        groups = events.setdefault(event, [])
        already = any(f"{HOOK_DIR}/{script}" in handler.get("command", "")
                      for group in groups for handler in group.get("hooks", []))
        if already:
            continue
        groups.append({"matcher": matcher, "hooks": [
            {"type": "command", "command": hook_command(root_expression, script, agent), "timeout": HOOK_TIMEOUT_SECONDS}]})
        added.append(f"{event}: {script}")
    return added


def plan_hook_file(target: Path, relative: Path, entries: tuple, root_expression: str) -> HookFilePlan:
    path = target / relative
    old_text = path.read_text(encoding="utf-8") if path.exists() else ""
    try:
        settings = json.loads(old_text) if old_text.strip() else {}
        if not isinstance(settings, dict) or not isinstance(settings.get("hooks", {}), dict):
            raise ValueError("unexpected shape")
    except ValueError as error:
        return HookFilePlan(path, old_text, old_text, [], f"cannot merge, {relative} is not the expected JSON ({error})")
    added = merge_hook_entries(settings, entries, root_expression)
    return HookFilePlan(path, old_text, json.dumps(settings, indent=2, ensure_ascii=False) + "\n", added)


def plan_hooks(target: Path) -> list[HookFilePlan]:
    return [
        plan_hook_file(target, CLAUDE_SETTINGS, CLAUDE_HOOK_ENTRIES, CLAUDE_PROJECT_ROOT),
        plan_hook_file(target, CODEX_HOOKS, CODEX_HOOK_ENTRIES, CODEX_PROJECT_ROOT),
    ]


def print_hook_plans(plans: list[HookFilePlan], apply: bool) -> None:
    print("\nHooks:")
    for plan in plans:
        if plan.error:
            print(f"  skipped     {plan.path}: {plan.error}")
        elif not plan.added:
            print(f"  unchanged   {plan.path} (entries already present)")
        else:
            print(f"  {'merge into' if apply else 'would merge'} {plan.path}: {', '.join(plan.added)}")
            print("".join(difflib.unified_diff(plan.old_text.splitlines(keepends=True), plan.new_text.splitlines(keepends=True),
                                               f"{plan.path.name} (current)", f"{plan.path.name} (merged)")))
    print("Codex reads project hooks from .codex/hooks.json only when the project's .codex layer is trusted, and\n"
          "each hook must be reviewed with /hooks in the Codex CLI before it runs. To use user-level hooks instead,\n"
          "copy the entries above into ~/.codex/hooks.json yourself; this installer never writes to the home directory.")


def apply_hooks(target: Path, plans: list[HookFilePlan]) -> None:
    for plan in plans:
        if plan.added and not plan.error:
            guard(target, plan.path)
            plan.path.parent.mkdir(parents=True, exist_ok=True)
            plan.path.write_text(plan.new_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Destination safety
# ---------------------------------------------------------------------------

class UnsafeDestination(Exception):
    """A path the installer would write resolves outside the target repository."""


def guard(target: Path, path: Path) -> Path:
    """`path` itself when its fully resolved location (symlinks followed) stays inside the target."""
    root = target.resolve()
    resolved = path.resolve()
    if resolved != root and root not in resolved.parents:
        raise UnsafeDestination(f"refusing to write {path}: it resolves to {resolved}, outside {root}")
    return path


def check_destinations(target: Path, actions: list[FileAction], blocks: list[BlockAction],
                       hook_plans: list[HookFilePlan]) -> None:
    """Fail before anything is written (dry runs included) when any destination escapes the target."""
    for action in actions:
        if action.kind in (ADD, REPLACE):
            guard(target, target / action.path)
    for block in blocks:
        if block.changed:
            guard(target, block.path)
    for plan in hook_plans:
        if plan.added and not plan.error:
            guard(target, plan.path)
    guard(target, target / CONFIG_FILE)
    guard(target, target / LOCK_FILE)


# ---------------------------------------------------------------------------
# Applying
# ---------------------------------------------------------------------------

def write_lock(target: Path, version: str, actions: list[FileAction], previous: dict | None) -> None:
    previous_hashes = (previous or {}).get("files", {})
    files = {}
    for action in actions:
        if action.kind == CONFLICT:
            if action.path in previous_hashes:
                files[action.path] = previous_hashes[action.path]
            continue
        files[action.path] = sha256_of(action.source)
    lock_path = guard(target, target / LOCK_FILE)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps({"version": version, "files": dict(sorted(files.items()))}, indent=2) + "\n", encoding="utf-8")


def apply_plan(payload_dir: Path, target: Path, version: str, actions: list[FileAction],
               blocks: list[BlockAction], config_text: str | None, previous_lock: dict | None,
               config_merge: tuple[str, list[str]] | None = None) -> None:
    for action in actions:
        if action.kind in (ADD, REPLACE):
            destination = guard(target, target / action.path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(action.source.read_bytes())
            destination.chmod(action.source.stat().st_mode & 0o777)
    for block in blocks:
        if block.changed:
            guard(target, block.path).write_text(block.new_text, encoding="utf-8")
    if config_text is not None:
        guard(target, target / CONFIG_FILE).write_text(config_text, encoding="utf-8")
    if config_merge is not None:
        guard(target, target / CONFIG_FILE).write_text(config_merge[0], encoding="utf-8")
    write_lock(target, version, actions, previous_lock)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def print_plan(version: str, actions: list[FileAction], blocks: list[BlockAction], config_text: str | None,
               removed: list[str], apply: bool, config_merge: tuple[str, list[str]] | None = None) -> None:
    verb = {ADD: "add", REPLACE: "replace", UNCHANGED: "unchanged", CONFLICT: "NEEDS MERGE"}
    print(f"context-notepad {version}: {'applying' if apply else 'dry run, nothing written'}")
    for action in actions:
        print(f"  {verb[action.kind]:<11} {action.path}")
    for block in blocks:
        state = "unchanged" if not block.changed else ("update block in" if block.existed else "create file with block:")
        print(f"  {state:<11} {block.path.name}")
    print(f"  {'create' if config_text is not None else 'keep':<11} {CONFIG_FILE.as_posix()}")
    if config_merge:
        print(f"  {'adding' if apply else 'would add'} default keys to config.json (values untouched): {', '.join(config_merge[1])}")
    for path in removed:
        print(f"  no longer shipped (left in place): {path}")
    for action in actions:
        if action.kind == CONFLICT:
            print(f"\nLocally modified, not overwritten: {action.path}. Merge by hand:\n{action.diff}")
    if not apply:
        print("\nRe-run with --apply to write these changes.")


def command_install(target: Path, update: bool, apply: bool, payload_dir: Path = PAYLOAD_DIR,
                    version: str | None = None, hooks: bool = False) -> int:
    version = version or read_version()
    lock = read_lock(target)
    if lock and not update:
        print(f"Already installed (v{lock.get('version')}). Use --update to refresh, or --status to inspect.", file=sys.stderr)
        return 1
    if not target.is_dir():
        print(f"Target is not a directory: {target}", file=sys.stderr)
        return 1

    actions = plan_files(payload_dir, target, lock)
    blocks = plan_blocks(payload_dir, target, version)
    config_text = plan_config(payload_dir, target)
    config_merge = plan_config_merge(payload_dir, target) if update else None
    removed = removed_from_payload(payload_dir, lock)
    hook_plans = plan_hooks(target) if hooks else []
    try:
        check_destinations(target, actions, blocks, hook_plans)
    except UnsafeDestination as error:
        print(str(error), file=sys.stderr)
        return 1
    print_plan(version, actions, blocks, config_text, removed, apply, config_merge)
    if hooks:
        print_hook_plans(hook_plans, apply)
    if apply:
        apply_plan(payload_dir, target, version, actions, blocks, config_text, lock, config_merge)
        apply_hooks(target, hook_plans)
        merges = [a.path for a in actions if a.kind == CONFLICT]
        print(f"\nDone. {len(merges)} file(s) need a manual merge." if merges else "\nDone.")
    return 0


def command_hooks_only(target: Path, apply: bool) -> int:
    plans = plan_hooks(target)
    try:
        check_destinations(target, [], [], plans)
    except UnsafeDestination as error:
        print(str(error), file=sys.stderr)
        return 1
    print_hook_plans(plans, apply)
    if apply:
        apply_hooks(target, plans)
    else:
        print("\nRe-run with --apply to write these changes.")
    return 0


def command_status(target: Path) -> int:
    lock = read_lock(target)
    payload_version = read_version()
    if not lock:
        print(f"Not installed in {target} (payload is v{payload_version}).")
        return 1
    print(f"Installed v{lock.get('version')}; payload is v{payload_version}.")
    for relative, locked_hash in lock.get("files", {}).items():
        path = target / relative
        state = "missing" if not path.exists() else ("ok" if sha256_of(path) == locked_hash else "modified locally")
        print(f"  {state:<16} {relative}")
    for name in INSTRUCTION_FILES:
        path = target / name
        match = re.search(rf"<!-- {TOOL_NAME}:begin (v[^ ]+) -->", path.read_text(encoding="utf-8")) if path.exists() else None
        print(f"  block {match.group(1) if match else 'absent':<10} {name}")
    print(f"  config {'present' if (target / CONFIG_FILE).exists() else 'missing'}: {CONFIG_FILE.as_posix()}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", type=Path, required=True, help="repository to install into")
    parser.add_argument("--update", action="store_true", help="refresh an existing install, preserving local edits")
    parser.add_argument("--status", action="store_true", help="show installed version and local modifications")
    parser.add_argument("--hooks", action="store_true",
                        help="merge hook entries into .claude/settings.json and .codex/hooks.json (diff first)")
    parser.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    target = args.target.expanduser().resolve()
    if args.status:
        return command_status(target)
    if args.hooks and not args.update and read_lock(target):
        return command_hooks_only(target, args.apply)
    return command_install(target, args.update, args.apply, hooks=args.hooks)


if __name__ == "__main__":
    raise SystemExit(main())
