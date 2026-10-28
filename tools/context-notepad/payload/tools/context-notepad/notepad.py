#!/usr/bin/env python3
"""Create and maintain thread notepads: one folder per line of work.

A thread is `<notepad_dir>/<thread>/` holding `notepad.md`, `briefs/` and
`mockups/`, plus `<notepad_dir>/INDEX.md` with one line per thread (title,
status, scope words). The notepad keeps the owner's words and the agent's
reading of them side by side so a later session, on either agent, can resume
without re-deriving the direction. Sections, in order: Vision, Interpretation,
Drift, Next, Done, Artifacts, Sessions.

Rules the tool enforces:
  - Vision only receives verbatim owner quotes, through `quote`.
  - Next items carry ids (`- [ ] N3 text`). `check` moves an item to Done with
    required evidence; `drop` and `block` mark it in place with a reason.
    Nothing is ever deleted.
  - Interpretation may be replaced (--replace). Any edit to existing lines
    first copies the notepad into the thread's .history/ folder.
  - Briefs copy Vision quotes verbatim by index and never paraphrase.
  - Every write is a dry run unless --apply is given.

Why it exists: a notepad, not a manager. It records and surfaces; it never
plans or steers. `route` and `audit` are helpers, the agent decides.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from session_digest import select_sessions  # noqa: E402
from transcript_sources import Config, effective_prefixes, find_git_root, load_config, resolve_project_path  # noqa: E402

SECTIONS = ("Vision", "Interpretation", "Drift", "Next", "Done", "Artifacts", "Sessions")
REPLACEABLE_SECTIONS = ("Interpretation",)
# Sections with their own command; `add` refuses them so ids and quoting stay honest.
COMMAND_ONLY_SECTIONS = {
    "Vision": "notepad.py quote THREAD --session ID --turn N",
    "Next": "notepad.py next THREAD \"text\"",
    "Artifacts": "notepad.py artifact THREAD PATH --note \"...\"",
}

NOTEPAD_FILE = "notepad.md"
INDEX_FILE = "INDEX.md"
BRIEFS_DIR = "briefs"
MOCKUPS_DIR = "mockups"
HISTORY_DIR_NAME = ".history"
DEFAULT_STATUS = "active"
BRIEF_SLUG_WORDS = 6
STOP_WORDS = frozenset(
    "the and for with that this from into about make add fix use new are was has have not but you "
    "can should would could please just want need all any our out how what when where why".split()
)
MIN_ROUTE_WORD_CHARS = 3
ROUTE_STEM_CHARS = 5

SECTION_HEADING = re.compile(r"^## (.+?)\s*$")
META_LINE = re.compile(r"^(Thread|Status|Scope|Created): ?(.*)$")
ITEM_LINE = re.compile(r"^- \[([ x~!])\] (N\d+) (.*)$")
ITEM_ID = re.compile(r"\bN(\d+)\b")
OPEN_MARK, DONE_MARK, DROPPED_MARK, BLOCKED_MARK = " ", "x", "~", "!"


# ---------------------------------------------------------------------------
# Paths: every notepad location is derived here.
# ---------------------------------------------------------------------------

def notepad_root(project: Path, notepad_dir: str) -> Path:
    return resolve_project_path(find_git_root(project), notepad_dir)


def thread_dir(root: Path, thread: str) -> Path:
    return root / slugify(thread)


def thread_path(root: Path, thread: str) -> Path:
    return thread_dir(root, thread) / NOTEPAD_FILE


def history_path(root: Path, thread: str, stamp: str) -> Path:
    return thread_dir(root, thread) / HISTORY_DIR_NAME / f"notepad.{stamp}.md"


def brief_path(root: Path, thread: str, day: str, goal: str) -> Path:
    words = " ".join(goal.split()[:BRIEF_SLUG_WORDS])
    return thread_dir(root, thread) / BRIEFS_DIR / f"{day}-{slugify(words)}.md"


def mockup_dir(project: Path, root: Path, config: Config, thread: str) -> Path:
    """The thread's mockups/ folder, or the configured project folder."""
    if config.mockup_dir:
        return resolve_project_path(find_git_root(project), config.mockup_dir.replace("{thread}", slugify(thread)))
    return thread_dir(root, thread) / MOCKUPS_DIR


