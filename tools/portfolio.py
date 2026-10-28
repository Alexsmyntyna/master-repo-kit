#!/usr/bin/env python3
"""Portfolio pulse and check-ins: which projects are moving, which are abandoned, and what each one is for.

`pulse` reads every project's repos with git (read-only) and writes holding/pulse.json: last commit, recent
commits, commits nobody has read yet, and a state (active, cooling, dormant, abandoned). The CEO, the COOs
and the app read that file.

It also reads the work that isn't on main yet: uncommitted changes, branches ahead of main, and extra
worktrees. A check-in is due when new code shows up (new commits, or that off-main work changed), and on a
slow schedule for projects that have gone quiet.

A check-in is a thread (see tools/converse.py) where the project's COO answers three things:
  - Work happened: what direction was it taking, and why? It reads a git digest of the unread commits.
  - Off-main work: what's in each branch, worktree and uncommitted change, and what should be brought
    into main, how (merge, squash, split, cherry-pick), and in what order. Or dropped.
  - Nothing happened: will this ever be published? How does it reach people (App Store, web, GitHub,
    plugin)? Is there a landing page? Push it, maintain it, park it, or retire it?
It ends with a release card. When the owner approves, the card is written to the project's company.json
(`release`), the project moves to the matching list in holding/portfolio.json, the commits count as read,
and the next check is scheduled by the card's cadence (weekly, monthly, quarterly, or none).

Usage:
    portfolio.py pulse [--quiet]          # refresh holding/pulse.json and print the table
    portfolio.py due                      # which projects need a check-in, and why
    portfolio.py checkin <slug>... [--run] [--model opus]   # open check-ins (and let the agents work them)
    portfolio.py checkin --due [--run] [--limit 4]          # every project that's due, in parallel
    portfolio.py apply <thread>           # write an approved check-in's release card (approve does this)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import converse  # noqa: E402
import git_history  # noqa: E402

import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
STATES = (("active", 14), ("cooling", 60), ("dormant", 180))  # days since the last commit; beyond is abandoned
CADENCE_DAYS = {"weekly": 7, "monthly": 30, "quarterly": 90}
VERDICT_TIER = {"push": "focus", "maintain": "maintain", "park": "paused", "retire": "paused"}
CARD_FIELDS = ("published", "channel", "landing_page", "verdict", "cadence", "next_step")
NEW_WORK = 3  # new commits since the last reading that make a check-in due (off-main changes always do)
LIST_CAP = 12  # branches or worktrees listed one by one in a digest; the rest are counted
DIGEST_SEGMENTS = 3  # a check-in reads the latest few stretches of work; older ones are summarized by month


def today() -> dt.date:
    return dt.date.today()


def git(path: str, *args: str) -> str:
    out = subprocess.run(["git", "-C", path, *args], capture_output=True, text=True, errors="replace")
    return out.stdout.strip() if out.returncode == 0 else ""


def state_for(idle: int | None) -> str:
    if idle is None:
        return "no-code"
    return next((name for name, days in STATES if idle <= days), "abandoned")


def company(slug: str) -> dict:
    return json.loads((ROOT / "companies" / slug / "company.json").read_text())


# --- pulse -------------------------------------------------------------------------------------------

def default_branch(path: str) -> str:
    ref = git(path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if ref:
        return ref.split("/", 1)[1]
    names = git(path, "for-each-ref", "refs/heads", "--format=%(refname:short)").split()
    return next((b for b in ("main", "master") if b in names), git(path, "branch", "--show-current") or "HEAD")


def off_main(repo) -> dict:
    """Work in this repo that isn't on its main branch: uncommitted files, branches ahead, extra worktrees."""
    path, main = repo.path, default_branch(repo.path)
    scope = ["--", repo.subdir] if repo.subdir else []
    status = [l for l in git(path, "status", "--porcelain", "--untracked-files=normal", *scope).splitlines()
              if not git_history.NOISE_RE.search(l[3:])]
    branches = []
    # One call for every branch's ahead/behind counts (git 2.41+); a subdir needs a path-limited count per branch.
    fmt = f"%(refname:short)\x1f%(objectname:short)\x1f%(committerdate:short)\x1f%(ahead-behind:{main})"
    for line in git(path, "for-each-ref", "refs/heads", f"--format={fmt}").splitlines():
        name, sha, date, counts = line.split("\x1f")
        ahead, behind = (int(n) for n in counts.split()) if counts.strip() else (0, 0)
        if repo.subdir and ahead:
            ahead = int(git(path, "rev-list", "--count", "--no-merges", f"{main}..{name}", *scope) or 0)
        if name != main and ahead:
            branches.append({"name": name, "sha": sha, "date": date, "ahead": ahead, "behind": behind})
    trees = []
    for block in git(path, "worktree", "list", "--porcelain").split("\n\n")[1:]:
        fields = dict(l.split(" ", 1) if " " in l else (l, "") for l in block.splitlines())
        if fields.get("worktree") and "prunable" not in fields and Path(fields["worktree"]).is_dir():
            dirty = len(git(fields["worktree"], "status", "--porcelain").splitlines())
            trees.append({"path": fields["worktree"], "branch": fields.get("branch", "").removeprefix("refs/heads/"),
                          "dirty": dirty})
    stashes = len(git(path, "stash", "list").splitlines())
    return {"repo": repo.label, "main": main, "dirty": len(status), "status": status[:200], "branches": branches,
            "worktrees": trees, "stashes": stashes}


