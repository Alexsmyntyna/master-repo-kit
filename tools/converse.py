#!/usr/bin/env python3
"""Threads between the owner, the parent-company CEO, and each project's COO.

A thread is a folder of short messages (like an email chain), stored in the repo so the app can show it
and any agent can read it. Each agent turn is a fresh headless run (`claude -p` on the owner's subscription,
or `codex exec`) that sees only its role prompt, the project's story and fronts, and this one thread.

The CEO only sits on projects in `focus` in holding/portfolio.json (the ones with public potential). On every
other project the COO reports straight to the owner, and the CEO joins a thread only when the owner addresses it.
The CEO's portfolio view is one line per focus project; everything else is a name it can look up if asked.
See agents/README.md.

Usage (from anywhere):
    converse.py new <slug|holding> "<title>" --body "..." [--to coo|ceo] [--kind directive]   # --to ceo brings the CEO in
    converse.py turn <thread> [--as coo|ceo] [--engine claude|codex] [--model sonnet] [--dry-run]
    converse.py run <thread> [--rounds 4]          # let the agents go back and forth until a decision
    converse.py retry [<thread>] [--wait]          # rerun what hit the usage limit (holding/retries.json)
    converse.py post <thread> --as <role> --kind report --body "..." [--to ceo] [--page-url /… --page-file …]
    converse.py chat <slug|holding> --body "..." [--page-url /… --page-file … --page-title …]   # the app's chat dock
    (new, post and chat take --typed "<what the owner typed>" when the spelling fixer changed --body; approve, --note)
    converse.py approve <thread> [--note "..."]    # the owner approves the CEO's decision
    converse.py desk                                # what's waiting on the owner, with each decision's options
    converse.py reconcile <thread>                  # after an approval: withdraw/recompute the questions it changes
    converse.py record                              # backfill approved decisions into decisions.json
    converse.py list [--status open]
    converse.py context <slug>                     # compact brief for agents coding in a project repo

<thread> is a path like companies/camera-app/threads/2026-10-10-react-native-rebuild (relative to the repo
root or absolute). Bodies may be "-" to read stdin.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
TOOLS_DIR = paths.CODE / "tools"  # granted commands name scripts by absolute path, never relative to a cwd
CHAT_PIN = "MASTER_REPO_CHAT"  # set on a chat agent's run: the one chat thread its spawn/board grants act for
KINDS = ("directive", "report", "question", "reply", "decision", "approval")
# Every decision that reaches the owner ends with this block; the app's decisions desk draws it as a table
# (app/src/lib/decisions.ts parses it, `desk` below prints it).
# How every agent writes (the full rules are skills/writing.md; this is the short version every turn carries).
WRITING_RULE = """# Writing
Everything you write (this message, notes, wiki pages) follows `skills/writing.md`; read it before writing a page.
- the owner's words first: quote them verbatim with where and when (file path, date). Don't paraphrase their intent into
  prose they didn't say. Their newest message overrides older summaries and pages.
- Facts from code carry a commit sha and date, or a file path. Not in the code or their words: don't state it as fact.
- Your inference is marked (Agent: … / source: agent) and short. No narrative, scene-setting, motivations or
  emotions, no origin stories they didn't tell.
- Plain and short: titles are nouns; lists and tables over paragraphs; lead with the answer.
- Wiki pages you write get `written_by: agent`. A story page is at most ~250 words: `## In your words`,
  `## What exists`, `## Where it's going`, `## Open questions`. A front is a few sentences plus "Dealt with when".
- Never: "close to home", "grew fast", "plainly", "it's worth noting", "dive into", "landscape", "journey",
  "seamless", "robust", "leverage", "unlock", em-dash pileups, questions as headings, slogans as titles."""

TALK_RULE = """This is a talk thread: the owner is thinking out loud with you about this project (and any others it's
about), adding ideas and revising direction. It is not a run toward a decision.
- Reply to the owner with kind reply. Build on what they say, connect it to the story, open fronts and existing ideas
  of the projects involved, and push back where it clashes with them or with their time. Ask at most one question.
