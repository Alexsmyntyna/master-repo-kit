#!/usr/bin/env python3
"""Recheck: flag open questions whose project moved on since they were asked, and have an agent recheck them.

An open question is one of:
  thread   companies/<slug>/threads/<id>/thread.md with status awaiting-alex or stale; asked on the date of its
           newest numbered message
  build    companies/<slug>/builds/<id>/build.md with status review; asked when it was last updated
  card     the `blocker` and `next` lines of companies/<slug>/card.json; asked on the line's `date`
Each is counted against the project's repos (companies/<slug>/git/snapshot.json, `path` and `subdir`; a build uses
its own `repo`/`subdir`): non-merge commits on HEAD after max(asked, rechecked). Dates without a time count from the
end of that day, so a question asked on the 11th is flagged by a commit on the 12th or later.

`scan` writes the flag and never touches anything else:
  thread, build   front matter `recheck_commits: N` and `recheck_since: "YYYY-MM-DD"` (only those lines rewritten)
  card line       `"recheck": {"commits": N, "since": "YYYY-MM-DD"}` inside the blocker or next object
With 0 commits the flag goes, as it does from a thread or build no longer open. A repo path that doesn't exist is
skipped quietly. Status is never changed.

`run` hands each flagged item to a Sonnet agent (on the subscription, never the API) that reads the commits and the
code and answers {"verdict": "resolved" | "rephrase" | "valid", "reason", "evidence": ["<sha> ..."], "rewrite"}:
  resolved   thread: a new message from the agent citing the commits, status "closed" (the existing closed status)
             build:  status kept, the verdict stored as front matter `recheck_note`
             card:   text kept; `"recheck": {"verdict": "resolved", ...}` so the board shows it and scan leaves it
  rephrase   thread: a new message with the rewritten question; the thread stays awaiting the owner
             card:   text replaced by the rewrite (source agent, date today); the old line appended to `previous`
             build:  noted as `recheck_note` (a build has no question text to rewrite)
  valid      flag cleared and `rechecked: "YYYY-MM-DD"` recorded, so only commits after today flag it again
Every item that got a verdict also keeps it in `recheck_note` ({verdict, reason, evidence, model, date}) and
`rechecked`. While the agent works, `recheck_running: "<time>"` is set (front matter, or inside the card line) and
always cleared afterwards. Each agent run is one line in holding/runs.jsonl with `task: "recheck"`.

Refs name an item: companies/<slug>/threads/<id>, companies/<slug>/builds/<id>, companies/<slug>/card.json#blocker
(or #next).

Usage:
    recheck.py scan [--all | <slug>]           # write or clear the flags (no agents; tools/refresh.py runs it daily)
    recheck.py list [--all | <slug>]           # what is flagged
    recheck.py run <ref> [--model sonnet]      # one agent for one item
    recheck.py run --all [--model sonnet]      # one agent per flagged item, one after another
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import card  # noqa: E402  (frontmatter reader)
import converse  # noqa: E402  (messages, run log, subscription env)
import footprint  # noqa: E402  (JSON helpers, all_slugs)
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
VERDICTS = ("resolved", "rephrase", "valid")
LINES = ("blocker", "next")
OPEN_THREAD = ("awaiting-alex", "awaiting-owner", "stale")
MAX_COMMITS_IN_PROMPT = 60
MAX_TURNS = 30
AGENT_TOOLS = ["Read", "Grep", "Glob", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)",
               "Bash(git ls-files:*)", "Bash(git blame:*)", "Bash(git branch:*)"]


def today() -> str:
    return dt.date.today().isoformat()


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------- front matter, line by line

def set_meta(path: Path, changes: dict, clear: tuple[str, ...] = ()) -> None:
    """Rewrite only the named front-matter lines: replace a key in place, add a new one at the end, drop `clear`."""
    text = path.read_text()
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    if not m:
        return
    out, done = [], set()
    for line in m.group(1).split("\n"):
        key = line.split(":", 1)[0].strip() if ":" in line and not line.startswith(" ") else None
        if key in clear and key not in changes:
            continue
        if key in changes:
            out.append(f"{key}: {json.dumps(changes[key], ensure_ascii=False)}")
            done.add(key)
        else:
            out.append(line)
    out += [f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in changes.items() if k not in done]
    new = "---\n" + "\n".join(out) + "\n---" + text[m.end():]
    if new != text:
        path.write_text(new)


# ---------------------------------------------------------------- dates and commits

def moment(value) -> dt.datetime | None:
    """A date counts from the end of that day; a timestamp counts from itself."""
    if not isinstance(value, str) or not re.match(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        if len(value) > 10:
            return dt.datetime.fromisoformat(value[:19])
        return dt.datetime.combine(dt.date.fromisoformat(value), dt.time(23, 59, 59))
    except ValueError:
        return None


def commits_since(path: str, subdir: str | None, since: dt.datetime) -> list[str]:
    """`<short sha> <date> <subject> (<branches>)` of each non-merge commit on any local or remote branch after `since`;
    work branches count as much as main. [] when the repo isn't there."""
    if not path or not Path(path).is_dir():
        return []
    cmd = ["git", "-C", path, "log", "--branches", "--remotes", "--no-merges",
           f"--since={since.isoformat(sep=' ')}", "--format=%h %cs %s%d"]
    if subdir:
        cmd += ["--", subdir]
    out = subprocess.run(cmd, capture_output=True, text=True)
    return [ln for ln in out.stdout.splitlines() if ln.strip()] if out.returncode == 0 else []


