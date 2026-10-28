#!/usr/bin/env python3
"""The one command agents coding in the owner's project repos use to read from and write back to Master-Repo.

Everything that isn't source code (notes, reports, mockups, screenshots, rules the owner states, session logs) lands
here as a dated file under companies/<slug>/ or standards/, so the project repo stays clean and the app's timeline
shows it. Writes under the data directory go through safe_fs (no symlink or hard-link redirection).

    inbox.py context <slug>                                     # orientation: card, open fronts, recent items, standards
    inbox.py note <slug> "<text>" [--title T] [--kind note|report|decision-needed] [--ref path]
    inbox.py mockup <slug> <file...> [--title T] [--question "..."] [--frame phone|desktop]
    inbox.py rule <area>[:<slug>] "<text>" [--scope generic|owner|project] [--project slug] [--source owner|code|agent (alex accepted as an alias)] [--ref ...]
    inbox.py done <slug> "<one line>"                           # end-of-session line in notes/<date>-sessions.md

Pass "-" as the text to read it from stdin.
"""
from __future__ import annotations

import argparse
import errno
import json
import os
import re
import stat
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import footprint  # noqa: E402
import paths  # noqa: E402
import safe_fs  # noqa: E402

ROOT = paths.ROOT
SCOPES = ("design", "structure", "deployment", "stack", "testing", "agent-files")
KINDS = ("note", "report", "decision-needed")
MAX_BYTES = 5 * 1024 * 1024
MOCKUP_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".html", ".css", ".pdf", ".md"}
DATED = re.compile(r"^\d{4}-\d{2}-\d{2}")


def now() -> datetime:
    return datetime.now()


def today() -> str:
    return now().strftime("%Y-%m-%d")


def slugify(text: str, limit: int = 60) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:limit].rstrip("-") or "untitled")


def q(value: str) -> str:
    """A frontmatter value as a JSON string, so quotes and colons are safe."""
    return json.dumps(value, ensure_ascii=False)


def frontmatter(text: str) -> tuple[dict, str]:
    """Top-level `key: value` lines (JSON-quoted values unquoted); nested YAML is ignored."""
    m = re.match(r"---\n(.*?)\n---\n?(.*)", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if line.startswith((" ", "\t", "-")) or ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if value.startswith('"'):
            try:
                value = json.loads(value)
            except ValueError:
                value = value.strip('"')
        meta[key.strip()] = value
    return meta, m.group(2)


def from_label() -> str:
    """The project repo this runs from (folder holding .git, found without running git), else 'project-agent'."""
    here = Path.cwd().resolve()
    for d in (here, *here.parents):
        if (d / ".git").exists():
            return "project-agent" if d in (paths.CODE, ROOT) else d.name
    return "project-agent"


def company_dir(slug: str) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug or "") or not (ROOT / "companies" / slug / "company.json").is_file():
        raise SystemExit(f"no project '{slug}' (companies/{slug}/company.json); slugs: {', '.join(known_slugs())}")
    return ROOT / "companies" / slug


def known_slugs() -> list[str]:
    return sorted(p.parent.name for p in (ROOT / "companies").glob("*/company.json") if not p.parent.name.startswith("_"))


def text_arg(value: str) -> str:
    text = sys.stdin.read() if value == "-" else value
    if not text.strip():
        raise SystemExit("empty text")
    return text.strip()


# --- safe writes ---------------------------------------------------------------------------------------

def rel_parts(path: Path) -> list[str]:
    return list(path.relative_to(ROOT).parts)


def read_text(path: Path) -> str | None:
    parts = rel_parts(path)
    try:
        dfd = safe_fs.open_dirs(ROOT, parts[:-1])
    except FileNotFoundError:
        return None
    try:
        return safe_fs.read_single(parts[-1], dir_fd=dfd).decode()
    except FileNotFoundError:
        return None
    finally:
        os.close(dfd)


def write_bytes(path: Path, data: bytes) -> None:
    parts = rel_parts(path)
    dfd = safe_fs.open_dirs(ROOT, parts[:-1], create=True)
    try:
        safe_fs.write_at(dfd, parts[-1], data)
    finally:
        os.close(dfd)


def free_name(folder: Path, stem: str, suffix: str = ".md") -> Path:
    """folder/stem+suffix, or stem-2, stem-3… when that's taken."""
    n, path = 1, folder / f"{stem}{suffix}"
    while path.exists() or path.is_symlink():
        n += 1
        path = folder / f"{stem}-{n}{suffix}"
    return path