def fingerprint(work: list[dict]) -> str:
    """Changes whenever off-main work changes: a branch moves, a worktree appears, files change."""
    import hashlib
    text = json.dumps([[w["status"], [(b["name"], b["sha"]) for b in w["branches"]],
                        [(t["path"], t["branch"], t["dirty"]) for t in w["worktrees"]], w["stashes"]] for w in work])
    return hashlib.sha1(text.encode()).hexdigest()[:12]


def pulse_one(slug: str) -> dict:
    ledger = git_history.load_ledger(slug)
    last, recent30, recent90, unread, total, work = None, 0, 0, 0, 0, []
    for repo in git_history.project_repos(slug):
        if not (Path(repo.path) / ".git").exists():
            continue
        work.append(off_main(repo))
        scope = ["--", repo.subdir] if repo.subdir else []
        date = git(repo.path, "log", "-1", "--format=%cs", "HEAD", *scope)
        if date and (last is None or date > last):
            last = date
        shas = [s[:git_history.SHA_LEN] for s in git(repo.path, "rev-list", "--no-merges", "HEAD", *scope).split()]
        total += len(shas)
        unread += len(set(shas) - git_history.read_shas(ledger, repo))
        for days in (30, 90):
            n = len(git(repo.path, "rev-list", "--no-merges", f"--since={days}.days", "HEAD", *scope).split())
            recent30, recent90 = (n, recent90) if days == 30 else (recent30, n)
    idle = (today() - dt.date.fromisoformat(last)).days if last else None
    release = company(slug).get("release") or {}
    return {"slug": slug, "name": company(slug).get("name", slug), "tier": converse.tier(slug),
            "state": state_for(idle), "last_commit": last, "idle_days": idle, "commits": total,
            "commits_30d": recent30, "commits_90d": recent90, "unread": unread,
            "uncommitted": sum(w["dirty"] for w in work), "branches": sum(len(w["branches"]) for w in work),
            "worktrees": sum(len(w["worktrees"]) for w in work), "fingerprint": fingerprint(work),
            "verdict": release.get("verdict"), "cadence": release.get("cadence"),
            "next_check": release.get("next_check")}


def pulse(slugs: list[str] | None = None) -> list[dict]:
    from concurrent.futures import ThreadPoolExecutor  # git calls are I/O-bound; read the repos side by side
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(pulse_one, slugs or git_history.all_slugs()))
    path = ROOT / "holding" / "pulse.json"
    path.write_text(json.dumps({"generated": today().isoformat(), "projects": rows}, indent=2) + "\n")
    return rows


def save_row(row: dict) -> None:
    """Replace one project's row in holding/pulse.json without re-reading every repo."""
    path = ROOT / "holding" / "pulse.json"
    data = json.loads(path.read_text()) if path.exists() else {"projects": []}
    data["projects"] = [r for r in data["projects"] if r["slug"] != row["slug"]] + [row]
    path.write_text(json.dumps(data, indent=2) + "\n")


def read_pulse() -> dict[str, dict]:
    path = ROOT / "holding" / "pulse.json"
    return {r["slug"]: r for r in json.loads(path.read_text())["projects"]} if path.exists() else {}


