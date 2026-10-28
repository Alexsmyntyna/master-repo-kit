#!/usr/bin/env python3
"""Read-only git history tooling for Master-Repo.

Keeps a ledger of which commits an agent has already read for each project,
so readings aren't repeated, and produces compact Markdown digests (segments,
momentum, rework hotspots) for the commits that still need a look.

Nothing here writes to a project repo. The only writes are the ledger
(`companies/<slug>/git/ledger.json`) and report files when `--out` is given.

Usage (from the Master-Repo root):
    python3 tools/git_history.py status
    python3 tools/git_history.py segments camera-app [--unread]
    python3 tools/git_history.py report camera-app --unread [--out PATH]
    python3 tools/git_history.py report camera-app --segment a1b2c3d
    python3 tools/git_history.py mark camera-app --segment a1b2c3d --ref companies/camera-app/notes/x.md
    python3 tools/git_history.py weekly [--out PATH]
    python3 tools/git_history.py snapshot [slug...]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
FIX_RE = re.compile(r"\b(fix(e[sd])?|bug(s|fix)?|revert(ed|s)?|broken|hotfix|regression|crash(es)?|workaround)\b", re.I)
FEATURE_RE = re.compile(r"^(feat|add(s|ed)?|implement(s|ed)?|introduce[sd]?|new|build|create[sd]?|support)\b", re.I)
GAP_DAYS = 7          # a quiet stretch longer than this starts a new segment
MAX_SEGMENT = 120     # split very busy stretches so one reading stays digestible
DORMANT_DAYS = 60
SHA_LEN = 12
# Generated or vendored paths that drown out real work in counts and hotspots.
NOISE_RE = re.compile(r"(^|/)(build|DerivedData|node_modules|\.next|dist|out|Pods|xcuserdata|target|\.build)/"
                      r"|(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Podfile\.lock|\.pbxproj|\.xcscheme)$"
                      r"|\.(png|jpe?g|gif|heic|webp|mp4|mov|pdf|zip|ttf|otf|woff2?|ico|icns|car)$", re.I)
CODE_RE = re.compile(r"\.(swift|m|mm|kt|java|ts|tsx|js|jsx|mjs|py|rs|go|rb|php|c|cc|cpp|h|hpp|cs|vue|svelte|sql)$", re.I)


@dataclass
class Commit:
    sha: str
    date: dt.date
    subject: str
    files: list[tuple[str, int, int]] = field(default_factory=list)  # (path, added, deleted)

    @property
    def is_fix(self) -> bool:
        return bool(FIX_RE.search(self.subject))

    @property
    def is_feature(self) -> bool:
        return not self.is_fix and bool(FEATURE_RE.search(self.subject.split(":", 1)[-1].strip())) or self.subject.lower().startswith("feat")


@dataclass
class Repo:
    slug: str
    path: str
    subdir: str | None

    @property
    def key(self) -> str:
        return f"{self.path}::{self.subdir}" if self.subdir else self.path

    @property
    def label(self) -> str:
        name = Path(self.path).name
        return f"{name}/{self.subdir}" if self.subdir else name


# ---------------------------------------------------------------- loading

def project_repos(slug: str) -> list[Repo]:
    model = json.loads((ROOT / "companies" / slug / "company.json").read_text())
    return [Repo(slug, r["path"], r.get("subdir")) for r in model.get("repos") or [] if r.get("path")]


def all_slugs() -> list[str]:
    return sorted(p.parent.name for p in (ROOT / "companies").glob("*/company.json") if not p.parent.name.startswith("_"))


def load_commits(repo: Repo) -> list[Commit]:
    """Oldest-first, non-merge commits reachable from HEAD (limited to subdir if set)."""
    if not (Path(repo.path) / ".git").exists():
        return []
    cmd = ["git", "-C", repo.path, "log", "HEAD", "--no-merges", "--date-order", "--reverse",
           "--date=short", "--numstat", "--format=%x1e%H%x1f%ad%x1f%s"]
    if repo.subdir:
        cmd += ["--", repo.subdir]
    out = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if out.returncode != 0:
        return []
    commits = []
    for block in out.stdout.split("\x1e")[1:]:
        head, _, rest = block.partition("\n")
        sha, date, subject = head.split("\x1f", 2)
        c = Commit(sha[:SHA_LEN], dt.date.fromisoformat(date), subject.strip())
        for line in rest.splitlines():
            parts = line.split("\t")
            if len(parts) == 3:
                add, rem, path = parts
                if NOISE_RE.search(path):
                    continue
                c.files.append((path, int(add) if add.isdigit() else 0, int(rem) if rem.isdigit() else 0))
        commits.append(c)
    return commits


# ---------------------------------------------------------------- ledger

def ledger_path(slug: str) -> Path:
    return ROOT / "companies" / slug / "git" / "ledger.json"


def load_ledger(slug: str) -> dict:
    p = ledger_path(slug)
    return json.loads(p.read_text()) if p.exists() else {"repos": {}}


def save_ledger(slug: str, ledger: dict) -> None:
    p = ledger_path(slug)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ledger, indent=2) + "\n")


def read_shas(ledger: dict, repo: Repo) -> set[str]:
    return {s for r in ledger["repos"].get(repo.key, {}).get("readings", []) for s in r["commits"]}


def last_reading(ledger: dict, repo: Repo) -> dict | None:
    readings = ledger["repos"].get(repo.key, {}).get("readings", [])
    return max(readings, key=lambda r: r["date"]) if readings else None


# ---------------------------------------------------------------- segments

def segment(commits: list[Commit]) -> list[list[Commit]]:
    """Split into stretches of work separated by quiet gaps; cap very busy stretches."""
    segs: list[list[Commit]] = []
    for c in commits:
        if segs and (c.date - segs[-1][-1].date).days <= GAP_DAYS and len(segs[-1]) < MAX_SEGMENT:
            segs[-1].append(c)
        else:
            segs.append([c])
    return segs


def seg_id(seg: list[Commit]) -> str:
    return seg[0].sha[:7]  # stable: history only grows at the tail


def coverage(seg: list[Commit], read: set[str]) -> str:
    n = sum(c.sha in read for c in seg)
    return "read" if n == len(seg) else "unread" if n == 0 else f"partial {n}/{len(seg)}"


# ---------------------------------------------------------------- digest

def head_files(repo: Repo) -> set[str]:
    out = subprocess.run(["git", "-C", repo.path, "ls-files"], capture_output=True, text=True, errors="replace")
    return set(out.stdout.splitlines()) if out.returncode == 0 else set()


def top_dir(path: str, depth: int = 2) -> str:
    parts = path.split("/")
    return "/".join(parts[:depth]) if len(parts) > depth else "/".join(parts[:-1]) or "(root)"


def rework_hotspots(commits: list[Commit], limit: int = 8) -> list[tuple[str, int, int]]:
    """Files touched most by fix-style commits: (path, fix touches, all touches)."""
    fixes, touches = Counter(), Counter()
    for c in commits:
        for path, _, _ in c.files:
            touches[path] += 1
            if c.is_fix:
                fixes[path] += 1
    return [(p, n, touches[p]) for p, n in fixes.most_common(limit) if n >= 3]


def settled_files(commits: list[Commit], limit: int = 8) -> list[tuple[str, dt.date]]:
    """Substantial files that were written and then barely needed touching again."""
    first: dict[str, tuple[dt.date, int]] = {}
    touches = Counter()
    for c in commits:
        for path, add, _ in c.files:
            touches[path] += 1
            if path not in first:
                first[path] = (c.date, add)
    # Only files old enough to have had the chance to need rework.
    cutoff = commits[-1].date - dt.timedelta(days=30) if commits else dt.date.min
    picks = [(p, d, add) for p, (d, add) in first.items()
             if touches[p] <= 2 and add >= 80 and d <= cutoff and CODE_RE.search(p)]
    return [(p, d) for p, d, _ in sorted(picks, key=lambda x: -x[2])[:limit]]


def describe_segment(seg: list[Commit], status: str) -> list[str]:
    fixes = sum(c.is_fix for c in seg)
    added = sum(a for c in seg for _, a, _ in c.files)
    removed = sum(r for c in seg for _, _, r in c.files)
    days = len({c.date for c in seg})
    areas = Counter(top_dir(p) for c in seg for p, _, _ in c.files).most_common(5)
    hot = Counter(p for c in seg for p, _, _ in c.files).most_common(5)
    features = [c for c in seg if c.is_feature][:12]
    lines = [
        f"### Segment `{seg_id(seg)}` · {seg[0].date} → {seg[-1].date} · {status}",
        "",
        f"{len(seg)} commits over {days} active days · fix-style {fixes} ({fixes * 100 // len(seg)}%) · +{added} / −{removed} lines",
        "",
        "Areas: " + ", ".join(f"`{a}` ({n})" for a, n in areas) if areas else "Areas: none recorded",
        "",
        "Most-touched files: " + ", ".join(f"`{p}` ({n})" for p, n in hot) if hot else "",
    ]
    if features:
        lines += ["", "Feature-style commits:"] + [f"- {c.date} `{c.sha[:7]}` {c.subject}" for c in features]
    reverts = [c for c in seg if c.subject.lower().startswith("revert")]
    if reverts:
        lines += ["", "Reverts:"] + [f"- {c.date} `{c.sha[:7]}` {c.subject}" for c in reverts[:8]]
    lines += ["", "<details><summary>All commit subjects</summary>", ""]
    lines += [f"- {c.date} `{c.sha[:7]}` {c.subject}" for c in seg]
    lines += ["", "</details>", ""]
    return lines


def momentum(commits: list[Commit]) -> list[str]:
    months = Counter(c.date.strftime("%Y-%m") for c in commits)
    if not months:
        return []
    peak = max(months.values())
    first, last = commits[0].date, commits[-1].date
    out, cur = [], dt.date(first.year, first.month, 1)
    while cur <= last:
        key = cur.strftime("%Y-%m")
        n = months.get(key, 0)
        out.append(f"`{key}` {'█' * max(1 if n else 0, round(n / peak * 30)):<30} {n}")
        cur = dt.date(cur.year + cur.month // 12, cur.month % 12 + 1, 1)
    return out


def report(slug: str, only_unread: bool, seg_ids: list[str] | None) -> str:
    ledger = load_ledger(slug)
    out = [f"# Git digest: {slug}", "", f"Generated {dt.date.today()} by `tools/git_history.py`. Facts from git; interpretation is the reader's job.", ""]
    for repo in project_repos(slug):
        commits = load_commits(repo)
        out += [f"## {repo.label}", "", f"`{repo.path}`" + (f" (subdir `{repo.subdir}`)" if repo.subdir else ""), ""]
        if not commits:
            out += ["No git history found.", ""]
            continue
        read = read_shas(ledger, repo)
        out += [f"{len(commits)} commits, {commits[0].date} → {commits[-1].date}. Already read: {len(read & {c.sha for c in commits})}.", ""]
        out += ["**Momentum by month**", "", *[f"    {l}" for l in momentum(commits)], ""]
        hot = rework_hotspots(commits)
        if hot:
            out += ["**Rework hotspots** (whole history; files most touched by fix-style commits)", ""]
            out += [f"- `{p}`: {f} fix commits of {t} touches" for p, f, t in hot] + [""]
        settled = settled_files(commits)
        if settled:
            present = head_files(repo)
            out += ["**Written once, rarely touched** (worked first time, or abandoned; check which)", ""]
            out += [f"- `{p}` (first written {d}){'' if p in present else ' · no longer in HEAD'}" for p, d in settled] + [""]
        for seg in segment(commits):
            status = coverage(seg, read)
            if seg_ids and seg_id(seg) not in seg_ids:
                continue
            if only_unread and status == "read":
                continue
            out += describe_segment(seg, status)
    return "\n".join(out)


# ---------------------------------------------------------------- commands

def cmd_status(args) -> None:
    today = dt.date.today()
    rows = [("project", "repo", "commits", "read", "unread", "last commit", "idle days", "last reading")]
    for slug in args.slugs or all_slugs():
        ledger = load_ledger(slug)
        for repo in project_repos(slug):
            commits = load_commits(repo)
            if not commits:
                rows.append((slug, repo.label, "-", "-", "-", "no git", "-", "-"))
                continue
            read = read_shas(ledger, repo) & {c.sha for c in commits}
            lr = last_reading(ledger, repo)
            rows.append((slug, repo.label, str(len(commits)), str(len(read)), str(len(commits) - len(read)),
                         str(commits[-1].date), str((today - commits[-1].date).days), lr["date"] if lr else "never"))
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    for r in rows:
        print("  ".join(v.ljust(w) for v, w in zip(r, widths)))


def cmd_segments(args) -> None:
    ledger = load_ledger(args.slug)
    for repo in project_repos(args.slug):
        commits = load_commits(repo)
        read = read_shas(ledger, repo)
        print(f"{repo.label}: {len(commits)} commits")
        for seg in segment(commits):
            status = coverage(seg, read)
            if args.unread and status == "read":
                continue
            fixes = sum(c.is_fix for c in seg)
            print(f"  {seg_id(seg)}  {seg[0].date} → {seg[-1].date}  {len(seg):>4} commits  fix {fixes * 100 // len(seg):>3}%  {status}")


def cmd_report(args) -> None:
    text = report(args.slug, args.unread, args.segment)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text + "\n")
        print(f"wrote {args.out}")
    else:
        print(text)


def cmd_mark(args) -> None:
    if not args.segment and not args.all_unread:
        sys.exit("mark: pass --segment ID... or --all-unread")
    ledger = load_ledger(args.slug)
    marked = 0
    for repo in project_repos(args.slug):
        commits = load_commits(repo)
        read = read_shas(ledger, repo)
        picked = []
        for seg in segment(commits):
            if args.all_unread or seg_id(seg) in args.segment:
                picked += [c.sha for c in seg if c.sha not in read]
        if not picked:
            continue
        entry = ledger["repos"].setdefault(repo.key, {"readings": []})
        entry["readings"].append({"date": str(dt.date.today()), "ref": args.ref, "note": args.note, "commits": picked})
        marked += len(picked)
        print(f"{repo.label}: marked {len(picked)} commits as read")
    if marked:
        save_ledger(args.slug, ledger)
    else:
        print("nothing new to mark")


def cmd_weekly(args) -> None:
    today = dt.date.today()
    out = [f"# Weekly git attention list · {today}", "",
           "What changed since each project was last read. Not a to-do list; it's what's worth a look.", ""]
    active, dormant, never = [], [], []
    for slug in all_slugs():
        ledger = load_ledger(slug)
        for repo in project_repos(slug):
            commits = load_commits(repo)
            if not commits:
                continue
            read = read_shas(ledger, repo)
            unread = [c for c in commits if c.sha not in read]
            idle = (today - commits[-1].date).days
            if not read:
                never.append((slug, repo, commits))
            elif unread:
                active.append((slug, repo, unread))
            if idle > DORMANT_DAYS:
                dormant.append((slug, repo, commits[-1].date, idle))
    if active:
        out += ["## New since last reading", ""]
        for slug, repo, unread in active:
            fixes = sum(c.is_fix for c in unread)
            out += [f"### {slug} · {repo.label}", "",
                    f"{len(unread)} unread commits, {unread[0].date} → {unread[-1].date}, fix-style {fixes * 100 // len(unread)}%.", ""]
            hot = rework_hotspots(unread, limit=5)
            if hot:
                out += ["Rework in this stretch: " + ", ".join(f"`{p}` ({f}/{t})" for p, f, t in hot), ""]
            out += [f"Next: `python3 tools/git_history.py report {slug} --unread`", ""]
    if never:
        out += ["## Never read (needs an initial deep dive)", ""]
        out += [f"- **{slug}** · {repo.label}: {len(c)} commits, {c[0].date} → {c[-1].date}, {len(segment(c))} segments" for slug, repo, c in never] + [""]
    if dormant:
        out += [f"## Quiet for more than {DORMANT_DAYS} days", ""]
        out += [f"- **{slug}** · {repo.label}: last commit {d} ({idle} days)" for slug, repo, d, idle in sorted(dormant, key=lambda x: -x[3])] + [""]
    text = "\n".join(out)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text + "\n")
        print(f"wrote {args.out}")
    else:
        print(text)


def snapshot_data(slug: str) -> dict:
    """Machine-readable summary the app renders. Facts from git only."""
    ledger = load_ledger(slug)
    repos = []
    for repo in project_repos(slug):
        commits = load_commits(repo)
        if not commits:
            repos.append({"label": repo.label, "path": repo.path, "subdir": repo.subdir, "commits": 0})
            continue
        read = read_shas(ledger, repo)
        months: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for c in commits:
            m = months[c.date.strftime("%Y-%m")]
            m[0] += 1
            m[1] += c.is_fix
        # Fill quiet months so gaps show on a timeline.
        filled, cur = [], dt.date(commits[0].date.year, commits[0].date.month, 1)
        while cur <= commits[-1].date:
            key = cur.strftime("%Y-%m")
            n, f = months.get(key, [0, 0])
            filled.append({"month": key, "commits": n, "fixes": f})
            cur = dt.date(cur.year + cur.month // 12, cur.month % 12 + 1, 1)
        present = head_files(repo)
        repos.append({
            "label": repo.label, "path": repo.path, "subdir": repo.subdir,
            "commits": len(commits), "read": len(read & {c.sha for c in commits}),
            "first": str(commits[0].date), "last": str(commits[-1].date),
            "fixes": sum(c.is_fix for c in commits),
            "months": filled,
            "segments": [{
                "id": seg_id(s), "from": str(s[0].date), "to": str(s[-1].date), "commits": len(s),
                "fixes": sum(c.is_fix for c in s), "status": coverage(s, read),
                "features": [{"sha": c.sha[:7], "date": str(c.date), "subject": c.subject} for c in s if c.is_feature][:8],
            } for s in segment(commits)],
            "hotspots": [{"path": p, "fixes": f, "touches": t} for p, f, t in rework_hotspots(commits, limit=10)],
            "written_once": [{"path": p, "date": str(d), "present": p in present} for p, d in settled_files(commits)],
        })
    return {"slug": slug, "generated": str(dt.date.today()), "repos": repos}


def cmd_snapshot(args) -> None:
    for slug in args.slugs or all_slugs():
        data = snapshot_data(slug)
        out = ROOT / "companies" / slug / "git" / "snapshot.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, indent=2) + "\n")
        print(f"wrote {out.relative_to(ROOT)}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("status", help="read/unread counts per project")
    s.add_argument("slugs", nargs="*")
    s.set_defaults(func=cmd_status)
    s = sub.add_parser("segments", help="list work segments and whether they've been read")
    s.add_argument("slug")
    s.add_argument("--unread", action="store_true")
    s.set_defaults(func=cmd_segments)
    s = sub.add_parser("report", help="Markdown digest for an agent to read")
    s.add_argument("slug")
    s.add_argument("--unread", action="store_true", help="only segments not fully read")
    s.add_argument("--segment", nargs="+", help="segment ids to include")
    s.add_argument("--out")
    s.set_defaults(func=cmd_report)
    s = sub.add_parser("mark", help="record that segments were read")
    s.add_argument("slug")
    s.add_argument("--segment", nargs="+", default=[])
    s.add_argument("--all-unread", action="store_true")
    s.add_argument("--ref", required=True, help="where the reading's interpretation was written")
    s.add_argument("--note")
    s.set_defaults(func=cmd_mark)
    s = sub.add_parser("weekly", help="cross-project attention list")
    s.add_argument("--out")
    s.set_defaults(func=cmd_weekly)
    s = sub.add_parser("snapshot", help="write companies/<slug>/git/snapshot.json for the app")
    s.add_argument("slugs", nargs="*")
    s.set_defaults(func=cmd_snapshot)
    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