def project_repos(slug: str, root: Path) -> list[dict]:
    snap = footprint.read_json(f"companies/{slug}/git/snapshot.json", root, {}) or {}
    return [{"path": r["path"], "subdir": r.get("subdir"), "label": r.get("label") or Path(r["path"]).name}
            for r in snap.get("repos") or [] if r.get("path")]


# ---------------------------------------------------------------- open questions

def thread_items(slug: str, root: Path) -> list[dict]:
    out = []
    for t in sorted((root / "companies" / slug / "threads").glob("*/thread.md")):
        meta = card.frontmatter(t)
        if meta.get("status") not in OPEN_THREAD:
            continue
        msgs = sorted(t.parent.glob("[0-9][0-9][0-9]-*.md"))
        dates = [d for d in (card.frontmatter(m).get("date") for m in msgs) if isinstance(d, str)]
        asked = max(dates) if dates else meta.get("updated") or meta.get("started")
        last = msgs[-1] if msgs else None
        head, body = converse.split_frontmatter(last.read_text()) if last else ({}, "")
        subject = head.get("subject")
        question = "\n\n".join(x for x in (f"Thread: {meta.get('title')}", f"Latest message ({last.name if last else '-'}): "
                                           f"{subject or ''}", body[:4000]) if x)
        out.append({"ref": str(t.parent.relative_to(root)), "slug": slug, "kind": "thread", "file": t,
                    "asked": asked, "rechecked": meta.get("rechecked"), "question": question,
                    "commits": meta.get("recheck_commits"), "since": meta.get("recheck_since"),
                    "running": meta.get("recheck_running")})
    return out


def build_items(slug: str, root: Path) -> list[dict]:
    out = []
    for b in sorted((root / "companies" / slug / "builds").glob("*/build.md")):
        meta = card.frontmatter(b)
        if meta.get("status") != "review":
            continue
        review = b.parent / "review.md"
        question = f"Build waiting for the owner's review and merge: {meta.get('title')}"
        if review.is_file():
            question += "\n\nThe review the owner was given (review.md):\n" + review.read_text()[:4000]
        repo = [{"path": meta["repo"], "subdir": meta.get("subdir") or None, "label": Path(meta["repo"]).name}] \
            if meta.get("repo") else None
        out.append({"ref": str(b.parent.relative_to(root)), "slug": slug, "kind": "build", "file": b,
                    "asked": meta.get("updated") or meta.get("approved") or meta.get("created"),
                    "rechecked": meta.get("rechecked"), "question": question, "repos": repo,
                    "commits": meta.get("recheck_commits"), "since": meta.get("recheck_since"),
                    "running": meta.get("recheck_running")})
    return out


def card_items(slug: str, root: Path) -> list[dict]:
    data = footprint.read_json(f"companies/{slug}/card.json", root)
    if not isinstance(data, dict):
        return []
    out = []
    for key in LINES:
        line = data.get(key)
        if not isinstance(line, dict) or not line.get("text"):
            continue  # a bare string has no date to count from
        flag = line.get("recheck") or {}
        if flag.get("verdict") == "resolved":
            continue  # an agent found it done; it stays shown until someone rewrites the line
        out.append({"ref": f"companies/{slug}/card.json#{key}", "slug": slug, "kind": "card", "field": key,
                    "file": root / "companies" / slug / "card.json", "asked": line.get("date"),
                    "rechecked": line.get("rechecked"),
                    "question": f"The project card's {key} line: {line['text']}"
                                + (f" (source {line.get('source')}, ref {line.get('ref')})" if line.get("source") else ""),
                    "commits": flag.get("commits"), "since": flag.get("since"),
                    "running": line.get("recheck_running")})
    return out