def index_path(root: Path) -> Path:
    return root / INDEX_FILE


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        raise SystemExit(f"Name {text!r} has no usable characters.")
    return slug


def thread_slugs(root: Path) -> list[str]:
    if not root.is_dir():
        return []
    return sorted(p.parent.name for p in root.glob(f"*/{NOTEPAD_FILE}"))


# ---------------------------------------------------------------------------
# Document model: a preamble and an ordered mapping of section name to body.
# ---------------------------------------------------------------------------

def parse_document(text: str) -> tuple[str, dict[str, str]]:
    preamble: list[str] = []
    sections: dict[str, list[str]] = {}
    current = None
    for line in text.splitlines():
        match = SECTION_HEADING.match(line)
        if match:
            current = match.group(1)
            sections.setdefault(current, [])
        elif current is None:
            preamble.append(line)
        else:
            sections[current].append(line)
    bodies = {name: "\n".join(lines).strip("\n") for name, lines in sections.items()}
    return "\n".join(preamble).rstrip("\n"), bodies


def render_document(preamble: str, sections: dict[str, str]) -> str:
    parts = [preamble.rstrip("\n"), ""]
    for name, body in ordered_sections(sections).items():
        parts += [f"## {name}", ""]
        if body.strip():
            parts += [body.strip("\n"), ""]
    return "\n".join(parts).rstrip("\n") + "\n"


def ordered_sections(sections: dict[str, str]) -> dict[str, str]:
    """Known sections in canonical order, then any extra ones in their original order."""
    known = {name: sections.get(name, "") for name in SECTIONS}
    return {**known, **{name: body for name, body in sections.items() if name not in known}}


def read_meta(preamble: str) -> dict[str, str]:
    return {m.group(1): m.group(2).strip() for m in map(META_LINE.match, preamble.splitlines()) if m}


def title_of(preamble: str, fallback: str) -> str:
    return next((l[2:].strip() for l in preamble.splitlines() if l.startswith("# ")), fallback)


def set_meta(preamble: str, **values: str) -> str:
    """Set Thread/Status/Scope/Created lines in the preamble, adding missing ones."""
    lines = preamble.splitlines()
    for key, value in values.items():
        replacement = f"{key}: {value}".rstrip()
        position = next((i for i, l in enumerate(lines) if l.startswith(f"{key}:")), None)
        if position is None:
            lines.append(replacement)
        else:
            lines[position] = replacement
    return "\n".join(lines)


def skeleton(title: str, slug: str, today: str, status: str = DEFAULT_STATUS, scope: str = "") -> str:
    sections = {name: "" for name in SECTIONS}
    preamble = "\n".join([f"# {title}", "", f"Thread: {slug}", f"Status: {status}", f"Scope: {scope}".rstrip(), f"Created: {today}"])
    return render_document(preamble, sections)


def canonical_section(name: str) -> str:
    for section in SECTIONS:
        if section.lower() == name.lower():
            return section
    raise SystemExit(f"Unknown section {name!r}. Sections: {', '.join(SECTIONS)}.")


def dated_bullet(text: str, today: str, label: str = "") -> str:
    lines = text.strip("\n").splitlines() or [""]
    head = f"- {today}{f' ({label})' if label else ''}: {lines[0]}"
    return "\n".join([head, *(f"  {line}" if line else "" for line in lines[1:])])


def quote_bullet(text: str, today: str, reference: str) -> str:
    quoted = "\n".join(f"  > {line}".rstrip() for line in text.splitlines())
    return f"- {today} ({reference}):\n{quoted}"


