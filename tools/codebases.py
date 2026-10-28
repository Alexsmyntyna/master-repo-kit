#!/usr/bin/env python3
"""Every codebase in the owner’s code folder, whether or not it is a project here or on GitHub.

    codebases.py scan      write holding/codebases/index.json (facts from git and the file tree)
    codebases.py list      print it: kind, last commit, commits, tracked-by, name

Kinds: own (the owner wrote it), fork (someone else's repo the owner committed to), clone (someone else's, untouched),
folder (not a git repo). Agents read each own codebase and write holding/codebases/<slug>.md: what it is, what
is worth learning or reusing, and a verdict (revive, parts, reference, archive). The app shows both on /codebases.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
from collections import Counter
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
FOLDER = Path.home() / "Documents" / "GitHub"
OUT = ROOT / "holding" / "codebases"
SKIP = {"node_modules", ".git", "venv", ".venv", "dist", "build", ".next", "target", "__pycache__", "Pods", "DerivedData"}
CODE = {".py", ".ts", ".tsx", ".js", ".jsx", ".swift", ".rs", ".go", ".kt", ".java", ".lua", ".c", ".cpp", ".h",
        ".cs", ".rb", ".php", ".html", ".css", ".svelte", ".vue", ".dart", ".sh", ".ipynb", ".m"}


def git(path: Path, *args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def tracked() -> dict[str, str]:
    """Repo path → project slug, for codebases that already are projects."""
    out = {}
    for f in (ROOT / "companies").glob("*/company.json"):
        for r in json.loads(f.read_text()).get("repos", []):
            p = r.get("path") if isinstance(r, dict) else r
            if p:
                out[os.path.realpath(os.path.expanduser(p))] = f.parent.name
    return out


def tree(path: Path) -> tuple[Counter, int, float]:
    """Code files by extension, how many, and the newest modification time (for folders without git)."""
    langs: Counter = Counter()
    files, newest = 0, 0.0
    for base, dirs, names in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP and not d.startswith(".")]
        if base.count(os.sep) - str(path).count(os.sep) > 6:
            dirs[:] = []
        for n in names:
            ext = os.path.splitext(n)[1].lower()
            if ext in CODE:
                langs[ext] += 1
                files += 1
                try:
                    newest = max(newest, os.path.getmtime(os.path.join(base, n)))
                except OSError:
                    pass
    return langs, files, newest


def readme_line(path: Path) -> str:
    for name in ("README.md", "readme.md", "README", "README.txt"):
        f = path / name
        if f.is_file():
            for line in f.read_text(errors="ignore").splitlines():
                line = line.strip().lstrip("#").strip()
                if len(line) > 3 and not line.startswith(("!", "<", "[", "```")):
                    return line[:160]
    return ""


def code_folder(root: Path | None = None) -> Path:
    owner_file = (root or ROOT) / "local/owner.json"
    owner = json.loads(owner_file.read_text()) if owner_file.is_file() else {}
    return Path(owner.get("code_dir") or FOLDER).expanduser().resolve()


def scan_one(path: Path, owners: dict[str, str], root: Path | None = None, inventory: bool = True) -> dict:
    real = os.path.realpath(path)
    project = owners.get(real) or next((s for p, s in owners.items() if p.startswith(real + "/")), "")
    langs, files, newest = tree(path) if inventory else (Counter(), 0, 0.0)
    entry = {
        "name": path.name, "slug": slugify(path.name), "path": str(path), "project": project,
        "readme": readme_line(path) if inventory else "", "files": files,
        "languages": [e.lstrip(".") for e, _ in langs.most_common(4)],
    }
    if not (path / ".git").exists():
        entry |= {"kind": "folder", "commits": 0, "mine": 0, "remote": "",
                  "last": dt.date.fromtimestamp(newest).isoformat() if newest else "", "first": "", "days": {}}
        return entry
    identity = re.compile("|".join(re.escape(value) for value in paths.owner_identities(root or ROOT)), re.I)
    remote = git(path, "remote", "get-url", "origin")
    authors = git(path, "log", "--format=%ae %an").splitlines()
    mine = sum(1 for a in authors if identity.search(a))
    owner = (re.search(r"github\.com[:/]([^/]+)/", remote) or [None, ""])[1]
    own_remote = not remote or bool(identity.search(owner))
    kind = "own" if own_remote and (mine or not authors) else "fork" if mine else "clone"
    since = (dt.date.today() - dt.timedelta(days=120)).isoformat()
    days = Counter(git(path, "log", f"--since={since}", "--format=%ad", "--date=short").split())
    entry |= {
        "kind": kind, "remote": remote, "commits": len(authors), "mine": mine,
        "first": git(path, "log", "--reverse", "--format=%ad", "--date=short").split("\n", 1)[0],
        "last": git(path, "log", "-1", "--format=%ad", "--date=short"),
        "days": dict(sorted(days.items())),
    }
    return entry


def scan() -> list[dict]:
    paths.owner_identities(ROOT)
    owners = tracked()
    folder = code_folder()
    entries = [scan_one(p, owners) for p in sorted(folder.iterdir(), key=lambda p: p.name.lower())
               if p.is_dir() and not p.name.startswith(".") and p.resolve() != ROOT]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(
        {"generated": dt.date.today().isoformat(), "folder": str(folder), "codebases": entries}, indent=2) + "\n")
    return entries


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["scan", "list"])
    args = ap.parse_args()
    entries = scan() if args.cmd == "scan" else json.loads((OUT / "index.json").read_text())["codebases"]
    for e in sorted(entries, key=lambda e: (e["kind"], e["last"]), reverse=True):
        print(f"{e['kind']:6} {e['last'] or '-':10} {e['commits']:>6} {e['project'] or '':22} {e['name']}")


if __name__ == "__main__":
    main()
