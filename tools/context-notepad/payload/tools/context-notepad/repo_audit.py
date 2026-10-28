#!/usr/bin/env python3
"""Scan a git repository for cleanup candidates. Read-only, no verdicts.

Collects evidence an agent needs to plan a tidy-up: loose root files, agent
remnants (plan/brief/temp files, duplicates, empty folders, prunable
worktrees), Markdown doc health (headers, ages, inbound references, checklist
progress, one-time-instruction phrases) and git state (tracked, untracked,
ignored, sizes of ignored top-level folders). It never writes, moves or
deletes anything, and it recommends nothing: the agent decides.

Project facts (allowlist, globs, protected paths, archive convention, post
checks) come from prune.config.json; see prune.config.example.json. List
values extend the built-in defaults, except where noted in the example.

Why it exists: the codebase-prune skill needs one cheap, deterministic pass
over the repo so the agent reads candidates in slices instead of the tree.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

CATEGORIES = ("loose_root_file", "remnant_pattern", "doc_health", "git_state")
TEXT_SAMPLE_BYTES = 8192
MAX_REFERENCE_FILE_BYTES = 2_000_000

DEFAULTS = {
    "root_allowlist": [
        "README*", "LICENSE*", "LICENCE*", "COPYING*", "NOTICE*", "CHANGELOG*",
        "CONTRIBUTING*", "CODE_OF_CONDUCT*", "SECURITY*", "CLAUDE.md", "AGENTS.md",
        "GEMINI.md", ".gitignore", ".gitattributes", ".gitmodules", ".editorconfig",
        ".env.example", "Package.swift", "Package.resolved", "Makefile", "package.json",
        "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pyproject.toml",
        "requirements*.txt", "setup.py", "setup.cfg", "tox.ini", "Cargo.toml",
        "Cargo.lock", "go.mod", "go.sum", "Gemfile*", "Dockerfile", "docker-compose*.yml",
        "tsconfig*.json", ".swiftlint.yml", ".swift-version", ".tool-versions",
        ".nvmrc", ".python-version", "Podfile*", "VERSION",
    ],
    "remnant_globs": [
        "*_PLAN.md", "plan-*.md", "*brief*", "temp", "temp.*", "temp-*", "temp_*",
        "scratch*", "*.orig", "*.rej", ".DS_Store",
    ],
    "remnant_skip_extensions": [
        ".swift", ".py", ".js", ".ts", ".tsx", ".m", ".h", ".kt", ".java", ".go", ".rs",
    ],
    "exclude_dirs": [
        ".git", "node_modules", "build", "DerivedData", ".build", "Pods", ".venv",
        "venv", "__pycache__", "dist", ".obsidian",
    ],
    "protected_paths": [".env*"],
    "doc_roots": [],
    "one_time_phrases": ["handoff", "hand-off", "brief", "do not re-litigate", "implement it"],
    "stale_days": 60,
    "archive_convention": "",
    "doc_header_convention": "Status: and Last verified: header lines near the top",
    "post_checks": [],
    "max_hash_bytes": 1_000_000,
    "duplicate_min_bytes": 64,
    "size_scan_entry_cap": 20000,
    "max_rows_per_category": 40,
}
# Lists in the config extend these defaults; scalars replace them.
LIST_KEYS_THAT_EXTEND = (
    "root_allowlist", "remnant_globs", "remnant_skip_extensions", "exclude_dirs",
    "protected_paths", "one_time_phrases",
)

REMNANT_KIND_ORDER = ["name_pattern", "empty_directory", "duplicate", "prunable_worktree"]

HEADER_STATUS = re.compile(r"^\W*status\W*:\s*(.+?)\s*$", re.IGNORECASE)
HEADER_VERIFIED = re.compile(r"^\W*last verified\W*:\s*(\d{4}-\d{2}-\d{2})", re.IGNORECASE)
HEADER_SCAN_LINES = 30
CHECKBOX = re.compile(r"^\s*[-*+]\s+\[([ xX])\]")
FILENAME_TOKEN = re.compile(r"[\w.+@-]+\.[A-Za-z0-9]{1,8}")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_audit_config(config_path: Path | None, project_root: Path) -> dict:
    """Defaults, extended or replaced by the first config file found."""
    candidates = [config_path] if config_path else [
        project_root / "tools" / "context-notepad" / "prune.config.json",
        Path(__file__).resolve().parent / "prune.config.json",
    ]
    config = {key: list(value) if isinstance(value, list) else value for key, value in DEFAULTS.items()}
    for candidate in candidates:
        if candidate and candidate.is_file():
            user = json.loads(candidate.read_text(encoding="utf-8"))
            for key, value in user.items():
                if key.startswith("_") or key not in DEFAULTS:
                    continue
                if key in LIST_KEYS_THAT_EXTEND:
                    config[key] = list(dict.fromkeys([*config[key], *value]))
                else:
                    config[key] = value
            config["_config_file"] = str(candidate)
            break
    return config


# ---------------------------------------------------------------------------
# Git access: a handful of process calls for the whole run.
# ---------------------------------------------------------------------------

def run_git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-c", "core.quotepath=off", *args],
        cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return result.stdout if result.returncode == 0 else ""


def git_root(project: Path) -> Path:
    top = run_git(project, "rev-parse", "--show-toplevel").strip()
    return Path(top) if top else project.resolve()


def null_separated(output: str) -> list[str]:
    return [item for item in output.split("\0") if item]


def list_tracked(root: Path) -> set[str]:
    return set(null_separated(run_git(root, "ls-files", "-z")))


def list_ignored(root: Path) -> list[str]:
    """Ignored files and collapsed ignored directories (trailing slash)."""
    return null_separated(run_git(
        root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"))


def list_untracked_collapsed(root: Path) -> list[str]:
    return null_separated(run_git(
        root, "ls-files", "-z", "--others", "--exclude-standard", "--directory", "--no-empty-directory"))


def last_change_dates(root: Path, wanted: set[str]) -> dict[str, str]:
    """Latest commit date per path from one streamed `git log`, stopping once all are seen."""
    found: dict[str, str] = {}
    if not wanted:
        return found
    process = subprocess.Popen(
        ["git", "-c", "core.quotepath=off", "log", "--format=@@%cs", "--name-only", "--no-renames"],
        cwd=root, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
    )
    current = ""
    for line in process.stdout:
        line = line.rstrip("\n")
        if line.startswith("@@"):
            current = line[2:]
        elif line and line not in found and line in wanted:
            found[line] = current
            if len(found) == len(wanted):
                break
    process.kill()
    process.wait()
    process.stdout.close()
    return found


def prunable_worktrees(root: Path) -> list[dict]:
    entries, current = [], {}
    for line in [*run_git(root, "worktree", "list", "--porcelain").splitlines(), ""]:
        if not line:
            if current.get("prunable") is not None:
                entries.append(current)
            current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = value
    return entries


# ---------------------------------------------------------------------------
# Filesystem inventory
# ---------------------------------------------------------------------------

class Inventory:
    """Files present on disk (excluding excluded and ignored directories) plus git state."""

    def __init__(self, root: Path, config: dict):
        self.root = root
        self.config = config
        self.tracked = list_tracked(root)
        ignored_entries = list_ignored(root)
        self.ignored_dirs = {entry.rstrip("/") for entry in ignored_entries if entry.endswith("/")}
        self.ignored_files = {entry for entry in ignored_entries if not entry.endswith("/")}
        self.files: list[str] = []
        self.empty_dirs: list[str] = []
        self._walk()

    def is_excluded(self, relative: str) -> bool:
        excluded = set(self.config["exclude_dirs"])
        return any(part in excluded for part in relative.split("/")[:-1])

    def state(self, relative: str) -> str:
        if relative in self.tracked:
            return "tracked"
        if relative in self.ignored_files or relative in self.ignored_dirs or any(
            relative.startswith(directory + "/") for directory in self.ignored_dirs
        ):
            return "ignored"
        return "untracked"

    def _walk(self) -> None:
        excluded = set(self.config["exclude_dirs"])
        for directory, subdirs, names in os.walk(self.root):
            relative_dir = os.path.relpath(directory, self.root)
            relative_dir = "" if relative_dir == "." else relative_dir.replace(os.sep, "/")
            subdirs[:] = sorted(
                name for name in subdirs
                if name not in excluded
                and (f"{relative_dir}/{name}" if relative_dir else name) not in self.ignored_dirs
            )
            if relative_dir and not subdirs and not names:
                self.empty_dirs.append(relative_dir)
            for name in sorted(names):
                self.files.append(f"{relative_dir}/{name}" if relative_dir else name)
        # Tracked files inside ignored directories are still part of the repo.
        present = set(self.files)
        for relative in self.tracked:
            if relative not in present and not self.is_excluded(relative) and (self.root / relative).is_file():
                self.files.append(relative)


def is_protected(relative: str, patterns: list[str]) -> bool:
    name = relative.rsplit("/", 1)[-1]
    for pattern in patterns:
        if pattern.endswith("/") and (relative + "/").startswith(pattern):
            return True
        if fnmatch.fnmatch(relative, pattern) or fnmatch.fnmatch(name, pattern):
            return True
    return False


def looks_like_text(path: Path) -> bool:
    try:
        with open(path, "rb") as handle:
            return b"\0" not in handle.read(TEXT_SAMPLE_BYTES)
    except OSError:
        return False


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def make_candidate(inventory: Inventory, relative: str, category: str, **signals) -> dict:
    return {
        "path": relative,
        "category": category,
        "state": inventory.state(relative),
        "protected": is_protected(relative, inventory.config["protected_paths"]),
        "signals": signals,
    }


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

def find_loose_root_files(inventory: Inventory) -> list[dict]:
    allowlist = inventory.config["root_allowlist"]
    found = []
    for relative in inventory.files:
        if "/" in relative:
            continue
        if any(fnmatch.fnmatchcase(relative, pattern) for pattern in allowlist):
            continue
        found.append(make_candidate(inventory, relative, "loose_root_file"))
    return found


def matches_remnant_glob(name: str, patterns: list[str], skipped_extensions: list[str]) -> list[str]:
    if os.path.splitext(name)[1].lower() in skipped_extensions:
        return []
    return [pattern for pattern in patterns if fnmatch.fnmatch(name.lower(), pattern.lower())]


def find_duplicates(inventory: Inventory) -> list[dict]:
    by_size: dict[int, list[str]] = {}
    for relative in inventory.files:
        if relative not in inventory.tracked:
            continue
        path = inventory.root / relative
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if inventory.config["duplicate_min_bytes"] <= size <= inventory.config["max_hash_bytes"]:
            by_size.setdefault(size, []).append(relative)
    by_hash: dict[str, list[str]] = {}
    for paths in by_size.values():
        if len(paths) < 2:
            continue
        for relative in paths:
            path = inventory.root / relative
            if looks_like_text(path):
                by_hash.setdefault(hashlib.sha256(path.read_bytes()).hexdigest(), []).append(relative)
    found = []
    for digest, paths in by_hash.items():
        if len(paths) < 2:
            continue
        for relative in paths:
            others = [other for other in paths if other != relative]
            found.append(make_candidate(
                inventory, relative, "remnant_pattern",
                kind="duplicate", sha256=digest[:12], duplicates=others))
    return found


def find_remnants(inventory: Inventory) -> list[dict]:
    config = inventory.config
    found = []
    for relative in inventory.files:
        name = relative.rsplit("/", 1)[-1]
        matched = matches_remnant_glob(name, config["remnant_globs"], config["remnant_skip_extensions"])
        if matched:
            found.append(make_candidate(inventory, relative, "remnant_pattern", kind="name_pattern", patterns=matched))
    for relative in inventory.empty_dirs:
        found.append(make_candidate(inventory, relative + "/", "remnant_pattern", kind="empty_directory"))
    found.extend(find_duplicates(inventory))
    for worktree in prunable_worktrees(inventory.root):
        found.append({
            "path": worktree.get("worktree", ""), "category": "remnant_pattern", "state": "worktree",
            "protected": False,
            "signals": {"kind": "prunable_worktree", "reason": worktree.get("prunable", ""),
                        "branch": worktree.get("branch", "")},
        })
    return found


def parse_header(text: str) -> tuple[str | None, str | None]:
    status = verified = None
    for line in text.splitlines()[:HEADER_SCAN_LINES]:
        if status is None and (match := HEADER_STATUS.match(line)):
            status = match.group(1)
        if verified is None and (match := HEADER_VERIFIED.match(line)):
            verified = match.group(1)
    return status, verified


def days_between(earlier: str | None, today: date) -> int | None:
    try:
        return (today - date.fromisoformat(earlier)).days if earlier else None
    except ValueError:
        return None


def checklist_counts(text: str) -> tuple[int, int]:
    boxes = [match.group(1) for line in text.splitlines() if (match := CHECKBOX.match(line))]
    return sum(1 for box in boxes if box != " "), len(boxes)


def phrase_counts(text: str, phrases: list[str]) -> dict[str, int]:
    counts = {}
    for phrase in phrases:
        hits = len(re.findall(rf"\b{re.escape(phrase)}\b", text, re.IGNORECASE))
        if hits:
            counts[phrase] = hits
    return counts


def build_reference_index(inventory: Inventory, texts: dict[str, str]) -> dict[str, set[str]]:
    """Map a bare filename to the files that mention it, from one pass over the text."""
    index: dict[str, set[str]] = {}
    for relative, text in texts.items():
        for token in set(FILENAME_TOKEN.findall(text)):
            index.setdefault(token, set()).add(relative)
    return index


def in_doc_roots(relative: str, roots: list[str]) -> bool:
    return not roots or any(relative == root or relative.startswith(root.rstrip("/") + "/") for root in roots)


def in_archive(relative: str, archive_convention: str) -> bool:
    """True under the configured archive folder, or any folder named archive."""
    prefix = archive_convention.split("<")[0]
    return bool(prefix and relative.startswith(prefix)) or "archive" in relative.split("/")[:-1]


def find_doc_health(inventory: Inventory, today: date) -> list[dict]:
    config = inventory.config
    docs = [r for r in inventory.files
            if r.lower().endswith(".md") and in_doc_roots(r, config["doc_roots"])]
    texts = {}
    for relative in inventory.files:
        path = inventory.root / relative
        if relative in inventory.tracked or relative in docs:
            try:
                if path.stat().st_size <= MAX_REFERENCE_FILE_BYTES and looks_like_text(path):
                    texts[relative] = read_text(path)
            except OSError:
                continue
    index = build_reference_index(inventory, texts)
    changed = last_change_dates(inventory.root, {d for d in docs if d in inventory.tracked})
    found = []
    for relative in docs:
        text = texts.get(relative) or read_text(inventory.root / relative)
        name = relative.rsplit("/", 1)[-1]
        referrers = sorted(index.get(name, set()) - {relative})
        status, verified = parse_header(text)
        ticked, total = checklist_counts(text)
        found.append(make_candidate(
            inventory, relative, "doc_health",
            status=status, last_verified=verified,
            days_since_verified=days_between(verified, today),
            last_git_change=changed.get(relative),
            days_since_git_change=days_between(changed.get(relative), today),
            inbound_references=len(referrers), referenced_by=referrers[:5],
            checklist_ticked=ticked, checklist_total=total,
            in_archive=in_archive(relative, config["archive_convention"]),
            one_time_phrases=phrase_counts(text, config["one_time_phrases"]),
        ))
    return found


def directory_size(path: Path, entry_cap: int) -> tuple[int, bool]:
    """Total file bytes below path, stopping after entry_cap entries."""
    total, seen, pending = 0, 0, [path]
    while pending:
        try:
            with os.scandir(pending.pop()) as entries:
                for entry in entries:
                    seen += 1
                    if seen > entry_cap:
                        return total, True
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
        except OSError:
            continue
    return total, False


def find_git_state(inventory: Inventory) -> list[dict]:
    found = []
    for entry in sorted(list_untracked_collapsed(inventory.root)):
        relative = entry.rstrip("/")
        if inventory.is_excluded(relative + "/x") or relative.split("/")[0] in inventory.config["exclude_dirs"]:
            continue
        found.append(make_candidate(inventory, relative, "git_state", kind="untracked"))
    ignored_paths = sorted(inventory.ignored_dirs | {f for f in inventory.ignored_files if "/" not in f})
    # Report the outermost ignored folder only; its size already includes nested ones.
    ignored_paths = [p for p in ignored_paths if not any(p.startswith(o + "/") for o in ignored_paths)]
    for relative in ignored_paths:
        path = inventory.root / relative
        if path.is_dir():
            size, truncated = directory_size(path, inventory.config["size_scan_entry_cap"])
            signals = {"kind": "ignored_directory", "size_bytes": size, "size_is_lower_bound": truncated}
        elif path.exists():
            signals = {"kind": "ignored_file", "size_bytes": path.stat().st_size}
        else:
            continue
        found.append(make_candidate(inventory, relative, "git_state", **signals))
    return found


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def build_report(project: Path, config: dict, today: date, only: str | None) -> dict:
    root = git_root(project)
    inventory = Inventory(root, config)
    builders = {
        "loose_root_file": lambda: find_loose_root_files(inventory),
        "remnant_pattern": lambda: find_remnants(inventory),
        "doc_health": lambda: find_doc_health(inventory, today),
        "git_state": lambda: find_git_state(inventory),
    }
    candidates = {name: build() for name, build in builders.items() if only in (None, name)}
    return {
        "project": str(root),
        "generated": today.isoformat(),
        "config_file": config.get("_config_file"),
        "archive_convention": config["archive_convention"],
        "doc_header_convention": config["doc_header_convention"],
        "protected_paths": config["protected_paths"],
        "post_checks": config["post_checks"],
        "stale_days": config["stale_days"],
        "counts": {name: len(items) for name, items in candidates.items()},
        "candidates": candidates,
    }


def doc_signal_count(candidate: dict, stale_days: int) -> int:
    signals = candidate["signals"]
    if signals["in_archive"]:
        return 0
    age = signals["days_since_git_change"]
    return sum([
        signals["inbound_references"] == 0,
        bool(signals["one_time_phrases"]),
        signals["checklist_total"] > 0 and signals["checklist_ticked"] == signals["checklist_total"],
        age is not None and age > stale_days,
        # A doc still claiming to be current long after its last verification
        # is the commonest misleading leftover.
        (signals.get("days_since_verified") or 0) > stale_days,
        # Root-level docs are read first by every agent, so they rank higher.
        "/" not in candidate["path"],
    ])


def sort_for_display(category: str, items: list[dict], stale_days: int) -> list[dict]:
    if category == "doc_health":
        return sorted(items, key=lambda c: (-doc_signal_count(c, stale_days), c["path"]))
    if category == "git_state":
        return sorted(items, key=lambda c: (-c["signals"].get("size_bytes", 0), c["path"]))
    if category == "remnant_pattern":
        return sorted(items, key=lambda c: (
            REMNANT_KIND_ORDER.index(c["signals"]["kind"]), c["state"] == "ignored", c["path"]))
    return sorted(items, key=lambda c: c["path"])


def human_size(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f}{unit}" if unit == "B" else f"{value:.1f}{unit}"
        value /= 1024
    return str(size)


def describe(candidate: dict) -> str:
    """One-line signal summary for a table cell."""
    signals = candidate["signals"]
    category = candidate["category"]
    if category == "doc_health":
        parts = [f"status={(signals['status'] or '-')[:60]}", f"verified={signals['last_verified'] or '-'}"]
        if signals["days_since_verified"] is not None:
            parts.append(f"verified_age={signals['days_since_verified']}d")
        if signals["in_archive"]:
            parts.append("archived")
        parts.append(f"changed_age={signals['days_since_git_change']}d"
                     if signals["days_since_git_change"] is not None else "changed_age=-")
        parts.append(f"refs={signals['inbound_references']}")
        if signals["checklist_total"]:
            parts.append(f"checklist={signals['checklist_ticked']}/{signals['checklist_total']}")
        if signals["one_time_phrases"]:
            parts.append("phrases=" + ",".join(f"{k}x{v}" for k, v in signals["one_time_phrases"].items()))
        return "; ".join(parts)
    if category == "remnant_pattern":
        kind = signals["kind"]
        if kind == "name_pattern":
            return "pattern " + ",".join(signals["patterns"])
        if kind == "duplicate":
            return "duplicate of " + ", ".join(signals["duplicates"][:3])
        if kind == "prunable_worktree":
            return f"prunable: {signals['reason']}"
        return kind
    if category == "git_state":
        size = signals.get("size_bytes")
        if size is not None:
            bound = ">=" if signals.get("size_is_lower_bound") else ""
            return f"{signals['kind']} {bound}{human_size(size)}"
        return signals["kind"]
    return ""


def render_markdown(report: dict, max_rows: int) -> str:
    lines = [
        "# Repo audit",
        "",
        f"- Project: `{report['project']}`",
        f"- Generated: {report['generated']}",
        f"- Config: {report['config_file'] or 'defaults'}",
        f"- Archive convention: {report['archive_convention'] or '(not set)'}",
        f"- Doc header convention: {report['doc_header_convention']}",
        f"- Protected paths: {', '.join(report['protected_paths'])}",
        f"- Post checks: {', '.join(report['post_checks']) or '(none configured)'}",
        "",
        "## Summary",
        "",
    ]
    lines += [f"- {name}: {count}" for name, count in report["counts"].items()]
    for category, items in report["candidates"].items():
        if not items:
            continue
        ordered = sort_for_display(category, items, report["stale_days"])
        note = " (sorted by number of signals)" if category == "doc_health" else ""
        lines += ["", f"## {category}{note}", "", "| Path | State | Protected | Signals |", "|---|---|---|---|"]
        for candidate in ordered[:max_rows]:
            protected = "yes" if candidate["protected"] else ""
            lines.append(f"| `{candidate['path']}` | {candidate['state']} | {protected} | {describe(candidate)} |")
        if len(ordered) > max_rows:
            lines.append(f"\n{len(ordered) - max_rows} more not shown; use --format json or --only {category}.")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Read-only scan for repo cleanup candidates.")
    parser.add_argument("--project", type=Path, default=Path.cwd(), help="repo to scan (default: cwd)")
    parser.add_argument("--config", type=Path, help="prune config (default: <project>/tools/context-notepad/prune.config.json)")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--only", choices=CATEGORIES, help="report one category")
    args = parser.parse_args(argv)

    project = git_root(args.project.expanduser())
    config = load_audit_config(args.config.expanduser() if args.config else None, project)
    report = build_report(project, config, date.today(), args.only)
    if args.format == "json":
        json.dump(report, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        # A single category with --only gets the whole table.
        max_rows = 10**9 if args.only else config["max_rows_per_category"]
        sys.stdout.write(render_markdown(report, max_rows))


if __name__ == "__main__":
    main()