def append_to_section(document: str, section: str, entry: str) -> str:
    preamble, sections = parse_document(document)
    existing = sections.get(section, "")
    sections[section] = f"{existing}\n{entry}".strip("\n")
    return render_document(preamble, sections)


def replace_section(document: str, section: str, text: str, today: str) -> str:
    preamble, sections = parse_document(document)
    sections[section] = f"Updated: {today}\n\n{text.strip()}"
    return render_document(preamble, sections)


# ---------------------------------------------------------------------------
# Checklist items (Next and Done)
# ---------------------------------------------------------------------------

@dataclass
class Item:
    mark: str
    item_id: str
    text: str

    def render(self) -> str:
        return f"- [{self.mark}] {self.item_id} {self.text}"


def parse_item(line: str) -> Item | None:
    match = ITEM_LINE.match(line)
    return Item(match.group(1), match.group(2), match.group(3)) if match else None


def next_free_id(sections: dict[str, str]) -> str:
    """One past the highest id used anywhere in Next or Done, so ids are never reused."""
    used = [int(n) for name in ("Next", "Done") for n in ITEM_ID.findall(sections.get(name, ""))]
    return f"N{max(used, default=0) + 1}"


def find_item(sections: dict[str, str], item_id: str) -> tuple[list[str], int, Item]:
    lines = sections.get("Next", "").splitlines()
    for position, line in enumerate(lines):
        item = parse_item(line)
        if item and item.item_id == item_id.upper() and item.mark in (OPEN_MARK, BLOCKED_MARK):
            return lines, position, item
    raise SystemExit(f"No open or blocked item {item_id} in Next.")


def thread_items(document: str) -> list[Item]:
    _, sections = parse_document(document)
    return [item for item in map(parse_item, sections.get("Next", "").splitlines()) if item]


def split_reason(text: str) -> tuple[str, str]:
    """Item text and reason from `text: dropped, reason` / `text: blocked, reason` lines."""
    match = re.match(r"^(.*?): (?:dropped|blocked), (.*)$", text)
    return (match.group(1), match.group(2)) if match else (text, "")


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def write_file(path: Path, content: str, apply: bool, action: str) -> None:
    print(f"{'Writing' if apply else 'Would write'} ({action}): {path}")
    if not apply:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def require_thread(root: Path, thread: str) -> Path:
    path = thread_path(root, thread)
    if not path.is_file():
        raise SystemExit(f"No notepad for thread {thread!r} at {path}. Create it with: notepad.py new {thread}")
    return path


def backup_before_edit(root: Path, thread: str, current_text: str, apply: bool) -> None:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    write_file(history_path(root, thread, stamp), current_text, apply, "backup")


def save_notepad(root: Path, thread: str, path: Path, updated: str, apply: bool, action: str,
                 backup_of: str | None = None) -> None:
    """Write a notepad (backing up the old text first when lines change) and refresh INDEX.md."""
    if backup_of is not None:
        backup_before_edit(root, thread, backup_of, apply)
    write_file(path, updated, apply, action)
    refresh_index(root, apply, pending={slugify(thread): updated})


# ---------------------------------------------------------------------------
# INDEX.md: one line per thread, parsed back by `route`.
# ---------------------------------------------------------------------------

INDEX_HEADER = "# Threads\n\nOne line per thread: slug | title | status | scope words. Maintained by notepad.py.\n"


def index_line(slug: str, document: str) -> str:
    preamble, _ = parse_document(document)
    meta = read_meta(preamble)
    title = title_of(preamble, slug).replace("|", "/")
    scope = meta.get("Scope", "").replace("|", "/")
    return f"- {slug} | {title} | {meta.get('Status', DEFAULT_STATUS)} | {scope}"


def render_index(root: Path, pending: dict[str, str] | None = None) -> str:
    pending = pending or {}
    slugs = sorted(set(thread_slugs(root)) | set(pending))
    lines = []
    for slug in slugs:
        document = pending.get(slug) or (root / slug / NOTEPAD_FILE).read_text(encoding="utf-8")
        lines.append(index_line(slug, document))
    return INDEX_HEADER + "\n" + "\n".join(lines) + ("\n" if lines else "")