- When an idea is worth keeping, write it as a wiki page: `companies/<slug>/wiki/ideas/<YYYY-MM-DD>-<topic>.md`
  with frontmatter title (a noun), kind: idea, summary, date, updated, raised_by: owner (or agent if it's yours),
  written_by: agent, and say so in your reply. For a new idea not tied to one project, use `discovery/ideas/`.
  Quote their words with the thread and date; mark your own additions Agent:. A short list, not an essay. Update a page you wrote earlier in this thread rather than making a second one.
- A revision to a story or a front: write out the exact change you'd make and ask whether to make it; don't edit
  stories or fronts yourself.
- When something needs their call, send it as kind decision with the options block below, and it goes to their
  decisions desk."""

PAGE_RULE = """the owner is talking to you from a page in their app: {title} ({url}){file_note}. Their messages here are
about that page: feedback, missing facts, ideas, fonts and colours, links, corrections.
- Read the page first (below). Answer in a few lines, about this page.
- When their message gives you the content (a fact, an idea, a reference, a correction, a decision they state),
  write it into the page itself{or_wiki}: keep its frontmatter and shape, quote their words with this thread and
  the date, bump `updated`, and say in one line what you changed. Their newest words replace older summaries on
  the page: cut agent prose they contradict rather than adding around it. On this page this overrides the rule
  against editing fronts and stories yourself. Don't invent what they didn't say; if something needs their call, ask
  one question.
- If what they say belongs on another page of this project's wiki (a new idea, another front), write it there
  and say where."""

# The chat dock in the app (app/src/components/dock/): one conversation per project, opened from any page.
CHAT_RULE = """This is the owner's chat for {where}: one running conversation they open from any page of their app. Each of
their messages says which page they sent it from, and the newest one is shown above. Where this differs from the
talk rules, this wins.
- Keep replies short: a few lines, lists over paragraphs. Answer what they asked.
- When the work is bigger than a reply, ask one or two follow-up questions first, or start it on its own and
  reply with the path: a thread (`python3 tools/converse.py spawn {thread} "<title>" --body "<the ask in your
  words; quote their>"`){board}.
- Never send kind decision here: a call for them goes into its own thread (above), and you reply with its path.
- End every reply that changed or created something with its repo path in backticks, one per line.
- Questions for them go last, at most two."""
# Every chat agent can read and write the owner's calendar through tools/agenda.py (chat_commands grants it, pinned to
# the chat's own thread, so each entry it adds records that thread as its source).
CALENDAR_RULE = """# the owner's calendar (holding/calendar.json, shown at /calendar)
Read and write it only through `python3 tools/agenda.py --by {thread} <command>`; never edit the JSON.
- Look first: `list [--from YYYY-MM-DD --to YYYY-MM-DD]` (default this week; ids in brackets), `brief --day D` or
  `brief --week D`. Today is {today}. He works at Royal Custom Design about 9–6 on weekdays; their own work goes in
  the mornings before 9 and evenings until about 9:30.
- Asked for a brief ("what's my week", "what's left before X"): run `brief`, then answer as a brief: the headline,
  its ```stats and ```flow blocks as they come, and a few lines on what matters, not every row.
- Loose words become entries: something happening on a day is `--kind due`; work they plan to do at a time is
  `--kind block` with `--date --time --end`; something to look at every so often is `--kind check --cadence`.
  `add --title "…" … --step "…" --project <slug> --quote "<their words>"`. Break real work into 2–5 steps.
  "Find time for X": read the week, pick an open window that fits their hours, add it, and say when.
- Never invent a date or time they didn't give or imply. When the day is missing, add nothing and ask the one question;
  "sometime in November" may be added with no date (it shows under No date yet) and say so.
- `move <id> --date/--time/--end`, `done <id>` (a check), `step <id> <step-id>`, `remove <id>` (only what an agent
  added). Say what you changed in one line per entry: title, day, time."""

CHAT_BOARD = """ or a Board
  epic (`python3 tools/converse.py board {thread} "<goal>"`: a plan only, nothing runs until they approve)"""

OPTIONS_RULE = """A message of kind decision ends with this block (after any other block), so the owner can compare the
options at a glance. 2–3 options, `*` after the letter of the one you recommend; the recommendation is
what the message proposes. time = weeks of the owner's time; complexity = moving parts, risk and upkeep;
growth = how far it moves the project toward people using or paying for it (or the owner's stated goal for it);
costs = what it gives up or puts at risk. Plain words, one line each, no pipes inside a field.

```options
ask: <the one question the owner is answering, ending with ?>
A* | <option in a few words> | time: <e.g. 1 week> | complexity: <low|medium|high> | growth: <low|medium|high> | costs: <what it gives up>
B | <option> | time: <…> | complexity: <…> | growth: <…> | costs: <…>
revisit: <what would reopen this>
```"""
MOCKUP_RULE = """# Mockups (skills/mockup-review.md)
When a question is about what something looks like or how it flows, draw it as ONE mockup for the owner to riff on,
with the trade-offs said plainly. Don't make variations to fill space: build your best answer, name what it gives
up, and describe the alternatives in the trade-off table instead of drawing them.
- A review is a folder `{dir}/<YYYY-MM-DD>-<topic>/` with `index.html` (and a few more `<name>.html` screens only if
  they truly differ) plus `review.md`. the owner opens it in the app, pins notes on the mockup and answers the questions;
  their answers come back to this thread and into `notes.md` beside it. Never edit `notes.md`.
- The HTML is self-contained: inline CSS and JS, no external fonts, images or requests (they are blocked; use
  data: URIs or CSS). It fills its viewport: the app draws the phone (402x874) or desktop (1280x800) frame around it.
  One prototype can hold several screens: route on `location.hash` (`#home`, `#shift`), listen for `hashchange`, and
  on each change call `parent.postMessage({ mockupScreen: "<hash without #>" }, "*")` so pins land on the right screen.
- It looks like the real product: its own tokens, components and copy, read from its code and
  `companies/<slug>/screens/`. Real data shapes and names (its types, fields, statuses), not lorem ipsum or a
  generic template. Say in the trade-offs what you made up.
- `review.md`:

```
---
title: <what this is, a few words>
date: <YYYY-MM-DD>
status: open
thread: {thread}
frame: phone | desktop
screens:
  - { file: "index.html#home", label: <short name> }
questions:
  - ask: <one question the owner answers, ending with ?>
    shown: <how the mockup answers it, one sentence>
    screen: "index.html#home"
---

| Choice in the mockup | Gains | Costs |
| --- | --- | --- |
| <the choice> | <what it gets> | <what it gives up; the alternative you didn't draw> |

<one line: what the mockup leaves out or invents>
```

- Two to six questions, each one a real choice. End your message with a block pointing at the review:

```mockups
A | <title> | {dir}/<YYYY-MM-DD>-<topic>/index.html
```"""

# The app reads every message as a brief (app/src/lib/brief.ts): the opening sentence is the headline, bold labels
# become coloured callouts and side-by-side cards, and stats/flow blocks are drawn as tiles and a step diagram.
VISUAL_RULE = """# Shape of a message
the owner reads your message as a page, not an email. Write it so it can be drawn:
- Open with the answer in 1–2 plain sentences (no label); it becomes the headline.
- Then short labelled parts. A label with text on the same line is a callout: `**Decision:** …`,
  `**Risk:** …`. A label alone on its line, followed by a short list, is a card; consecutive cards sit side by
  side: `**What it costs:**`, `**What we found:**`, `**What would make me revisit:**`. Put the questions for
  the owner last under `**Questions for the owner:**` as a numbered list.
- Numbers that matter go in a stats block (value | what it is | source or note), 2–4 lines:

```stats
82/100 | Dispo reviews at 3★ or less | App Store, last 100
9 | competitors in the market file
```

- A plan, sequence or staged rebuild goes in a flow block, one step per line (step | when or detail | state),
  state optional: done, now, next or risk:

```flow
Ship 1.3.x from main | week 1 | now
Bring in shared rolls | weeks 2–3
Re-check React Native | after 1.4 | risk
```

- Comparisons across 3+ things are a markdown table. No walls of prose: a paragraph is 1–3 sentences."""

MARKET_RULE = """# Market
The project's market file is `{dir}/`: `market.md` (who buys and how, rough size with sources, trends, where the
gap is), `competitors.json` (facts fetched by the tool; you fill each entry's who, strengths, complaints,
positioning, threat low|medium|high, sources [{{url, date}}], notes) and `reviews/`. It is how this company gets
smarter than any one conversation: read it before answering anything about users, competitors or positioning,
and when you learn something, write it there (with a source and date) rather than only in your reply.
Tools (public data, no login):
  python3 tools/market.py search {slug} "<term>" [--add]   App Store apps for a search; add the relevant ones by id
  python3 tools/market.py add {slug} <app-id | https://…>   keep an app (rating, price, screenshots) or capture a web page
  python3 tools/market.py reviews {slug} <app-id>           recent reviews: low ratings show what users want and lack
  python3 tools/market.py status {slug}
Screenshots land in `{dir}/shots/`: open them with Read to see how competitors actually look, and point to them
when a mockup borrows or departs from one. Keep it to real competitors (5–12), not every search hit."""

MARKET_CHECK = """Market check. Build or refresh this project's market file so we understand its market better than the owner does.
1. Find the real competitors: App Store searches for the terms its users would type, plus web products. Keep the
   5–12 that matter; for each fill who it's for, strengths, complaints, positioning, threat and sources.
2. Pull reviews for the 3–4 closest ones and write the recurring complaints and wishes into market.md.
3. Look at their screenshots. Note what the category does by convention and where it all looks the same.
4. Write market.md: who buys, how they find and pay for these apps, rough size with sources, trends, and the gap.
Every competitor fact carries its source URL and date; your judgments are marked as yours. market.md is
tables and short lists, not essays.
Then report: what changed in our understanding, the gap this project could own, and one positioning
recommendation with the evidence for it. Mockups if a positioning implies a different look."""

STATUSES = ("open", "awaiting-alex", "awaiting-owner", "stale", "talking", "decided", "closed")  # talking: a talk thread, the owner's turn; stale: awaiting-alex unanswered 14 days (tools/refresh.py), still answerable
WORD_LIMIT = 400
FULL_THREAD = 6  # beyond this many messages, send the summary, the first message and the last few
TOOLS = {
    # Read-only on project repos; the COO may write research notes into its own project's notes folder.
    "ceo": ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
    "coo": ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Bash(git log:*)", "Bash(git show:*)",
            "Bash(git ls-files:*)", *paths.GIT_BRANCH_READ, "Bash(git diff:*)", "Bash(git rev-list:*)",
            "Bash(git status:*)", "Bash(git worktree list:*)", "Bash(git stash list:*)", "Bash(git stash show:*)",
            ],
}
MAX_TURNS = {"ceo": 40, "coo": 50}
MODELS = ("haiku", "sonnet", "opus", "fable")
DEFAULT_MODEL = {"ceo": "opus", "coo": "sonnet"}


def role_files() -> dict[str, Path]:
    """Merge prompts per file: data roles override shipped roles without hiding the rest."""
    out = {}
    for folder in (paths.CODE / "agents", ROOT / "agents"):
        for path in sorted(folder.glob("*.md")):
            meta, _ = split_frontmatter(path.read_text())
            if re.fullmatch(r"[a-z][a-z0-9-]*", path.stem) and path.stem != "pointer":
                out[path.stem] = path
    return out


def agent_roles() -> tuple[str, ...]:
    return tuple(role_files())


def roles() -> tuple[str, ...]:
    return ("owner", "alex", *agent_roles())


def role_spec(role: str) -> dict:
    meta, _ = split_frontmatter(role_files()[role].read_text())
    tools = meta.get("tools", TOOLS.get(role, TOOLS["coo"]))
    if isinstance(tools, str):
        tools = [t.strip().strip('"\'') for t in tools.strip("[]").split(",") if t.strip()]
    turns = meta.get("max_turns", MAX_TURNS.get(role, 50))
    # `writes: [wiki/research, notes]`: folders under the thread's project the role may write (front matter only).
    writes = meta.get("writes", [])
    if isinstance(writes, str):
        writes = [w.strip().strip('"\'') for w in writes.strip("[]").split(",") if w.strip()]
    return {"model": meta.get("model") or DEFAULT_MODEL.get(role, "sonnet"),
            "max_turns": int(turns), "tools": list(tools), "writes": [w.strip("/") for w in writes if ".." not in w]}


def default_model(role: str) -> str:
    """The model a role runs on unless a thread says otherwise: holding/models.json ({"ceo": "fable"}), written by
    the app's "Use as default", overrides DEFAULT_MODEL per role; anything missing or unknown falls back."""
    try:
        chosen = json.loads((ROOT / "holding" / "models.json").read_text()).get(role)
    except (OSError, ValueError, AttributeError):
        chosen = None
    return chosen if chosen in MODELS else role_spec(role)["model"]
# Smaller agents the CEO/COO can hand bulk work to, so its own context stays on judgment (--agents).
HELPERS = {
    "scout": {
        "model": "haiku",
        "description": "Fast, cheap read-only helper for bulk codebase and repo work: find files, read and summarize "
                       "them, skim git history, list what changed. Give it a precise question; run several in parallel.",
        "prompt": "You are a scout working for an operator. Do exactly the lookup asked, read-only. Answer briefly with "
                  "facts, file paths, line numbers and commit hashes. No opinions or recommendations. Say 'not found' "
                  "rather than guessing.",
    },
    "researcher": {
        "model": "sonnet",
        "description": "Web researcher for markets, competitors, platform APIs, pricing and docs. Returns a short "
                       "summary with source URLs.",
        "prompt": "You are a researcher working for an operator. Search and read the web for the question asked. Return "
                  "at most 200 words of findings, each with its source URL and date. Separate facts from claims. "
                  "Say what you couldn't find.",
    },
}
HELPER_TOOLS = {"scout": ("Read", "Grep", "Glob", "Bash(git "), "researcher": ("WebSearch", "WebFetch", "Read")}
TIERS = ("focus", "maintain", "paused", "undecided")  # the lists in holding/portfolio.json


def today() -> str:
    return dt.date.today().isoformat()


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "thread"


# --- files -------------------------------------------------------------------------------------------

def split_frontmatter(text: str) -> tuple[dict, str]:
    m = re.match(r"---\n(.*?)\n---\n?(.*)", text, re.S)
    if not m:
        return {}, text.strip()
    meta: dict = {}
    lines = m.group(1).splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if value in ("|", "|-"):  # a block scalar (`typed`): the indented lines below, verbatim
            block = []
            while i < len(lines) and (lines[i].startswith("  ") or not lines[i].strip()):
                block.append(lines[i][2:])
                i += 1
            meta[key.strip()] = "\n".join(block).rstrip("\n")
            continue
        if not value:
            items = []
            while i < len(lines) and re.match(r"\s+-\s+", lines[i]):
                items.append(re.sub(r"^\s+-\s+", "", lines[i]).strip().strip('"\''))
                i += 1
            meta[key.strip()] = items
            continue
        try:
            meta[key.strip()] = json.loads(value)
        except ValueError:
            meta[key.strip()] = value
    return meta, m.group(2).strip()


BLOCK_KEYS = ("typed",)  # multi-line text the owner wrote, stored as a YAML block scalar so it reads as they typed it


def frontmatter_line(key: str, value) -> str:
    if key in BLOCK_KEYS and isinstance(value, str):
        return f"{key}: |\n" + "\n".join(f"  {line}" if line.strip() else "" for line in value.split("\n"))
    return f"{key}: {json.dumps(value, ensure_ascii=False)}"


def write_doc(path: Path, meta: dict, body: str, exclusive: bool = False) -> None:
    from migrate import owner_values
    meta = owner_values(meta)
    head = "\n".join(frontmatter_line(k, v) for k, v in meta.items())
    with open(path, "x" if exclusive else "w") as f:
        f.write(f"---\n{head}\n---\n\n{body.strip()}\n")


WORDS = re.compile(r"[A-Za-z'’]+")


def typed_meta(body: str, typed: str | None) -> dict:
    """What the owner typed, when the spelling fixer changed it before saving (app/DESIGN.md, Spelling): `typed` holds
    their original and `fixes` the number of words changed. Empty when there's nothing to keep."""
    if typed is None or not typed.strip() or typed.strip() == body.strip():
        return {}
    a, b = WORDS.findall(typed), WORDS.findall(body)
    fixes = sum(x != y for x, y in zip(a, b)) if len(a) == len(b) else max(1, abs(len(a) - len(b)))
    return {"typed": typed.strip(), "fixes": max(fixes, 1)}


def scope_dir(scope: str) -> Path:
    if scope == "holding":
        return ROOT / "holding"
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", scope) or not (ROOT / "companies" / scope / "company.json").exists():
        raise SystemExit(f"Unknown project: {scope}")
    return ROOT / "companies" / scope


def thread_path(arg: str) -> Path:
    path = Path(arg)
    path = (path if path.is_absolute() else ROOT / path).resolve()
    try:
        parts = path.relative_to(ROOT).parts  # must live inside this repo
    except ValueError:
        raise SystemExit(f"Not a thread: {arg}")
    # Only <scope>/threads/<id>: a thread.md an agent wrote somewhere else (a wiki or mockup folder) isn't one.
    where = parts[:3] == ("companies", parts[1], "threads") and len(parts) == 4 if parts[:1] == ("companies",) \
        else parts[:2] == ("holding", "threads") and len(parts) == 3
    if not where or not (path / "thread.md").exists():
        raise SystemExit(f"Not a thread: {arg}")
    return path


def scope_of(thread: Path) -> str:
    rel = thread.relative_to(ROOT).parts
    return rel[1] if rel[0] == "companies" else "holding"


def portfolio() -> dict:
    path = ROOT / "holding" / "portfolio.json"
    return json.loads(path.read_text()) if path.exists() else {}


def tier(slug: str) -> str:
    """Where a project sits in holding/portfolio.json. Only `focus` projects get the CEO by default."""
    data = portfolio()
    return next((t for t in TIERS if slug in (data.get(t) or [])), "undecided")


def has_ceo(thread: Path) -> bool:
    return "ceo" in (read_thread(thread)[0].get("participants") or ["ceo"])


def boss(thread: Path) -> str:
    """Who the COO reports to on this thread: the CEO if it sits on it, otherwise the owner. In a talk thread the
    agent the owner is talking to answers them directly."""
    return "owner" if is_talk(thread) or not has_ceo(thread) else "ceo"


def page_of(thread: Path) -> dict:
    """The app page behind the owner's latest message (url, the file behind it, title): the page that message was sent
    from (chat messages each record theirs), else the page the thread was started from. {} when there is none."""
    for _, m, _ in reversed(messages(thread)):
        if m.get("from") in ("alex", "owner"):
            if isinstance(m.get("page"), dict):
                return m["page"]
            if m.get("page") is False:
                return {}  # they turned the page off for this message
            break
    page = read_thread(thread)[0].get("page")
    return page if isinstance(page, dict) else {}


def page_wiki(thread: Path) -> str | None:
    """A page thread may edit its scope's wiki (the page itself, fronts, ideas), never anything else: a project's
    companies/<slug>/wiki, or the parent company's holding/wiki."""
    if not page_of(thread):
        return None
    scope = scope_of(thread)
    return "holding/wiki" if scope == "holding" else f"companies/{scope}/wiki"


HOLDING_PAGE_FILES = ("holding/vision.md",)  # single holding files a talk on that very page may Edit
CALENDAR_FILE = "holding/calendar.json"  # never granted as a file; a chat writes it through tools/agenda.py


def page_files(thread: Path) -> tuple[str, ...]:
    """Files outside the wiki that a talk/chat thread may Edit because the owner is talking from that file's page:
    only the parent company's vision. holding/setup.json and money.json get no grant: the owner ticks steps and types
    figures himself, and the CEO proposes changes in the chat. holding/calendar.json gets no file grant either: every
    chat writes it through tools/agenda.py (chat_commands), which checks each entry."""
    if scope_of(thread) != "holding" or not is_talk(thread):
        return ()
    f = page_of(thread).get("file") or ""
    return (f,) if f in HOLDING_PAGE_FILES else ()


def page_editable(thread: Path) -> bool:
    """Whether the file behind this page is one the agent may edit (under the page wiki, or a granted file)."""
    f, wiki = page_of(thread).get("file") or "", page_wiki(thread)
    return bool(wiki and (not f or f.startswith(f"{wiki}/"))) or f in page_files(thread)


def page_arg(url: str | None, file: str | None, title: str | None) -> dict | None:
    if not url:
        return None
    if not re.fullmatch(r"/[\w\-./%~()!*',;:@&=+$]*", url) or ".." in url:  # a path as the browser encodes it
        raise SystemExit("Bad page url.")
    if file and (file.startswith("/") or ".." in file.split("/") or not (ROOT / file).exists()):
        raise SystemExit("Bad page file.")
    return {"url": url[:300], "file": file or "", "title": (title or "")[:200]}


def is_talk(thread: Path) -> bool:
    """A talk thread is the owner thinking out loud with an agent (ideas, revisions), not a run toward a decision.
    The chat dock's conversation is one too."""
    return read_thread(thread)[0].get("mode") in ("talk", "chat")


def is_chat(thread: Path) -> bool:
    return read_thread(thread)[0].get("mode") == "chat"


def about(thread: Path) -> list[str]:
    """Every project a thread is about: its scope, plus any others the owner named (`projects`)."""
    meta, _ = read_thread(thread)
    scope = scope_of(thread)
    slugs = ([scope] if scope != "holding" else []) + [p for p in meta.get("projects") or [] if p != scope]
    return [p for p in slugs if (ROOT / "companies" / p / "company.json").exists()]


def idea_homes(thread: Path) -> tuple[str, ...]:
    """Where a thread's idea pages go: each project it's about, else the parent company's wiki on a holding
    thread (with discovery/ideas for an idea not tied to anything), else discovery/ideas."""
    homes = tuple(f"companies/{p}/wiki/ideas" for p in about(thread))
    if homes:
        return homes
    return ("holding/wiki/ideas", "discovery/ideas") if scope_of(thread) == "holding" else ("discovery/ideas",)


def messages(thread: Path) -> list[tuple[Path, dict, str]]:
    out = []
    for p in sorted(thread.glob("[0-9][0-9][0-9]-*.md")):
        meta, body = split_frontmatter(p.read_text())
        out.append((p, meta, body))
    return out


def read_thread(thread: Path) -> tuple[dict, str]:
    return split_frontmatter((thread / "thread.md").read_text())


def update_thread(thread: Path, clear: tuple[str, ...] = (), **changes) -> None:
    meta, body = read_thread(thread)
    meta.update({k: v for k, v in changes.items() if v is not None})
    for key in clear:
        meta.pop(key, None)
    meta["updated"] = today()
    write_doc(thread / "thread.md", meta, body)


def set_models(thread: Path, role: str, model: str | None, no_helpers: bool = False) -> None:
    """the owner's choice of model for one role on this thread (sticks until they change it), and helpers on/off."""
    meta = read_thread(thread)[0]
    changes: dict = {}
    if model and role in agent_roles():
        changes["models"] = {**(meta.get("models") or {}), role: model}
    if no_helpers or meta.get("helpers") is False:
        changes["helpers"] = not no_helpers
    if changes:
        update_thread(thread, **changes)


def running_pid(thread: Path) -> int | None:
    """The pid of a live turn on this thread, or None (a stale marker from a crashed run doesn't count)."""
    pid = (read_thread(thread)[0].get("running") or {}).get("pid")
    if not pid:
        return None
    try:
        os.kill(int(pid), 0)
        return int(pid)
    except (OSError, ValueError):
        return None


def log_run(entry: dict) -> None:
    """One line per agent turn in holding/runs.jsonl, so the app can show what ran, how long, and what failed."""
    with open(ROOT / "holding" / "runs.jsonl", "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# --- limits ------------------------------------------------------------------------------------------
# the owner, 2026-10-11: "when we hit limits with 5 hour or other then that stuff needs to be queued and if we can get
# the time for the reset try it then". A run that hits the subscription limit doesn't fail: the thread gets a
# `waiting` marker, the run goes into holding/retries.json, and `converse.py retry --wait` (started detached, one at
# a time) runs it again once the limit resets.

LIMIT_WAIT = dt.timedelta(minutes=30)  # when the CLI gives no reset time
# Errors that say "limit" but won't lift by waiting (a prompt too long, a turn or budget cap, a concurrency cap).
NOT_A_LIMIT = re.compile(r"max[_ ]turns|context|too long|budget|concurrent|recursion|device", re.I)
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
RESET_ISO = re.compile(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|UTC|[+-]\d{2}:?\d{2})?")
RESET_EPOCH = re.compile(r"(?:\||resets?\s+(?:at\s+)?)\s*(\d{10}|\d{13})(?!\d)", re.I)
RESET_IN = re.compile(r"resets?\s+in\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m)\b[\s,]*(?:and\s+)?)+)", re.I)
RESET_CLOCK = re.compile(
    r"resets?\s+(?:at\s+|on\s+)?(?:(?P<mon>" + "|".join(MONTHS) + r")[a-z]*\.?\s+(?P<day>\d{1,2}),?\s+"
    r"(?:(?P<year>\d{4}),?\s+)?(?:at\s+)?)?(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>[ap])\.?m\.?"
    r"(?:\s*\((?P<tz>[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+)*)\))?", re.I)


def is_limit(text: str | None) -> bool:
    """Whether an error from `claude -p` is a usage limit (5-hour session, weekly, rate): it mentions a limit and
    isn't one of the caps that waiting won't lift. "CameraApp" doesn't count: the word must stand alone."""
    text = text or ""
    return bool(re.search(r"\blimit(?:s|ed)?\b", text, re.I)) and not NOT_A_LIMIT.search(text)


def local_now() -> dt.datetime:
    return dt.datetime.now().astimezone()


def reset_time(text: str, now: dt.datetime | None = None) -> dt.datetime | None:
    """When a limit resets, read from the CLI's text: "resets 3:30pm (America/New_York)", "resets at 3pm",
    "resets Oct 14, 9am (UTC)", "resets in 2h 15m", an ISO time, or an epoch ("usage limit reached|1760000000").
    None when the text gives no time. Always timezone-aware."""
    now = now or local_now()
    text = text or ""
    if m := RESET_ISO.search(text):
        zone = m.group(3) or ""
        stamp = dt.datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}{'+00:00' if zone in ('Z', 'UTC') else zone}")
        return stamp if stamp.tzinfo else stamp.astimezone()
    if m := RESET_EPOCH.search(text):
        n = int(m.group(1))
        return dt.datetime.fromtimestamp(n / 1000 if n > 10**11 else n).astimezone()
    if m := RESET_IN.search(text):
        units = {"d": "days", "h": "hours", "m": "minutes"}
        span = dt.timedelta()
        for n, unit in re.findall(r"(\d+)\s*([a-z]+)", m.group(1), re.I):
            span += dt.timedelta(**{units[unit[0].lower()]: int(n)})
        return now + span
    if m := RESET_CLOCK.search(text):
        try:
            from zoneinfo import ZoneInfo
            zone = ZoneInfo(m.group("tz")) if m.group("tz") else now.tzinfo
        except (ValueError, KeyError, OSError):
            zone = now.tzinfo
        here = now.astimezone(zone)
        hour = int(m.group("h")) % 12 + (12 if m.group("ap").lower() == "p" else 0)
        if hour > 23 or int(m.group("m") or 0) > 59:
            return None
        when = here.replace(hour=hour, minute=int(m.group("m") or 0), second=0, microsecond=0)
        if m.group("mon"):
            month = MONTHS.index(m.group("mon")[:3].lower()) + 1
            try:
                when = when.replace(year=int(m.group("year") or here.year), month=month, day=int(m.group("day")))
            except ValueError:
                return None
            if when < here - dt.timedelta(days=1) and not m.group("year"):
                when = when.replace(year=when.year + 1)  # "Jan 2" seen on Dec 31
        elif when <= here:
            when += dt.timedelta(days=1)  # "3pm" after 3pm is tomorrow's
        return when
    return None


def retry_time(text: str, now: dt.datetime | None = None) -> dt.datetime:
    """When to run again: a minute after the reset the CLI names, or LIMIT_WAIT from now when it names none (or
    one that has already passed). Local time."""
    now = now or local_now()
    reset = reset_time(text, now)
    if reset is None or reset <= now:
        return (now + LIMIT_WAIT).replace(microsecond=0).astimezone()
    return (reset + dt.timedelta(minutes=1)).replace(microsecond=0).astimezone()


class LimitReached(SystemExit):
    """`claude -p` hit a usage limit. A SystemExit, so a caller that doesn't queue fails as it always did."""

    def __init__(self, message: str, retry_at: dt.datetime):
        super().__init__(f"Limit reached: {message}")
        self.message, self.retry_at = message, retry_at


def retries_file() -> Path:
    return ROOT / "holding" / "retries.json"


def waiter_file() -> Path:
    return ROOT / "holding" / "retries.pid"


def parse_time(value) -> dt.datetime | None:
    try:
        stamp = dt.datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return stamp if stamp.tzinfo else stamp.astimezone()


def read_retries() -> list[dict]:
    """The queue in holding/retries.json: one entry per thread (or Board subtask) waiting out a limit:
    {thread, role, model, engine, retry_at, queued, attempts} plus `brief` for a Board subtask."""
    try:
        items = json.loads(retries_file().read_text())
    except (OSError, ValueError):
        return []
    return [e for e in items if isinstance(e, dict) and e.get("thread")] if isinstance(items, list) else []


def edit_retries(change) -> list[dict]:
    """Read, change and write the queue under a lock, so two runs hitting the limit at once don't lose an entry."""
    import fcntl
    retries_file().parent.mkdir(parents=True, exist_ok=True)
    with open(retries_file(), "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        try:
            items = json.loads(f.read() or "[]")
        except ValueError:
            items = []
        items = change([e for e in items if isinstance(e, dict) and e.get("thread")] if isinstance(items, list) else [])
        f.seek(0)
        f.truncate()
        f.write(json.dumps(items, indent=2, ensure_ascii=False) + "\n")
    return items


def same_retry(a: dict, thread: str, brief: str | None = None) -> bool:
    return a.get("thread") == thread and (a.get("brief") or None) == (brief or None)


def queue_retry(entry: dict) -> dict:
    """Add a run to the queue, or move its time when it's already there (attempts counts the limits hit)."""
    out = {}

    def change(items):
        nonlocal out
        old = next((e for e in items if same_retry(e, entry["thread"], entry.get("brief"))), {})
        out = {"thread": entry["thread"], **({"brief": entry["brief"]} if entry.get("brief") else {}),
               "role": entry.get("role"), "model": entry.get("model"), "engine": entry.get("engine") or "claude",
               "retry_at": entry["retry_at"], "queued": old.get("queued") or local_now().isoformat(timespec="seconds"),
               "attempts": int(old.get("attempts") or 0) + 1}
        return [e for e in items if e is not old] + [out]

    edit_retries(change)
    return out


def drop_retry(thread: str, brief: str | None = None) -> None:
    if any(same_retry(e, thread, brief) for e in read_retries()):
        edit_retries(lambda items: [e for e in items if not same_retry(e, thread, brief)])


def waiter_pid() -> int | None:
    """The pid of the live `retry --wait`, or None (a stale pid file doesn't count)."""
    try:
        pid = int(waiter_file().read_text().strip() or 0)
        if pid:
            os.kill(pid, 0)
            return pid
    except (OSError, ValueError):
        pass
    return None


def start_detached(args: list[str], label: str) -> None:
    """Run `converse.py <args>` in the background, as the app's startDetached does: on the subscription, never
    with a chat agent's grants, output to the app's run logs."""
    logs = Path.home() / "Library" / "Logs" / (os.environ.get("MASTER_REPO_ID", "").strip() or "master-repo") / "app-runs"
    logs.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    env = subscription_env()
    env.pop(CHAT_PIN, None)
    env["MASTER_REPO_ROOT"] = str(ROOT)
    with open(logs / f"{stamp}-{label}.log", "a") as out:
        subprocess.Popen([sys.executable, str(TOOLS_DIR / "converse.py"), *args],
                         cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True)


def start_waiter() -> None:
    """Make sure a `retry --wait` is draining the queue (the run that hit the limit starts it; so does the app)."""
    if not waiter_pid():
        start_detached(["retry", "--wait"], "retry-wait")


IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic")


def attachment(path: str) -> dict:
    """A file, folder or image the owner points an agent at. Must exist and live under their home folder. A long paste the
    app saved as a file (holding/uploads/<date>/<stamp>-pasted-<first words>.md|.txt) is kind `pasted`."""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise SystemExit(f"Attachment not found: {path}")
    if Path.home().resolve() not in p.parents:
        raise SystemExit(f"Attachments must be inside {Path.home()}: {path}")
    pasted = ((ROOT / "holding" / "uploads").resolve() in p.parents and p.suffix.lower() in (".md", ".txt")
              and re.match(r"[0-9a-z]+-pasted-", p.name))
    kind = "folder" if p.is_dir() else "image" if p.suffix.lower() in IMAGE_EXT else "pasted" if pasted else "file"
    return {"path": str(p), "kind": kind}


def repo_path(path: str) -> str:
    """A path as the owner and the agents see it: repo-relative inside Master-Repo, absolute outside it."""
    try:
        return str(Path(path).relative_to(ROOT.resolve()))
    except ValueError:
        return str(path)


def attachment_label(a: dict) -> str:
    """`image #3`: the attachment's kind and its number in the thread (counted per kind, in the order attached)."""
    return f"{a.get('kind', 'file')} #{a['n']}" if a.get("n") else str(a.get("kind", "file"))


def _label_text(text: str) -> str:
    """Text that sits inside a Markdown link label: no brackets or backslashes, one line."""
    return re.sub(r"\s+", " ", re.sub(r"[\[\]\\]", "", text)).strip()


def attachment_line(a: dict) -> str:
    """The record of one attachment at the end of the message body (app/DESIGN.md, Attachments):
    `[image #3](path)`, `[pasted #2: its first line](path)`, `[file #1: name.pdf](path)`, `[folder #1: name/](path)`.
    Paths are repo-relative inside Master-Repo, absolute outside it (in <…> when they have spaces)."""
    p, where = Path(a["path"]), repo_path(a["path"])
    if a.get("kind") == "image":
        text = attachment_label(a)
    elif a.get("kind") == "pasted":
        try:
            first = next((line for line in p.read_text(errors="replace").splitlines() if line.strip()), "")
        except OSError:
            first = ""
        first = _label_text(re.sub(r"^[#>*\-\s]+", "", first))
        first = first if len(first) <= 60 else first[:60].rsplit(" ", 1)[0] + "…"
        text = f"{attachment_label(a)}: {first or p.name}"
    else:
        # An upload's stored name starts with a time stamp (lib/attachments.ts saveUploads); show the name they gave it.
        name = re.sub(r"^[0-9a-z]{6,10}-", "", p.name) if where.startswith("holding/uploads/") else p.name
        text = f"{attachment_label(a)}: {_label_text(name)}{'/' if a.get('kind') == 'folder' else ''}"
    target = f"<{where}>" if re.search(r"[\s()<>]", where) else where
    return f"[{text}]({target})"


def attachment_dirs(thread: Path) -> list[str]:
    """Folders an agent needs access to for this thread's attachments (outside the repo)."""
    dirs = set()
    for _, m, _ in messages(thread):
        for a in m.get("attachments") or []:
            p = Path(a["path"])
            d = p if a.get("kind") == "folder" else p.parent
            if d.is_dir() and ROOT not in (d, *d.parents):
                dirs.add(str(d))
    return sorted(dirs)


def add_message(thread: Path, sender: str, to: str, kind: str, body: str, subject: str | None = None,
                extra: dict | None = None, attachments: list[str] | None = None) -> Path:
    sender = "owner" if sender == "alex" else sender
    to = "owner" if to == "alex" else to
    if sender not in roles() or to not in roles():
        raise SystemExit(f"Roles are {', '.join(roles())}")
    if kind not in KINDS:
        raise SystemExit(f"Kinds are {', '.join(KINDS)}")
    n = len(messages(thread)) + 1
    head, _ = read_thread(thread)
    participants = head.get("participants") or ["owner", "ceo", "coo"]
    if "ceo" in (sender, to) and "ceo" not in participants:
        participants = [*participants, "ceo"]  # the owner asked the CEO in; it stays for the rest of the thread
    meta = {"from": sender, "to": to, "kind": kind, "date": today()}
    if subject:
        meta["subject"] = subject
    if attachments:
        # Numbered per kind across the thread (image #1, #2 …) and recorded as lines after the body, so "image #3"
        # means one thing to the owner, in the app and to the agents. `typed` (in extra) keeps only their words.
        count: dict[str, int] = {}
        for _, m, _ in messages(thread):
            for a in m.get("attachments") or []:
                count[a.get("kind")] = count.get(a.get("kind"), 0) + 1
        meta["attachments"] = []
        for a in map(attachment, attachments):
            count[a["kind"]] = count.get(a["kind"], 0) + 1
            meta["attachments"].append({**a, "n": count[a["kind"]]})
        record = "\n".join(map(attachment_line, meta["attachments"]))
        body = f"{body.strip()}\n\n{record}" if body.strip() else record
    meta.update(extra or {})
    path = thread / f"{n:03d}-{sender}.md"
    write_doc(path, meta, body, exclusive=True)
    status = "awaiting-owner" if to in ("alex", "owner") else "decided" if kind == "approval" else "open"
    if status in ("awaiting-alex", "awaiting-owner") and kind != "decision" and head.get("mode") in ("talk", "chat"):
        status = "talking"  # a conversation turn, not something for the decisions desk
    update_thread(thread, status=status, last_from=sender, messages=n, participants=participants)
    return path


def new_thread(scope: str, title: str, body: str, sender: str = "owner", to: str | None = None,
               kind: str = "directive", extra_meta: dict | None = None, attachments: list[str] | None = None,
               talk: bool = False, projects: list[str] | None = None, page: dict | None = None,
               folder: str | None = None, message_extra: dict | None = None) -> Path:
    base = scope_dir(scope) / "threads"
    for p in projects or []:
        scope_dir(p)  # validate
    extra_meta = {**(extra_meta or {}), **({"mode": "talk"} if talk else {}), **({"page": page} if page else {}),
                  **({"projects": [p for p in projects if p != scope]} if projects else {})}
    if scope == "holding":
        participants = ["owner", "ceo"]
    elif tier(scope) == "focus" or to == "ceo":
        participants = ["owner", "ceo", "coo"]
    else:
        participants = ["owner", "coo"]  # a small project: the COO and the owner sort it out without the CEO
    to = to or ("ceo" if scope == "holding" else "coo")
    base.mkdir(exist_ok=True)
    thread = base / (folder or f"{today()}-{slugify(title)}")
    n = 2
    while thread.exists() and not folder:  # a second thread with the same title on the same day
        thread = base / f"{today()}-{slugify(title)}-{n}"
        n += 1
    thread.mkdir(exist_ok=bool(folder))
    meta = {"title": title, "scope": scope, "status": "open", "started": today(), "updated": today(),
            "participants": participants,
            "summary": "", "decision": None, "messages": 0, **(extra_meta or {})}
    write_doc(thread / "thread.md", meta, "")
    add_message(thread, sender, to, kind, body, subject=title, attachments=attachments, extra=message_extra)
    return thread


def chat(scope: str, body: str, page: dict | None = None, attachments: list[str] | None = None,
         typed: str | None = None) -> Path:
    """the owner's message in the app's chat dock: one conversation per project (or the holding), in
    `<scope>/threads/chat/`, created on the first message and reused after. Each message records the page it
    was sent from (`page: false` when they turned the page off), so the agent reads the page they are on now."""
    thread = scope_dir(scope) / "threads" / "chat"
    extra = {"page": page or False, **typed_meta(body, typed)}
    if not (thread / "thread.md").exists():
        return new_thread(scope, "Chat", body, to="ceo", kind="reply", attachments=attachments,
                          extra_meta={"mode": "chat"}, folder="chat", message_extra=extra)
    if running_pid(thread):
        raise SystemExit("Still answering the last message.")
    add_message(thread, "owner", "ceo", "reply", body, extra=extra, attachments=attachments)
    return thread


# --- context -----------------------------------------------------------------------------------------

def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit].rsplit("\n", 1)[0] + "\n[…clipped]"


def pulse_of(slug: str) -> str:
    """The project's activity from holding/pulse.json (written by tools/portfolio.py pulse)."""
    import portfolio as pf  # late: portfolio imports this module
    return pf.pulse_line(pf.read_pulse().get(slug))


def project_brief(slug: str, limit: int = 6000) -> str:
    """The project's story, open fronts, repos and open threads: what any agent needs to orient."""
    base = scope_dir(slug)
    parts = []
    company = json.loads((base / "company.json").read_text())
    parts.append(f"# {company.get('name', slug)} (`companies/{slug}/`)")
    status = f"Activity: {pulse_of(slug)}."
    release = company.get("release") or {}
    if release:
        status += (f" Release card ({release.get('last_check')}): {release.get('verdict')}, published "
                   f"{release.get('published')}, via {release.get('channel')}, landing page "
                   f"{release.get('landing_page') or 'none'}. Next step: {release.get('next_step')}.")
    parts.append(status)
    index = base / "wiki" / "index.md"
    if index.exists():
        parts.append("## Story\n" + clip(split_frontmatter(index.read_text())[1], limit))
    fronts = []
    for p in sorted((base / "wiki" / "fronts").glob("*.md")):
        meta, _ = split_frontmatter(p.read_text())
        if meta.get("status", "open") in ("open", "working"):
            fronts.append(f"- **{meta.get('title', p.stem)}** ({meta.get('status', 'open')}): {meta.get('summary', '')} "
                          f"`{p.relative_to(ROOT)}`")
    if fronts:
        parts.append("## Open fronts\n" + "\n".join(fronts))
    market = base / "market"
    if (market / "market.md").exists() or (market / "competitors.json").exists():
        lines = []
        if (market / "market.md").exists():
            lines.append(clip(split_frontmatter((market / "market.md").read_text())[1], limit // 3))
        if (market / "competitors.json").exists():
            for c in json.loads((market / "competitors.json").read_text()).get("competitors", []):
                a = c.get("appstore") or {}
                lines.append(f"- {c.get('name')}: {c.get('positioning') or c.get('who') or ''}"
                             + (f" (★{a['rating']}, {a.get('ratings')} ratings, {a.get('price')})" if a.get("rating") else "")
                             + (f" threat {c['threat']}" if c.get("threat") else ""))
        parts.append(f"## Market (`companies/{slug}/market/`)\n" + "\n".join(lines))
    repos = [r.get("path") for r in company.get("repos") or [] if r.get("path")]
    if repos:
        parts.append("## Code (read-only)\n" + "\n".join(f"- {r}" for r in repos))
    threads = []
    for t in sorted((base / "threads").glob("*/thread.md")) if (base / "threads").exists() else []:
        meta, _ = split_frontmatter(t.read_text())
        if meta.get("status") != "closed":
            threads.append(f"- {meta.get('title')} — {meta.get('status')}: {meta.get('summary') or ''} "
                           f"`{t.parent.relative_to(ROOT)}`")
    if threads:
        parts.append("## Threads\n" + "\n".join(threads))
    return "\n\n".join(parts)


def portfolio_slice(current: str | None = None, limit: int = 160) -> str:
    """The CEO's view of the portfolio: one line per focus project, names only for the rest."""
    data = portfolio()
    lines = []
    for slug in data.get("focus") or []:
        try:
            company = json.loads((scope_dir(slug) / "company.json").read_text())
        except SystemExit:
            continue
        line = company.get("one_liner") or company.get("ambition") or ""
        line = line.get("text", "") if isinstance(line, dict) else line
        lines.append(f"- **{company.get('name', slug)}** (`{slug}`): {clip(line, limit) if line else 'no one-liner yet'} "
                     f"[{pulse_of(slug)}]")
    others = [s for t in ("maintain", "undecided", "paused") for s in data.get(t) or [] if s != current]
    out = "## Focus projects (yours)\n" + ("\n".join(lines) or "None chosen yet; the owner sets them in holding/portfolio.json.")
    if others:
        import portfolio as pf
        pulses = pf.read_pulse()
        names = [f"{s} ({pulses[s]['state']})" if s in pulses else s for s in others]
        out += ("\n\n## Not yours unless asked\n" + ", ".join(names) + ". Small or undecided projects run by "
                "their COO and the owner. Don't weigh them or read their files unless this thread is about one.")
    return out


def thread_text(thread: Path) -> str:
    meta, _ = read_thread(thread)
    msgs = messages(thread)
    shown = msgs if len(msgs) <= FULL_THREAD else [msgs[0], *msgs[-(FULL_THREAD - 2):]]
    lines = [f"# Thread: {meta.get('title')}", f"Status: {meta.get('status')}"]
    if meta.get("summary"):
        lines.append(f"Summary so far: {meta['summary']}")
    if len(shown) < len(msgs):
        lines.append(f"({len(msgs) - len(shown)} earlier messages omitted; the summary covers them.)")
    for p, m, body in shown:
        on = m.get("page") if isinstance(m.get("page"), dict) else {}
        where = f" · sent from {on.get('title') or on.get('url')} ({on.get('url')})" if on else ""
        lines.append(f"\n## {p.stem} · {m.get('from')} → {m.get('to')} · {m.get('kind')} · {m.get('date')}{where}\n{body}")
        if m.get("attachments"):
            lines.append("Attached (read these with your tools; images open with Read). the owner sees the same numbers, so "
                         "\"image #3\" is this thread's image #3. Pasted files are material they brought, not their words:\n"
                         + "\n".join(f"- {attachment_label(a)}: {repo_path(a['path'])}" for a in m["attachments"]))
    return "\n".join(lines)


def next_role(thread: Path) -> str | None:
    msgs = messages(thread)
    if not msgs:
        return None
    to = msgs[-1][1].get("to")
    return to if to in agent_roles() else None


def build_prompt(thread: Path, role: str) -> str:
    _, role_text = split_frontmatter(role_files()[role].read_text())
    scope = scope_of(thread)
    sections = [role_text, f"Repo root (Master-Repo): {ROOT}. Today is {today()}."]
    focus = scope == "holding" or tier(scope) == "focus"
    talk = is_talk(thread)
    if scope != "holding":
        # The CEO gets the full brief only for its own projects; when the owner pulls it into a small one, a short one.
        sections.append("# The project\n" + project_brief(scope, 6000 if role == "coo" or focus or talk else 1500))
    others = [p for p in about(thread) if p != scope]
    if others:
        sections.append("# Also about\n" + "\n\n".join(project_brief(p, 2000) for p in others))
    if scope != "holding":
        if role == "coo" and not talk:
            sections.append(f"You may write long research to `companies/{scope}/notes/` and link it. "
                            "The market file and mockups go to their own folders (below). Write nowhere else.")
    if role == "ceo" and not talk:
        if not focus:
            sections.append("This project isn't one of your focus projects. the owner brought you in for this one "
                            "question: answer it, keep it light, and don't plan beyond it.")
        vision = ROOT / "holding" / "vision.md"
        if vision.exists():
            sections.append("# the owner's vision\n" + clip(split_frontmatter(vision.read_text())[1], 3000))
        direction = ROOT / "holding" / "direction.md"
        if direction.exists():
            sections.append("# Across all projects\n" + clip(direction.read_text(), 3000))
        sections.append(portfolio_slice(scope))
    page = page_of(thread)
    if page:
        f = page.get("file")
        body = clip((ROOT / f).read_text(errors="ignore"), 8000) if f and (ROOT / f).is_file() else ""
        sections.append(f"# The page: {page.get('title') or page.get('url')}\n"
                        + (f"File: `{f}`\n\n{body}" if body else f"(Context: `{f}`)" if f else "(No file behind it.)"))
    sections.append(thread_text(thread))
    if role == "ceo":
        states = [json.loads(p.read_text()) for p in sorted((thread / "lanes").glob("*.json"))]
        if states:
            sections.append("# Lane results\n" + json.dumps(states, ensure_ascii=False) +
                            "\nWrite one summary and recommendation using all lane results, including failures. "
                            "Do not request more fan-out in this summary.")
        sections.append("To consult several projects after this turn, put this exact line in your body: "
                        "FANOUT: slug1, slug2 | precise brief. Do not request it again after receiving lane results.")
    up = boss(thread)
    if talk:
        homes = [f"`{d}/`" for d in idea_homes(thread)]
        rule = (TALK_RULE + f"\n\nYou may write idea pages to {', '.join(homes)} and mockups to their folder (below), nowhere else. "
                "Address owner in every reply.")
        if is_chat(thread):
            name = "the parent company" if scope == "holding" else f"`{scope}`"
            rule += "\n\n" + (CHAT_RULE.replace("{where}", name)
                                .replace("{board}", "" if scope == "holding" else CHAT_BOARD)
                                .replace("python3 tools/", f"python3 {TOOLS_DIR}/")
                                .replace("{scope}", scope).replace("{thread}", str(thread.relative_to(ROOT))))
            rule += "\n\n" + (CALENDAR_RULE.replace("python3 tools/", f"python3 {TOOLS_DIR}/")
                                .replace("{thread}", str(thread.relative_to(ROOT)))
                                .replace("{today}", dt.date.today().isoformat()))
        if page:
            wiki, files = page_wiki(thread), page_files(thread)
            if page.get("file") == CALENDAR_FILE and is_chat(thread):
                or_wiki = " (don't edit the file: write through agenda.py, as the calendar rules say)"
            elif files:
                or_wiki = f" (you may edit `{files[0]}`, and anything under `{wiki}/`)"
            elif scope == "holding" and wiki and not page_editable(thread):
                or_wiki = (f" (you can't edit `{page['file']}`; say the change and the owner makes it. You may edit "
                           f"anything under `{wiki}/`)")
            elif wiki:
                or_wiki = f" (you may edit anything under `{wiki}/`)"
            else:
                or_wiki = " (you can't edit this one; say the change and the owner makes it)"
            rule += "\n\n" + PAGE_RULE.format(
                title=page.get("title") or "a page", url=page.get("url") or "",
                file_note=f", file `{page['file']}`" if page.get("file") else "", or_wiki=or_wiki)
    elif role == "coo" and up in ("alex", "owner"):
        rule = ("This is a small project with no CEO on it: you report to the owner directly. Keep it practical; "
                "when a plan is ready, send it to owner as kind decision so they can approve it.")
    elif role == "coo":
        rule = "You report to the CEO, never to the owner directly."
    else:
        rule = ("Address owner only when a decision is ready for their approval (kind decision) or you need "
                "something only they can give.")
        first = messages(thread)[0][1] if messages(thread) else {}
        if role == "ceo" and first.get("from") == first.get("to") == "ceo":
            rule += ("\n\nThe first message is your own brief, written from the owner's chat (not their words). Do the work "
                     "it asks and report to owner.")
        if scope == "holding" and role == "ceo":
            rule += ("\n\nYou may write idea pages for the parent company to `holding/wiki/ideas/<YYYY-MM-DD>-<topic>.md` "
                     "(kind: idea, written_by: agent) and mockups to their folder (below), nowhere else.")
    if read_thread(thread)[0].get("helpers", True) is not False:
        sections.append("# Helpers\nYou oversee smaller agents. Hand bulk, repetitive work to them with the Agent tool "
                        "and keep your own attention on judgment: `scout` (fast, cheap) for finding, reading and "
                        "summarizing files and git history; `researcher` for web lookups. Give each a precise "
                        "question, run independent ones in parallel, and check any claim you rely on before you "
                        "repeat it. Do small lookups yourself; a helper is for work that would fill your context.")
    if role == "ceo":
        sections.append(CONSULT_RULE.replace("python3 tools/", f"python3 {paths.tools_ref()}/")
                        .replace("{thread}", str(thread.relative_to(ROOT)))
                        .replace("{projects}", ", ".join(project_slugs())))
    msgs = messages(thread)
    if role == "ceo" and msgs and msgs[-1][1].get("from") in ("alex", "owner"):
        items = open_questions(thread)
        if items:
            sections.append(RECONCILE_RULE.replace("{questions}", questions_text(items)))
    sections.append(WRITING_RULE)
    sections.append(mockup_rule(mockup_dir(scope), thread))
    sections.append(VISUAL_RULE)
    if role == "coo" and scope != "holding":
        sections.append(market_rule(scope))
    sections.append(f"""# Your reply

Write the next message in this thread as the {role.upper()}. Output exactly this shape and nothing else:

to: <{'owner' if talk or role == 'ceo' else up}>
kind: <{' | '.join(k for k in KINDS if k != 'approval')}>
subject: <short subject line>
thread_summary: <one sentence: where the whole thread stands now>
---
<message body, at most {WORD_LIMIT} words, starting with a 1–2 sentence summary>

{rule}

{OPTIONS_RULE}""")
    return "\n\n".join(sections)


def parse_reply(text: str, role: str, up: str = "ceo") -> dict:
    """`up` is who the COO reports to on this thread (the CEO, or the owner on a project without one)."""
    other = up if role == "coo" else "coo"
    text = text.strip()
    text = re.sub(r"^```[a-z]*\n|\n```$", "", text)
    head, sep, body = text.partition("\n---\n")
    fields = dict(re.findall(r"^(to|kind|subject|thread_summary):\s*(.+)$", head, re.M)) if sep else {}
    if not fields:
        return {"to": other, "kind": "reply", "subject": None, "summary": None, "body": text}
    to = fields.get("to", other).strip().lower()
    kind = fields.get("kind", "reply").strip().lower()
    if role == "coo":
        to = up  # the chain of command: a COO reports to the CEO when there is one, else to the owner
    return {
        "to": to if to in roles() and to != role else other,
        "kind": kind if kind in KINDS and kind != "approval" else "reply",
        "subject": fields.get("subject", "").strip() or None,
        "summary": fields.get("thread_summary", "").strip() or None,
        "body": body.strip(),
    }


def options_card(body: str) -> dict | None:
    """The ```options block at the end of a decision (OPTIONS_RULE), or None. Mirrors app/src/lib/decisions.ts."""
    m = re.search(r"```options\n(.*?)(?:```|\Z)", body, re.S)
    if not m:
        return None
    card: dict = {"ask": "", "options": [], "revisit": ""}
    for line in m.group(1).splitlines():
        line = re.sub(r"^\s*[-*]\s+(?=[A-Z]\*?\s*\|)", "", line).strip()
        kv = re.match(r"(?i)(ask|revisit):\s*(.+)$", line)
        if kv:
            card[kv.group(1).lower()] = kv.group(2).strip()
            continue
        opt = re.match(r"([A-Z])(\*)?\s*\|(.*)$", line)
        if not opt:
            continue
        label, *rest = [part.strip() for part in opt.group(3).split("|")]
        fields = {}
        for part in rest:
            f = re.match(r"(?i)([a-z ]+):\s*(.*)$", part)
            if f:
                fields[f.group(1).strip().lower()] = f.group(2).strip()
        card["options"].append({"key": opt.group(1), "label": label, "recommended": bool(opt.group(2)),
                                "time": fields.get("time", ""), "complexity": fields.get("complexity", ""),
                                "growth": fields.get("growth", ""),
                                "costs": fields.get("costs") or fields.get("gives up", "")})
    if not card["options"]:
        return None
    if not any(o["recommended"] for o in card["options"]):
        card["options"][0]["recommended"] = True
    return card


def decisions_file(scope: str) -> Path:
    return ROOT / "holding" / "decisions.json" if scope == "holding" else scope_dir(scope) / "decisions.json"


def record_decision(thread: Path, note: str | None = None) -> dict | None:
    """Append an approved thread's decision to the project's decisions.json, so every decision a project has
    made lives in one place. Idempotent: a thread is recorded once."""
    meta, _ = read_thread(thread)
    if meta.get("status") != "decided":
        return None
    scope = scope_of(thread)
    path = decisions_file(scope)
    log = json.loads(path.read_text()) if path.exists() else []
    ref = str(thread.relative_to(ROOT))
    if any((d.get("source") or {}).get("ref") == ref for d in log):
        return None
    msgs = messages(thread)
    proposal = next(((m, b) for _, m, b in reversed(msgs) if m.get("kind") == "decision"), None)
    approval = next(((m, b) for _, m, b in reversed(msgs) if m.get("kind") == "approval"), None)
    body = proposal[1] if proposal else ""
    card = options_card(body)
    reasoning = re.sub(r"```(?:options|release)\n.*?(?:```|\Z)", "", body, flags=re.S).strip()
    first = reasoning.split("\n\n", 1)[0].strip()
    prefix = re.sub(r"[^A-Z]", "", scope.upper())[:3] or "DEC"
    entry = {
        "id": f"{prefix}-DEC-{len(log) + 1:03d}",
        "date": (approval[0].get("date") if approval else None) or meta.get("updated") or today(),
        "decision": meta.get("decision") or (proposal[0].get("subject") if proposal else None) or meta.get("title"),
        "why": clip(first, 600) if first else meta.get("summary") or None,
        "alternatives": [f"{o['key']}: {o['label']}" for o in card["options"] if not o["recommended"]] if card else [],
        "tradeoffs": card["options"] if card else [],
        "revisit": card["revisit"] if card and card["revisit"] else None,
        "note": note if note is not None else (approval[1] if approval else None),
        "source": {"type": "owner", "ref": ref, "date": meta.get("updated") or today(),
                   "note": f"Approved by the owner in a thread; proposed by the {(proposal[0].get('from') or 'agent').upper() if proposal else 'agent'}."},
    }
    path.write_text(json.dumps([*log, entry], indent=2, ensure_ascii=False) + "\n")
    return entry


def desk() -> list[dict]:
    """Every thread waiting on the owner, oldest first, with its options card when the agent wrote one."""
    out = []
    for t in sorted(ROOT.glob("companies/*/threads/*/thread.md")) + sorted(ROOT.glob("holding/threads/*/thread.md")):
        meta, _ = split_frontmatter(t.read_text())
        msgs = messages(t.parent)
        if meta.get("status") not in ("awaiting-alex", "awaiting-owner") or not msgs:
            continue
        _, last, body = msgs[-1]
        out.append({"thread": str(t.parent.relative_to(ROOT)), "scope": meta.get("scope") or scope_of(t.parent),
                    "from": last.get("from"), "kind": last.get("kind"), "since": last.get("date") or meta.get("updated"),
                    "title": meta.get("decision") or last.get("subject") or meta.get("title"),
                    "card": options_card(body)})
    return sorted(out, key=lambda d: (d["scope"] not in (portfolio().get("focus") or []), d["since"] or ""))


# --- engines -----------------------------------------------------------------------------------------

def subscription_env() -> dict:
    # An API key in the environment makes Claude Code bill the API instead of the subscription.
    env = dict(os.environ)
    env.pop("ANTHROPIC_API_KEY", None)
    return env


def helper_agents(tools: list[str]) -> dict:
    """Helper definitions limited to tools the overseer itself is allowed (they can never do more than it can)."""
    out = {}
    for name, spec in HELPERS.items():
        allowed = [t for t in tools if t.startswith(HELPER_TOOLS[name]) and not t.startswith(("Write", "Edit"))]
        if allowed:
            out[name] = {**spec, "tools": allowed}
    return out


def mockup_rule(folder: str, thread: Path | None) -> str:
    """MOCKUP_RULE for this folder; a review made in a thread links back to it, so the owner's notes are posted there."""
    return MOCKUP_RULE.replace("{dir}", folder).replace("{thread}", str(thread.relative_to(ROOT)) if thread else '""')


def mockup_dir(scope: str) -> str:
    return "holding/mockups" if scope == "holding" else f"companies/{scope}/mockups"


def run_claude(prompt: str, role: str, scope: str, model: str, extra_dirs: tuple[str, ...] = (),
               helpers: bool = True, writable: tuple[str, ...] = (), consult_from: Path | None = None,
               commands: tuple[str, ...] = (), pin: str | None = None) -> tuple[str, dict]:
    # A folder grants Write and Edit under it; a single file (holding/vision.md) only Edit of that file.
    tools = list(role_spec(role)["tools"]) + [grant for w in writable for grant in (
        [f"Edit(./{w})"] if Path(w).suffix else [f"{verb}(./{w}/**)" for verb in ("Write", "Edit")])]
    tools += [f"Bash({c} :*)" for c in commands]
    settings: dict = {"disableAllHooks": True}
    if consult_from:  # the CEO calls COOs as tools (CONSULT_RULE); a COO run takes minutes
        tools.append(f"Bash(python3 {paths.tools_ref()}/converse.py consult {consult_from.relative_to(ROOT)} :*)")
        settings["env"] = {"BASH_DEFAULT_TIMEOUT_MS": "1200000", "BASH_MAX_TIMEOUT_MS": "1800000"}
    cmd = ["claude", "-p", "--model", model, "--output-format", "json", "--no-session-persistence",
           "--max-turns", str(role_spec(role)["max_turns"]),
           # No hooks or MCP servers from the owner's own setup: a plugin hook once made the agent answer it instead
           # of the thread. (--bare would also skip them, but it forces API-key billing.)
           "--settings", json.dumps(settings), "--strict-mcp-config", "--setting-sources", ""]
    tools += [f"{verb}(./{mockup_dir(scope)}/**)" for verb in ("Write", "Edit")]
    if scope != "holding":
        if role == "coo":
            tools += [f"Write(./companies/{scope}/notes/**)", f"Edit(./companies/{scope}/notes/**)",
                      f"Write(./companies/{scope}/market/**)", f"Edit(./companies/{scope}/market/**)",
                      # the market tool, for this project only
                      *(f"Bash(python3 {paths.tools_ref()}/market.py {cmd} {scope}:*)" for cmd in ("search", "add", "reviews", "status")),
                      f"Write(./companies/{scope}/screens/screens.json)", f"Edit(./companies/{scope}/screens/screens.json)"]
        company = json.loads((scope_dir(scope) / "company.json").read_text())
        for repo in company.get("repos") or []:
            if repo.get("path") and Path(repo["path"]).is_dir():
                cmd += ["--add-dir", repo["path"]]
    for d in extra_dirs:
        cmd += ["--add-dir", d]
    if helpers:
        cmd += ["--agents", json.dumps(helper_agents(tools))]
        tools += ["Agent", "Task"]  # the subagent tool (named Task in older Claude Code)
    cmd += ["--allowedTools", *tools, "--disallowedTools", *paths.GIT_DENY]
    env = subscription_env()
    env.pop(CHAT_PIN, None)  # a run started from a chat agent's command (board) never inherits its grants
    if commands and pin:
        env[CHAT_PIN] = pin
    proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, cwd=ROOT, env=env)
    try:
        data = json.loads(proc.stdout)
    except ValueError:
        text = proc.stderr.strip() or proc.stdout[:500]
        if is_limit(text):
            raise LimitReached(text[:500], retry_time(text))
        raise SystemExit(f"claude -p failed ({proc.returncode}): {text}")
    if data.get("is_error"):
        text = str(data.get("result") or "")
        if data.get("subtype") != "error_max_turns" and is_limit(text):
            raise LimitReached(text[:500], retry_time(text))
        raise SystemExit(f"claude -p returned an error: {data.get('result')}")
    usage = {
        "engine": "claude", "model": model, "turns": data.get("num_turns"),
        "seconds": round((data.get("duration_ms") or 0) / 1000),
        # On a subscription login this is a list-price estimate, not a charge.
        "list_price_usd": round(data.get("total_cost_usd") or 0, 4),
    }
    by_model = {k.removeprefix("claude-"): round(v.get("costUSD") or 0, 4)
                for k, v in (data.get("modelUsage") or {}).items()}
    if len(by_model) > 1:
        usage["by_model"] = by_model  # the overseer plus the helpers it used
    return data.get("result") or "", usage


def run_codex(prompt: str, role: str, scope: str, model: str | None, extra_dirs: tuple[str, ...] = ()) -> tuple[str, dict]:
    with tempfile.NamedTemporaryFile("r", suffix=".md") as out:
        cmd = ["codex", "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
               "-C", str(ROOT), "-o", out.name]
        if model:
            cmd += ["-m", model]
        if scope != "holding":
            company = json.loads((scope_dir(scope) / "company.json").read_text())
            for repo in company.get("repos") or []:
                if repo.get("path") and Path(repo["path"]).is_dir():
                    cmd += ["--add-dir", repo["path"]]
        for d in extra_dirs:
            cmd += ["--add-dir", d]
        start = dt.datetime.now()
        proc = subprocess.run([*cmd, "-"], input=prompt, capture_output=True, text=True)
        if proc.returncode:
            raise SystemExit(f"codex exec failed ({proc.returncode}): {proc.stderr.strip()[-500:]}")
        text = Path(out.name).read_text()
    return text, {"engine": "codex", "model": model or "default",
                  "seconds": round((dt.datetime.now() - start).total_seconds())}


def take_turn(thread: Path, role: str | None = None, engine: str = "claude", model: str | None = None,
              dry_run: bool = False) -> Path | str | None:
    """One agent turn: the new message's path (the prompt on a dry run), or None when the run hit the usage limit
    and was queued to run again after the reset (nothing is posted; the thread shows `waiting`)."""
    role = role or next_role(thread)
    if not dry_run and running_pid(thread) not in (None, os.getpid()):
        raise SystemExit("An agent is already working on this thread.")
    if role not in agent_roles():
        raise SystemExit("Nobody to answer: the last message is addressed to the owner. Reply with `post` or `approve`.")
    prompt = build_prompt(thread, role)
    if dry_run:
        return prompt
    before = messages(thread)
    answering_alex = bool(before) and before[-1][1].get("from") in ("alex", "owner")
    scope = scope_of(thread)
    meta = read_thread(thread)[0]
    model = model or (None if engine == "codex" else (meta.get("models") or {}).get(role) or default_model(role))
    helpers = meta.get("helpers", True) is not False
    started = dt.datetime.now()
    # While a turn runs, thread.md says who is working (and the pid, so the app can tell a crash from a slow run).
    update_thread(thread, clear=("failed", "waiting"), running={"role": role, "engine": engine,
                                                                "model": model or "default",
                                                                "since": started.isoformat(timespec="seconds"),
                                                                "pid": os.getpid()})
    rel = str(thread.relative_to(ROOT))
    entry = {"thread": rel, "scope": scope, "role": role, "engine": engine,
             "model": model or "default", "started": started.isoformat(timespec="seconds")}
    try:
        extra = tuple(attachment_dirs(thread))
        if engine == "codex":
            text, usage = run_codex(prompt, role, scope, model, extra)
        else:
            writable = idea_homes(thread) if is_talk(thread) or (scope == "holding" and role == "ceo") else ()
            if is_talk(thread) and page_wiki(thread):
                writable += (page_wiki(thread),)
            writable += page_files(thread)
            if scope != "holding":
                writable += tuple(f"companies/{scope}/{w}" for w in role_spec(role)["writes"])
            text, usage = run_claude(prompt, role, scope, model, extra, helpers, writable,
                                     consult_from=thread if role == "ceo" else None, commands=chat_commands(thread),
                                     pin=str(thread.relative_to(ROOT)) if is_chat(thread) else None)
    except LimitReached as hit:  # not a failure: wait for the reset, then run again (`retry`)
        at = hit.retry_at.isoformat(timespec="seconds")
        update_thread(thread, clear=("running",), waiting={"reason": "limit", "retry_at": at,
                                                           "message": hit.message[:300], "role": role})
        log_run({**entry, "seconds": round((dt.datetime.now() - started).total_seconds()), "ok": False,
                 "limit": True, "retry_at": at, "error": hit.message[:500]})
        queue_retry({"thread": rel, "role": role, "model": model, "engine": engine, "retry_at": at})
        start_waiter()
        return None
    except BaseException as error:  # record the failure on the thread, then let it propagate
        message = str(error) or type(error).__name__
        update_thread(thread, clear=("running",), failed={"role": role, "at": dt.datetime.now().isoformat(timespec="seconds"),
                                                          "error": message[:500]})
        log_run({**entry, "seconds": round((dt.datetime.now() - started).total_seconds()), "ok": False,
                 "error": message[:500]})
        raise
    update_thread(thread, clear=("running",))
    drop_retry(rel)  # it went through, however it was started
    log_run({**entry, "seconds": usage.get("seconds"), "ok": True, "turns": usage.get("turns"),
             "list_price_usd": usage.get("list_price_usd")})
    reply = parse_reply(text, role, boss(thread))
    if is_talk(thread) or role == "ceo":
        reply["to"] = "owner"  # the CEO is the owner's one counterpart; it reaches COOs through consult, not the thread
    if is_chat(thread) and reply["kind"] == "decision":
        reply["kind"] = "reply"  # the chat never sits on the decisions desk; decisions get their own thread
    path = add_message(thread, role, reply["to"], reply["kind"], reply["body"], reply["subject"], {"usage": usage})
    changes = {"summary": reply["summary"]}
    if reply["kind"] == "decision":
        changes["decision"] = reply["subject"] or reply["body"].split("\n", 1)[0]
    update_thread(thread, **changes)
    # Only the owner's own words can withdraw or reshape their other questions: apply a reconcile block only on a turn
    # that answers them (the same turns that were shown RECONCILE_RULE).
    if role == "ceo" and answering_alex and parse_reconcile(reply["body"]):
        reconcile(thread, reply["body"])
    return path


def parse_fanout(body: str) -> tuple[list[str], str] | None:
    match = re.search(r"^FANOUT: ([a-z0-9][a-z0-9-]*(?:\s*,\s*[a-z0-9][a-z0-9-]*)+)\s*\|\s*(.+)$", body, re.M)
    return ([s.strip() for s in match[1].split(",")], match[2].strip()) if match else None


def project_repo(slug: str) -> Path | None:
    company = json.loads((scope_dir(slug) / "company.json").read_text())
    candidates = [r.get("path") or r.get("local_path") if isinstance(r, dict) else r
                  for r in company.get("repos") or []]
    candidates.append(company.get("local_path"))
    index = ROOT / "holding" / "codebases" / "index.json"
    if index.exists():
        candidates += [e.get("path") for e in json.loads(index.read_text()).get("codebases", [])
                       if e.get("project") == slug]
    return next((Path(p).expanduser().resolve() for p in candidates if p and Path(p).expanduser().is_dir()), None)


def lane_prompt(thread: Path, slug: str, brief: str, repo: Path | None) -> str:
    _, role = split_frontmatter(role_files()["coo"].read_text())
    base = scope_dir(slug)
    card = base / "card.json"
    latest = next((body for _, meta, body in reversed(messages(thread)) if meta.get("from") == "ceo"), "")
    context = [role, f"Master-Repo data: {ROOT}. Project: {slug}. Today: {today()}.",
               "Read-only investigation. Do not write files, run tests, install, or change anything. "
               "Reply with one or two sentences of findings/recommendation, citing paths; say unknown when needed.",
               f"Local repo: {repo}" if repo else "No local repo available. Running in the hub with project wiki context only.",
               "# Card\n" + (card.read_text() if card.exists() else "Unknown"),
               "# Story and fronts"]
    for path in [base / "wiki" / "index.md", *sorted((base / "wiki" / "fronts").glob("*.md"))]:
        if path.exists():
            meta, body = split_frontmatter(path.read_text())
            if path.name == "index.md" or meta.get("status", "open") in ("open", "working"):
                context.append(f"## {path.relative_to(ROOT)}\n{body}")
    return "\n\n".join([*context, "# CEO latest message\n" + latest, "# Brief\n" + brief, WRITING_RULE])


def write_lane(path: Path, state: dict) -> None:
    # Atomic replacement: readers never see a half-written JSON document.
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n")
    temp.replace(path)


def lane_engine(prompt: str, engine: str, model: str | None, cwd: Path, progress) -> tuple[str, dict]:
    if engine == "codex":
        with tempfile.NamedTemporaryFile(suffix=".md") as out:
            cmd = ["codex", "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
                   "-C", str(cwd), "-o", out.name]
            if model:
                cmd += ["-m", model]
            proc = subprocess.run([*cmd, "-"], input=prompt, capture_output=True, text=True,
                                  cwd=cwd, env=subscription_env())
            if proc.returncode:
                error = proc.stderr.strip() or proc.stdout.strip()
                if is_limit(error):
                    raise LimitReached(error, retry_time(error))
                raise RuntimeError(error or f"codex exited {proc.returncode}")
            return Path(out.name).read_text(), {"engine": engine, "model": model or "default"}
    tools = list(TOOLS["coo"])
    cmd = ["claude", "-p", "--model", model or default_model("coo"), "--output-format", "stream-json",
           "--verbose", "--no-session-persistence", "--max-turns", str(role_spec("coo")["max_turns"]),
           "--settings", json.dumps({"disableAllHooks": True}), "--strict-mcp-config", "--setting-sources", "",
           "--tools", "Read,Grep,Glob,WebSearch,WebFetch,Bash", "--allowedTools", *tools, "--disallowedTools", *paths.GIT_DENY, "--add-dir", str(ROOT)]
    env = subscription_env()
    env.pop(CHAT_PIN, None)
    # Files avoid pipe deadlocks (large prompts and stderr), while stdout stays live.
    with tempfile.TemporaryFile(mode="w+") as inp, tempfile.TemporaryFile(mode="w+") as err:
        inp.write(prompt)
        inp.seek(0)
        proc = subprocess.Popen(cmd, stdin=inp, stdout=subprocess.PIPE, stderr=err, text=True, cwd=cwd, env=env)
        result = None
        raw = []
        try:
            for line in proc.stdout:
                raw.append(line)
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if event.get("type") == "result":
                    result = event
                for block in (event.get("message") or {}).get("content", []):
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        args = block.get("input") or {}
                        detail = args.get("file_path") or args.get("path") or args.get("pattern") or args.get("query") or args.get("command") or ""
                        progress(f"{block.get('name', 'tool')} {detail}".strip()[:140])
            proc.wait()
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        finally:
            proc.stdout.close()
        err.seek(0)
        error = err.read()
    if result is None or result.get("is_error") or proc.returncode:
        error = str((result or {}).get("result") or error or "".join(raw))[-1000:]
        if is_limit(error) and (result or {}).get("subtype") != "error_max_turns":
            raise LimitReached(error, retry_time(error))
        raise RuntimeError(error or f"claude exited {proc.returncode}")
    return result.get("result") or "", {"engine": engine, "model": model or default_model("coo"),
                                           "turns": result.get("num_turns")}


def fanout(thread: Path, projects: list[str], brief: str = "", engine: str = "claude",
           model: str | None = None, dry_run: bool = False, resume: bool = False) -> list[dict]:
    if not has_ceo(thread):
        raise SystemExit("Fan-out requires a CEO thread.")
    if running_pid(thread) not in (None, os.getpid()):
        raise SystemExit("An agent is already working on this thread.")
    slugs = list(dict.fromkeys(s.strip() for s in projects if s.strip()))
    if not slugs:
        raise SystemExit("Give at least one project.")
    plans = []
    for slug in slugs:
        scope_dir(slug)
        repo = project_repo(slug)
        plans.append((slug, repo, lane_prompt(thread, slug, brief, repo)))
    if dry_run:
        return [{"slug": slug, "repo": str(repo) if repo else None, "cwd": str(repo or ROOT), "prompt": prompt}
                for slug, repo, prompt in plans]
    import threading
    post_lock = threading.Lock()
    folder = thread / "lanes"
    folder.mkdir(exist_ok=True)
    rel = str(thread.relative_to(ROOT))
    states = []
    for slug, repo, _ in plans:
        state = {"slug": slug, "role": "coo", "status": "queued", "started": local_now().isoformat(),
                 "finished": None, "steps": [], "result": None, "run_id": uuid.uuid4().hex,
                 "repo": str(repo) if repo else None, "brief": brief}
        write_lane(folder / f"{slug}.json", state)
        states.append(state)
    update_thread(thread, running={"role": "coo", "engine": engine, "pid": os.getpid(),
                                   "since": local_now().isoformat(), "task": "fanout"})

    def lane(plan, state):
        slug, repo, prompt = plan
        path = folder / f"{slug}.json"
        state.update(status="running", started=local_now().isoformat())
        write_lane(path, state)
        def progress(line):
            state["steps"] = [*state["steps"], line][-6:]
            write_lane(path, state)
        usage = {}
        try:
            text, usage = lane_engine(prompt, engine, model, repo or ROOT, progress)
            text = text.strip()
            state.update(status="done", result=text)
            drop_retry(rel, f"lane:{slug}")
        except LimitReached as hit:
            state.update(status="limited", result=hit.message[:500])
            queue_retry({"thread": rel, "brief": f"lane:{slug}", "role": "coo", "model": model,
                         "engine": engine, "retry_at": hit.retry_at.isoformat()})
        except (Exception, SystemExit) as error:
            state.update(status="failed", result=(str(error) or type(error).__name__)[:500])
            drop_retry(rel, f"lane:{slug}")
        finally:
            state["finished"] = local_now().isoformat()
            write_lane(path, state)
        with post_lock:
            add_message(thread, "coo", "ceo", "report", state["result"] or "No result returned.",
                        subject=f"{slug}: {state['status']}", extra={"lane": slug, "run_id": state["run_id"], "usage": usage})
            log_run({"thread": rel, "scope": slug, "role": "coo", "task": "fanout", "engine": engine,
                     "model": model or "default", "started": state["started"], "run_id": state["run_id"],
                     "ok": state["status"] == "done", "limit": state["status"] == "limited"})
    try:
        with ThreadPoolExecutor(max_workers=len(plans)) as pool:
            futures = [pool.submit(lane, plan, state) for plan, state in zip(plans, states)]
            for future in futures:
                future.result()
    finally:
        update_thread(thread, clear=("running",))
    all_states = [json.loads(p.read_text()) for p in folder.glob("*.json")]
    if any(s["status"] == "limited" for s in all_states):
        start_waiter()
    elif not any(s["status"] in ("queued", "running") for s in all_states):
        take_turn(thread, "ceo", engine=engine)  # one summary after every lane has reached a terminal state
    return states


def chat_commands(thread: Path) -> tuple[str, ...]:
    """What the chat agent may run on its own (CHAT_RULE, CALENDAR_RULE): start a thread, a Board plan on a project,
    and read and write the calendar. Only the narrow commands below, tied to this chat thread; nothing else of `new`
    or build.py."""
    if not is_chat(thread):
        return ()
    rel = str(thread.relative_to(ROOT))
    return (f"python3 {TOOLS_DIR}/converse.py spawn {rel}", f"python3 {TOOLS_DIR}/agenda.py --by {rel}") + (
        () if scope_of(thread) == "holding" else (f"python3 {TOOLS_DIR}/converse.py board {rel}",))


def chat_thread(arg: str) -> Path:
    """The chat thread a spawn/board call acts for: <scope>/threads/chat, and when a chat agent runs it, the one
    chat its run was started for (CHAT_PIN), so a path trick can't reach another project's chat."""
    thread = thread_path(arg)
    if thread.name != "chat" or not is_chat(thread):
        raise SystemExit(f"Not a chat thread: {arg}")
    pin = os.environ.get(CHAT_PIN)
    if pin and thread != (ROOT / pin).resolve():
        raise SystemExit("This chat can only start work for itself.")
    return thread


def spawn(chat_path: Path, title: str, body: str) -> Path:
    """The chat agent starts a piece of work as its own thread. The first message is the CEO's (never the owner's
    words): a directive to the project's COO, or on the parent company, where there is no COO, the CEO's own
    brief to itself (ceo → ceo), so the CEO is next and works it. The `spawn` command then starts that turn."""
    scope = scope_of(chat_path)
    rel = str(chat_path.relative_to(ROOT))
    to = "ceo" if scope == "holding" else "coo"
    return new_thread(scope, title, body, sender="ceo", to=to, kind="directive", extra_meta={"spawned_from": rel})


def start_run(thread: Path) -> None:
    """Start the agents' turns on a thread in the background (`converse.py run`), as the app's startRun does, so a
    spawned thread doesn't sit waiting. The run gets no chat grants: CHAT_PIN is dropped, and run_claude grants
    spawn/board only to a chat thread's own turn. Output goes to the app's run logs."""
    start_detached(["run", str(thread.relative_to(ROOT))], f"spawn-{scope_of(thread)}")


RUN_ROUNDS = 4  # turns a `run` (and a retried run) takes before stopping


def run_thread(thread: Path, rounds: int = RUN_ROUNDS, engine: str = "claude", model: str | None = None,
               role: str | None = None) -> bool:
    """Let the agents go back and forth (`run`). False when a turn hit the usage limit and was queued. With `role`
    (a retry), `model` is the one that role's queued turn was going to use; later turns use the thread's own."""
    for _ in range(rounds):
        nxt = next_role(thread)
        if not nxt:
            break
        out = take_turn(thread, nxt, engine, model if not role or nxt == role else None)
        if out is None:
            print(f"waiting: limit reached, retry at {(read_thread(thread)[0].get('waiting') or {}).get('retry_at')}",
                  flush=True)
            return False
        print(out.relative_to(ROOT), flush=True)
        if nxt == "ceo":
            request = parse_fanout(messages(thread)[-1][2])
            if request:
                fanout(thread, *request, engine=engine, model=model)
                break
        if role:
            role = model = None
    return True


def retry_entry(entry: dict) -> str:
    """Run one queued entry again: "done", "queued" (the limit again; it has a new time), "dropped" (nothing left
    to run, or it failed for another reason; a failure shows on the thread as before) or "busy" (running now)."""
    rel, brief = entry["thread"], entry.get("brief")
    if brief and brief.startswith("lane:"):
        thread = thread_path(rel)
        state = json.loads((thread / "lanes" / f"{brief[5:]}.json").read_text())
        fanout(thread, [state["slug"]], state.get("brief", ""), entry.get("engine") or "claude",
               entry.get("model"), resume=True)
        return "queued" if any(same_retry(e, rel, brief) for e in read_retries()) else "done"
    if brief or "/builds/" in rel:
        import build  # late: build imports this module
        return build.retry_after_limit(entry)
    try:
        thread = thread_path(rel)
    except SystemExit:
        drop_retry(rel)
        return "dropped"
    if running_pid(thread):
        return "busy"
    if not next_role(thread):  # the owner has the last word now (they answered, or someone ran it meanwhile)
        drop_retry(rel)
        update_thread(thread, clear=("waiting",))
        return "dropped"
    try:
        done = run_thread(thread, engine=entry.get("engine") or "claude", model=entry.get("model"),
                          role=entry.get("role"))
    except BaseException as error:  # take_turn has marked the thread failed; the queue lets it go
        if isinstance(error, KeyboardInterrupt):
            raise
        print(f"retry failed for {rel}: {error}", file=sys.stderr, flush=True)
        drop_retry(rel)
        return "dropped"
    if done:
        drop_retry(rel)
    return "done" if done else "queued"


def retry(thread_arg: str | None = None) -> list[tuple[str, str]]:
    """Run every queued entry whose time has come, or, with a thread, that thread's entry now (the owner's Retry now)."""
    entries = read_retries()
    if thread_arg:
        path = Path(thread_arg)
        rel = str((path if path.is_absolute() else ROOT / path).resolve().relative_to(ROOT))
        targets = [e for e in entries if e["thread"] == rel]
        if not targets:  # not queued (the file was lost): the thread's own marker says who was waiting
            waiting = read_thread(thread_path(rel))[0].get("waiting")
            if not isinstance(waiting, dict):
                raise SystemExit("Nothing is waiting on a limit in this thread.")
            targets = [{"thread": rel, "role": waiting.get("role"), "engine": "claude"}]
    else:
        now = local_now()
        targets = [e for e in entries if (parse_time(e.get("retry_at")) or now) <= now]
    return [(f"{e['thread']}{' #' + e['brief'] if e.get('brief') else ''}", retry_entry(e)) for e in targets]


def wait_and_retry(poll: float = 60.0) -> None:
    """`retry --wait`: sleep until the earliest retry time plus a minute, run what's due, and keep going while the
    queue has entries. One waiter at a time: it holds a lock on holding/retries.pid (which holds its pid for the
    app) for as long as it lives, so a stale file never blocks a new one. Sleeps in short steps against the wall
    clock, so a Mac that slept catches up when it wakes."""
    import fcntl
    import time
    waiter_file().parent.mkdir(parents=True, exist_ok=True)
    lock = open(waiter_file(), "a+")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        print("A retry waiter is already running.")
        return
    try:
        lock.seek(0)
        lock.truncate()
        lock.write(str(os.getpid()))
        lock.flush()
        while entries := read_retries():
            now = local_now()
            wake = min(parse_time(e.get("retry_at")) or now for e in entries) + dt.timedelta(minutes=1)
            if now < wake:
                time.sleep(min(poll, max(1.0, (wake - now).total_seconds())))
                continue
            for name, result in retry():
                print(f"{local_now().isoformat(timespec='seconds')} {result:8} {name}", flush=True)
            if read_retries() == entries:
                time.sleep(poll)  # everything due was busy; don't spin
    finally:
        lock.seek(0)
        lock.truncate()
        lock.close()


def board(chat_path: Path, goal: str) -> Path:
    """The chat agent asks for a Board plan (build.py plan): subtasks only; nothing runs until the owner approves."""
    scope = scope_of(chat_path)
    if scope == "holding":
        raise SystemExit("The parent company has no Board.")
    import build  # late: build imports this module
    return build.plan(scope, goal, str(chat_path.relative_to(ROOT)))


RECONCILE_RULE = """# Other questions waiting on the owner
the owner's latest words may change what these other open questions should be. They are on their desk now:

{questions}

For each one their message settles, overturns or reshapes, end your reply with a reconcile block, one line each:

```reconcile
<thread path> | withdraw | <one line: what in their answer makes it moot>
<thread path> | redo | <one line: what changes, so you can ask it again properly>
```

withdraw: their answer already decides it, or it no longer applies. redo: it still needs their call, but the
question, options or mockups are now wrong. Leave out every question that is still right as it is. Never decide
one for them, never withdraw one only because it is old, and when unsure, leave it."""


def open_questions(thread: Path) -> list[dict]:
    """Other threads waiting on the owner that this thread's answer could change: same projects, plus the holding's."""
    scopes = set(about(thread)) | {"holding"}
    me = str(thread.relative_to(ROOT))
    return [d for d in desk() if d["thread"] != me and d["scope"] in scopes]


def questions_text(items: list[dict]) -> str:
    out = []
    for d in items:
        _, _, body = messages(ROOT / d["thread"])[-1]
        ask = (d.get("card") or {}).get("ask") or d["title"]
        out.append(f"- `{d['thread']}` ({d['scope']}): {ask}\n  {clip(re.sub(r'```.*?```', '', body, flags=re.S), 500)}")
    return "\n".join(out)


def parse_reconcile(body: str) -> list[tuple[str, str, str]]:
    m = re.search(r"```reconcile\n(.*?)(?:```|\Z)", body, re.S)
    out = []
    for line in (m.group(1).splitlines() if m else []):
        parts = [x.strip().strip("`") for x in line.split("|", 2)]
        if len(parts) == 3 and parts[1].lower() in ("withdraw", "redo"):
            out.append((parts[0], parts[1].lower(), parts[2]))
    return out


def reconcile(source: Path, body: str, run_redo: bool = True) -> list[dict]:
    """Apply a ```reconcile block from the CEO: withdraw questions the owner's answer made moot, recompute reshaped ones.
    Only threads that were offered (open_questions) can be touched, and nothing is ever approved."""
    allowed = {d["thread"]: d for d in open_questions(source)}
    title = read_thread(source)[0].get("title") or source.name
    done = []
    for path, action, why in parse_reconcile(body):
        if path not in allowed:
            continue
        target = ROOT / path
        if action == "withdraw":
            add_message(target, "ceo", "owner", "reply",
                        f"Withdrawn: your answer in \u201c{title}\u201d (`{source.relative_to(ROOT)}`) settles this. {why}",
                        "Withdrawn after your answer elsewhere")
            update_thread(target, status="closed", superseded_by=str(source.relative_to(ROOT)),
                          summary=f"Withdrawn by the CEO after the owner's answer in \u201c{title}\u201d: {why}")
        else:
            add_message(target, "ceo", "ceo", "report",
                        f"Recomputing this after the owner's answer in \u201c{title}\u201d (`{source.relative_to(ROOT)}`): {why}",
                        "Recomputing after your answer elsewhere")
        done.append({"thread": path, "action": action, "why": why})
    if done:
        update_thread(source, reconciled=done)
    if run_redo:
        for d in done:
            if d["action"] == "redo":
                try:
                    take_turn(ROOT / d["thread"], "ceo")
                except BaseException as error:  # one failed recompute shouldn't lose the others
                    print(f"recompute failed for {d['thread']}: {error}", file=sys.stderr)
    return done


def reconcile_after(thread: Path, model: str | None = None) -> list[dict]:
    """After the owner approves (no agent turn follows), ask the CEO only whether the approval changes their other open
    questions, and apply its answer."""
    items = open_questions(thread)
    if not items:
        return []
    _, role_text = split_frontmatter(role_files()["ceo"].read_text())
    vision = ROOT / "holding" / "vision.md"
    prompt = "\n\n".join([
        role_text, f"Repo root (Master-Repo): {ROOT}. Today is {today()}.",
        "# the owner's vision\n" + clip(split_frontmatter(vision.read_text())[1], 3000) if vision.exists() else "",
        thread_text(thread),
        RECONCILE_RULE.replace("{questions}", questions_text(items)),
        "the owner has just decided this thread. Output only the reconcile block, or the word none.",
    ])
    text, usage = run_claude(prompt, "ceo", scope_of(thread), model or default_model("ceo"))
    log_run({"thread": str(thread.relative_to(ROOT)), "scope": scope_of(thread), "role": "ceo", "task": "reconcile",
             "seconds": usage.get("seconds"), "ok": True, "list_price_usd": usage.get("list_price_usd")})
    return reconcile(thread, text)


CONSULT_RULE = """# Your COOs
You are the one the owner talks to. Each project has a COO who knows its code, notes and screens; call them as tools
inside this turn instead of handing the thread over:

    python3 tools/converse.py consult {thread} <project-slug> "<precise question>"

It runs that project's COO (read-only on its code, may write notes and mockups) and prints the answer, which
can take several minutes; give the Bash call a long timeout. Ask several COOs at once with parallel calls,
follow up in more rounds when an answer opens a new question, and ask a COO for mockups when options need to be
seen. Think first, ask for what you lack, then put it together yourself: the owner gets one answer from you, with the
COOs' findings woven in (and their mockups listed in your own ```mockups block). Don't consult for things you
can read yourself in a minute. Projects: {projects}."""


def market_rule(slug: str) -> str:
    return (MARKET_RULE.replace("python3 tools/", f"python3 {paths.tools_ref()}/")
            .replace("{dir}", f"companies/{slug}/market").replace("{slug}", slug).replace("{{", "{").replace("}}", "}"))


def consults_dir(thread: Path) -> Path:
    return thread / "consults"


def consult(thread: Path, slug: str, question: str, model: str | None = None) -> str:
    """The CEO asks one project's COO a question mid-turn (CONSULT_RULE). Recorded under the thread's consults/
    with the number of the message it feeds, so the app can show what the CEO asked before it answered."""
    if not (ROOT / "companies" / slug / "company.json").exists():
        raise SystemExit(f"No project {slug!r}. Projects: {', '.join(project_slugs())}")
    folder = consults_dir(thread)
    folder.mkdir(exist_ok=True)
    feeds = len(messages(thread)) + 1
    n = len(list(folder.glob("*.md"))) + 1
    path = folder / f"{n:03d}-{slug}.md"
    while path.exists():
        n += 1
        path = folder / f"{n:03d}-{slug}.md"
    model = model or (read_thread(thread)[0].get("models") or {}).get("coo") or default_model("coo")
    started = dt.datetime.now()
    meta = {"project": slug, "feeds": feeds, "model": model, "status": "running",
            "started": started.isoformat(timespec="seconds"), "question": question}
    write_doc(path, meta, "")
    _, role_text = split_frontmatter(role_files()["coo"].read_text())
    prompt = "\n\n".join([
        role_text, f"Repo root (Master-Repo): {ROOT}. Today is {today()}.",
        "# The project\n" + project_brief(slug, 6000),
        f"You may write long research to `companies/{slug}/notes/`, the market file to `companies/{slug}/market/` "
        f"and mockups to `{mockup_dir(slug)}/` "
        "(see Mockups). Write nowhere else.",
        WRITING_RULE,
        mockup_rule(mockup_dir(slug), thread),
        VISUAL_RULE,
        market_rule(slug),
        f"# The CEO asks\nThe CEO is mid-way through answering the owner and needs this from you:\n\n{question}\n\n"
        "Answer the CEO directly in plain markdown (no header lines), at most about 400 words: findings first, "
        "each with a path, commit sha and date, or URL as evidence, the owner's words quoted, your inference "
        "marked, and end with any ```mockups block. Say \"unknown\" rather than guess."])
    entry = {"thread": str(thread.relative_to(ROOT)), "scope": slug, "role": "coo", "engine": "claude",
             "model": model, "task": "consult", "started": started.isoformat(timespec="seconds")}
    try:
        text, usage = run_claude(prompt, "coo", slug, model)
    except BaseException as error:
        write_doc(path, {**meta, "status": "failed", "error": (str(error) or type(error).__name__)[:500]}, "")
        log_run({**entry, "ok": False, "error": (str(error) or type(error).__name__)[:500]})
        raise
    write_doc(path, {**meta, "status": "done", "usage": usage}, text.strip())
    log_run({**entry, "seconds": usage.get("seconds"), "ok": True, "turns": usage.get("turns"),
             "list_price_usd": usage.get("list_price_usd")})
    return text.strip()


def project_slugs() -> list[str]:
    return sorted(p.parent.name for p in (ROOT / "companies").glob("*/company.json") if not p.parent.name.startswith("_"))


# --- commands ----------------------------------------------------------------------------------------

def body_arg(value: str, attached: bool = False) -> str:
    """The message text. It may be empty when files are attached: the body is then just their record lines."""
    text = sys.stdin.read() if value == "-" else value
    if not text.strip() and not attached:
        raise SystemExit("Empty message body")
    return text


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    typed_help = "what the owner typed before the spelling fixer changed --body; kept beside it as `typed`"
    p = sub.add_parser("new"); p.add_argument("scope"); p.add_argument("title"); p.add_argument("--body", required=True)
    p.add_argument("--typed", help=typed_help)
    p.add_argument("--json", action="store_true", help="print the new thread as JSON (scope, id, path)")
    p.add_argument("--attach", nargs="+", default=[], help="files, folders or images for the agents to look at")
    p.add_argument("--model", choices=MODELS, help="model for the agent this goes to, from now on in this thread")
    p.add_argument("--no-helpers", action="store_true", help="the agents work alone, without smaller helper agents")
    p.add_argument("--from", dest="sender", default="owner"); p.add_argument("--to", choices=agent_roles())
    p.add_argument("--kind", default="directive")
    p.add_argument("--talk", action="store_true", help="a conversation (ideas, revisions), not a run toward a decision")
    p.add_argument("--about", nargs="+", default=[], help="other projects this thread is also about")
    p.add_argument("--page-url", help="the app page the owner is talking from"); p.add_argument("--page-file")
    p.add_argument("--page-title")
    for name in ("turn", "run"):
        p = sub.add_parser(name); p.add_argument("thread"); p.add_argument("--engine", choices=("claude", "codex"), default="claude")
        p.add_argument("--model")
        if name == "turn":
            p.add_argument("--as", dest="role", choices=agent_roles()); p.add_argument("--dry-run", action="store_true")
        else:
            p.add_argument("--rounds", type=int, default=4)
    p = sub.add_parser("fanout", help="run project COOs concurrently, then one CEO summary")
    p.add_argument("thread"); p.add_argument("--projects", required=True)
    p.add_argument("--brief", default=""); p.add_argument("--engine", choices=("claude", "codex"), default="claude")
    p.add_argument("--model"); p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("post"); p.add_argument("thread"); p.add_argument("--as", dest="role", required=True, choices=roles())
    p.add_argument("--to"); p.add_argument("--kind", default="reply"); p.add_argument("--body", required=True)
    p.add_argument("--subject"); p.add_argument("--typed", help=typed_help)
    p.add_argument("--attach", nargs="+", default=[], help="files, folders or images for the agents to look at")
    p.add_argument("--model", choices=MODELS, help="model for the agent this goes to, from now on in this thread")
    p.add_argument("--no-helpers", action="store_true", help="the agents work alone, without smaller helper agents")
    for p in (p, sub.add_parser("chat", help="the owner's message in the app's chat dock (one conversation per project)")):
        p.add_argument("--page-url", help="the app page this message was sent from"); p.add_argument("--page-file")
        p.add_argument("--page-title")
    p.add_argument("scope"); p.add_argument("--body", required=True); p.add_argument("--json", action="store_true")
    p.add_argument("--model", choices=MODELS, help="the CEO's model in this chat, from now on")
    p.add_argument("--coo-model", choices=MODELS, help="the model the project's COO is consulted on in this chat")
    p.add_argument("--typed", help=typed_help)
    p.add_argument("--attach", nargs="+", default=[], help="files, folders or images for the agent to look at")
    p = sub.add_parser("spawn", help="the chat agent starts a thread (first message is the CEO's)")
    p.add_argument("chat"); p.add_argument("title"); p.add_argument("--body", required=True)
    p = sub.add_parser("board", help="the chat agent asks for a Board plan (nothing runs until the owner approves)")
    p.add_argument("chat"); p.add_argument("goal")
    p = sub.add_parser("approve"); p.add_argument("thread"); p.add_argument("--note", default="Approved.")
    p.add_argument("--typed", help="what the owner typed before the spelling fixer changed --note; kept beside it as `typed`")
    p = sub.add_parser("list"); p.add_argument("--status", choices=STATUSES)
    p = sub.add_parser("context"); p.add_argument("slug")
    p = sub.add_parser("consult", help="the CEO asks a project's COO mid-turn; prints the answer")
    p.add_argument("thread"); p.add_argument("slug"); p.add_argument("question", nargs="+")
    p.add_argument("--model", choices=MODELS)
    p = sub.add_parser("market-check", help="have a project's COO build or refresh its market file, then report")
    p.add_argument("slug"); p.add_argument("--run", action="store_true"); p.add_argument("--model", choices=MODELS)
    sub.add_parser("desk", help="what is waiting on the owner, with each decision's options")
    p = sub.add_parser("reconcile", help="after the owner decides a thread, withdraw or recompute the questions it changes")
    p.add_argument("thread"); p.add_argument("--model", choices=MODELS)
    sub.add_parser("record", help="put every approved thread's decision into its project's decisions.json")
    p = sub.add_parser("retry", help="run again what hit the usage limit (holding/retries.json) once its time has come")
    p.add_argument("thread", nargs="?", help="run this thread's queued turn now, whatever its time")
    p.add_argument("--wait", action="store_true", help="keep waiting and retrying until the queue is empty")
    a = ap.parse_args(argv)

    if a.cmd == "new":
        for path in a.attach:
            attachment(path)  # validate before creating anything
        body = body_arg(a.body, bool(a.attach))
        thread = new_thread(a.scope, a.title, body, a.sender, a.to, a.kind, attachments=a.attach,
                            talk=a.talk, projects=a.about, page=page_arg(a.page_url, a.page_file, a.page_title),
                            message_extra=typed_meta(body, a.typed) or None)
        set_models(thread, next_role(thread) or "coo", a.model, a.no_helpers)
        print(json.dumps({"scope": a.scope, "id": thread.name, "path": str(thread.relative_to(ROOT))}) if a.json
              else thread.relative_to(ROOT))
    elif a.cmd == "chat":
        for path in a.attach:
            attachment(path)  # validate before writing anything
        thread = chat(a.scope, body_arg(a.body, bool(a.attach)), page_arg(a.page_url, a.page_file, a.page_title), a.attach, a.typed)
        set_models(thread, "ceo", a.model)
        set_models(thread, "coo", a.coo_model)
        rel = str(thread.relative_to(ROOT))
        print(json.dumps({"scope": a.scope, "id": thread.name, "path": rel}) if a.json else rel)
    elif a.cmd == "spawn":
        title = a.title.strip()[:120]
        if not title:
            raise SystemExit("Give the thread a title.")
        thread = spawn(chat_thread(a.chat), title, body_arg(a.body))
        if scope_of(thread) == "holding":
            start_run(thread)  # the CEO works its own brief now; a project's spawn waits for the owner's Continue
        print(thread.relative_to(ROOT))
    elif a.cmd == "board":
        print(board(chat_thread(a.chat), a.goal.strip()[:2000] or "build").relative_to(ROOT))
    elif a.cmd == "reconcile":
        for d in reconcile_after(thread_path(a.thread), a.model):
            print(f"{d['action']:8} {d['thread']}  {d['why']}")
    elif a.cmd == "market-check":
        thread = new_thread(a.slug, f"Market check {today()}", MARKET_CHECK, "owner", "coo", "directive")
        set_models(thread, "coo", a.model)
        print(thread.relative_to(ROOT), flush=True)
        if a.run:
            run_thread(thread, rounds=8)
    elif a.cmd == "consult":
        print(consult(thread_path(a.thread), a.slug, " ".join(a.question), a.model))
    elif a.cmd == "fanout":
        result = fanout(thread_path(a.thread), a.projects.split(","), a.brief, a.engine, a.model, a.dry_run)
        if a.dry_run:
            print(json.dumps(result, indent=2))
    elif a.cmd == "turn":
        thread = thread_path(a.thread)
        out = take_turn(thread, a.role, a.engine, a.model, a.dry_run)
        print(out if isinstance(out, str) else out.relative_to(ROOT) if out else
              f"waiting: limit reached, retry at {read_thread(thread)[0]['waiting']['retry_at']}")
    elif a.cmd == "run":
        thread = thread_path(a.thread)
        run_thread(thread, a.rounds, a.engine, a.model)
        print(f"status: {read_thread(thread)[0].get('status')}")
    elif a.cmd == "retry":
        if a.wait:
            if a.thread:
                raise SystemExit("--wait drains the whole queue; leave out the thread.")
            wait_and_retry()
        else:
            for name, result in retry(a.thread):
                print(f"{result:8} {name}")
    elif a.cmd == "post":
        thread = thread_path(a.thread)
        to = a.to or (boss(thread) if a.role == "coo" else "coo")
        page = page_arg(a.page_url, a.page_file, a.page_title)
        body = body_arg(a.body, bool(a.attach))
        extra = {**({"page": page} if page else {}), **typed_meta(body, a.typed)}
        print(add_message(thread, a.role, to, a.kind, body, a.subject, extra=extra or None,
                          attachments=a.attach).relative_to(ROOT))
        set_models(thread, to, a.model, a.no_helpers)
    elif a.cmd == "approve":
        thread = thread_path(a.thread)
        last = messages(thread)[-1][1] if messages(thread) else {}
        add_message(thread, "owner", last.get("from") if last.get("from") in ("ceo", "coo") else boss(thread),
                    "approval", a.note, extra=typed_meta(a.note, a.typed) or None)
        update_thread(thread, status="decided", decision=read_thread(thread)[0].get("decision") or last.get("subject"))
        print("decided")
        if record_decision(thread, a.note):
            print(f"recorded in {decisions_file(scope_of(thread)).relative_to(ROOT)}")
        if read_thread(thread)[0].get("checkin"):
            import portfolio as pf
            card = pf.apply(thread)
            print(f"release card: {card['verdict']}, next check {card['next_check']}" if card
                  else "no release card in this check-in; nothing applied")
    elif a.cmd == "list":
        for t in sorted(ROOT.glob("companies/*/threads/*/thread.md")) + sorted(ROOT.glob("holding/threads/*/thread.md")):
            meta, _ = split_frontmatter(t.read_text())
            if not a.status or meta.get("status") == a.status:
                print(f"{meta.get('status', '?'):14} {t.parent.relative_to(ROOT)}  {meta.get('title')}")
    elif a.cmd == "context":
        print(project_brief(a.slug))
    elif a.cmd == "record":
        for t in sorted(ROOT.glob("companies/*/threads/*/thread.md")) + sorted(ROOT.glob("holding/threads/*/thread.md")):
            entry = record_decision(t.parent)
            if entry:
                print(f"{entry['id']:14} {t.parent.relative_to(ROOT)}  {entry['decision']}")
    elif a.cmd == "desk":
        items = desk()
        if not items:
            print("Nothing waiting on you.")
        for d in items:
            print(f"\n{d['scope']} · {d['from']} {d['kind']} · since {d['since']}\n  {d['thread']}")
            card = d["card"]
            print(f"  {card['ask'] if card and card['ask'] else d['title']}")
            for o in card["options"] if card else []:
                print(f"   {o['key']}{'*' if o['recommended'] else ' '} {o['label']}  · time {o['time'] or '?'}"
                      f" · complexity {o['complexity'] or '?'} · growth {o['growth'] or '?'}"
                      + (f" · costs {o['costs']}" if o["costs"] else ""))
            if card and card["revisit"]:
                print(f"   revisit if: {card['revisit']}")
            if not card:
                print("   (no options card; ask for one on the decisions page)")


if __name__ == "__main__":
    main()
