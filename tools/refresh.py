#!/usr/bin/env python3
"""The daily chain that keeps derived data fresh without spending agent tokens.

Steps, in order (each runs even if an earlier one printed warnings):
    1. git_history.py snapshot           every project's companies/<slug>/git/snapshot.json
    2. portfolio.py pulse --quiet        holding/pulse.json
    3. footprint.py scan --all [--probe] companies/<slug>/footprint.json
    4. hygiene.py scan --all             companies/<slug>/hygiene.json
    5. recheck.py scan --all             flags open questions (threads awaiting the owner, builds in review, card blocker
                                         and next) asked before their repos' newest commits: `recheck_commits` and
                                         `recheck_since`, or `recheck` inside the card line. No agents here; the
                                         agent recheck is `recheck.py run`, started by the owner from the Board
    6. card.py refresh --all             derived keys of companies/<slug>/card.json (`recheck` counts the flags)
    7. mark stale                        a thread awaiting the owner whose newest message is older than 14 days, and a
                                         build in review or approved untouched for 14 days, get `status: "stale"`
                                         and a `stale_since` line. Nothing else in the file changes; nothing is
                                         deleted.

With --commit, files changed under companies/ and holding/ (none over 1 MB; skipped ones are printed) are committed
as "refresh YYYY-MM-DD" and pushed to origin main. Exits non-zero only when a step crashes.

Usage:
    refresh.py [--commit] [--probe]
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import card  # noqa: E402
import footprint  # noqa: E402
import paths  # noqa: E402
import rules  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
TOOLS = paths.CODE / "tools"
STALE_DAYS = 14
MAX_COMMIT_BYTES = 1_000_000
COMMIT_DIRS = ("companies", "holding")
MAX_SCAN_BYTES = 1_000_000
SECRET_RES = [re.compile(p) for p in (
    r"mongodb(\+srv)?://[^\s/]*:[^\s/]*@", r"AKIA[0-9A-Z]{16}", r"sk_(live|test)_[0-9A-Za-z]{8,}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----", r"ghp_[0-9A-Za-z]{20,}", r"xox[baprs]-[0-9A-Za-z-]{10,}")]
SECRET_RES.append(re.compile(r"(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}", re.I))


def secret_like(full: Path) -> bool:
    """True when a text file up to 1 MB contains a credential-looking string."""
    try:
        if not full.is_file() or full.stat().st_size > MAX_SCAN_BYTES:
            return False
        data = full.read_bytes()
    except OSError:
        return False
    if b"\0" in data:
        return False
    text = data.decode("utf-8", "replace")
    return any(rx.search(text) for rx in SECRET_RES)


def today() -> dt.date:
    return dt.date.today()


def as_date(value) -> dt.date | None:
    if isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value):
        try:
            return dt.date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def set_stale(path: Path, on: dt.date) -> None:
    """Rewrite only the front matter's status line and add stale_since right after it."""
    text = path.read_text()
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    if not m:
        return
    lines = m.group(1).split("\n")
    out = []
    for line in lines:
        if line.startswith("stale_since:"):
            continue
        if line.startswith("status:"):
            out += ['status: "stale"', f'stale_since: "{on.isoformat()}"']
        else:
            out.append(line)
    path.write_text("---\n" + "\n".join(out) + "\n---" + text[m.end():])


def mark_stale(root: Path, on: dt.date | None = None) -> list[str]:
    on = on or today()
    cutoff = on - dt.timedelta(days=STALE_DAYS)
    marked = []
    for t in sorted((root / "companies").glob("*/threads/*/thread.md")):
        meta = card.frontmatter(t)
        if meta.get("status") not in ("awaiting-alex", "awaiting-owner"):
            continue
        dates = [d for d in (as_date(card.frontmatter(m).get("date"))
                             for m in t.parent.glob("[0-9][0-9][0-9]-*.md")) if d]
        newest = max(dates) if dates else as_date(meta.get("updated")) or as_date(meta.get("started"))
        if newest and newest < cutoff:
            set_stale(t, on)
            marked.append(str(t.relative_to(root)))
    for b in sorted((root / "companies").glob("*/builds/*/build.md")):
        meta = card.frontmatter(b)
        if meta.get("status") not in ("review", "approved"):
            continue
        newest = as_date(meta.get("updated")) or as_date(meta.get("approved")) or as_date(meta.get("created"))
        if newest and newest < cutoff:
            set_stale(b, on)
            marked.append(str(b.relative_to(root)))
    return marked


