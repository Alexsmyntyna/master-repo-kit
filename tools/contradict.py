#!/usr/bin/env python3
"""Contradiction check: find where the owner now says something that conflicts with what they said before.

The landing page's promise: when the owner says "Let's get the Android build going this week" (26 Oct) and on 3 Oct
said "iOS only until the beta has 10 testers", an agent flags it and asks which holds.

`collect` gathers the owner's dated statements per project, each short (a sentence, or a decision's text):
  decision  companies/<slug>/decisions.json entries whose `source` is the owner (a string "owner"/"alex", or an object
            with `type` "owner"/"alex"); ref `companies/<slug>/decisions.json#<id>`
  thread    messages in companies/<slug>/threads/*/NNN-*.md sent by the owner (`from: owner`, or the old `alex`);
            automatic directives (a check-in the scheduler sent in the owner's name) are skipped unless the owner typed
            them; ref `<file>:<line>`
  note      companies/<slug>/notes/*.md and wiki pages with `written_by: owner`, and a front's `summary` when
            `raised_by: owner`; ref `<file>:<line>`
  card      the card's goal, blocker, next and gates whose `source` is the owner; ref `companies/<slug>/card.json#goal`
`candidates` pairs two statements of one project when they have different dates and share topic terms (words after
stopwords, plus term groups so ios/android/web/mac, pricing words, stack words and launch/release words pair up).
Only pairs whose newer statement is within the last N days (default 30); a pair where the newer one cites the older
(its ref, or a decision's `refs`) is skipped; at most 20 newest pairs per project. No agent runs here.
`check --run` sends unjudged candidate pairs in batches to a Sonnet judge (`claude -p`, on the subscription) that
answers {"id", "conflict": bool, "question": "<X or Y?>"} per pair. Every judged pair, conflict or not, is stored in
companies/<slug>/contradictions.json and never judged again:
  [{"id", "a": {"text", "date", "ref"}, "b": {...}, "conflict", "question", "status", "found"}]
  status    open (conflict, waiting for the owner) | resolved | dismissed | none (the judge saw no conflict)
`resolve` marks a pair resolved and appends a decision (source owner, refs to both statements) saying which holds;
`dismiss` drops it. Each judge run is one line in holding/runs.jsonl with `task: "contradict"`. A usage limit stops
the run; pairs not yet judged stay candidates for the next one.

Usage:
    contradict.py collect [<slug>]                        # the owner's statements
    contradict.py candidates [<slug>] [--days N]          # pairs worth judging (no agent)
    contradict.py check [--slug x] [--days N]             # same, per project
    contradict.py check [--slug x] [--days N] --run [--model sonnet]   # judge them, store the verdicts
    contradict.py list [<slug>]                           # open contradictions
    contradict.py resolve <slug> <id> --keep a|b|both [--note "..."]
    contradict.py dismiss <slug> <id>
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import card  # noqa: E402  (frontmatter reader)
import converse  # noqa: E402  (run log, subscription env, limit detection)
import footprint  # noqa: E402  (JSON helpers, all_slugs)
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
OWNER = ("owner", "alex")
DEFAULT_DAYS = 30
MAX_PAIRS = 20
BATCH = 8
MAX_STATEMENTS_PER_FILE = 3
MIN_WORDS = 5
MAX_CHARS = 240
MIN_SHARED = 2
STATUSES = ("open", "resolved", "dismissed", "none")
MAX_TURNS = 3

STOPWORDS = set("""
a about after again all also am an and any are as at be because been before being but by can could did do does doing
done for from get gets getting go goes going got had has have having he her here him his how i if in into is it its
just let lets like make makes me more most my need needs new no not now of off on once one only onto or other our out
over own really same she should so some still such than that the their them then there these they thing things this
those through to too up us use used using very want wants was we well were what when where which while who why will
with would yes you your week weeks day days today next first last project projects page pages app apps note notes item items site
three two four five something everything anything work working
""".split())

# Words that mean the same topic: each group becomes one shared term, so "ios" and "android" pair up.
TERM_GROUPS = {
    "platform": "ios android web mac macos windows linux iphone ipad watchos desktop mobile pwa native",
    "pricing": "price prices pricing cost costs charge charging fee fees subscription free paid paywall revenue tier "
               "plan plans discount rate rates package packages",
    "stack": "react swift swiftui kotlin flutter nextjs next node typescript javascript python django rails postgres "
             "mongodb mongo sqlite firebase supabase vercel aws backend frontend database api expo",
    "release": "launch launched release released ship shipped shipping publish published beta testflight testers "
               "tester build builds version deploy deployed live store appstore submission",
}
GROUP_OF = {w: g for g, words in TERM_GROUPS.items() for w in words.split()}


def today() -> dt.date:
    return dt.date.today()


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def is_owner(value) -> bool:
    """A source or author that is the owner: "owner"/"alex", or an object whose `type` is one of them."""
    if isinstance(value, dict):
        value = value.get("type")
    return isinstance(value, str) and value.strip().lower() in OWNER


def as_date(value) -> str | None:
    if isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value):
        try:
            return dt.date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------- collecting

def shorten(text: str, limit: int = MAX_CHARS) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;: ") + "…"


def sentences(text: str, first_line: int = 1) -> list[tuple[int, str]]:
    """(line number, sentence) for the prose of a Markdown body: no headings, tables, code or quotes of other people."""
    out, fenced = [], False
    for i, raw in enumerate(text.splitlines(), first_line):
        line = raw.strip()
        if line.startswith("```"):
            fenced = not fenced
            continue
        if fenced or not line or line.startswith(("#", "|", ">", "---", "<")):
            continue
        line = re.sub(r"^([-*+]|\d+[.)])\s+", "", line)
        line = re.sub(r"[*_`]+", "", line)
        for s in re.split(r"(?<=[.!?])\s+", line):
            if len(s.split()) >= MIN_WORDS:
                out.append((i, shorten(s)))
    return out


def split_file(path: Path) -> tuple[dict, str, int]:
    """(front matter, body, line number the body starts on)."""
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return {}, "", 1
    m = re.match(r"---\n(.*?)\n---\n?", text, re.S)
    if not m:
        return {}, text, 1
    return card.frontmatter(path), text[m.end():], text[:m.end()].count("\n") + 1


def stmt(kind: str, text: str, date: str | None, ref: str, cites: list[str] | None = None) -> dict | None:
    if not date or not text.strip():
        return None
    return {"kind": kind, "text": shorten(text), "date": date, "ref": ref, "cites": cites or []}


def decision_statements(slug: str, root: Path) -> list[dict]:
    rel = f"companies/{slug}/decisions.json"
    data = footprint.read_json(rel, root, [])
    out = []
    for i, d in enumerate(data if isinstance(data, list) else []):
        if not isinstance(d, dict) or not is_owner(d.get("source")):
            continue
        src = d.get("source") if isinstance(d.get("source"), dict) else {}
        s = stmt("decision", str(d.get("decision") or ""), as_date(d.get("date")) or as_date(src.get("date")),
                 f"{rel}#{d.get('id') or i}", [str(r) for r in d.get("refs") or [] if isinstance(r, str)])
        out += [s] if s else []
    return out


def thread_statements(slug: str, root: Path) -> list[dict]:
    out = []
    for f in sorted((root / "companies" / slug / "threads").glob("*/[0-9][0-9][0-9]-*.md")):
        meta, body, first = split_file(f)
        if not is_owner(meta.get("from")):
            continue
        if meta.get("kind") == "directive" and not meta.get("typed"):
            continue  # the scheduler's check-in, sent in the owner's name
        date = as_date(meta.get("date"))
        rel = str(f.relative_to(root))
        for line, s in sentences(body, first)[:MAX_STATEMENTS_PER_FILE]:
            item = stmt("thread", s, date, f"{rel}:{line}")
            out += [item] if item else []
    return out


def note_statements(slug: str, root: Path) -> list[dict]:
    out = []
    base = root / "companies" / slug
    for f in sorted([*base.glob("notes/*.md"), *base.glob("wiki/**/*.md")]):
        meta, body, first = split_file(f)
        date = as_date(meta.get("updated")) or as_date(meta.get("date")) or as_date(f.name)
        rel = str(f.relative_to(root))
        if is_owner(meta.get("written_by")):
            for line, s in sentences(body, first)[:MAX_STATEMENTS_PER_FILE]:
                item = stmt("note", s, date, f"{rel}:{line}")
                out += [item] if item else []
        elif is_owner(meta.get("raised_by")) and isinstance(meta.get("summary"), str):
            item = stmt("note", meta["summary"], as_date(meta.get("date")) or date, f"{rel}:summary")
            out += [item] if item else []
    return out


def card_statements(slug: str, root: Path) -> list[dict]:
    rel = f"companies/{slug}/card.json"
    data = footprint.read_json(rel, root, {})
    if not isinstance(data, dict):
        return []
    out = []
    for key in ("goal", "blocker", "next"):
        line = data.get(key)
        if isinstance(line, dict) and is_owner(line.get("source")):
            item = stmt("card", str(line.get("text") or ""), as_date(line.get("date")), f"{rel}#{key}")
            out += [item] if item else []
    for i, g in enumerate(data.get("gates") or []):
        if isinstance(g, dict) and is_owner(g.get("source")) and g.get("note"):
            item = stmt("card", f"{g.get('name')}: {g['note']}", as_date(g.get("date")), f"{rel}#gates/{i}")
            out += [item] if item else []
    return out


def collect(slug: str, root: Path | None = None) -> list[dict]:
    """The owner's dated statements for one project, oldest first."""
    root = root or ROOT
    found = [*decision_statements(slug, root), *thread_statements(slug, root), *note_statements(slug, root),
             *card_statements(slug, root)]
    return sorted(found, key=lambda s: (s["date"], s["ref"]))


