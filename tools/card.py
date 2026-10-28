#!/usr/bin/env python3
"""Project cards: the first thing the owner sees for each project, in twelve lines or fewer.

companies/<slug>/card.json holds two kinds of keys:
  human    slug, kind, kind_source, goal, gates, blocker, next, updated (and any key this tool doesn't know):
           written by agents and the owner, never touched here
  derived  moved, owes, recheck, footprint, hygiene, tier, derived_at: rewritten by `refresh` from
           companies/<slug>/git/snapshot.json, holding/pulse.json, holding/portfolio.json,
           companies/<slug>/threads/*/thread.md, companies/<slug>/builds/*/build.md,
           companies/<slug>/footprint.json and companies/<slug>/hygiene.json. `recheck` counts the open questions
           tools/recheck.py flagged (commits since they were asked); it is kept apart from `owes`
A card that doesn't exist yet is created with the human keys empty and `"needs": "goal, gates, blocker, next"`.

Usage:
    card.py refresh <slug> | --all   # merge derived keys into card.json
    card.py show <slug>              # print the card
    card.py board                    # every card, what owes the owner or costs without moving first, then by idle days
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import footprint  # noqa: E402  (shared JSON and company helpers)
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)

HUMAN = ("slug", "kind", "kind_source", "goal", "gates", "blocker", "next", "updated")
NEEDED = ("goal", "gates", "blocker", "next")
TIERS = ("focus", "maintain", "paused", "undecided")
FOOTPRINT_KEYS = ("hosting", "database", "payments", "store", "domains", "public_urls_ok", "monthly_cost", "summary")
HYGIENE_KEYS = ("stray_root_files", "claude_md_lines", "agents_md_lines", "agent_files_last_edit", "pointer_ok",
                "untracked", "score")
IDLE_FOOTPRINT_DAYS = 30  # something hosted, stored or billed with no commit in this long is called out on the board


def today() -> dt.date:
    return dt.date.today()


def frontmatter(path: Path) -> dict:
    """The front matter of a thread.md or build.md, values JSON-decoded where they are JSON (as converse writes)."""
    import json
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return {}
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    meta = {}
    for line in (m.group(1).splitlines() if m else []):
        if ":" in line and not line.startswith(" "):
            key, value = line.split(":", 1)
            try:
                meta[key.strip()] = json.loads(value.strip())
            except ValueError:
                meta[key.strip()] = value.strip()
    return meta


def last_message(thread: Path) -> dict:
    msgs = sorted(thread.glob("[0-9][0-9][0-9]-*.md"))
    return frontmatter(msgs[-1]) if msgs else {}


# ---------------------------------------------------------------- derived

def moved(slug: str, root: Path) -> dict:
    pulse = footprint.read_json("holding/pulse.json", root, {}) or {}
    row = next((r for r in pulse.get("projects") or [] if r.get("slug") == slug), None)
    snap = footprint.read_json(f"companies/{slug}/git/snapshot.json", root, {}) or {}
    last = row.get("last_commit") if row else None
    if not last:
        last = max((r.get("last") for r in snap.get("repos") or [] if r.get("last")), default=None)
    try:
        idle = (today() - dt.date.fromisoformat(last)).days if last else None
    except ValueError:
        idle = None
    return {"last_commit": last, "idle_days": idle, "commits_30d": row.get("commits_30d") if row else None,
            "uncommitted": row.get("uncommitted") if row else None, "branches": row.get("branches") if row else None}


def owes(slug: str, root: Path) -> dict:
    out = {"decisions": 0, "builds_review": 0, "builds_approved_unrun": 0, "threads_awaiting": 0}
    for t in sorted((root / "companies" / slug / "threads").glob("*/thread.md")):
        meta = frontmatter(t)
        if meta.get("status") not in ("awaiting-alex", "awaiting-owner"):
            continue
        if meta.get("decision") or last_message(t.parent).get("kind") == "decision":
            out["decisions"] += 1
        else:
            out["threads_awaiting"] += 1
    for b in sorted((root / "companies" / slug / "builds").glob("*/build.md")):
        status = frontmatter(b).get("status")
        if status == "review":
            out["builds_review"] += 1
        elif status == "approved":
            out["builds_approved_unrun"] += 1
    return out


def recheck(slug: str, root: Path) -> int:
    """Open questions tools/recheck.py flagged: threads awaiting the owner, builds in review, the card's blocker and next."""
    n = 0
    for t in (root / "companies" / slug / "threads").glob("*/thread.md"):
        meta = frontmatter(t)
        n += meta.get("status") in ("awaiting-alex", "awaiting-owner", "stale") and bool(meta.get("recheck_commits"))
    for b in (root / "companies" / slug / "builds").glob("*/build.md"):
        meta = frontmatter(b)
        n += meta.get("status") == "review" and bool(meta.get("recheck_commits"))
    data = footprint.read_json(f"companies/{slug}/card.json", root)
    for key in ("blocker", "next"):
        line = data.get(key) if isinstance(data, dict) else None
        n += isinstance(line, dict) and bool((line.get("recheck") or {}).get("commits"))
    return n