def refresh_index(root: Path, apply: bool, pending: dict[str, str] | None = None) -> None:
    path = index_path(root)
    text = render_index(root, pending)
    if path.is_file() and path.read_text(encoding="utf-8") == text:
        return
    write_file(path, text, apply, "index")


def parse_index(root: Path) -> list[dict[str, str]]:
    path = index_path(root)
    if not path.is_file():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = [p.strip() for p in line[2:].split("|")] if line.startswith("- ") else []
        if len(parts) == 4:
            rows.append(dict(zip(("slug", "title", "status", "scope"), parts)))
    return rows


# ---------------------------------------------------------------------------
# Commands: threads
# ---------------------------------------------------------------------------

def command_new(args, root: Path, config: Config) -> int:
    path = thread_path(root, args.thread)
    if path.exists():
        raise SystemExit(f"Notepad already exists: {path}")
    slug = slugify(args.thread)
    text = skeleton(args.title or args.thread, slug, str(date.today()), args.status, args.scope)
    save_notepad(root, args.thread, path, text, args.apply, "new notepad")
    for folder in (BRIEFS_DIR, MOCKUPS_DIR):
        print(f"{'Creating' if args.apply else 'Would create'} folder: {thread_dir(root, args.thread) / folder}")
        if args.apply:
            (thread_dir(root, args.thread) / folder).mkdir(parents=True, exist_ok=True)
    return 0


def command_list(args, root: Path, config: Config) -> int:
    slugs = thread_slugs(root)
    if not slugs:
        print(f"No notepads in {root}")
        return 0
    for slug in slugs:
        path = root / slug / NOTEPAD_FILE
        preamble, _ = parse_document(path.read_text(encoding="utf-8"))
        modified = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d")
        print(f"{slug:<30} {modified}  {read_meta(preamble).get('Status', DEFAULT_STATUS):<9} {title_of(preamble, slug)}")
    return 0


def command_show(args, root: Path, config: Config) -> int:
    print(require_thread(root, args.thread).read_text(encoding="utf-8"), end="")
    return 0


def command_meta(args, root: Path, config: Config) -> int:
    path = require_thread(root, args.thread)
    document = path.read_text(encoding="utf-8")
    preamble, sections = parse_document(document)
    changes = {key: value for key, value in (("Status", args.status), ("Scope", args.scope)) if value is not None}
    if not changes:
        raise SystemExit("Give --status and/or --scope.")
    updated = render_document(set_meta(preamble, **changes), sections)
    save_notepad(root, args.thread, path, updated, args.apply, "update thread metadata")
    return 0


def command_index(args, root: Path, config: Config) -> int:
    refresh_index(root, args.apply)
    return 0


def command_add(args, root: Path, config: Config) -> int:
    path = require_thread(root, args.thread)
    section = canonical_section(args.section)
    if section in COMMAND_ONLY_SECTIONS:
        raise SystemExit(f"{section} has its own command: {COMMAND_ONLY_SECTIONS[section]}")
    document = path.read_text(encoding="utf-8")
    today = str(date.today())

    if args.replace:
        if section not in REPLACEABLE_SECTIONS:
            raise SystemExit(f"{section} is append-only. --replace works for: {', '.join(REPLACEABLE_SECTIONS)}.")
        updated = replace_section(document, section, args.text, today)
        save_notepad(root, args.thread, path, updated, args.apply, f"replace {section}", backup_of=document)
        return 0

    updated = append_to_section(document, section, dated_bullet(args.text, today))
    save_notepad(root, args.thread, path, updated, args.apply, f"append to {section}")
    return 0