# ---------------------------------------------------------------- pairing

def terms(text: str) -> set[str]:
    """Topic terms: lower-case words without stopwords (plural 's' dropped), related words folded into group terms."""
    out = set()
    for w in re.findall(r"[a-z0-9][a-z0-9+#.-]*", text.lower().replace("’", "'")):
        w = w.strip(".-").replace("'s", "")
        if len(w) < 3 or w in STOPWORDS or w.isdigit():
            continue
        if w in GROUP_OF:
            out.add("group:" + GROUP_OF[w])
            continue
        w = w[:-1] if w.endswith("s") and len(w) > 4 else w
        out.add("group:" + GROUP_OF[w] if w in GROUP_OF else w)
    return out


def pair_id(a: dict, b: dict) -> str:
    key = "|".join([a["ref"], a["text"], b["ref"], b["text"]])
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def cites(newer: dict, older: dict) -> bool:
    """The newer statement points at the older one: a decision's `refs`, or the older's ref written in its text."""
    ref = older["ref"]
    base = ref.split("#")[0].split(":")[0]
    return any(c == ref or c.startswith(ref) or ref.startswith(c) for c in newer.get("cites") or []) \
        or ref in newer["text"] or (base != ref and base in newer["text"])


def candidates(slug: str, root: Path | None = None, days: int = DEFAULT_DAYS, skip: set[str] | None = None,
               on: dt.date | None = None) -> list[dict]:
    """Pairs {id, a, b, shared} (a older), newest first, at most MAX_PAIRS; `skip` holds ids already judged."""
    root = root or ROOT
    cutoff = ((on or today()) - dt.timedelta(days=days)).isoformat()
    found = collect(slug, root)
    for s in found:
        s["terms"] = terms(s["text"])
    pairs = []
    for j, b in enumerate(found):
        if b["date"] < cutoff:
            continue
        for a in found[:j]:
            if a["date"] >= b["date"] or a["ref"] == b["ref"] or cites(b, a):
                continue
            shared = a["terms"] & b["terms"]
            if len(shared) < MIN_SHARED:
                continue
            pid = pair_id(a, b)
            if skip and pid in skip:
                continue
            pairs.append({"id": pid, "a": view(a), "b": view(b), "shared": sorted(shared)})
    pairs.sort(key=lambda p: (p["b"]["date"], len(p["shared"]), p["id"]), reverse=True)
    return pairs[:MAX_PAIRS]