def items(root: Path, slugs: list[str]) -> list[dict]:
    return [i for s in slugs for i in (*thread_items(s, root), *build_items(s, root), *card_items(s, root))]


def since_of(item: dict) -> dt.datetime | None:
    found = [m for m in (moment(item.get("asked")), moment(item.get("rechecked"))) if m]
    return max(found) if found else None


def count(item: dict, root: Path) -> tuple[list[str], dt.datetime | None]:
    """The commits after the item was asked (or last rechecked), across its repos, each prefixed with the repo."""
    since = since_of(item)
    if not since:
        return [], None
    found = []
    for r in item.get("repos") or project_repos(item["slug"], root):
        found += [f"{r['label']}: {c}" for c in commits_since(r["path"], r.get("subdir"), since)]
    return found, since


# ---------------------------------------------------------------- writing the flag

def edit_card_line(item: dict, root: Path, change) -> None:
    """Re-read card.json, let `change(line)` edit the item's line in place, write it back if it changed."""
    rel = f"companies/{item['slug']}/card.json"
    data = footprint.read_json(rel, root)
    if not isinstance(data, dict) or not isinstance(data.get(item["field"]), dict):
        return
    before = json.dumps(data, sort_keys=True)
    change(data[item["field"]], data)
    if json.dumps(data, sort_keys=True) != before:
        footprint.write_json(rel, data, root)


def write_flag(item: dict, root: Path, n: int, since: dt.datetime | None) -> None:
    day = since.date().isoformat() if since else None
    if item["kind"] == "card":
        def change(line, _data):
            if n:
                line["recheck"] = {"commits": n, "since": day}
            elif "verdict" not in (line.get("recheck") or {}):
                line.pop("recheck", None)
        edit_card_line(item, root, change)
    elif n:
        set_meta(item["file"], {"recheck_commits": n, "recheck_since": day})
    else:
        set_meta(item["file"], {}, clear=("recheck_commits", "recheck_since"))


def clear_answered(root: Path, slugs: list[str]) -> None:
    """A thread or build that stopped being open (the owner answered, a build merged) loses a flag left from before."""
    for slug in slugs:
        base = root / "companies" / slug
        for f in [*base.glob("threads/*/thread.md"), *base.glob("builds/*/build.md")]:
            meta = card.frontmatter(f)
            still_open = meta.get("status") in (OPEN_THREAD if f.name == "thread.md" else ("review",))
            if "recheck_commits" in meta and not still_open:
                set_meta(f, {}, clear=("recheck_commits", "recheck_since"))


def scan(root: Path, slugs: list[str]) -> list[dict]:
    """Write or clear every open question's flag; returns the flagged ones with their commit counts."""
    clear_answered(root, slugs)
    flagged = []
    for item in items(root, slugs):
        found, since = count(item, root)
        write_flag(item, root, len(found), since)
        if found:
            flagged.append({"ref": item["ref"], "commits": len(found), "since": since.date().isoformat()})
    return flagged


# ---------------------------------------------------------------- the agent

def prompt_for(item: dict, found: list[str], since: dt.datetime, repos: list[dict]) -> str:
    where = {"thread": "a thread waiting on the owner's answer", "build": "a coding build waiting for the owner's review",
             "card": "a line on the project's card, which the owner reads first"}[item["kind"]]
    lines = [
        "You recheck one open question in the owner's Master-Repo against the code. The project's repos got commits "
        "after the question was asked; decide whether those commits answered it, changed it, or left it as is.",
        "", f"## The question ({where}, asked {item.get('asked')}; ref {item['ref']})", "", item["question"], "",
        "## Repos", *(f"- {r['path']}" + (f" (only the `{r['subdir']}` folder counts)" if r.get("subdir") else "")
                      for r in repos),
        "", f"## Commits since {since.date().isoformat()} ({len(found)}; newest first)",
        *(f"- {c}" for c in found[:MAX_COMMITS_IN_PROMPT]),
        *([f"- ... and {len(found) - MAX_COMMITS_IN_PROMPT} more"] if len(found) > MAX_COMMITS_IN_PROMPT else []),
        "", "## How", "Read the commits that could touch the question with `git show <sha>` or `git log -p` "
        f"(run git inside the repo folder, e.g. `cd <repo> && git show <sha>`) and the code they touch. Read only; "
        "change nothing. Judge from the code, not from commit messages alone. Commits may be on work branches, not "
        "main (`git branch -a --contains <sha>`); work on a branch can still answer or outdate the question, so say "
        "which branch it is on.",
        "", "## Answer",
        "- resolved: the commits did what the question asked for, or made it moot. Say what and cite the commits.",
        "- rephrase: still open, but the facts in it are out of date. Give the question rewritten for today in "
        "`rewrite`, in the same voice and about the same length (one or two sentences for a card line).",
        "- valid: still open as written.",
        "Plain words: facts with a short sha, no praise, no guessing. When unsure, say valid.", "",
        'Output only one JSON object, nothing else: {"verdict": "resolved" | "rephrase" | "valid", '
        '"reason": "<one to three sentences>", "evidence": ["<short sha> <what it changed>"], '
        '"rewrite": "<only for rephrase>"}',
    ]
    return "\n".join(lines)