def find_owner_turn(args, config, project: Path):
    session_args = argparse.Namespace(
        agent="all", session=args.session, previous=False, since=None, last=1, list=False,
    )
    prefixes = effective_prefixes(config, project, args.prefix)
    sessions = select_sessions(session_args, config, prefixes)
    if not sessions:
        raise SystemExit(f"No session matches {args.session!r}.")
    session = sessions[-1]
    for exchange in session.exchanges:
        if exchange.number == args.turn:
            return session, exchange
    raise SystemExit(f"Session {session.session_id} has no owner turn {args.turn} (it has {session.owner_turn_count}).")


def command_quote(args, root: Path, config: Config) -> int:
    path = require_thread(root, args.thread)
    session, exchange = find_owner_turn(args, config, args.project)
    reference = f"{session.agent}:{session.session_id} turn {exchange.number}"
    entry = quote_bullet(exchange.owner_text, str(date.today()), reference)
    updated = append_to_section(path.read_text(encoding="utf-8"), "Vision", entry)
    save_notepad(root, args.thread, path, updated, args.apply, "quote into Vision")
    return 0


# ---------------------------------------------------------------------------
# Commands: checklist
# ---------------------------------------------------------------------------

def command_next(args, root: Path, config: Config) -> int:
    path = require_thread(root, args.thread)
    document = path.read_text(encoding="utf-8")
    _, sections = parse_document(document)
    item = Item(OPEN_MARK, next_free_id(sections), args.text.strip())
    print(f"New item: {item.item_id}")
    save_notepad(root, args.thread, path, append_to_section(document, "Next", item.render()), args.apply, "add Next item")
    return 0


def rewrite_next(document: str, lines: list[str]) -> str:
    preamble, sections = parse_document(document)
    sections["Next"] = "\n".join(lines)
    return render_document(preamble, sections)


def check_document(document: str, item_id: str, evidence: str) -> tuple[str, Item]:
    """The document with a Next item moved to Done with its evidence, and the item."""
    _, sections = parse_document(document)
    lines, position, item = find_item(sections, item_id)
    remaining = lines[:position] + lines[position + 1:]
    done = Item(DONE_MARK, item.item_id, f"{split_reason(item.text)[0]} ({evidence.strip()})")
    return append_to_section(rewrite_next(document, remaining), "Done", done.render()), item


def command_check(args, root: Path, config: Config) -> int:
    if not args.evidence.strip():
        raise SystemExit("--evidence is required: a commit, test name, file, or screenshot.")
    path = require_thread(root, args.thread)
    document = path.read_text(encoding="utf-8")
    updated, item = check_document(document, args.item, args.evidence)
    save_notepad(root, args.thread, path, updated, args.apply, f"check {item.item_id}", backup_of=document)
    return 0


def mark_in_place(args, root: Path, mark: str, label: str) -> int:
    if not args.reason.strip():
        raise SystemExit("--reason is required.")
    path = require_thread(root, args.thread)
    document = path.read_text(encoding="utf-8")
    _, sections = parse_document(document)
    lines, position, item = find_item(sections, args.item)
    lines[position] = Item(mark, item.item_id, f"{split_reason(item.text)[0]}: {label}, {args.reason.strip()}").render()
    save_notepad(root, args.thread, path, rewrite_next(document, lines), args.apply,
                 f"{label} {item.item_id}", backup_of=document)
    return 0


def command_drop(args, root: Path, config: Config) -> int:
    return mark_in_place(args, root, DROPPED_MARK, "dropped")


def command_block(args, root: Path, config: Config) -> int:
    return mark_in_place(args, root, BLOCKED_MARK, "blocked")


def collect_open_items(root: Path, thread: str | None = None) -> list[tuple[str, Item]]:
    slugs = [slugify(thread)] if thread else thread_slugs(root)
    found = []
    for slug in slugs:
        path = root / slug / NOTEPAD_FILE
        if not path.is_file():
            raise SystemExit(f"No notepad for thread {thread!r} at {path}.")
        for item in thread_items(path.read_text(encoding="utf-8")):
            if item.mark in (OPEN_MARK, BLOCKED_MARK):
                found.append((slug, item))
    return found


