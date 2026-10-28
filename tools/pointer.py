#!/usr/bin/env python3
"""Put a MASTER-REPO.md and a marked "Master record" block into every tracked project repo.

The templates live in agents/pointer.md. For each repo path in companies/<slug>/company.json `repos[*].path` (grouped
by path, so a repo shared by several slugs gets one file listing all of them), install renders MASTER-REPO.md at the
repo root and puts the block between <!-- master-repo:start --> and <!-- master-repo:end --> in the agent file:

- AGENTS.md when it exists;
- CLAUDE.md too, unless it has an `@AGENTS.md` import line (Claude Code loads the import, so a second block would
  be seen twice); a block install put there earlier is taken out again;
- a new CLAUDE.md holding just the block when neither exists.

Files are deduplicated by their resolved path (an AGENTS.md symlinked to CLAUDE.md is one file). Re-running replaces
what's between the markers and leaves every other byte alone. Nothing else in a project repo is touched, and no git
command runs there.

    pointer.py install <slug> | --all      # write MASTER-REPO.md and the block
    pointer.py check [<slug> | --all]      # one line per repo; exit 1 when anything is missing or stale
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT
TEMPLATE = paths.CODE / "agents" / "pointer.md"
FILE_NAME = "MASTER-REPO.md"
START, END = "<!-- master-repo:start -->", "<!-- master-repo:end -->"
FENCE = re.compile(r"^````markdown\n(.*?)^````$", re.S | re.M)
BLOCK = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
IMPORT = re.compile(r"@(\./)?AGENTS\.md")


def templates(path: Path | None = None) -> tuple[str, str]:
    """(MASTER-REPO.md template, agent-file block template): the two ````markdown fences in agents/pointer.md."""
    found = FENCE.findall((path or TEMPLATE).read_text())
    if len(found) != 2:
        raise SystemExit(f"{path or TEMPLATE}: expected two ````markdown templates, found {len(found)}")
    return found[0], found[1].rstrip("\n")


def repo_slugs(root: Path | None = None) -> dict[str, list[str]]:
    """{repo path: [slugs]} from every companies/<slug>/company.json, in slug order."""
    out: dict[str, list[str]] = {}
    for f in sorted(((root or ROOT) / "companies").glob("*/company.json")):
        slug = f.parent.name
        if slug.startswith("_"):
            continue
        try:
            repos = json.loads(f.read_text()).get("repos") or []
        except (OSError, ValueError):
            print(f"warning: can't read {f}", file=sys.stderr)
            continue
        for r in repos:
            p = r.get("path") if isinstance(r, dict) else None
            if isinstance(p, str) and p.strip():
                out.setdefault(p.strip(), [])
                if slug not in out[p.strip()]:
                    out[p.strip()].append(slug)
    return out


def render(template: str, repo: Path, slugs: list[str], root: Path | None = None) -> str:
    root = root or ROOT
    owner_file = root / "local/owner.json"
    owner = json.loads(owner_file.read_text()) if owner_file.is_file() else {}
    template = template.replace("Master-Repo", owner.get("hub") or "Master-Repo")
    template = template.replace("~/Documents/GitHub/" + (owner.get("hub") or "Master-Repo"), str(root))
    lines = [f"- `{s}`: `companies/{s}/`" for s in slugs]
    if len(slugs) > 1:
        lines.append("\nThis repo is shared by these projects. Ask the owner which one a task is for unless it's obvious.")
    values = {
        "repo_name": repo.name,
        "slugs": ", ".join(f"`{s}`" for s in slugs),
        "slug_lines": "\n".join(lines),
        "slug_arg": slugs[0] if len(slugs) == 1 else "<slug>",
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values[m.group(1)], template)


def imports_agents(text: str) -> bool:
    """True when a CLAUDE.md has an @AGENTS.md import line anywhere (HTML comments ignored)."""
    return any(IMPORT.fullmatch(ln.strip()) for ln in re.sub(r"<!--.*?-->", "", text, flags=re.S).splitlines())


def agent_files(repo: Path) -> tuple[list[tuple[Path, bool]], list[Path]]:
    """([(file, exists)] that should carry the block, [files that shouldn't]), deduplicated by resolved path."""
    agents, claude = repo / "AGENTS.md", repo / "CLAUDE.md"
    if not agents.is_file() and not claude.is_file():
        return [(claude, False)], []
    picks: list[Path] = [agents] if agents.is_file() else []
    drop: list[Path] = []
    if claude.is_file():
        if agents.is_file() and imports_agents(claude.read_text()):
            drop.append(claude.resolve())
        else:
            picks.append(claude)
    seen, out = set(), []
    for p in picks:
        r = p.resolve()
        if r not in seen:
            seen.add(r)
            out.append((r, True))
    return out, [d for d in drop if d not in seen]


def with_block(text: str | None, block: str) -> str:
    if text is None:
        return block + "\n"
    if BLOCK.search(text):
        return BLOCK.sub(lambda _: block, text, count=1)
    return text + ("" if text.endswith("\n") or not text else "\n") + ("\n" if text else "") + block + "\n"


def without_block(text: str) -> str:
    """Take out a block (and the blank line install put before it); every other byte stays."""
    return re.sub(r"\n?" + BLOCK.pattern + r"\n?", "", text, count=1, flags=re.S)


def plan(repo: Path, slugs: list[str], tpl: tuple[str, str], root: Path | None = None) -> list[tuple[Path, str, str | None]]:
    """[(path, wanted content, current content or None)] for one repo."""
    out = []
    target = repo / FILE_NAME
    out.append((target, render(tpl[0], repo, slugs, root), target.read_text() if target.is_file() else None))
    block = render(tpl[1], repo, slugs, root)
    carry, drop = agent_files(repo)
    for f, exists in carry:
        current = f.read_text() if exists else None
        out.append((f, with_block(current, block), current))
    for f in drop:
        current = f.read_text()
        if BLOCK.search(current):
            out.append((f, without_block(current), current))
    return out


def label(repo: Path, f: Path) -> str:
    try:
        return str(f.relative_to(repo.resolve()))
    except ValueError:
        return str(f.relative_to(repo)) if f.is_relative_to(repo) else str(f)


def select(slug: str | None, all_: bool) -> list[tuple[Path, list[str]]]:
    groups = repo_slugs()
    if not all_:
        if not (ROOT / "companies" / slug / "company.json").is_file():
            raise SystemExit(f"no companies/{slug}/company.json")
        groups = {p: s for p, s in groups.items() if slug in s}
    return [(Path(p), s) for p, s in groups.items()]


def cmd_install(slug: str | None, all_: bool) -> int:
    tpl = templates()
    for repo, slugs in select(slug, all_):
        if not repo.is_dir():
            print(f"warning: {repo} doesn't exist; skipped", file=sys.stderr)
            continue
        changed = []
        for f, want, have in plan(repo, slugs, tpl):
            if want != have:
                f.write_text(want)
                changed.append(label(repo, f) + (" (created)" if have is None else ""))
        print(f"{repo}: {', '.join(changed) if changed else 'up to date'}")
    return 0


def cmd_check(slug: str | None, all_: bool) -> int:
    tpl, drift = templates(), False
    for repo, slugs in select(slug, all_):
        if not repo.is_dir():
            print(f"skip     {repo} (doesn't exist)")
            continue
        issues = []
        for f, want, have in plan(repo, slugs, tpl):
            name = label(repo, f)
            if have is None:
                issues.append(f"{name} missing")
            elif f.name != FILE_NAME and not BLOCK.search(want):
                issues.append(f"{name} has a block it shouldn't")
            elif f.name != FILE_NAME and not BLOCK.search(have):
                issues.append(f"{name} has no block")
            elif want != have:
                issues.append(f"{name} stale")
        drift = drift or bool(issues)
        print(f"{'drift' if issues else 'ok':8} {repo}" + (f" ({'; '.join(issues)})" if issues else ""))
    return 1 if drift else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("install", "check"):
        p = sub.add_parser(name)
        p.add_argument("slug", nargs="?")
        p.add_argument("--all", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "install" and not (a.slug or a.all):
        ap.error("install needs a slug or --all")
    if a.slug and a.all:
        ap.error("give a slug or --all, not both")
    all_ = a.all or not a.slug
    return cmd_install(a.slug, all_) if a.cmd == "install" else cmd_check(a.slug, all_)


if __name__ == "__main__":
    sys.exit(main())
