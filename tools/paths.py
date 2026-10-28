"""Where Master-Repo's code and data live, in one place for every tool.

CODE is this checkout: tools/, agents/ and app/ travel together. ROOT is the data directory (companies/, holding/,
identity/, skills/, queue/, guide/): MASTER_REPO_ROOT when set, otherwise the checkout itself, as before. The app
passes its own resolved root to every Python call through the same variable, so both sides read the same files.
See DATA.md for the layout.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

CODE = Path(__file__).resolve().parent.parent


def data_root() -> Path:
    env = os.environ.get("MASTER_REPO_ROOT", "").strip()
    return Path(env).expanduser().resolve() if env else CODE


ROOT = data_root()


def agents_dir(root: Path | None = None) -> Path:
    """Role prompts: the data directory's own agents/ if it has one, otherwise the ones that ship with the tools."""
    own = (root or ROOT) / "agents"
    return own if own.is_dir() else CODE / "agents"


def tools_ref() -> str:
    """How an agent running in the data directory calls a tool: `tools` when code and data share a folder."""
    return "tools" if ROOT == CODE else str(CODE / "tools")


def owner(root: Path | None = None) -> dict:
    """local/owner.json: {"name": display name, "emails": [...], "handles": [...]}; optional "short" overrides the first name. Missing → neutral words."""
    try:
        data = json.loads(((root or ROOT) / "local" / "owner.json").read_text())
    except (OSError, ValueError):
        data = {}
    data = data if isinstance(data, dict) else {}
    name = data.get("name") if isinstance(data.get("name"), str) and data["name"].strip() else ""
    short = data.get("short") if isinstance(data.get("short"), str) and data["short"].strip() else ""
    return {"name": name.strip() or "Owner", "short": short.strip() or (name.split()[0] if name.strip() else "You")}


def owner_identities(root: Path | None = None) -> list[str]:
    """Emails and handles used to recognize the owner's commits and remotes."""
    file = (root or ROOT) / "local" / "owner.json"
    try:
        data = json.loads(file.read_text())
        values = [value.strip() for key in ("emails", "handles") for value in data.get(key, [])
                  if isinstance(value, str) and value.strip()]
    except (OSError, ValueError, AttributeError, TypeError):
        values = []
    if not values:
        raise SystemExit(f"Configure emails and handles in {file}; copy local/owner.example.json to get started.")
    return values


# Agents read the owner's repos with git. `git branch` also creates, renames and deletes, and git accepts bundled
# short flags (-vD) and shortened long ones (--del), so its allows are exact commands with no wildcard. Filtered
# listing (--contains, --merged, patterns) goes through git for-each-ref, which only reads.
GIT_BRANCH_READ = [f"Bash(git branch{args})" for args in
                   ("", " -a", " -r", " -v", " -vv", " -a -v", " -av", " -avv", " -a -vv", " --show-current",
                    " --list", " -a --list")] + ["Bash(git for-each-ref:*)"]
# Belt and braces over any broader allow: writing flags anywhere in a branch command, file output, redirects.
GIT_DENY = [f"Bash(git branch*{flag}*)" for flag in
            (" -d", " -D", " -m", " -M", " -c", " -C", " -f", " -u", " --delete", " --move", " --copy", " --force",
             " --set-upstream", " --unset-upstream", " --edit-description", " --track", " --no-track")] + [
            "Bash(* --output*)", "Bash(*>*)"]