def command_audit(args, root: Path, config: Config) -> int:
    found = collect_open_items(root, args.thread)
    if not found:
        print("No open or blocked items.")
        return 0
    for slug, item in found:
        state = "blocked" if item.mark == BLOCKED_MARK else "open"
        print(f"{slug:<24} {item.item_id:<5} {state:<8} {item.text}")
    threads = len({slug for slug, _ in found})
    print(f"\n{len(found)} item(s) across {threads} thread(s). State each as done, still open, or blocked before stopping.")
    return 0


def command_artifact(args, root: Path, config: Config) -> int:
    path = require_thread(root, args.thread)
    approval = "approved by owner" if args.approved else "not yet approved"
    entry = f"- {date.today()}: {args.path}: {args.note.strip()} ({approval})"
    updated = append_to_section(path.read_text(encoding="utf-8"), "Artifacts", entry)
    save_notepad(root, args.thread, path, updated, args.apply, "add Artifacts line")
    return 0


def command_mockup_dir(args, root: Path, config: Config) -> int:
    print(mockup_dir(args.project, root, config, args.thread))
    return 0


# ---------------------------------------------------------------------------
# Commands: briefs
# ---------------------------------------------------------------------------

REPORT_FORMAT = (
    "What changed, evidence per item (commit, test, file or screenshot), open questions. "
    "Short. No pasted files or logs."
)


def parse_vision_quotes(vision: str) -> list[tuple[str, str]]:
    """(heading line, verbatim quote text) for each Vision entry, in order."""
    entries: list[tuple[str, list[str]]] = []
    for line in vision.splitlines():
        if line.startswith("- "):
            entries.append((line[2:].rstrip(":"), []))
        elif entries and line.startswith("  >"):
            entries[-1][1].append(line[3:].removeprefix(" "))
    return [(heading, "\n".join(body)) for heading, body in entries]


def select_quotes(vision: str, indexes: list[int]) -> list[tuple[str, str]]:
    quotes = parse_vision_quotes(vision)
    chosen = []
    for index in indexes:
        if not 1 <= index <= len(quotes):
            raise SystemExit(f"Vision has {len(quotes)} quote(s); there is no quote {index}.")
        chosen.append(quotes[index - 1])
    return chosen


def render_brief(thread: str, today: str, args, quotes: list[tuple[str, str]], items: list[Item]) -> str:
    lines = [f"# Brief: {args.goal.strip()}", "", f"Thread: {slugify(thread)}", f"Date: {today}", "",
             "## Goal", "", args.goal.strip(), "", "## Owner's words (verbatim)", ""]
    if not quotes:
        lines += ["(no Vision quote selected)", ""]
    for heading, text in quotes:
        lines += [f"Vision, {heading}:", ""]
        lines += [f"> {line}".rstrip() for line in text.splitlines()] + [""]
    lines += ["## Owns", "", args.owns.strip(), "", "## Out of scope", "", args.out_of_scope.strip(), "", "## Items", ""]
    lines += [item.render() for item in items] or ["(none)"]
    lines += ["", "## Verify", "", args.verify.strip(), "", "## Report format", "", REPORT_FORMAT, ""]
    return "\n".join(lines)


def command_brief(args, root: Path, config: Config) -> int:
    path = require_thread(root, args.thread)
    _, sections = parse_document(path.read_text(encoding="utf-8"))
    wanted = [i.strip().upper() for i in args.items.split(",") if i.strip()]
    by_id = {item.item_id: item for item in map(parse_item, sections.get("Next", "").splitlines()) if item}
    missing = [i for i in wanted if i not in by_id]
    if missing:
        raise SystemExit(f"Not in Next: {', '.join(missing)}.")
    indexes = [int(i) for i in args.quotes.split(",") if i.strip()] if args.quotes else []
    quotes = select_quotes(sections.get("Vision", ""), indexes)
    today = str(date.today())
    target = brief_path(root, args.thread, today, args.goal)
    write_file(target, render_brief(args.thread, today, args, quotes, [by_id[i] for i in wanted]), args.apply, "brief")
    print(target)
    return 0