def view(s: dict) -> dict:
    return {"text": s["text"], "date": s["date"], "ref": s["ref"]}


# ---------------------------------------------------------------- stored verdicts

def store_path(slug: str) -> str:
    return f"companies/{slug}/contradictions.json"


def load(slug: str, root: Path) -> list[dict]:
    data = footprint.read_json(store_path(slug), root, [])
    return [e for e in data if isinstance(e, dict) and e.get("id")] if isinstance(data, list) else []


def save(slug: str, entries: list[dict], root: Path) -> None:
    footprint.write_json(store_path(slug), entries, root)


def open_count(slug: str, root: Path) -> int:
    return sum(1 for e in load(slug, root) if e.get("status") == "open")


def pending(slug: str, root: Path | None = None, days: int = DEFAULT_DAYS) -> list[dict]:
    """Candidates not judged yet."""
    root = root or ROOT
    return candidates(slug, root, days, skip={e["id"] for e in load(slug, root)})


# ---------------------------------------------------------------- the judge

def prompt_for(slug: str, pairs: list[dict]) -> str:
    lines = [
        "You check the owner's own statements about one project for conflicts. Each pair below holds two things the "
        "owner said at different times. Decide for each pair whether the newer statement conflicts with the older: "
        "both cannot hold at once (a different platform, price, stack, order, scope or date for the same thing).",
        "Not a conflict: the newer statement adds detail, follows the older one's own condition, covers a different "
        "thing, or the owner changing course on purpose with the reason stated in the newer one.",
        "When unsure, say no conflict.", "", f"Project: {slug}", ""]
    for p in pairs:
        lines += [f"### {p['id']}", f"older ({p['a']['date']}): {p['a']['text']}",
                  f"newer ({p['b']['date']}): {p['b']['text']}", ""]
    lines += ['For a conflict, `question` is one short question to the owner in plain words that names both sides and '
              'asks which holds, like "Android this week, or iOS only until 10 beta testers?". Empty for no conflict.',
              "Output only one JSON array, nothing else, one object per pair: "
              '[{"id": "<id>", "conflict": true | false, "question": "<X or Y?>"}]']
    return "\n".join(lines)