# --- note ----------------------------------------------------------------------------------------------

def cmd_note(slug: str, text: str, title: str | None, kind: str, ref: str | None) -> Path:
    base = company_dir(slug)
    title = (title or text.splitlines()[0])[:80].strip()
    date = today()
    folder = base / ("reports" if kind == "report" else "notes")
    path = free_name(folder, f"{date}-{slugify(title)}")
    head = ["---", f"title: {q(title)}", f"kind: {kind}", f"date: {date}", "written_by: agent",
            f"from: {q(from_label())}", f"ref: {q(ref or '')}", "---", ""]
    write_bytes(path, ("\n".join(head) + "\n" + text + "\n").encode())
    return path


# --- mockup --------------------------------------------------------------------------------------------

def cmd_mockup(slug: str, files: list[str], title: str | None, question: str | None, frame: str) -> Path | None:
    base = company_dir(slug)
    sources, refused = [], []
    git_dir = os.path.realpath(paths.CODE / ".git")
    for f in files:
        p = Path(f).expanduser()
        real = os.path.join(os.path.realpath(p.parent), p.name)
        if p.suffix.lower() not in MOCKUP_EXT:
            refused.append(f"{f}: extension not allowed (png, jpg, jpeg, webp, gif, svg, html, css, pdf, md)")
        elif footprint.private(p.name):
            refused.append(f"{f}: private-looking file name")
        elif any(part.startswith(".env") for part in Path(real).parts) or real == git_dir \
                or real.startswith(git_dir + os.sep):
            refused.append(f"{f}: inside .git or an .env path")
        else:
            try:
                fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
            except OSError as e:
                refused.append(f"{f}: " + ("links are refused" if e.errno in (errno.ELOOP, errno.EMLINK)
                                           else "not found or unreadable"))
                continue
            try:
                st = os.fstat(fd)
                if not stat.S_ISREG(st.st_mode):
                    refused.append(f"{f}: not a plain file")
                elif st.st_nlink != 1:
                    refused.append(f"{f}: hard-linked file")
                elif st.st_size > MAX_BYTES:
                    refused.append(f"{f}: {st.st_size / 1048576:.1f} MB is over the 5 MB limit; shrink or crop it")
                else:
                    with os.fdopen(fd, "rb", closefd=False) as fh:
                        data = fh.read(MAX_BYTES + 1)
                    if len(data) > MAX_BYTES:
                        refused.append(f"{f}: over the 5 MB limit")
                    else:
                        sources.append((p, data))
            finally:
                os.close(fd)
    for r in refused:
        print(f"refused {r}", file=sys.stderr)
    if not sources:
        print("nothing to copy", file=sys.stderr)
        return None
    names = [p.name for p, _ in sources]
    if len(set(names)) != len(names):
        raise SystemExit("two files share a name; rename one")
    title = (title or Path(names[0]).stem.replace("-", " ").replace("_", " ")).strip()
    date = today()
    folder = free_name(base / "mockups", f"{date}-{slugify(title)}", "")
    for p, data in sources:
        write_bytes(folder / p.name, data)
    first = "index.html" if "index.html" in names else names[0]
    screens = [first] + [n for n in names if n != first]
    head = ["---", f"title: {q(title)}", f"date: {date}", "status: open", 'thread: ""', f"frame: {frame}",
            "written_by: agent", f"from: {q(from_label())}", "screens:"]
    head += [f"  - {{ file: {q(n)}, label: {q(Path(n).stem.replace('-', ' ').replace('_', ' '))} }}" for n in screens]
    if question:
        head += ["questions:", f"  - ask: {q(question)}", '    shown: ""', f"    screen: {q(first)}"]
    else:
        head.append("questions: []")
    head += ["---", "", "| Choice in the mockup | Gains | Costs |", "| --- | --- | --- |",
             "| not written by the agent that sent this | | |", ""]
    write_bytes(folder / "review.md", "\n".join(head).encode())
    return folder


# --- rule ----------------------------------------------------------------------------------------------

def company_names() -> dict[str, str]:
    out = {}
    for f in (ROOT / "companies").glob("*/company.json"):
        if f.parent.name.startswith("_"):
            continue
        try:
            name = json.loads(f.read_text()).get("name")
        except (OSError, ValueError):
            name = None
        out[f.parent.name] = name if isinstance(name, str) and name.strip() else f.parent.name
    return out