# ---------------------------------------------------------------------------
# Commands: routing
# ---------------------------------------------------------------------------

def words_of(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= MIN_ROUTE_WORD_CHARS and w not in STOP_WORDS}


def route_score(request_words: set[str], row: dict[str, str]) -> int:
    """Scope-word hits count double; title and slug hits count once. A shared 5-letter stem matches."""
    stems = {w[:ROUTE_STEM_CHARS] for w in request_words}
    def hits(text: str) -> int:
        return sum(1 for w in words_of(text) if w in request_words or w[:ROUTE_STEM_CHARS] in stems)
    return 2 * hits(row["scope"]) + hits(row["title"].replace("-", " ")) + hits(row["slug"].replace("-", " "))


def command_route(args, root: Path, config: Config) -> int:
    rows = parse_index(root)
    if not rows:
        print(f"No INDEX.md threads in {root}. Size the request as small or start a new thread.")
        return 0
    request_words = words_of(args.request)
    scored = sorted(((route_score(request_words, row), row) for row in rows), key=lambda pair: -pair[0])
    candidates = [(score, row) for score, row in scored if score > 0]
    if not candidates:
        print("No thread matches. Treat as a small task or a new thread; ask the owner if unsure.")
        return 0
    for score, row in candidates:
        print(f"{score:>3}  {row['slug']:<24} {row['status']:<9} {row['title']}  [{row['scope']}]")
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        print("\nTop candidates tie. Ask the owner one question naming them.")
    return 0


# ---------------------------------------------------------------------------
# Migration from 0.1.0 single-file threads
# ---------------------------------------------------------------------------

def convert_next(next_body: str, sections: dict[str, str]) -> str:
    """Give unnumbered bullets in an old Next section checklist ids; leave other lines alone."""
    working = dict(sections)
    lines = []
    for line in next_body.splitlines():
        if line.startswith("- ") and not ITEM_LINE.match(line):
            item = Item(OPEN_MARK, next_free_id({**working, "Next": "\n".join(lines)}), line[2:])
            lines.append(item.render())
        else:
            lines.append(line)
    return "\n".join(lines)


def migrated_text(old_text: str, slug: str) -> str:
    preamble, sections = parse_document(old_text)
    preamble = set_meta(preamble, Thread=slug)
    meta = read_meta(preamble)
    if "Status" not in meta:
        preamble = set_meta(preamble, Status=DEFAULT_STATUS)
    if "Scope" not in meta:
        preamble = set_meta(preamble, Scope="")
    sections["Next"] = convert_next(sections.get("Next", ""), sections)
    return render_document(preamble, sections)