def ask_judge(prompt: str, model: str) -> tuple[list | None, dict]:
    """Run one claude -p turn on the subscription; (parsed array or None, run-log fields)."""
    cmd = ["claude", "-p", "--model", model, "--output-format", "json", "--no-session-persistence",
           "--max-turns", str(MAX_TURNS), "--settings", json.dumps({"disableAllHooks": True}), "--strict-mcp-config", "--setting-sources", ""]
    proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, cwd=ROOT, env=converse.subscription_env())
    try:
        data = json.loads(proc.stdout)
    except ValueError:
        return None, {"error": (proc.stderr or proc.stdout)[-300:], "limit": converse.is_limit(proc.stderr or proc.stdout)}
    result = data.get("result") or ""
    extra = {"turns": data.get("num_turns"), "list_price_usd": round(data.get("total_cost_usd") or 0, 4)}
    if data.get("is_error") or proc.returncode != 0:
        return None, {**extra, "error": result[-300:] or proc.stderr[-300:], "limit": converse.is_limit(result or proc.stderr)}
    try:
        return json.loads(re.search(r"\[.*\]", result, re.S).group(0)), extra
    except (ValueError, AttributeError) as error:
        return None, {**extra, "error": f"{error}: {result[-300:]}"}


def valid_verdicts(raw, pairs: list[dict]) -> dict[str, dict]:
    """{id: {conflict, question}} for each pair the judge answered properly; others are left to the next run."""
    ids = {p["id"] for p in pairs}
    out = {}
    for v in raw if isinstance(raw, list) else []:
        if not isinstance(v, dict) or v.get("id") not in ids or not isinstance(v.get("conflict"), bool):
            continue
        question = str(v.get("question") or "").strip()
        if v["conflict"] and not question:
            continue
        out[v["id"]] = {"conflict": v["conflict"], "question": question[:400] if v["conflict"] else ""}
    return out