def pulse_line(row: dict | None) -> str:
    """One compact phrase, e.g. `active · 40 commits/30d · 12 unread · monthly check`."""
    if not row:
        return "no pulse yet"
    bits = [row["state"]]
    if row["idle_days"] is not None and row["state"] != "active":
        bits.append(f"idle {row['idle_days']}d")
    if row["commits_30d"]:
        bits.append(f"{row['commits_30d']} commits/30d")
    if row["unread"]:
        bits.append(f"{row['unread']} unread")
    off = [f"{row[k]} {label}" for k, label in (("uncommitted", "uncommitted"), ("branches", "branches off main"),
                                                ("worktrees", "worktrees")) if row.get(k)]
    bits += off
    if row.get("verdict"):
        bits.append(f"{row['verdict']}, {row.get('cadence') or 'no'} check")
    return " · ".join(bits)


# --- due ---------------------------------------------------------------------------------------------

def open_checkin(slug: str) -> Path | None:
    for t in (ROOT / "companies" / slug / "threads").glob("*/thread.md"):
        meta, _ = converse.split_frontmatter(t.read_text())
        if meta.get("checkin") and meta.get("status") in ("open", "awaiting-alex", "awaiting-owner"):
            return t.parent
    return None


def due_reasons(row: dict) -> list[str]:
    release = company(row["slug"]).get("release") or {}
    reasons = []
    if not release:
        reasons.append("no release card yet")
    elif release.get("next_check") and release["next_check"] <= today().isoformat():
        reasons.append(f"{release.get('cadence')} check due {release['next_check']}")
    if release and row["unread"] >= NEW_WORK:
        reasons.append(f"{row['unread']} new commits since the last reading")
    if release and row["fingerprint"] != release.get("fingerprint") and (row["uncommitted"] or row["branches"] or row["worktrees"]):
        reasons.append("work off main changed (uncommitted, branches or worktrees)")
    if release.get("state_at_check") in ("dormant", "abandoned") and row["state"] == "active":
        reasons.append("revived: commits again after going quiet")
    return reasons


def due(rows: list[dict]) -> list[tuple[dict, list[str]]]:
    out = []
    for row in rows:
        reasons = due_reasons(row)
        if reasons and not open_checkin(row["slug"]):
            out.append((row, reasons))
    return out


# --- check-ins ---------------------------------------------------------------------------------------

def directive(row: dict, reasons: list[str], digest: str | None) -> str:
    release = company(row["slug"]).get("release") or {}
    lines = [f"Standing check-in (scheduled by tools/portfolio.py): {', '.join(reasons)}.",
             f"Pulse: {pulse_line(row)}; last commit {row['last_commit'] or 'none'}; {row['commits']} commits in all."]
    if release:
        lines.append(f"Last card ({release.get('last_check')}): {release.get('verdict')}, "
                     f"{release.get('channel')}, next step: {release.get('next_step')}.")
    if digest:
        lines.append(f"\n1. **What happened and why.** The unread commits are digested in `{digest}`. List what the work "
                     "added, each with a commit sha and date, and the recorded reason for it: quote the owner's words "
                     "(threads, decisions, notes) with where and when, or the commit message. Say \"unknown\" where "
                     "nothing records the why; don't supply one.")
    if row.get("uncommitted") or row.get("branches") or row.get("worktrees"):
        lines.append(f"\n{2 if digest else 1}. **What isn't on main yet?** The digest ends with the uncommitted files, branches "
                     "and worktrees; inspect them with git (status, diff, log). For each one: what it's for, whether it should "
                     "come into main, how (commit as is, split into smaller commits, merge, squash, cherry-pick) and in what "
                     "order, or whether it should be dropped. Main must stay releasable.")
    n = 1 + bool(digest) + bool(row.get("uncommitted") or row.get("branches") or row.get("worktrees"))
    lines.append(f"\n{n}. **Will this reach people?** Published or not, how it's delivered (App Store, "
                 "web, GitHub release, plugin, package), whether it has a landing page (example.com counts), "
                 "and what's missing. Then a verdict: push (worth the CEO's attention), maintain (keep it working), "
                 "park (check now and then), or retire.")
    lines.append("\nWrite by skills/writing.md: the owner quoted, code cited, your inference marked and short. If the owner's "
                 "newest thread messages say something the wiki story doesn't, quote them and propose the change.")
    lines.append("\nThe decision that reaches the owner must end with this block, filled in:\n\n```release\n"
                 "published: yes | no | partly\nchannel: app-store | web | github | plugin | package | none | undecided\n"
                 "landing_page: <url or none>\nverdict: push | maintain | park | retire\n"
                 "cadence: weekly | monthly | quarterly | none\nnext_step: <one line, the smallest useful move>\n```")
    return "\n".join(lines)