def rule_line(text: str, source: str, ref: str | None, date: str) -> str:
    text = text.strip()
    if not text.endswith((".", "!", "?")):
        text += "."
    source = "owner" if source == "alex" else source
    return f"- {text} ({source}: {ref}, {date})" if ref else f"- {text} ({source}, {date})"


def cmd_rule(area: str, text: str, source: str, ref: str | None,
             scope: str | None = None, project: str | None = None) -> Path:
    area, _, legacy = area.partition(":")
    if area not in SCOPES:
        raise SystemExit(f"area must be one of {', '.join(SCOPES)}")
    if legacy:
        if scope not in (None, "project") or project not in (None, legacy):
            raise SystemExit("legacy area:slug conflicts with --scope or --project")
        scope, project = "project", legacy
    if scope is None:
        scope = "owner"
        print("scope: owner (default)")
    if scope == "project":
        if not project:
            raise SystemExit("--project is required for --scope project")
        base = company_dir(project)
        path = base / "standards.md"
    else:
        if project:
            raise SystemExit("--project requires --scope project")
        path = ROOT / ("standards" if scope == "generic" else "local/standards") / f"{area}.md"
    date = today()
    name = area.replace("-", " ").capitalize()
    current = read_text(path)
    if current is None:
        current = f"---\ntitle: {q(name if scope != 'project' else 'Standards')}\nupdated: {date}\nwritten_by: agent\n---\n\n# {name if scope != 'project' else 'Standards'}\n"
    lines = current.rstrip().split("\n")
    heading = f"## {area}" if scope == "project" else "## Shared"
    if heading not in lines:
        lines += ["", heading, ""]
    start = lines.index(heading) + 1
    end = next((i for i in range(start, len(lines)) if lines[i].startswith("## ")), len(lines))
    while end > start and not lines[end - 1].strip():
        end -= 1
    lines[end:end] = [rule_line(text, source, ref, date), ""]
    out = "\n".join(lines).rstrip() + "\n"
    out = re.sub(r"(?m)^updated: .*$", f"updated: {date}", out, count=1)
    write_bytes(path, out.encode())
    return path


# --- done ----------------------------------------------------------------------------------------------

def cmd_done(slug: str, text: str) -> Path:
    base = company_dir(slug)
    date = today()
    path = base / "notes" / f"{date}-sessions.md"
    current = read_text(path)
    if current is None:
        current = "\n".join(["---", f"title: {q('Sessions ' + date)}", "kind: sessions", f"date: {date}",
                             "written_by: agent", "---", "", ""])
    line = f"- {now().strftime('%H:%M')} {' '.join(text.split())}"
    body = current.rstrip("\n")
    write_bytes(path, (body + ("\n\n" if body.endswith("---") else "\n") + line + "\n").encode())
    return path


# --- context -------------------------------------------------------------------------------------------

def field(value) -> str:
    if isinstance(value, dict):
        return str(value.get("text") or "").strip()
    return str(value or "").strip()