def judge(slug: str, root: Path, days: int, model: str) -> tuple[int, int, bool]:
    """Judge a project's unjudged candidates in batches; (judged, conflicts, hit a usage limit)."""
    todo = pending(slug, root, days)
    judged = conflicts = 0
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        began = dt.datetime.now()
        raw, extra = ask_judge(prompt_for(slug, batch), model)
        verdicts = valid_verdicts(raw, batch)
        entry = {"scope": slug, "role": "judge", "engine": "claude", "model": model, "task": "contradict",
                 "started": began.isoformat(timespec="seconds"), "pairs": len(batch),
                 "seconds": round((dt.datetime.now() - began).total_seconds()), **extra}
        limit = bool(entry.pop("limit", False))
        if not verdicts:
            converse.log_run({**entry, "ok": False, "limit": limit,
                              "error": extra.get("error") or f"bad answer: {str(raw)[:300]}"})
            if limit:
                return judged, conflicts, True
            continue
        stored = load(slug, root)
        have = {e["id"] for e in stored}
        for p in batch:
            v = verdicts.get(p["id"])
            if not v or p["id"] in have:
                continue
            stored.append({"id": p["id"], "a": p["a"], "b": p["b"], "conflict": v["conflict"],
                           "question": v["question"], "status": "open" if v["conflict"] else "none",
                           "found": today().isoformat()})
            judged += 1
            conflicts += v["conflict"]
        save(slug, stored, root)
        converse.log_run({**entry, "ok": True, "judged": len(verdicts), "conflicts": sum(v["conflict"] for v in verdicts.values())})
    return judged, conflicts, False


# ---------------------------------------------------------------- the owner's answer

def find(slug: str, pair_id_: str, root: Path) -> tuple[list[dict], dict | None]:
    entries = load(slug, root)
    return entries, next((e for e in entries if e["id"] == pair_id_), None)


def next_decision_id(slug: str, existing: list) -> str:
    ids = [d.get("id") for d in existing if isinstance(d, dict) and isinstance(d.get("id"), str)]
    m = next((re.match(r"([A-Z0-9]+)-DEC-\d+$", i) for i in ids if re.match(r"([A-Z0-9]+)-DEC-\d+$", i)), None)
    prefix = m.group(1) if m else re.sub(r"[^A-Za-z0-9]", "", slug)[:3].upper() or "DEC"
    top = max([int(i.rsplit("-", 1)[1]) for i in ids if re.match(rf"{prefix}-DEC-\d+$", i)] or [0])
    return f"{prefix}-DEC-{top + 1:03d}"


def resolve(slug: str, pid: str, keep: str, note: str | None = None, root: Path | None = None) -> dict:
    """Mark a pair resolved and append the decision saying which holds. Returns the decision."""
    root = root or ROOT
    entries, e = find(slug, pid, root)
    if not e:
        raise SystemExit(f"no contradiction {pid} in {slug}")
    if keep not in ("a", "b", "both"):
        raise SystemExit("--keep takes a, b or both")
    day = today().isoformat()
    kept = e["a"]["text"] if keep == "a" else e["b"]["text"] if keep == "b" else f"{e['a']['text']} / {e['b']['text']}"
    other = e["b"] if keep == "a" else e["a"]
    rel = f"companies/{slug}/decisions.json"
    decisions = footprint.read_json(rel, root, [])
    decisions = decisions if isinstance(decisions, list) else []
    decision = {"id": next_decision_id(slug, decisions), "date": day,
                "decision": f"Both hold: {kept}" if keep == "both" else f"Holds: {kept}",
                "why": (f"{e.get('question')} " if e.get("question") else "") + (note or "").strip(),
                "alternatives": [] if keep == "both" else [other["text"]], "tradeoffs": [], "revisit": None,
                "source": {"type": "owner", "ref": f"{store_path(slug)}#{pid}", "date": day,
                           "note": "Answered the contradiction check."},
                "refs": [e["a"]["ref"], e["b"]["ref"]]}
    decision["why"] = decision["why"].strip()
    footprint.write_json(rel, [*decisions, decision], root)
    e.update({"status": "resolved", "resolved": {"keep": keep, "note": note or "", "date": day,
                                                 "decision": decision["id"]}})
    save(slug, entries, root)
    return decision