def ask_agent(prompt: str, repos: list[dict], model: str) -> tuple[dict | None, dict]:
    """Run one claude -p turn on the subscription; (parsed verdict or None, run-log fields)."""
    dirs = [r["path"] for r in repos if Path(r["path"]).is_dir()]
    cmd = ["claude", "-p", "--model", model, "--output-format", "json", "--no-session-persistence",
           "--max-turns", str(MAX_TURNS), "--settings", json.dumps({"disableAllHooks": True}),
           "--strict-mcp-config", "--allowedTools", *AGENT_TOOLS]
    for d in dirs[1:]:
        cmd += ["--add-dir", d]
    proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, cwd=dirs[0] if dirs else ROOT,
                          env=converse.subscription_env())
    try:
        data = json.loads(proc.stdout)
        verdict = json.loads(re.search(r"\{.*\}", data.get("result") or "", re.S).group(0))
    except (ValueError, AttributeError) as error:
        return None, {"error": f"{error}: {(proc.stderr or proc.stdout)[-300:]}"}
    return verdict, {"turns": data.get("num_turns"), "list_price_usd": round(data.get("total_cost_usd") or 0, 4)}


def valid_verdict(v) -> dict | None:
    if not isinstance(v, dict) or v.get("verdict") not in VERDICTS:
        return None
    out = {"verdict": v["verdict"], "reason": str(v.get("reason") or "").strip()[:1500],
           "evidence": [str(e)[:300] for e in (v.get("evidence") or []) if str(e).strip()][:20]}
    if out["verdict"] == "rephrase":
        rewrite = str(v.get("rewrite") or "").strip()
        if not rewrite:
            return None
        out["rewrite"] = rewrite[:2000]
    return out


# ---------------------------------------------------------------- applying a verdict

def cites(evidence: list[str]) -> str:
    return "\n".join(f"- `{e.split(' ', 1)[0]}` {e.split(' ', 1)[1] if ' ' in e else ''}".rstrip()
                     for e in evidence) or "- none cited"


def apply_thread(item: dict, v: dict, note: dict) -> None:
    thread = item["file"].parent
    msgs = converse.messages(thread)
    last_kind = msgs[-1][1].get("kind") if msgs else None
    usage = {"engine": "claude", "model": note["model"], "task": "recheck"}
    if v["verdict"] == "resolved":
        body = (f"Rechecked against the code on {note['date']}: this looks resolved by commits after it was asked.\n\n"
                f"{v['reason']}\n\nCommits:\n{cites(v['evidence'])}")
        converse.add_message(thread, "coo", "owner", "report", body, subject="Recheck: resolved by later commits",
                             extra={"usage": usage})
        set_meta(item["file"], {"status": "closed", "recheck_note": note, "rechecked": note["date"]},
                 clear=("recheck_commits", "recheck_since"))
    elif v["verdict"] == "rephrase":
        body = (f"{v['rewrite']}\n\nRechecked against the code on {note['date']}: the question above replaces the "
                f"earlier one. {v['reason']}\n\nCommits:\n{cites(v['evidence'])}")
        kind = last_kind if last_kind in ("question", "decision") else "question"
        converse.add_message(thread, "coo", "owner", kind, body, subject="Recheck: the question, brought up to date",
                             extra={"usage": usage})
        set_meta(item["file"], {"status": "awaiting-owner", "recheck_note": note, "rechecked": note["date"]},
                 clear=("recheck_commits", "recheck_since", "stale_since"))
    else:
        set_meta(item["file"], {"recheck_note": note, "rechecked": note["date"]},
                 clear=("recheck_commits", "recheck_since"))