def tier(slug: str, root: Path) -> str:
    data = footprint.read_json("holding/portfolio.json", root, {}) or {}
    return next((t for t in TIERS if slug in (data.get(t) or [])), "undecided")


def derived(slug: str, root: Path) -> dict:
    fp = footprint.read_json(f"companies/{slug}/footprint.json", root)
    hy = footprint.read_json(f"companies/{slug}/hygiene.json", root)
    return {
        "moved": moved(slug, root),
        "owes": owes(slug, root),
        "recheck": recheck(slug, root),
        "footprint": {k: fp.get(k) for k in FOOTPRINT_KEYS} if isinstance(fp, dict) else None,
        "hygiene": {k: hy.get(k) for k in HYGIENE_KEYS} if isinstance(hy, dict) else None,
        "tier": tier(slug, root),
        "derived_at": today().isoformat(),
    }


def missing(card: dict) -> list[str]:
    return [k for k in NEEDED if not card.get(k)]


def refresh(slug: str, root: Path | None = None) -> dict:
    root = root or ROOT
    rel = f"companies/{slug}/card.json"
    card = footprint.read_json(rel, root)
    if not isinstance(card, dict):
        card = {"slug": slug, "kind": None, "kind_source": None, "goal": None, "gates": [], "blocker": None,
                "next": None, "updated": None}
    card.update(derived(slug, root))
    need = missing(card)
    if need:
        card["needs"] = ", ".join(need)
    else:
        card.pop("needs", None)
    footprint.write_json(rel, card, root)
    return card


# ---------------------------------------------------------------- printing

def text_of(field) -> str | None:
    if isinstance(field, dict):
        return field.get("text")
    return field if isinstance(field, str) else None


def owes_total(card: dict) -> int:
    return sum(v for v in (card.get("owes") or {}).values() if isinstance(v, int))


def has_footprint(card: dict) -> bool:
    fp = card.get("footprint") or {}
    hosting = [h for h in fp.get("hosting") or [] if h not in ("xcode", "docker", "procfile", "fastlane")]
    return bool(hosting or fp.get("database") or fp.get("payments"))


def footprint_idle(card: dict) -> bool:
    idle = (card.get("moved") or {}).get("idle_days")
    return has_footprint(card) and (idle is None or idle >= IDLE_FOOTPRINT_DAYS)


def moved_line(m: dict) -> str:
    if not m or not m.get("last_commit"):
        return "no commits found"
    bits = [f"last commit {m['last_commit']} ({m['idle_days']}d idle)"]
    if m.get("commits_30d") is not None:
        bits.append(f"{m['commits_30d']} commits/30d")
    if m.get("uncommitted"):
        bits.append(f"{m['uncommitted']} uncommitted")
    if m.get("branches"):
        bits.append(f"{m['branches']} branches off main")
    return " · ".join(bits)


def owes_line(o: dict) -> str:
    labels = (("decisions", "decision", "decisions"), ("threads_awaiting", "thread awaiting", "threads awaiting"),
              ("builds_review", "build to review", "builds to review"),
              ("builds_approved_unrun", "approved build not run", "approved builds not run"))
    bits = [f"{o[k]} {one if o[k] == 1 else many}" for k, one, many in labels if (o or {}).get(k)]
    return " · ".join(bits) or "nothing"


def hygiene_line(h: dict | None) -> str:
    if not h or not h.get("score"):
        return "not checked"
    bits = []
    if h.get("stray_root_files"):
        bits.append(f"{h['stray_root_files']} stray files")
    biggest = max(h.get("claude_md_lines") or 0, h.get("agents_md_lines") or 0)
    if biggest >= 150:
        bits.append(f"agent file {biggest} lines")
    if h.get("pointer_ok") is False:
        bits.append("no pointer")
    return h["score"] + (f" ({', '.join(bits)})" if bits else "")