def off_main_text(slug: str) -> str:
    out = ["# Work not on main", ""]
    for repo in git_history.project_repos(slug):
        if not (Path(repo.path) / ".git").exists():
            continue
        w = off_main(repo)
        out += [f"## {w['repo']} (main is `{w['main']}`)", ""]
        if not (w["dirty"] or w["branches"] or w["worktrees"] or w["stashes"]):
            out += ["Everything is on main. Nothing uncommitted.", ""]
            continue
        if w["dirty"]:
            dirs: dict[str, int] = {}
            for line in w["status"]:
                top = git_history.top_dir(line[3:].strip('"'))
                dirs[top] = dirs.get(top, 0) + 1
            out += [f"**{w['dirty']} uncommitted files** (`git -C {repo.path} status` for the list), by folder:", ""]
            out += [f"- `{d}`: {n}" for d, n in sorted(dirs.items(), key=lambda x: -x[1])[:15]] + [""]
        branches = sorted(w["branches"], key=lambda b: b["date"], reverse=True)
        if len(branches) > LIST_CAP:
            out += [f"**{len(branches)} branches ahead of main**; the {LIST_CAP} most recent are below. "
                    f"Older ones: {', '.join(b['name'] for b in branches[LIST_CAP:LIST_CAP + 40])}"
                    f"{' …' if len(branches) > LIST_CAP + 40 else ''}.", ""]
        for b in branches[:LIST_CAP]:
            subjects = git(repo.path, "log", "--no-merges", "--format=- %cs %h %s", "-8", f"{w['main']}..{b['name']}")
            out += [f"**Branch `{b['name']}`**: {b['ahead']} commits ahead, {b['behind']} behind, last {b['date']}.", "",
                    subjects, ""]
        trees = sorted(w["worktrees"], key=lambda t: -t["dirty"])
        if len(trees) > LIST_CAP:
            out += [f"**{len(trees)} worktrees**; the {LIST_CAP} with the most uncommitted files are below.", ""]
        for t in trees[:LIST_CAP]:
            out += [f"**Worktree** `{t['path']}` on `{t['branch'] or 'detached'}`, {t['dirty']} uncommitted files.", ""]
        if w["stashes"]:
            out += [f"**{w['stashes']} stashes** (`git stash list`).", ""]
    return "\n".join(out)


def digest_text(slug: str) -> str:
    """The git digest limited to the latest unread stretches, so one reading stays small."""
    ledger = git_history.load_ledger(slug)
    ids = []
    for repo in git_history.project_repos(slug):
        read = git_history.read_shas(ledger, repo)
        segs = [x for x in git_history.segment(git_history.load_commits(repo))
                if git_history.coverage(x, read) != "read"]
        ids += [git_history.seg_id(x) for x in segs[-DIGEST_SEGMENTS:]]
    text = git_history.report(slug, only_unread=True, seg_ids=ids) + "\n\n" + off_main_text(slug)
    return text + ("\n\nOnly the latest stretches of unread work are listed; earlier ones show only in the monthly "
                   "momentum above. Approving the check-in marks all of them read.")


def checkin(row: dict, reasons: list[str], run: bool = False, model: str | None = None) -> Path:
    slug = row["slug"]
    digest = None
    if row["unread"] or row.get("uncommitted") or row.get("branches") or row.get("worktrees"):
        notes = ROOT / "companies" / slug / "notes"
        notes.mkdir(exist_ok=True)
        path = notes / f"{today().isoformat()}-git-digest.md"
        path.write_text(digest_text(slug) + "\n")
        digest = str(path.relative_to(ROOT))
    thread = converse.new_thread(slug, f"Check-in {today().isoformat()}", directive(row, reasons, digest),
                                 extra_meta={"checkin": True, "digest": digest, "fingerprint": row.get("fingerprint")})
    if run:
        for _ in range(4):
            if not converse.next_role(thread):
                break
            if converse.take_turn(thread, model=model) is None:
                break  # the usage limit: queued, `converse.py retry` finishes it after the reset
    return thread


def parse_card(text: str) -> dict | None:
    m = re.search(r"```release\n(.*?)(?:```|\Z)", text, re.S)  # agents sometimes drop the closing fence
    if not m:
        return None
    card = {k: v.strip() for k, v in re.findall(r"^(\w+):\s*(.*)$", m.group(1), re.M) if k in CARD_FIELDS}
    if not re.match(r"https?://\S+$", card.get("landing_page", ""), re.I):
        card["landing_page"] = None  # agent-written; only plain web links are kept
    if card.get("verdict") not in VERDICT_TIER or card.get("cadence") not in (*CADENCE_DAYS, "none"):
        return None
    return card