def step(label: str, args: list[str]) -> bool:
    """Run one tool; print its warnings and a short tail; False only when it crashed."""
    out = subprocess.run([sys.executable, *args], capture_output=True, text=True, env={**os.environ,
                         "MASTER_REPO_ROOT": str(ROOT)}, cwd=str(ROOT))
    lines = (out.stdout + out.stderr).strip().splitlines()
    noteworthy = [ln for ln in lines if re.search(r"warn|not found|error|refused|traceback", ln, re.I)]
    status = "ok" if out.returncode == 0 else f"FAILED (exit {out.returncode})"
    print(f"{label}: {status}, {len(lines)} lines of output")
    for ln in (noteworthy if out.returncode == 0 else lines[-15:])[:15]:
        print(f"    {ln}")
    return out.returncode == 0


def git(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=check)


def commit(on: dt.date) -> str:
    listing = git("status", "--porcelain", "-z", "--untracked-files=all", "--", *COMMIT_DIRS).stdout
    entries = [e for e in listing.split("\0") if e]
    files, skipped, i = [], [], 0
    while i < len(entries):
        code, path = entries[i][:2], entries[i][3:]
        if code.startswith("R") or code.startswith("C"):
            i += 1  # the rename's source path follows; the new path is the one staged
        i += 1
        full = ROOT / path
        if footprint.private(Path(path).name) or secret_like(full):
            print(f"skipped (secret-like): {path}")
            continue
        if full.is_file() and full.stat().st_size > MAX_COMMIT_BYTES:
            skipped.append(f"{path} ({full.stat().st_size // 1024} KB)")
            continue
        files.append(path)
    for s in skipped:
        print(f"    skipped, over 1 MB: {s}")
    if not files:
        return "nothing to commit"
    git("add", "-A", "--", *files, check=True)
    msg = f"refresh {on.isoformat()}"
    done = git("commit", "-q", "-m", msg, "--only", "--", *files)
    if done.returncode != 0:
        return f"commit failed: {(done.stderr or done.stdout).strip()[:200]}"
    push = git("push", "-q", "origin", "main")
    return f"committed {len(files)} files as '{msg}'" + ("" if push.returncode == 0 else
                                                          f"; push failed: {push.stderr.strip()[:200]}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--commit", action="store_true", help="commit companies/ and holding/ changes and push to main")
    p.add_argument("--probe", action="store_true", help="let footprint.py HEAD-request public links")
    a = p.parse_args(argv)
    t = str(TOOLS)
    steps = [
        ("snapshot", [f"{t}/git_history.py", "snapshot"]),
        ("pulse", [f"{t}/portfolio.py", "pulse", "--quiet"]),
        ("footprint", [f"{t}/footprint.py", "scan", "--all", *(["--probe"] if a.probe else [])]),
        ("hygiene", [f"{t}/hygiene.py", "scan", "--all"]),
        ("recheck", [f"{t}/recheck.py", "scan", "--all"]),  # before cards, so their `recheck` count is today's
        ("cards", [f"{t}/card.py", "refresh", "--all"]),
    ]
    crashed = [label for label, args in steps if not step(label, args)]
    try:
        marked = mark_stale(ROOT)
        print(f"stale: {len(marked)} marked")
        for m in marked:
            print(f"    {m}")
    except Exception as e:  # noqa: BLE001 — report and carry on to the summary
        crashed.append("stale")
        marked = []
        print(f"stale: FAILED ({e})")
    if marked and "cards" not in crashed:  # owes counts change when a thread or build goes stale
        step("cards again", [f"{t}/card.py", "refresh", "--all"])
    print(rules.audit(ROOT)["summary"] + "; " + rules.condensation(ROOT, today()))
    result = commit(today()) if a.commit else "not committed (no --commit)"
    print(f"refresh {today().isoformat()}: {len(steps) + 1 - len(crashed)}/{len(steps) + 1} steps ok"
          f"{', crashed: ' + ', '.join(crashed) if crashed else ''}; {len(marked)} marked stale; {result}")
    return 1 if crashed else 0


if __name__ == "__main__":
    sys.exit(main())