def dismiss(slug: str, pid: str, root: Path | None = None) -> None:
    root = root or ROOT
    entries, e = find(slug, pid, root)
    if not e:
        raise SystemExit(f"no contradiction {pid} in {slug}")
    e.update({"status": "dismissed", "dismissed": today().isoformat()})
    save(slug, entries, root)


# ---------------------------------------------------------------- command line

def slugs_of(slug: str | None) -> list[str]:
    return [slug] if slug else footprint.all_slugs(ROOT)


def show_pairs(slug: str, pairs: list[dict]) -> None:
    print(f"{slug}: {len(pairs)} candidate pairs")
    for p in pairs:
        print(f"  {p['id']}  [{', '.join(p['shared'][:6])}]")
        print(f"    {p['a']['date']}  {p['a']['text']}  ({p['a']['ref']})")
        print(f"    {p['b']['date']}  {p['b']['text']}  ({p['b']['ref']})")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("collect")
    s.add_argument("slug", nargs="?")
    s = sub.add_parser("candidates")
    s.add_argument("slug", nargs="?")
    s.add_argument("--days", type=int, default=DEFAULT_DAYS)
    s = sub.add_parser("check")
    s.add_argument("--slug")
    s.add_argument("--days", type=int, default=DEFAULT_DAYS)
    s.add_argument("--run", action="store_true", help="send the unjudged pairs to a Sonnet judge and store the verdicts")
    s.add_argument("--model", default="sonnet")
    s = sub.add_parser("list")
    s.add_argument("slug", nargs="?")
    s = sub.add_parser("resolve")
    s.add_argument("slug")
    s.add_argument("id")
    s.add_argument("--keep", required=True, choices=("a", "b", "both"))
    s.add_argument("--note")
    s = sub.add_parser("dismiss")
    s.add_argument("slug")
    s.add_argument("id")
    a = p.parse_args(argv)
    if a.cmd == "collect":
        for slug in slugs_of(a.slug):
            found = collect(slug, ROOT)
            print(f"{slug}: {len(found)} statements")
            for st in found if a.slug else []:
                print(f"  {st['date']}  {st['kind']:8} {st['text']}  ({st['ref']})")
    elif a.cmd in ("candidates", "check"):
        slugs = slugs_of(a.slug)
        total = 0
        for slug in slugs:
            if a.cmd == "check" and a.run:
                judged, conflicts, limit = judge(slug, ROOT, a.days, a.model)
                print(f"{slug}: judged {judged}, {conflicts} conflicts, {open_count(slug, ROOT)} open")
                if limit:
                    print("usage limit reached; the rest stay candidates for the next run", file=sys.stderr)
                    return 1
                continue
            pairs = pending(slug, ROOT, a.days) if a.cmd == "check" else candidates(slug, ROOT, a.days)
            total += len(pairs)
            if pairs:
                show_pairs(slug, pairs)
            elif a.slug:
                print(f"{slug}: 0 candidate pairs")
        if not (a.cmd == "check" and a.run):
            print(f"{total} candidate pairs in {len(slugs)} projects")
    elif a.cmd == "list":
        for slug in slugs_of(a.slug):
            for e in load(slug, ROOT):
                if e.get("status") == "open":
                    print(f"{slug} {e['id']}  {e.get('question')}\n    {e['a']['date']} {e['a']['text']}\n"
                          f"    {e['b']['date']} {e['b']['text']}")
    elif a.cmd == "resolve":
        d = resolve(a.slug, a.id, a.keep, a.note, ROOT)
        print(f"resolved; decision {d['id']}: {d['decision']}")
    else:
        dismiss(a.slug, a.id, ROOT)
        print("dismissed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