def apply(thread: Path) -> dict | None:
    """Write the approved release card into company.json, move the project's tier, and mark commits read."""
    slug = converse.scope_of(thread)
    card = next((c for _, _, body in reversed(converse.messages(thread)) if (c := parse_card(body))), None)
    if not card:
        return None
    row = pulse_one(slug)
    days = CADENCE_DAYS.get(card["cadence"])
    card.update({"last_check": today().isoformat(),
                 "next_check": (today() + dt.timedelta(days=days)).isoformat() if days else None,
                 "state_at_check": row["state"], "thread": str(thread.relative_to(ROOT)),
                 "fingerprint": converse.read_thread(thread)[0].get("fingerprint") or row["fingerprint"]})
    path = ROOT / "companies" / slug / "company.json"
    model = json.loads(path.read_text())
    model["release"] = card
    path.write_text(json.dumps(model, indent=2, ensure_ascii=False) + "\n")

    path = ROOT / "holding" / "portfolio.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    # A card can promote a project into focus, but only the owner takes one out of it (they chose the focus list).
    if slug not in (data.get("focus") or []):
        for t in converse.TIERS:
            data[t] = [s for s in data.get(t) or [] if s != slug]
        data.setdefault(VERDICT_TIER[card["verdict"]], []).append(slug)
    data["updated"] = today().isoformat()
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

    if row["unread"]:
        mark_read(slug, str(thread.relative_to(ROOT)))
    save_row(pulse_one(slug))
    return card


def mark_read(slug: str, ref: str) -> None:
    """Record every commit on main as read by this check-in (shas only; no need to load the diffs)."""
    ledger = git_history.load_ledger(slug)
    for repo in git_history.project_repos(slug):
        if not (Path(repo.path) / ".git").exists():
            continue
        scope = ["--", repo.subdir] if repo.subdir else []
        shas = [s[:git_history.SHA_LEN] for s in git(repo.path, "rev-list", "--no-merges", "HEAD", *scope).split()]
        new = [s for s in shas if s not in git_history.read_shas(ledger, repo)]
        if new:
            entry = ledger["repos"].setdefault(repo.key, {"readings": []})
            entry["readings"].append({"date": today().isoformat(), "ref": ref, "note": "check-in", "commits": new})
    git_history.save_ledger(slug, ledger)


# --- commands ----------------------------------------------------------------------------------------

def print_table(rows: list[dict]) -> None:
    rows = sorted(rows, key=lambda r: (r["idle_days"] is None, r["idle_days"] or 0))
    for r in rows:
        print(f"{r['slug']:22} {r['tier']:10} {pulse_line(r)}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pulse").add_argument("--quiet", action="store_true")
    sub.add_parser("due")
    p = sub.add_parser("checkin"); p.add_argument("slugs", nargs="*"); p.add_argument("--due", action="store_true")
    p.add_argument("--run", action="store_true"); p.add_argument("--model")
    p.add_argument("--limit", type=int, default=6, help="at most this many check-ins at once")
    sub.add_parser("apply").add_argument("thread")
    a = ap.parse_args(argv)

    if a.cmd == "pulse":
        rows = pulse()
        if not a.quiet:
            print_table(rows)
    elif a.cmd == "due":
        for row, reasons in due(pulse()):
            print(f"{row['slug']:22} {'; '.join(reasons)}")
    elif a.cmd == "checkin":
        if a.due:
            picks = due(pulse())[: a.limit]
        elif a.slugs:
            picks = [(row, due_reasons(row) or ["asked by the owner"]) for row in map(pulse_one, a.slugs)]
        else:
            raise SystemExit("checkin: pass project slugs or --due")
        from concurrent.futures import ThreadPoolExecutor  # each turn is its own claude -p process
        with ThreadPoolExecutor(max_workers=max(1, a.limit)) as pool:
            futures = {pool.submit(checkin, row, reasons, a.run, a.model): row["slug"] for row, reasons in picks}
            for f, slug in futures.items():
                try:
                    thread = f.result()
                    print(f"{thread.relative_to(ROOT)}  status: {converse.read_thread(thread)[0].get('status')}", flush=True)
                except (Exception, SystemExit) as e:  # one failed project doesn't stop the rest
                    print(f"{slug}: failed: {e}", flush=True)
    elif a.cmd == "apply":
        card = apply(converse.thread_path(a.thread))
        print(json.dumps(card, indent=2) if card else "No release card found in this thread.")


if __name__ == "__main__":
    main()