def apply_card(item: dict, v: dict, note: dict, root: Path) -> None:
    def change(line, data):
        line["rechecked"] = note["date"]
        line["recheck_note"] = note
        if v["verdict"] == "resolved":
            line["recheck"] = {"verdict": "resolved", "reason": v["reason"], "evidence": v["evidence"],
                               "date": note["date"], "model": note["model"]}
            return
        line.pop("recheck", None)
        if v["verdict"] == "rephrase":
            old = {k: line.get(k) for k in ("text", "source", "ref", "date")}
            line["previous"] = [*(line.get("previous") or []), {**old, "replaced": note["date"]}]
            shas = ", ".join(e.split(" ", 1)[0] for e in v["evidence"][:5])
            line.update({"text": v["rewrite"], "source": "agent", "date": note["date"],
                         "ref": f"tools/recheck.py {note['date']}" + (f": {shas}" if shas else "")})
            data["updated"] = note["date"]
    edit_card_line(item, root, change)


def apply(item: dict, verdict: dict, model: str, root: Path) -> None:
    note = {**{k: verdict[k] for k in ("verdict", "reason", "evidence")}, "model": model, "date": today()}
    if verdict["verdict"] == "rephrase":
        note["rewrite"] = verdict["rewrite"]
    if item["kind"] == "thread":
        apply_thread(item, verdict, note)
    elif item["kind"] == "card":
        apply_card(item, verdict, note, root)
    else:
        set_meta(item["file"], {"recheck_note": note, "rechecked": note["date"]},
                 clear=("recheck_commits", "recheck_since"))


def set_running(item: dict, root: Path, on: bool) -> None:
    if item["kind"] == "card":
        def change(line, _data):
            if on:
                line["recheck_running"] = now()
            else:
                line.pop("recheck_running", None)
        edit_card_line(item, root, change)
    elif on:
        set_meta(item["file"], {"recheck_running": now()})
    else:
        set_meta(item["file"], {}, clear=("recheck_running",))


def run_one(item: dict, model: str, root: Path) -> str:
    found, since = count(item, root)
    if not found:
        write_flag(item, root, 0, since)
        return f"{item['ref']}: no commits since it was asked; nothing to recheck"
    repos = [r for r in (item.get("repos") or project_repos(item["slug"], root)) if Path(r["path"]).is_dir()]
    began = dt.datetime.now()
    set_running(item, root, True)
    try:
        raw, extra = ask_agent(prompt_for(item, found, since, repos), repos, model)
        verdict = valid_verdict(raw)
        entry = {"thread": item["ref"], "scope": item["slug"], "role": "coo", "engine": "claude", "model": model,
                 "started": began.isoformat(timespec="seconds"), "task": "recheck",
                 "seconds": round((dt.datetime.now() - began).total_seconds()), **extra}
        if not verdict:
            converse.log_run({**entry, "ok": False, "error": extra.get("error") or f"bad answer: {str(raw)[:300]}"})
            return f"{item['ref']}: the agent's answer couldn't be read; the flag stays"
        apply(item, verdict, model, root)
        converse.log_run({**entry, "ok": True, "verdict": verdict["verdict"]})
        return f"{item['ref']}: {verdict['verdict']}: {verdict['reason'][:160]}"
    finally:
        set_running(item, root, False)


def find(ref: str, root: Path) -> dict | None:
    m = re.match(r"companies/([a-z0-9-]+)/", ref)
    if not m:
        return None
    return next((i for i in items(root, [m.group(1)]) if i["ref"] == ref.rstrip("/")), None)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("scan", "list"):
        s = sub.add_parser(name)
        s.add_argument("slug", nargs="?")
        s.add_argument("--all", action="store_true")
    s = sub.add_parser("run", help="one agent per item: a ref, or --all for every flagged item")
    s.add_argument("ref", nargs="?")
    s.add_argument("--all", action="store_true")
    s.add_argument("--model", default="sonnet")
    a = p.parse_args(argv)
    if a.cmd in ("scan", "list"):
        slugs = footprint.all_slugs(ROOT) if a.all or not a.slug else [a.slug]
        if a.cmd == "scan":
            flagged = scan(ROOT, slugs)
            print(f"recheck: {len(flagged)} flagged")
            for f in flagged:
                print(f"    {f['ref']}  {f['commits']} commits since {f['since']}")
        else:
            for i in items(ROOT, slugs):
                if i.get("commits"):
                    print(f"{i['ref']}  {i['commits']} commits since {i['since']}")
        return 0
    if bool(a.ref) == a.all:
        p.error("give a ref or --all")
    if a.all:
        todo = [i for i in items(ROOT, footprint.all_slugs(ROOT)) if i.get("commits") and not i.get("running")]
    else:
        item = find(a.ref, ROOT)
        if not item:
            print(f"no open question at {a.ref}", file=sys.stderr)
            return 1
        todo = [item]
    for item in todo:
        print(run_one(item, a.model, ROOT))
    if not todo:
        print("nothing flagged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