def show_lines(card: dict, name: str | None = None) -> list[str]:
    kind = card.get("kind") or "kind ?"
    if card.get("kind") and card.get("kind_source") and card["kind_source"] not in ("alex", "owner"):
        kind += f" ({card['kind_source']})"
    lines = [f"{name or card.get('slug')} · {kind} · {card.get('tier') or 'undecided'}"]
    lines.append(f"Goal: {text_of(card.get('goal')) or '?'}")
    gates = card.get("gates") or []
    if gates:
        mark = {"done": "✓", "open": "○"}
        lines.append("Finish gates: " + "  ".join(f"{mark.get(g.get('state'), '?')} {g.get('name')}" for g in gates))
    else:
        lines.append("Finish gates: ?")
    lines.append(f"Blocker: {text_of(card.get('blocker')) or '?'}")
    lines.append(f"Next: {text_of(card.get('next')) or '?'}")
    fp = card.get("footprint")
    lines.append(f"Footprint: {fp.get('summary') if fp else 'not scanned'}")
    lines.append(f"Hygiene: {hygiene_line(card.get('hygiene'))}")
    lines.append(f"Moved: {moved_line(card.get('moved') or {})}")
    lines.append(f"Owes: {owes_line(card.get('owes') or {})}")
    if card.get("needs"):
        lines.append(f"Needs: {card['needs']}")
    return lines


def load(slug: str, root: Path) -> dict | None:
    card = footprint.read_json(f"companies/{slug}/card.json", root)
    return card if isinstance(card, dict) else None


def board_order(cards: list[dict]) -> list[dict]:
    def key(c: dict):
        idle = (c.get("moved") or {}).get("idle_days")
        flagged = owes_total(c) > 0 or footprint_idle(c)
        return (0 if flagged else 1, -(idle if idle is not None else 10 ** 6), c.get("slug") or "")
    return sorted(cards, key=key)


def board_lines(root: Path) -> list[str]:
    cards = [c for c in (load(s, root) for s in footprint.all_slugs(root)) if c]
    out = []
    for c in board_order(cards):
        m = c.get("moved") or {}
        flags = []
        if owes_total(c):
            flags.append(f"owes {owes_line(c.get('owes') or {})}")
        if footprint_idle(c):
            flags.append("footprint, no movement")
        if c.get("recheck"):
            flags.append(f"{c['recheck']} to recheck")
        idle = f"{m['idle_days']}d idle" if m.get("idle_days") is not None else "no commits"
        fp = (c.get("footprint") or {}).get("summary") or "not scanned"
        hy = (c.get("hygiene") or {}).get("score") or "-"
        out.append(f"{c.get('slug'):22} {c.get('tier') or '':9} {idle:12} hygiene {hy:5} {fp}")
        nxt = text_of(c.get("next"))
        detail = flags + ([f"next: {nxt}"] if nxt else []) + ([f"needs {c['needs']}"] if c.get("needs") else [])
        if detail:
            out.append(f"{'':22} " + " · ".join(detail))
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("refresh", help="merge derived keys into companies/<slug>/card.json")
    s.add_argument("slug", nargs="?")
    s.add_argument("--all", action="store_true", help="every project")
    s = sub.add_parser("show", help="print one card (12 lines or fewer)")
    s.add_argument("slug")
    sub.add_parser("board", help="every card, sorted: owes or idle footprint first, then by idle days")
    a = p.parse_args(argv)
    if a.cmd == "refresh":
        if bool(a.slug) == a.all:
            p.error("give a slug or --all")
        for slug in footprint.all_slugs(ROOT) if a.all else [a.slug]:
            if not (ROOT / "companies" / slug / "company.json").is_file():
                p.error(f"no companies/{slug}/company.json")
            c = refresh(slug)
            print(f"{slug:22} {moved_line(c['moved'])}" + (f"  needs {c['needs']}" if c.get("needs") else ""))
    elif a.cmd == "show":
        card = load(a.slug, ROOT)
        if card is None:
            print(f"no card for {a.slug}; run: card.py refresh {a.slug}", file=sys.stderr)
            return 1
        name = footprint.company(a.slug, ROOT).get("name")
        print("\n".join(show_lines(card, name if isinstance(name, str) else None)))
    else:
        print("\n".join(board_lines(ROOT)) or "no cards yet; run: card.py refresh --all")
    return 0


if __name__ == "__main__":
    sys.exit(main())