def command_migrate(args, root: Path, config: Config) -> int:
    old_files = [p for p in sorted(root.glob("*.md")) if p.name != INDEX_FILE] if root.is_dir() else []
    if not old_files:
        print(f"No 0.1.0 single-file threads in {root}.")
        return 0
    for old in old_files:
        slug = slugify(old.stem)
        destination = thread_path(root, slug)
        if destination.exists():
            print(f"Skipping {old.name}: {destination} already exists.")
            continue
        write_file(destination, migrated_text(old.read_text(encoding="utf-8"), slug), args.apply, f"migrate {old.name}")
        for folder in (BRIEFS_DIR, MOCKUPS_DIR):
            if args.apply:
                (thread_dir(root, slug) / folder).mkdir(parents=True, exist_ok=True)
        for backup in sorted((root / HISTORY_DIR_NAME).glob(f"{old.stem}.*.md")) if (root / HISTORY_DIR_NAME).is_dir() else []:
            target = thread_dir(root, slug) / HISTORY_DIR_NAME / backup.name.replace(f"{old.stem}.", "notepad.", 1)
            print(f"{'Moving' if args.apply else 'Would move'} backup: {backup} -> {target}")
            if args.apply:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(backup), target)
        print(f"{'Removing' if args.apply else 'Would remove'} old file (content now in {destination.name}): {old}")
        if args.apply:
            old.unlink()
    refresh_index(root, args.apply)
    return 0


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--project", type=Path, default=Path.cwd(), help="project directory (default: cwd)")
    common.add_argument("--config", type=Path, help="config.json path (default: next to this script)")
    common.add_argument("--prefix", action="append", default=[], help="extra repo path prefix for quote, repeatable")
    common.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name: str, handler, help_text: str, *positionals: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, parents=[common], help=help_text)
        for positional in positionals:
            sub.add_argument(positional)
        sub.set_defaults(handler=handler)
        return sub

    new = command("new", command_new, "create a thread folder and notepad", "thread")
    new.add_argument("--title", help="heading for the notepad (default: the thread name)")
    new.add_argument("--status", default=DEFAULT_STATUS, help="thread status shown in INDEX.md (default: active)")
    new.add_argument("--scope", default="", help="comma-separated scope words used by route")

    command("list", command_list, "list threads")
    command("show", command_show, "print a notepad", "thread")
    meta = command("meta", command_meta, "change a thread's status or scope words", "thread")
    meta.add_argument("--status")
    meta.add_argument("--scope")
    command("index", command_index, "rebuild INDEX.md from the notepads")

    add = command("add", command_add, "append a dated bullet to a section", "thread")
    add.add_argument("section", help=f"one of: {', '.join(SECTIONS)} (Vision, Next, Artifacts have their own commands)")
    add.add_argument("text")
    add.add_argument("--replace", action="store_true",
                     help=f"replace the section ({', '.join(REPLACEABLE_SECTIONS)} only); backs up first")

    quote = command("quote", command_quote, "copy an owner turn verbatim from a session into Vision", "thread")
    quote.add_argument("--session", required=True, help="session id or prefix (see session_digest.py --list)")
    quote.add_argument("--turn", type=int, required=True, help="owner turn number as numbered in the digest")

    command("next", command_next, "add a Next item with the next free id", "thread").add_argument("text")

    check = command("check", command_check, "move a Next item to Done with evidence", "thread", "item")
    check.add_argument("--evidence", required=True, help="commit, test name, file or screenshot, e.g. \"a1b2c3d, InboxTests\"")
    for name, handler, help_text in (("drop", command_drop, "mark an item dropped (kept, with the reason)"),
                                     ("block", command_block, "mark an item blocked (kept, with the reason)")):
        sub = command(name, handler, help_text, "thread", "item")
        sub.add_argument("--reason", required=True)

    audit = command("audit", command_audit, "list open and blocked items across threads")
    audit.add_argument("thread", nargs="?")

    artifact = command("artifact", command_artifact, "add an Artifacts line", "thread", "path")
    artifact.add_argument("--note", required=True, help="what the artifact shows")
    artifact.add_argument("--approved", action="store_true", help="the owner approved it")

    command("mockup-dir", command_mockup_dir, "print where this thread's mockups go", "thread")

    brief = command("brief", command_brief, "write a subagent brief to briefs/ and print its path", "thread")
    brief.add_argument("--goal", required=True, help="the goal in one sentence")
    brief.add_argument("--items", default="", help="comma-separated Next ids this brief covers, e.g. N3,N4")
    brief.add_argument("--owns", required=True, help="owned files or folders")
    brief.add_argument("--out-of-scope", required=True, dest="out_of_scope")
    brief.add_argument("--verify", required=True, help="tests, build or screenshots to capture")
    brief.add_argument("--quotes", help="1-based Vision quote numbers to copy verbatim, e.g. 1,2")

    command("route", command_route, "rank threads against a request using INDEX.md scope words", "request")
    command("migrate", command_migrate, "move 0.1.0 single-file threads into the folder layout")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = load_config(args.config)
    root = notepad_root(args.project, config.notepad_dir)
    return args.handler(args, root, config)


if __name__ == "__main__":
    raise SystemExit(main())