def clip(text: str, limit: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def card_lines(base: Path) -> list[str]:
    f = base / "card.json"
    if not f.is_file():
        return [f"No card yet (`{f.relative_to(ROOT)}`)."]
    try:
        card = json.loads(f.read_text())
    except ValueError:
        return [f"`{f.relative_to(ROOT)}` isn't valid JSON."]
    out = []
    if card.get("kind"):
        out.append(f"Finish line: {card['kind']}")
    for key, label in (("goal", "Goal"), ("blocker", "Blocker"), ("next", "Next")):
        if field(card.get(key)):
            out.append(f"{label}: {clip(field(card.get(key)))}")
    gates = [g for g in card.get("gates") or [] if isinstance(g, dict) and g.get("state") != "done"]
    if gates:
        out.append("Open gates:")
        room = 11 - len(out)
        for g in gates[:room]:
            note = f": {clip(g['note'], 90)}" if g.get("note") else ""
            out.append(f"- {g.get('name')} ({g.get('state', 'unknown')}){note}")
        if len(gates) > room:
            out[-1] = f"- …and {len(gates) - room + 1} more in card.json"
    return out[:12] or ["Card is empty."]


def front_lines(base: Path) -> list[str]:
    out = []
    for p in sorted((base / "wiki" / "fronts").glob("*.md")):
        meta, _ = frontmatter(p.read_text())
        if meta.get("status", "open") in ("open", "working"):
            out.append(f"- {meta.get('title', p.stem)} ({meta.get('status', 'open')}): {clip(meta.get('summary', ''), 140)}")
    return out


def recent_items(base: Path, n: int = 5) -> list[str]:
    items = []
    for kind in ("notes", "reports", "mockups", "builds"):
        d = base / kind
        if not d.is_dir():
            continue
        for p in d.iterdir():
            if not DATED.match(p.name) or p.name.startswith("."):
                continue
            meta_file = {"mockups": p / "review.md", "builds": p / "build.md"}.get(kind, p)
            title = ""
            if meta_file.is_file():
                title = frontmatter(meta_file.read_text())[0].get("title", "")
            items.append((p.name[:10], p.name, kind, clip(title or p.stem[11:].replace("-", " "), 90), p))
    items.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [f"- {d} {k[:-1] if k != 'notes' else 'note'}: {t} (`{p.relative_to(ROOT)}`)" for d, _, k, t, p in items[:n]]


def standards_lines(project: str | None = None) -> list[str]:
    import rules
    return [f"- `{file.relative_to(ROOT)}` ({scope}; {len(file.read_text().splitlines())} lines)"
            for scope, _, file in rules.rule_files(ROOT, project)]


def cmd_context(slug: str) -> str:
    base = company_dir(slug)
    try:
        name = json.loads((base / "company.json").read_text()).get("name") or slug
    except ValueError:
        name = slug
    parts = [f"# {name} (`companies/{slug}/` in {ROOT})", "", "## Card", *card_lines(base)]
    decisions_file = base / "decisions.json"
    decisions = json.loads(decisions_file.read_text()) if decisions_file.is_file() else []
    decisions = sorted(decisions, key=lambda d: d.get("date") or "", reverse=True)[:8]
    def decision_line(d):
        text = d.get("decision") or d.get("title") or "Untitled decision"
        if isinstance(text, dict):
            text = text.get("text", "")
        return f"- {d.get('date') or 'undated'}: {' '.join(str(text).split())[:220]}"
    parts += ["", "## Recent decisions", *([decision_line(d) for d in decisions] or ["None recorded."])]
    fronts = front_lines(base)
    parts += ["", "## Open fronts", *(fronts[:6] or ["None open."])]
    parts += ["", "## Recent", *(recent_items(base) or ["Nothing dated yet."])]
    std = standards_lines(slug)
    parts += ["", "## Standards (read the ones that touch your task)", *(std or ["None written yet."])]
    tool = f"python3 {paths.CODE / 'tools' / 'inbox.py'}"
    parts += ["", f"Write back: `{tool} note|mockup|rule|done {slug} ...` (`--help` for each)."]
    return "\n".join(parts[:69])


# --- cli -----------------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("context", help="orientation for a coding agent")
    p.add_argument("slug")
    p = sub.add_parser("note", help="a dated note or report")
    p.add_argument("slug"); p.add_argument("text")
    p.add_argument("--title"); p.add_argument("--kind", choices=KINDS, default="note"); p.add_argument("--ref")
    p = sub.add_parser("mockup", help="copy mockup files into a dated review folder")
    p.add_argument("slug"); p.add_argument("files", nargs="+")
    p.add_argument("--title"); p.add_argument("--question")
    p.add_argument("--frame", choices=("phone", "desktop"), default="phone")
    p = sub.add_parser("rule", help="append a sourced rule at the chosen level",
                       description="would this rule hold word for word in a repo with none of the owner's projects? yes → generic; about one project → project; otherwise owner")
    p.add_argument("area"); p.add_argument("text")
    p.add_argument("--scope", choices=("generic", "owner", "project"), default=None)
    p.add_argument("--project", help="project slug; required for project scope")
    p.add_argument("--source", choices=("owner", "alex", "code", "agent"), type=lambda v: "owner" if v == "alex" else v, default="agent"); p.add_argument("--ref")
    p = sub.add_parser("done", help="end-of-session line")
    p.add_argument("slug"); p.add_argument("text")
    a = ap.parse_args(argv)

    if a.cmd == "context":
        print(cmd_context(a.slug))
        return 0
    try:
        if a.cmd == "note":
            out = cmd_note(a.slug, text_arg(a.text), a.title, a.kind, a.ref)
        elif a.cmd == "mockup":
            out = cmd_mockup(a.slug, a.files, a.title, a.question, a.frame)
            if out is None:
                return 1
        elif a.cmd == "rule":
            out = cmd_rule(a.area, text_arg(a.text), a.source, a.ref, a.scope, a.project)
        else:
            out = cmd_done(a.slug, text_arg(a.text))
    except OSError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print(f"wrote {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
