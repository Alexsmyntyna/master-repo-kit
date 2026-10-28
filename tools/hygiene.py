#!/usr/bin/env python3
"""How tidy each project repo is: stray files at the root, agent-file size, the Master-Repo pointer, loose git state.

Read-only on project repos: it lists the root folder, counts lines in CLAUDE.md and AGENTS.md, and runs read-only
git (`status --porcelain`, `log -1 -- CLAUDE.md`, `for-each-ref`). Nothing is written to a project repo.

Writes companies/<slug>/hygiene.json (two-space JSON, unknown keys kept), one entry per repo plus totals and a
score:
    good  no stray root files, every agent file under 150 lines, pointer in place
    poor  5+ stray root files, or an agent file over 400 lines, or the pointer missing
    fair  anything in between
`reasons` says why.

Usage:
    hygiene.py scan <slug>
    hygiene.py scan --all
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import footprint  # noqa: E402  (shared JSON and company helpers)
import paths  # noqa: E402
import pointer  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)

KEEP_MD = {"README.md", "CLAUDE.md", "AGENTS.md", "MASTER-REPO.md", "CONTRIBUTING.md", "LICENSE.md", "CHANGELOG.md",
           "SECURITY.md", "CODE_OF_CONDUCT.md"}
KEEP_OTHER = {"index.html", "404.html", "robots.txt", "llms.txt", "LICENSE.txt", "CMakeLists.txt", "humans.txt"}
STRAY_EXT = {".md", ".html", ".htm", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".heic", ".webp", ".pdf", ".log",
             ".mov", ".mp4", ".zip", ".csv", ".bak", ".orig", ".rej"}
SCREENSHOT_RE = re.compile(r"screen ?shot|screenshot|simulator screen|^img_\d+", re.I)
GOOD_LINES, POOR_LINES, POOR_STRAY = 150, 400, 5
STALE_BRANCH_DAYS = 60


def git(repo: Path, *args: str) -> str:
    out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, errors="replace")
    return out.stdout if out.returncode == 0 else ""


def stray(name: str) -> bool:
    if name.startswith(".") or name in KEEP_MD or name in KEEP_OTHER:
        return False
    if re.fullmatch(r"requirements[\w.-]*\.txt", name):
        return False
    return Path(name).suffix.lower() in STRAY_EXT or bool(SCREENSHOT_RE.search(name))


def line_count(path: Path) -> int:
    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def default_branch(repo: Path) -> str:
    ref = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").strip()
    if ref:
        return ref.split("/", 1)[1]
    names = git(repo, "for-each-ref", "refs/heads", "--format=%(refname:short)").split()
    return next((b for b in ("main", "master") if b in names), git(repo, "branch", "--show-current").strip() or "HEAD")


def pointer_ok(repo: Path) -> bool:
    if not (repo / pointer.FILE_NAME).is_file():
        return False
    for name in ("CLAUDE.md", "AGENTS.md"):
        p = repo / name
        if p.is_file():
            try:
                if pointer.START in p.read_text(errors="replace"):
                    return True
            except OSError:
                pass
    return False


def scan_repo(repo: Path, today: dt.date | None = None) -> dict:
    today = today or dt.date.today()
    top = Path(git(repo, "rev-parse", "--show-toplevel").strip() or repo)
    try:
        names = sorted(p.name for p in top.iterdir() if p.is_file() and not p.is_symlink())
    except OSError:
        names = []
    strays = [n for n in names if stray(n)]
    lines, last_edit = {}, None
    for name in ("CLAUDE.md", "AGENTS.md"):
        p = top / name
        lines[name] = line_count(p) if p.is_file() else 0
        if p.is_file():
            d = git(top, "log", "-1", "--format=%ad", "--date=short", "--", name).strip()
            if d and (last_edit is None or d > last_edit):
                last_edit = d
    status = git(top, "status", "--porcelain").splitlines()
    untracked = sum(1 for ln in status if ln.startswith("??"))
    main = default_branch(top)
    branches, stale = 0, 0
    for ln in git(top, "for-each-ref", "refs/heads", "--format=%(refname:short)\x1f%(committerdate:short)").splitlines():
        name, _, date = ln.partition("\x1f")
        if name == main:
            continue
        branches += 1
        try:
            if (today - dt.date.fromisoformat(date)).days > STALE_BRANCH_DAYS:
                stale += 1
        except ValueError:
            pass
    return {"repo": str(top), "stray_root_files": len(strays), "stray": strays,
            "claude_md_lines": lines["CLAUDE.md"], "agents_md_lines": lines["AGENTS.md"],
            "agent_files_last_edit": last_edit, "pointer_ok": pointer_ok(top),
            "untracked": untracked, "modified": len(status) - untracked,
            "branches": branches, "stale_branches": stale,
            "agent_files_linked": (top / "CLAUDE.md").is_file() and (top / "AGENTS.md").is_file()
            and (top / "CLAUDE.md").resolve() == (top / "AGENTS.md").resolve()}


def score(r: dict) -> tuple[str, list[str]]:
    reasons, poor = [], False
    biggest = max(r["claude_md_lines"], r["agents_md_lines"])
    if r["stray_root_files"]:
        n = r["stray_root_files"]
        reasons.append(f"{n} stray root file{'s' if n != 1 else ''}")
        poor |= r["stray_root_files"] >= POOR_STRAY
    files = (("claude_md_lines", "CLAUDE.md"), ("agents_md_lines", "AGENTS.md"))
    if r.get("agent_files_linked"):  # one file under two names (a symlink): judge it once
        files = (("claude_md_lines", "CLAUDE.md = AGENTS.md"),)
    for key, label in files:
        if r[key] >= GOOD_LINES:
            reasons.append(f"{label} {r[key]} lines")
            poor |= r[key] > POOR_LINES
    if not r["pointer_ok"]:
        reasons.append("Master-Repo pointer missing")
        poor = True
    if poor:
        return "poor", reasons
    good = not r["stray_root_files"] and biggest < GOOD_LINES and r["pointer_ok"]
    return ("good" if good else "fair"), reasons


def scan(slug: str, root: Path | None = None) -> dict:
    root = root or ROOT
    model = footprint.company(slug, root)
    rel = f"companies/{slug}/hygiene.json"
    old = footprint.read_json(rel, root, {}) or {}
    repos, warnings = [], []
    for repo in footprint.repo_paths(model):
        # A repo entry with a subdir still has its agent files and root at the repository's top level.
        if not repo.is_dir() or not git(repo, "rev-parse", "--git-dir"):
            warnings.append(f"repo not found or not a git repo: {repo}")
            continue
        r = scan_repo(repo)
        if any(x["repo"] == r["repo"] for x in repos):
            continue
        r["score"], r["reasons"] = score(r)
        repos.append(r)
    out = dict(old)
    if repos:
        total = {
            "stray_root_files": sum(r["stray_root_files"] for r in repos),
            "claude_md_lines": max(r["claude_md_lines"] for r in repos),
            "agents_md_lines": max(r["agents_md_lines"] for r in repos),
            "agent_files_last_edit": max((r["agent_files_last_edit"] for r in repos if r["agent_files_last_edit"]), default=None),
            "pointer_ok": all(r["pointer_ok"] for r in repos),
            "untracked": sum(r["untracked"] for r in repos), "modified": sum(r["modified"] for r in repos),
            "stale_branches": sum(r["stale_branches"] for r in repos),
        }
        ranks = {"good": 0, "fair": 1, "poor": 2}
        total["score"] = max((r["score"] for r in repos), key=ranks.get)
        total["reasons"] = [f"{Path(r['repo']).name}: {x}" if len(repos) > 1 else x for r in repos for x in r["reasons"]]
    else:
        total = {"stray_root_files": None, "claude_md_lines": None, "agents_md_lines": None,
                 "agent_files_last_edit": None, "pointer_ok": None, "untracked": None, "modified": None,
                 "stale_branches": None, "score": None, "reasons": ["no repo to check"]}
    out.update({"slug": slug, **total, "repos": repos, "scanned_at": dt.date.today().isoformat()})
    if warnings:
        out["warnings"] = warnings
    else:
        out.pop("warnings", None)
    footprint.write_json(rel, out, root)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan", help="write companies/<slug>/hygiene.json from a read-only look at its repos")
    s.add_argument("slug", nargs="?")
    s.add_argument("--all", action="store_true", help="every project")
    a = p.parse_args(argv)
    if bool(a.slug) == a.all:
        p.error("give a slug or --all")
    if not a.all and not (ROOT / "companies" / a.slug / "company.json").is_file():
        p.error(f"no companies/{a.slug}/company.json")
    for slug in footprint.all_slugs(ROOT) if a.all else [a.slug]:
        h = scan(slug)
        note = f"  ({'; '.join(h['warnings'])})" if h.get("warnings") else ""
        print(f"{slug:22} {h['score'] or '-':5} {', '.join(h['reasons']) or 'clean'}{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
