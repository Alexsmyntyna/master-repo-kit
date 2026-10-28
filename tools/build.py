#!/usr/bin/env python3
"""Builds: the owner sends coding agents into a project's codebase, from the app, and watches them work.

A build is an epic on the project's board; its briefs (NN-<name>.md) are the epic's subtasks.

    build.py plan <slug> -- "<what to build>" [--thread <path>] [--model sonnet|opus] [--run]
        the COO reads the project and proposes subtasks: companies/<slug>/builds/<id>/NN-<name>.md
    build.py replan <slug> <id> -- "<direction>"     the COO rewrites the subtasks that haven't started
    build.py approve <slug> <id>                      the owner approves the subtasks; nothing runs before this
    build.py task <slug> -- "<what to do>" [--run]   a one-off: one subtask, straight from the owner's words, approved
    build.py run <slug> <id> [--brief NN] [--mode parallel|sequence] [--model sonnet|opus]
        each subtask gets its own git worktree and branch (mr/<id>-NN) and a Claude Code agent in it. Parallel:
        all at once, each off main. Sequence: one after another, each off the branch before it, so the epic
        stacks up and merging the last merges them all. Then the COO reviews the branches (review.md)
    build.py say <slug> <id> <NN> "<direction>"       resume that agent's session with the owner's direction
    build.py stop <slug> <id> [NN]                     stop running agents
    build.py merge <slug> <id> <NN>                    the owner only: merge the branch into the repo's main
    build.py discard <slug> <id> <NN>                  remove the worktree and branch
    build.py open <slug> [--build <id> --brief <NN>] (--zed | --terminal [--prompt-file f] [--resume])
        open the repo (or a build's worktree) in Zed, or Ghostty running claude with a prompt
    build.py status <slug>

Coding agents never touch the checked-out repo or main: they work in ~/.master-repo/worktrees/<slug>/, commit
to their own branch, and can't push. Only the owner merges, and only into a clean main. Builds start only when the owner
asks (AGENTS.md: project repos are read-only unless the owner explicitly asks for a change).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import converse  # noqa: E402
import paths  # noqa: E402
import safe_fs  # noqa: E402

ROOT = converse.ROOT
WORKTREES = Path.home() / ".master-repo" / "worktrees"
SLUG = re.compile(r"^[a-z0-9-]+$")
# Bash is not pre-approved: every shell command runs in Claude Code's sandbox (sandbox_settings), which is the
# real boundary. The denials below are a second line, not the boundary (a shell can route around patterns).
CODER_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "TodoWrite"]
CODER_DENIED = ["Bash(git push:*)", "Bash(git remote:*)", "Bash(git merge:*)", "Bash(git rebase:*)",
                "Bash(git reset --hard:*)", "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git worktree:*)",
                "Bash(git branch -D:*)", "Bash(git branch -d:*)", "Bash(git config:*)", "Bash(sudo:*)",
                "Bash(rm -rf /:*)", "Bash(rm -rf ~:*)"]

PLAN_RULE = """# Write briefs for coding agents
the owner wants this built in the project's codebase:

{goal}

You are the COO. Read the code first (it is in the repo directories you can read), then split the work into
1–4 briefs: the epic's subtasks on the owner's board. Each goes to a separate Claude Code agent in its own git
worktree. the owner runs them one at a time, all in sequence (each agent starts from the branch before it), or all in
parallel (each off main, so they must not edit the same files). Number them in the order they should run, and
mark a brief that builds on an earlier one with `needs:`. Each brief should be a meaningful piece of work the owner
would recognise, never a chore list; prefer fewer, complete briefs; one is fine. Agents always commit their work on their
branch (that is how the owner reviews and merges it); never tell them not to commit.

Write each brief to `{dir}/NN-<short-name>.md` (NN = 01, 02, …):

```
---
title: <what this agent builds, a few words>
files: <the files or folders it owns>
needs: <the NN of briefs it builds on, or none>
---

## Goal
<what done looks like for the owner, in plain words>

## Context
<what the agent needs to know: where things live, the conventions, the relevant history, links to notes>

## Steps
<concrete steps, in order>

## Done when
<checks it must run and pass: build, tests, a screen to look at>

## Don't
<files and areas it must not touch, and what is out of scope>
```

When the work is design (mockups, prototypes, "what could this look like"), the brief asks for mockup reviews,
not a decision hub or sets of variations: ONE mockup per design question set, the agent's best answer, built
like the real product (its own tokens, components, copy and data types, read from the code), with the
trade-offs and the alternatives it didn't draw in a short table, and two to six questions for the owner. Each review
goes in `master-repo-mockups/<YYYY-MM-DD>-<topic>/` (index.html + review.md, format in the agent's rules);
Master-Repo collects them after the run and the owner reviews them in the app. Don't ask for the context-notepad
decision hub, "Copy for the agent" widgets, or three concepts to compare. One brief is usually enough.

Then write `{dir}/plan.md`, starting with frontmatter that names the epic in a few plain words
(`---\ntitle: <e.g. "Mobile blend of TimeApp and FinanceApp">\n---`), then two or three sentences on the plan, why it is split this way, whether it is safe
to run in parallel or should run in sequence, and what the owner should look at by hand. Write nowhere else. Reply with one line saying how many briefs."""

CODER_RULE = """# Your brief
You are a coding agent working on {name}, in a git worktree of its repo on branch `{branch}`. the owner sent you from
their control center; they and the project's COO will review your branch before anything reaches main.

{brief}

# How to work
- Work only in this worktree{subdir}. Stay inside your brief; if it turns out wrong or too big, do the part that
  makes sense and say so.
- Follow the repo's own CLAUDE.md / AGENTS.md if it has one.
- Commit as you go, on this branch, with clear messages, and commit everything before your report, even if the
  brief seems to say otherwise: uncommitted work can't be reviewed or merged. Never push, merge, rebase or
  switch branches.
- Run the checks in "Done when". If something can't be checked here (a device, an account), say so.
- Your shell is sandboxed: it can write only in this worktree and has no network, so you can't install
  packages or fetch anything. Installed dependencies (node_modules) are linked in read-only. If a check needs
  something that isn't there, say so in your report instead of working around it.
- End with a short report: what you changed (files), how you verified it, what is left or risky.

# Mockups
If your brief asks for mockups or prototypes, make ONE mockup per set of design questions, your best answer, not
variations, and no decision hub (even if the repo has a context-notepad hub template). Write each as a review
folder `{mockups}/<YYYY-MM-DD>-<topic>/` (that folder is ignored by git; Master-Repo copies it after your run and
the owner reviews it in their app, pinning notes on it):
- `index.html`, self-contained: inline CSS and JS, no external fonts, images or requests (they are blocked; use
  data: URIs). It fills its viewport; the app draws a phone (402x874) or desktop (1280x800) frame around it. Several
  screens in one file route on `location.hash` and, on every change, call
  `parent.postMessage({ mockupScreen: "<hash without #>" }, "*")`.
- It looks like the real product: copy its tokens, components and copy from the code, and use its real data types
  and field names with believable sample data. Say what you invented.
- `review.md`: frontmatter `title`, `date`, `status: open`, `frame: phone|desktop`, `screens` (list of
  `{ file: "index.html#home", label: Home }`), `questions` (2–6 of `{ ask, shown, screen }`: the question, how the
  mockup answers it, which screen shows it); body: a table `| Choice in the mockup | Gains | Costs |`, with the
  alternatives you didn't draw named under Costs, then one line on what it leaves out."""

REVIEW_RULE = """# Review the build
Coding agents worked on these briefs, each on its own branch off `{base}`. Below: each brief, the agent's final
report, its commits and its diff (possibly cut short; say so if you couldn't see enough to judge).

{runs}

Write `{dir}/review.md` for the owner, short, in this shape:
- The opening sentence: is this ready to merge, and in what order?
- `**Per branch:**` one line each: merge, fix first (what), or discard, and why.
- `**Look at by hand:**` the screens or behaviours the owner should try before merging.
- `**Risks:**` anything the diffs break or leave half-done.
Write nowhere else. Reply with the opening sentence."""

REPLAN_RULE = """# Re-plan the epic
the owner read the subtasks you proposed and is changing direction:

{direction}

{started}The subtasks that hadn't started were set aside; here they are for reference:

{old}

Rewrite the plan to follow the owner's direction. Same format and rules as before. Number new briefs from {next}
(`{dir}/{next}-<short-name>.md` …), never reusing a number, and rewrite `{dir}/plan.md`. Write nowhere else.
Reply with one line saying what changed."""


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def git(cwd: Path | str, *args: str, check: bool = False) -> str:
    p = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    if check and p.returncode:
        raise SystemExit(f"git {' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout.strip()


def project(slug: str) -> tuple[dict, Path, str | None]:
    if not SLUG.match(slug) or not (ROOT / "companies" / slug / "company.json").is_file():
        raise SystemExit(f"No project {slug!r}.")
    company = json.loads((ROOT / "companies" / slug / "company.json").read_text())
    repos = [r for r in company.get("repos") or [] if r.get("path") and Path(r["path"]).is_dir()]
    if not repos:
        raise SystemExit(f"{slug} has no codebase on this Mac.")
    repo = next((r for r in repos if r.get("role") == "primary"), repos[0])
    return company, Path(repo["path"]), repo.get("subdir")


def build_dir(slug: str, bid: str) -> Path:
    if not SLUG.match(bid):
        raise SystemExit("Bad build id.")
    d = ROOT / "companies" / slug / "builds" / bid
    if not (d / "build.md").is_file():
        raise SystemExit(f"No build {bid} in {slug}.")
    return d


def read_meta(path: Path) -> dict:
    return converse.split_frontmatter(path.read_text())[0] if path.exists() else {}


def update_build(d: Path, **changes) -> None:
    meta, body = converse.split_frontmatter((d / "build.md").read_text())
    meta.update(changes, updated=now())
    converse.write_doc(d / "build.md", meta, body)


def briefs(d: Path) -> list[tuple[str, Path]]:
    return [(p.name[:2], p) for p in sorted(d.glob("[0-9][0-9]-*.md"))]


def run_file(d: Path, n: str) -> Path:
    if not re.fullmatch(r"\d\d", n or ""):
        raise SystemExit("Bad brief number.")
    return d / "runs" / f"{n}.json"


def read_run(d: Path, n: str) -> dict:
    f = run_file(d, n)
    return json.loads(f.read_text()) if f.exists() else {}


def write_run(d: Path, n: str, **changes) -> dict:
    (d / "runs").mkdir(exist_ok=True)
    state = {**read_run(d, n), **changes}
    run_file(d, n).write_text(json.dumps(state, indent=2) + "\n")
    return state


def default_branch(repo: Path) -> str:
    for name in ("main", "master"):
        if git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{name}"):
            return name
    return git(repo, "symbolic-ref", "--short", "HEAD") or "HEAD"


def alive(pid) -> bool:
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


# --- plan --------------------------------------------------------------------------------------------

def typed_field(goal: str, typed: str | None) -> dict:
    """What the owner typed when the app's spelling fixer changed the goal (app/DESIGN.md, Spelling), for build.md's
    front matter: `typed`, only when it differs from the goal, which is the fixed text."""
    return {"typed": typed.strip()} if typed and typed.strip() and typed.strip() != goal.strip() else {}


def plan(slug: str, goal: str, thread: str | None = None, model: str | None = None, typed: str | None = None) -> Path:
    company, repo, subdir = project(slug)
    bid = f"{converse.today()}-{converse.slugify(goal)[:40].strip('-') or 'build'}"
    d = ROOT / "companies" / slug / "builds" / bid
    n = 2
    while d.exists():
        d, n = d.with_name(f"{bid}-{n}"), n + 1
    d.mkdir(parents=True)
    converse.write_doc(d / "build.md", {
        "title": goal.splitlines()[0][:120], "status": "planning", "kind": "epic", "repo": str(repo), "subdir": subdir,
        "base": default_branch(repo), "thread": thread or "", "created": now(), "updated": now(),
        **typed_field(goal, typed),
    }, goal)
    rel = str(d.relative_to(ROOT))
    _, role_text = converse.split_frontmatter((paths.agents_dir(ROOT) / "coo.md").read_text())
    sections = [role_text, f"Repo root (Master-Repo): {ROOT}. Today is {converse.today()}.",
                "# The project\n" + converse.project_brief(slug, 6000)]
    if thread:
        sections.append(converse.thread_text(converse.thread_path(thread)))
    sections.append(PLAN_RULE.replace("{goal}", goal).replace("{dir}", rel))
    write_plan(d, slug, sections, model)
    return d


def started(d: Path, n: str) -> bool:
    return bool(read_run(d, n).get("worktree"))


def write_plan(d: Path, slug: str, sections: list[str], model: str | None) -> None:
    rel = str(d.relative_to(ROOT))
    update_build(d, status="planning", planning_pid=os.getpid(), error="", approved="")  # a new plan needs a new yes
    try:
        text, usage = converse.run_claude("\n\n".join(sections), "coo", slug, model or "sonnet", writable=(rel,),
                                          helpers=True)
    except BaseException as error:
        update_build(d, status="failed", error=str(error)[:500])
        raise
    update_build(d, status="proposed" if briefs(d) else "failed", plan_note=text.strip()[:500],
                 plan_usage=usage, **({} if briefs(d) else {"error": "The COO wrote no briefs."}))
    converse.log_run({"thread": rel, "scope": slug, "role": "coo", "task": "build-plan",
                      "seconds": usage.get("seconds"), "ok": bool(briefs(d)), "list_price_usd": usage.get("list_price_usd")})


def replan(slug: str, bid: str, direction: str, model: str | None = None) -> None:
    """the owner changes the epic's direction: the subtasks that haven't started are set aside, the COO writes new ones."""
    d = build_dir(slug, bid)
    if any(read_run(d, n).get("status") == "running" and alive(read_run(d, n).get("pid")) for n, _ in briefs(d)):
        raise SystemExit("Agents are working on this epic; stop them first.")
    aside = d / "set-aside" / dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    old, kept = [], []
    for n, brief in briefs(d):
        if started(d, n):
            kept.append(f"- {brief.name} ({read_run(d, n).get('status')}): {read_meta(brief).get('title') or brief.stem}")
        else:
            aside.mkdir(parents=True, exist_ok=True)
            old.append(f"## {brief.name}\n\n{converse.clip(brief.read_text(), 2500)}")
            brief.rename(aside / brief.name)
    nums = [int(p.name[:2]) for p in [*d.glob("[0-9][0-9]-*.md"), *d.glob("set-aside/*/[0-9][0-9]-*.md")]]
    nxt = f"{max(nums, default=0) + 1:02d}"
    meta, goal = converse.split_frontmatter((d / "build.md").read_text())
    rel = str(d.relative_to(ROOT))
    _, role_text = converse.split_frontmatter((paths.agents_dir(ROOT) / "coo.md").read_text())
    sections = [role_text, f"Repo root (Master-Repo): {ROOT}. Today is {converse.today()}.",
                "# The project\n" + converse.project_brief(slug, 6000), f"# The epic the owner asked for\n{goal}",
                f"# Your plan so far\n{(d / 'plan.md').read_text() if (d / 'plan.md').exists() else '(none)'}",
                PLAN_RULE.replace("{goal}", goal).replace("{dir}", rel),
                REPLAN_RULE.replace("{direction}", direction).replace("{dir}", rel).replace("{next}", nxt)
                .replace("{old}", "\n\n".join(old) or "(none)")
                .replace("{started}", "These already ran and stay as they are:\n" + "\n".join(kept) + "\n\n" if kept else "")]
    update_build(d, directions=[*(meta.get("directions") or []), {"at": now(), "text": direction[:2000]}])
    write_plan(d, slug, sections, model or meta.get("model"))


def approve(slug: str, bid: str) -> None:
    d = build_dir(slug, bid)
    meta = read_meta(d / "build.md")
    if meta.get("status") == "planning" or not briefs(d):
        raise SystemExit("There are no subtasks to approve yet.")
    update_build(d, status="approved", approved=now())


def task(slug: str, text: str, typed: str | None = None) -> Path:
    """A one-off: the owner's words become the only subtask, approved, with no COO plan."""
    _, repo, subdir = project(slug)
    title = text.strip().splitlines()[0][:120]
    bid = f"{converse.today()}-{converse.slugify(title)[:40].strip('-') or 'task'}"
    d = ROOT / "companies" / slug / "builds" / bid
    n = 2
    while d.exists():
        d, n = d.with_name(f"{bid}-{n}"), n + 1
    d.mkdir(parents=True)
    converse.write_doc(d / "build.md", {"title": title, "status": "approved", "kind": "task", "repo": str(repo),
                                        "subdir": subdir, "base": default_branch(repo), "created": now(),
                                        "approved": now(), **typed_field(text, typed)}, text)
    converse.write_doc(d / "01-task.md", {"title": title}, f"## Goal\n{text}\n\n## Done when\n"
                       "It works, the project's own checks pass, and your report says how you checked it.")
    return d


# --- run ---------------------------------------------------------------------------------------------

SECRETS = ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config", "~/.docker", "~/.kube", "~/.netrc", "~/.npmrc",
           "~/.pypirc", "~/.git-credentials", "~/Library/Keychains"]


def rule(tool: str, path: str) -> str:
    """A Read/Edit permission rule for a path. Claude Code reads `/x` as relative to the settings file and `//x` as
    absolute, so an absolute path needs the extra slash (without it the rule silently matched nothing, and agents
    could not commit: 2026-10-21 asset-tool build, index.lock "Operation not permitted")."""
    return f"{tool}(/{path})" if path.startswith("/") else f"{tool}({path})"


def sandbox_settings(state: dict | None) -> dict:
    """The agent's shell may write only inside its worktree, plus the exact git files a commit on its own branch
    touches: shared objects, its own branch ref and reflog, and the HEAD/index/logs in its worktree's admin dir.
    Never hooks, config, or the admin dir's `commondir`/`gitdir` (repointing those would make git run the agent's
    config the next time git runs there outside the sandbox). Secrets folders and .env files can't be read, and
    there is no network, so nothing can be pushed or sent out."""
    git_paths: list[str] = []
    if state and state.get("admin"):
        common, admin, ref = Path(state["common"]), Path(state["admin"]), state["branch"]
        git_paths = [f"{common}/objects/**",
                     *(f"{common}/{p}" for p in (f"refs/heads/{ref}", f"refs/heads/{ref}.lock", f"logs/refs/heads/{ref}")),
                     *(f"{admin}/{f}" for f in ("HEAD", "HEAD.lock", "index", "index.lock", "ORIG_HEAD", "ORIG_HEAD.lock",
                                                "COMMIT_EDITMSG", "AUTO_MERGE", "AUTO_MERGE.lock", "logs/**"))]
    allow = [rule("Edit", p) for p in git_paths]
    deny = [f"Read({p}/**)" if not p.endswith(("rc", "credentials")) else f"Read({p})" for p in SECRETS]
    deny += ["Read(**/.env)", "Read(**/.env.*)"]
    deny_write, deny_read = [], [p.replace("~", str(Path.home()), 1) for p in SECRETS]
    for root in {state.get("repo"), state.get("worktree")} - {None, ""} if state else ():
        # The rules above stop the Read tool; only the sandbox stops `cat .env` (also via the checkout's own path).
        deny_read += [f"{root}/{p}" for p in (".env", ".env.*", "**/.env", "**/.env.*")]
    if state and state.get("worktree"):
        # Files that tools load as configuration later, outside the sandbox (Claude Code project settings and
        # hooks, editor settings that name binaries to run, direnv), and the worktree's own git link. Permission
        # rules stop the file tools; the sandbox's own denyWrite stops the shell (permission rules alone don't).
        wt = state["worktree"]
        deny += [rule("Edit", f"{wt}/{p}") for p in WORKTREE_CONFIG]
        deny_write = [f"{wt}/{p.removesuffix('/**')}" for p in WORKTREE_CONFIG]
    return {"disableAllHooks": True, "permissions": {"allow": allow, "deny": deny},
            "sandbox": {"enabled": True, "autoAllowBashIfSandboxed": True, "allowUnsandboxedCommands": False,
                        "filesystem": {"denyWrite": deny_write,
                                       "denyRead": deny_read}}}


WORKTREE_CONFIG = [".git", ".claude/**", "**/.claude/**", ".zed/**", "**/.zed/**", ".vscode/**", "**/.vscode/**",
                   ".idea/**", ".envrc", "**/.envrc", ".mcp.json", "**/.mcp.json"]
# The same config can still arrive by commit (git plumbing writes a tree without the file ever existing on disk),
# plus git's own: a branch that touches any of these is never merged from the app; the owner looks at it in Zed.
CONFIG_NAMES = {".claude", ".zed", ".vscode", ".idea", ".envrc", ".mcp.json", ".gitmodules", ".gitattributes",
                "CLAUDE.md", "CLAUDE.local.md", ".husky", ".githooks", ".lefthook.yml", "lefthook.yml",
                ".pre-commit-config.yaml"}


CONFIG_KEYS = {unicodedata.normalize("NFC", n).casefold() for n in CONFIG_NAMES}


def config_touched(repo: Path, base: str, branch: str, three_dot: bool = False) -> list[str]:
    """Paths the branch adds or changes that tools load as config. Names are read NUL-separated (never quoted)
    and compared as macOS's filesystem does, ignoring case and Unicode form: `.CLAUDE/` loads as `.claude/`."""
    p = subprocess.run(["git", "-C", str(repo), *SAFE_GIT, "-c", "core.quotePath=false", "diff", "--name-only", "-z",
                        "--no-renames", f"{base}{'...' if three_dot else '..'}{branch}", "--"], capture_output=True)
    if p.returncode:  # fail closed: an unreadable diff is never an empty one
        raise SystemExit(f"Can't list what this branch changes: {p.stderr.decode(errors='replace').strip()[-300:]}")
    names = [n for n in p.stdout.decode("utf-8", "surrogateescape").split("\0") if n]
    # Symlinks too: one committed into the checkout can point editors and tools anywhere.
    q = subprocess.run(["git", "-C", str(repo), *SAFE_GIT, "diff", "--raw", "-z", "--no-renames",
                        f"{base}{'...' if three_dot else '..'}{branch}", "--"], capture_output=True)
    if q.returncode:
        raise SystemExit(f"Can't list what this branch changes: {q.stderr.decode(errors='replace').strip()[-300:]}")
    raw = q.stdout.decode("utf-8", "surrogateescape").split("\0")
    links = [raw[i + 1] for i in range(0, len(raw) - 1, 2) if raw[i].split(" ")[1:2] == ["120000"]]
    return [n for n in names if CONFIG_KEYS & {unicodedata.normalize("NFC", part).casefold() for part in n.split("/")}] + \
        [f"{n} (symlink)" for n in links]


# Git outside the sandbox never trusts the worktree's own pointers: it is told the admin and common dirs that were
# recorded when the worktree was made, and won't run hooks or an fsmonitor command.
SAFE_GIT = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]


def worktree_paths(repo: Path, wt: Path) -> dict:
    common = Path(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    admin = Path((wt / ".git").read_text().split("gitdir:", 1)[1].strip())
    return {"common": str(common.resolve()), "admin": str(admin.resolve())}


def verify(state: dict) -> None:
    """Refuse a worktree whose git pointers the agent changed."""
    wt, admin = Path(state["worktree"]), Path(state.get("admin") or "")
    link = (wt / ".git").read_text().split("gitdir:", 1)[-1].strip() if (wt / ".git").is_file() else ""
    common = (admin / "commondir").read_text().strip() if (admin / "commondir").is_file() else ""
    if not state.get("admin") or Path(link).resolve() != admin or (admin / common).resolve() != Path(state["common"]):
        raise SystemExit("This worktree's git link was changed; it can't be trusted. Discard it.")


def wgit(state: dict, *args: str) -> str:
    verify(state)
    env = {**os.environ, "GIT_DIR": state["admin"], "GIT_COMMON_DIR": state["common"], "GIT_WORK_TREE": state["worktree"]}
    p = subprocess.run(["git", *SAFE_GIT, *args], capture_output=True, text=True, cwd=state["worktree"], env=env)
    return p.stdout.strip()


def link_dependencies(repo: Path, worktree: Path) -> None:
    """A fresh worktree has no installed dependencies and the agent has no network: link the checkout's
    node_modules folders in (the sandbox lets the agent read them, not change them)."""
    linked = False
    for nm in repo.glob("**/node_modules"):
        rel = nm.relative_to(repo)
        if len(rel.parts) > 4 or "node_modules" in rel.parts[:-1]:
            continue
        dest = worktree / rel
        if dest.parent.is_dir() and not dest.exists():
            dest.symlink_to(nm, target_is_directory=True)
            linked = True
    # `node_modules/` in a .gitignore matches folders, not links: keep `git add -A` from committing the link.
    if linked:
        git_exclude(repo, "node_modules")


def git_exclude(repo: Path, name: str) -> None:
    exclude = Path(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")) / "info" / "exclude"
    exclude.parent.mkdir(exist_ok=True)
    lines = exclude.read_text().splitlines() if exclude.exists() else []
    if name not in lines:
        exclude.write_text("\n".join([*lines, name]) + "\n")


# Coding agents can't write to Master-Repo, so they put mockup reviews (CODER_RULE "Mockups") in this folder at the
# root of their worktree, kept out of git; after the run they are copied to companies/<slug>/mockups/<id>/.
MOCKUPS = "master-repo-mockups"
REVIEW_ID = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$")
REVIEW_FILE = re.compile(r"^([a-z0-9-]+\.html|review\.md)$")


def collect_mockups(slug: str, worktree: str | Path) -> list[str]:
    """Copy the agent's review folders into Master-Repo: only review.md and plain .html files, never links, never
    over a review the owner has already answered, and never their notes.md. Returns the review ids copied."""
    # The agent's side is read through directory fds too (from the worktree root, which build.py made), so a
    # folder swapped for a link mid-copy can't point the read anywhere else.
    try:
        top = safe_fs.open_dirs(Path(worktree), [MOCKUPS])
    except OSError:
        return []
    copied = []
    try:
        names = sorted(os.listdir(top))
    finally:
        os.close(top)
    for rid in names:
        if not REVIEW_ID.match(rid):
            continue
        try:
            sfd = safe_fs.open_dirs(Path(worktree), [MOCKUPS, rid])
        except OSError:
            continue
        try:
            data = {}
            for name in os.listdir(sfd):
                if REVIEW_FILE.match(name):
                    try:
                        data[name] = safe_fs.read_single(name, dir_fd=sfd, limit=5_000_000)
                    except OSError:
                        continue
        finally:
            os.close(sfd)
        if "review.md" not in data:
            continue
        # Both ends are agent-writable, so every read and write goes through safe_fs: directory fds opened with
        # O_NOFOLLOW from the top, single-link regular files only (a hard link to a private file is refused, not
        # copied in), and fresh files renamed into place.
        try:
            dfd = safe_fs.open_dirs(ROOT, ["companies", slug, "mockups", rid], create=True)
        except OSError:
            continue
        try:
            try:
                if re.search(r"^status:\s*['\"]?answered", safe_fs.read_single("review.md", dir_fd=dfd).decode(errors="replace"), re.M):
                    continue
            except FileNotFoundError:
                pass
            for name, body in data.items():
                safe_fs.write_at(dfd, name, body)
        except OSError:
            continue
        finally:
            os.close(dfd)
        copied.append(rid)
    return copied


def dirty(state: dict) -> bool:
    """Uncommitted work in a worktree, not counting the linked node_modules."""
    lines = wgit(state, "status", "--porcelain").splitlines()
    return any(not (l.startswith("?? ") and l[3:].rstrip("/").split("/")[-1] == "node_modules") for l in lines)


def coder_cmd(model: str, resume: str | None = None, state: dict | None = None) -> list[str]:
    cmd = ["claude", "-p", "--model", model, "--output-format", "stream-json", "--verbose",
           "--permission-mode", "acceptEdits", "--max-turns", "200",
           "--settings", json.dumps(sandbox_settings(state)), "--strict-mcp-config",
           # Only the owner's user settings: never project or local settings an agent could have written in its worktree.
           "--setting-sources", "user",
           "--allowedTools", *CODER_TOOLS, "--disallowedTools", *CODER_DENIED]
    if resume:
        cmd += ["--resume", resume]
    return cmd


def start_agent(d: Path, n: str, prompt: str, model: str, resume: str | None = None) -> subprocess.Popen:
    state = read_run(d, n)
    verify(state)
    cwd = Path(state["worktree"]) / (state.get("subdir") or "")
    with open(d / "runs" / f"{n}.log", "a") as log:  # the agent keeps its own handle
        log.write(json.dumps({"type": "mr_prompt", "text": prompt[-4000:], "at": now()}) + "\n")
        log.flush()
        proc = subprocess.Popen(coder_cmd(model, resume, state), stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT,
                                cwd=cwd, env=converse.subscription_env(), text=True)
    proc.stdin.write(prompt)
    proc.stdin.close()
    write_run(d, n, status="running", pid=proc.pid, model=model, started=now(), waiting=None)
    return proc


def finish_agent(d: Path, n: str, proc: subprocess.Popen) -> dict:
    code = proc.wait()
    result: dict = {}
    session = read_run(d, n).get("session")
    for line in (d / "runs" / f"{n}.log").read_text(errors="ignore").splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        session = ev.get("session_id") or session
        if ev.get("type") == "result":
            result = ev
    state = read_run(d, n)
    repo = Path(read_meta(d / "build.md").get("repo") or state["repo"])
    try:
        left = dirty(state)
    except SystemExit:
        left = True
    mockups = collect_mockups(d.parent.parent.name, state["worktree"]) if state.get("worktree") else []
    stopping = state.get("status") == "stopping"
    text = str(result.get("result") or "")
    # The usage limit: the subtask waits (its session resumes after the reset) instead of failing.
    limited = (not stopping and bool(result.get("is_error")) and result.get("subtype") != "error_max_turns"
               and converse.is_limit(text))
    waiting = None
    if limited:
        waiting = {"reason": "limit", "retry_at": converse.retry_time(text).isoformat(timespec="seconds"),
                   "message": text[:300]}
    out = write_run(d, n, status="stopped" if stopping else "waiting" if limited else
                    "done" if code == 0 and not result.get("is_error") else "failed",
                    pid=None, ended=now(), session=session, report=(result.get("result") or "")[-6000:],
                    cost_usd=round((state.get("cost_usd") or 0) + (result.get("total_cost_usd") or 0), 4),
                    commits=int(git(repo, "rev-list", "--count", f"{state['base_sha']}..{state['branch']}") or 0),
                    dirty=left, mockups=mockups, waiting=waiting)
    if waiting:
        rel = str(d.relative_to(ROOT))
        converse.log_run({"thread": rel, "scope": d.parent.parent.name, "role": "coo", "engine": "claude",
                          "model": state.get("model") or "", "task": f"build-{n}",
                          "started": state.get("started") or now(), "ok": False, "limit": True,
                          "retry_at": waiting["retry_at"], "error": text[:500]})
        converse.queue_retry({"thread": rel, "brief": n, "role": "coder", "model": state.get("model"),
                              "engine": "claude", "retry_at": waiting["retry_at"]})
        converse.start_waiter()
    return out


RESUME_AFTER_LIMIT = ("The usage limit that stopped you has reset. Continue the brief where you left off on this "
                      "branch, commit, and end with the short report again.")


def launch(d: Path, slug: str, bid: str, n: str, brief: Path, start_from: str, model: str) -> subprocess.Popen:
    """Start a subtask's agent: a fresh run from its brief, or, for one that hit the usage limit, its own session
    resumed, so it picks up where it stopped."""
    s = read_run(d, n)
    if s.get("status") == "waiting" and s.get("session") and s.get("worktree"):
        return start_agent(d, n, RESUME_AFTER_LIMIT, s.get("model") or model, resume=s["session"])
    return start_agent(d, n, prepare(d, slug, bid, n, brief, start_from), model)


FINISHED = ("done", "merged", "discarded")


def prepare(d: Path, slug: str, bid: str, n: str, brief: Path, start_from: str) -> str:
    """The subtask's worktree and branch (made once, off `start_from`), and the agent's prompt."""
    company, repo, subdir = project(slug)
    meta = read_meta(d / "build.md")
    branch = f"mr/{bid}-{n}"[:100]
    wt = WORKTREES / slug / f"{bid}-{n}"
    if not wt.exists():
        wt.parent.mkdir(parents=True, exist_ok=True)
        git(repo, "worktree", "add", "-b", branch, str(wt), start_from, check=True)
        write_run(d, n, **worktree_paths(repo, wt))  # recorded before the agent can touch anything
        link_dependencies(repo, wt)
    git_exclude(repo, MOCKUPS)
    bmeta, body = converse.split_frontmatter(brief.read_text())
    write_run(d, n, brief=brief.name, title=bmeta.get("title") or brief.stem, branch=branch, worktree=str(wt),
              subdir=subdir, base=meta.get("base") or default_branch(repo), repo=str(repo),
              stacked_on=start_from if start_from.startswith("mr/") else "",
              base_sha=read_run(d, n).get("base_sha") or git(repo, "rev-parse", f"refs/heads/{branch}"))
    return (CODER_RULE.replace("{name}", company.get("name") or slug).replace("{branch}", branch)
            .replace("{brief}", f"# {bmeta.get('title') or brief.stem}\n\n{body}")
            .replace("{subdir}", f" (the project lives in `{subdir}/`)" if subdir else "")
            .replace("{mockups}", str(wt / MOCKUPS)))


def run(slug: str, bid: str, only: str | None = None, model: str | None = None, mode: str = "parallel") -> None:
    d = build_dir(slug, bid)
    meta = read_meta(d / "build.md")
    if not meta.get("approved") or meta.get("status") in ("planning", "proposed"):
        raise SystemExit("Approve the subtasks first.")
    _, repo, _ = project(slug)
    base = meta.get("base") or default_branch(repo)
    model = model or meta.get("model") or "sonnet"
    todo = [(n, b) for n, b in briefs(d) if (not only or n == only)
            and not (read_run(d, n).get("status") == "running" and alive(read_run(d, n).get("pid")))
            and (only or read_run(d, n).get("status") not in FINISHED)]
    if not todo:
        print("Nothing to start.")
        return
    update_build(d, status="running", runner_pid=os.getpid(), mode=mode if not only else meta.get("mode") or "")
    if mode == "sequence" and not only:
        # Each subtask starts from the branch before it (when that one left work behind), so the epic stacks up.
        prev = None
        for n, brief in briefs(d):
            s = read_run(d, n)
            if (n, brief) in todo:
                start_from = prev if prev else base
                state = finish_agent(d, n, launch(d, slug, bid, n, brief, start_from, model))
                if state.get("status") != "done":
                    break  # a failed or stopped step ends the sequence; the owner decides what next
                s = state
            if s.get("status") == "done" and s.get("branch"):
                prev = s["branch"]
    else:
        procs = [(n, launch(d, slug, bid, n, brief, base, model)) for n, brief in todo]
        for n, proc in procs:
            finish_agent(d, n, proc)
    after_runs(slug, bid)


def after_runs(slug: str, bid: str) -> None:
    d = build_dir(slug, bid)
    states = [read_run(d, n) for n, _ in briefs(d)]
    if any(s.get("status") == "running" and alive(s.get("pid")) for s in states):
        return
    if any(s.get("status") == "waiting" for s in states):  # the review waits until the limit lets them finish
        update_build(d, status="waiting", runner_pid=None)
        return
    update_build(d, status="reviewing", runner_pid=None)
    try:
        review(slug, bid)
    finally:
        update_build(d, status="review")


def retry_after_limit(entry: dict) -> str:
    """`converse.py retry` for a Board subtask that hit the usage limit: run it again (its session resumes), and in
    a sequence the steps after it too. Same results as converse.retry_entry: done, queued, dropped, busy."""
    rel, n = entry["thread"], entry.get("brief") or ""
    parts = Path(rel).parts
    try:
        if len(parts) != 4 or parts[0] != "companies" or parts[2] != "builds":
            raise SystemExit("Not a build.")
        d = build_dir(parts[1], parts[3])
        s = read_run(d, n)
    except SystemExit:
        converse.drop_retry(rel, n)
        return "dropped"
    if s.get("status") == "running" and alive(s.get("pid")):
        return "busy"
    if s.get("status") != "waiting":  # stopped, discarded or run by hand since
        converse.drop_retry(rel, n)
        return "dropped"
    mode = read_meta(d / "build.md").get("mode") or "parallel"
    try:
        run(parts[1], parts[3], only=None if mode == "sequence" else n, model=s.get("model"), mode=mode)
    except BaseException as error:
        if isinstance(error, KeyboardInterrupt):
            raise
        print(f"retry failed for {rel} #{n}: {error}", file=sys.stderr, flush=True)
        converse.drop_retry(rel, n)
        return "dropped"
    if read_run(d, n).get("status") == "waiting":
        return "queued"
    converse.drop_retry(rel, n)
    return "done"


def config_note(repo: Path, base: str, branch: str) -> str:
    try:
        t = config_touched(repo, base, branch)
    except SystemExit as e:
        return f"CONFIG CHECK FAILED ({e}); the app will not merge this."
    return f"CONFIG CHANGED (the app will not merge this; say why each is needed): {', '.join(t)}" if t else ""


def review(slug: str, bid: str, model: str | None = None) -> None:
    d = build_dir(slug, bid)
    meta = read_meta(d / "build.md")
    parts = []
    for n, brief in briefs(d):
        s = read_run(d, n)
        if not s.get("worktree"):
            continue
        wt, base, repo = s["worktree"], s.get("base_sha") or meta.get("base"), Path(s.get("repo") or meta.get("repo"))
        diff = git(repo, "diff", f"{base}..{s['branch']}")
        parts.append(f"## Brief {n}: {s.get('title')} (branch {s.get('branch')}, worktree {wt}, {s.get('status')})\n\n"
                     f"{converse.clip(brief.read_text(), 2500)}\n\n### Agent's report\n{s.get('report') or '(none)'}\n\n"
                     f"### Commits\n{git(repo, 'log', '--oneline', base + '..' + s['branch']) or '(none)'}\n"
                     f"{'Uncommitted changes left in the worktree.' if s.get('dirty') else ''}\n"
                     f"{config_note(repo, base, s['branch'])}\n\n"
                     f"### Diff\n```diff\n{converse.clip(diff, 25000)}\n```")
    if not parts:
        return
    rel = str(d.relative_to(ROOT))
    _, role_text = converse.split_frontmatter((paths.agents_dir(ROOT) / "coo.md").read_text())
    prompt = "\n\n".join([role_text, f"Repo root (Master-Repo): {ROOT}. Today is {converse.today()}.",
                          f"# What the owner asked for\n{converse.split_frontmatter((d / 'build.md').read_text())[1]}",
                          REVIEW_RULE.replace("{base}", meta.get("base") or "main").replace("{runs}", "\n\n".join(parts))
                          .replace("{dir}", rel)])
    # Never the worktrees themselves: an agent can leave a symlink there to anything the COO could read.
    _, usage = converse.run_claude(prompt, "coo", slug, model or "sonnet", writable=(rel,), helpers=False)
    converse.log_run({"thread": rel, "scope": slug, "role": "coo", "task": "build-review",
                      "seconds": usage.get("seconds"), "ok": True, "list_price_usd": usage.get("list_price_usd")})


def say(slug: str, bid: str, n: str, text: str) -> None:
    d = build_dir(slug, bid)
    s = read_run(d, n)
    if not s:
        raise SystemExit("That agent hasn't started.")
    if s.get("status") == "running" and alive(s.get("pid")):
        raise SystemExit("That agent is still working. Stop it first, or wait for it to finish.")
    prompt = f"Direction from {paths.owner(ROOT)['short']}:\n\n{text}\n\nContinue on this branch, commit, and end with the short report again."
    proc = start_agent(d, n, prompt, s.get("model") or "sonnet", resume=s.get("session"))
    update_build(d, status="running")
    finish_agent(d, n, proc)
    after_runs(slug, bid)


def stop(slug: str, bid: str, n: str | None = None) -> None:
    d = build_dir(slug, bid)
    for m, _ in briefs(d):
        s = read_run(d, m)
        if (n is None or m == n) and s.get("status") == "running" and alive(s.get("pid")):
            write_run(d, m, status="stopping")
            os.kill(int(s["pid"]), signal.SIGTERM)
            print(f"stopped {m}")


def merge(slug: str, bid: str, n: str) -> None:
    d = build_dir(slug, bid)
    s = read_run(d, n)
    _, repo, _ = project(slug)
    if not s.get("branch"):
        raise SystemExit("Nothing to merge.")
    if s.get("status") == "running" and alive(s.get("pid")):
        raise SystemExit("The agent is still working.")
    base = s.get("base") or default_branch(repo)
    if git(repo, "symbolic-ref", "--short", "HEAD") != base:
        raise SystemExit(f"The repo isn't on {base}; switch it there first (open it in Zed).")
    if git(repo, "status", "--porcelain"):
        raise SystemExit(f"The repo has uncommitted changes on {base}; commit or stash them first.")
    if dirty(s):
        raise SystemExit("The agent left uncommitted changes in its worktree; ask it to commit, or discard them.")
    touched = config_touched(repo, base, s["branch"], three_dot=True)  # with any subtasks it stacks on
    if touched:
        raise SystemExit(f"This branch changes tool or git config or adds symlinks ({', '.join(touched[:5])}); "
                         "merge it yourself after reading those files.")
    p = subprocess.run(["git", "-C", str(repo), "merge", "--no-ff", "--no-edit", s["branch"]], capture_output=True, text=True)
    if p.returncode:
        git(repo, "merge", "--abort")
        raise SystemExit(f"The merge conflicts; nothing changed. Resolve it in Zed. ({p.stdout.strip()[-300:]})")
    head = git(repo, "rev-parse", "--short", "HEAD")
    write_run(d, n, status="merged", merged=now(), merge_commit=head)
    for m, _ in briefs(d):  # subtasks this one stacked on came in with it
        o = read_run(d, m)
        if m != n and o.get("branch") and o.get("status") not in ("merged", "discarded") and \
                subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor", o["branch"], "HEAD"]).returncode == 0:
            write_run(d, m, status="merged", merged=now(), merge_commit=head, merged_with=n)
    print(f"merged {s['branch']} into {base}")


def discard(slug: str, bid: str, n: str) -> None:
    d = build_dir(slug, bid)
    s = read_run(d, n)
    _, repo, _ = project(slug)
    if s.get("status") == "running" and alive(s.get("pid")):
        raise SystemExit("Stop the agent first.")
    if s.get("worktree") and Path(s["worktree"]).exists():
        shutil.rmtree(s["worktree"])  # removed directly: git never reads the agent's worktree
        git(repo, "worktree", "prune")
    if s.get("branch") and s.get("status") != "merged":
        git(repo, "branch", "-D", s["branch"])
    write_run(d, n, status="discarded" if s.get("status") != "merged" else "merged", discarded=now())


# --- open --------------------------------------------------------------------------------------------

def open_in(slug: str, bid: str | None, n: str | None, zed: bool, prompt_file: str | None, resume: bool) -> None:
    _, repo, subdir = project(slug)
    path, session = repo / (subdir or ""), None
    if bid:
        s = read_run(build_dir(slug, bid), n or "")
        if not s.get("worktree"):
            raise SystemExit("No worktree for that brief.")
        verify(s)  # Zed and a shell prompt run git there, outside the sandbox
        path, session = Path(s["worktree"]) / (s.get("subdir") or ""), s.get("session")
    if zed:
        subprocess.Popen(["open", "-a", "Zed", str(path)])
        return
    # Ghostty runs a small script: cd, then an interactive claude with the prompt (or the agent's session).
    script = Path(tempfile.mkdtemp(prefix="mr-term-")) / "start.sh"
    claude = "claude"
    if bid:
        claude += " --setting-sources user --strict-mcp-config"  # an agent's worktree: ignore any config it wrote
    if resume and session:
        claude += f" --resume {shlex.quote(session)}"
    if prompt_file:
        text = Path(prompt_file).read_text()[:8000]
        keep = script.parent / "prompt.md"
        keep.write_text(text)
        claude += f' "$(cat {shlex.quote(str(keep))})"'
    script.write_text(f"#!/bin/zsh -l\ncd {shlex.quote(str(path))}\n{claude}\nexec zsh -l\n")
    script.chmod(0o700)
    subprocess.Popen(["open", "-na", "Ghostty.app", "--args", f"--working-directory={path}", "-e", str(script)])


def status(slug: str) -> None:
    for d in sorted((ROOT / "companies" / slug / "builds").glob("*/build.md")):
        meta = read_meta(d)
        print(f"{d.parent.name}  {meta.get('status')}  {meta.get('title')}")
        for n, _ in briefs(d.parent):
            s = read_run(d.parent, n)
            print(f"   {n} {s.get('status') or 'not started':10} {s.get('commits', '-')} commits  {s.get('title') or ''}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("slug"); p.add_argument("goal")
    p.add_argument("--thread"); p.add_argument("--model", choices=converse.MODELS); p.add_argument("--run", action="store_true")
    typed_help = "what the owner typed before the app's spelling fixer changed the goal; kept in build.md as `typed`"
    p.add_argument("--typed", help=typed_help)
    p = sub.add_parser("replan"); p.add_argument("slug"); p.add_argument("build"); p.add_argument("direction")
    p.add_argument("--model", choices=converse.MODELS)
    p = sub.add_parser("approve"); p.add_argument("slug"); p.add_argument("build")
    p = sub.add_parser("task"); p.add_argument("slug"); p.add_argument("text"); p.add_argument("--run", action="store_true")
    p.add_argument("--typed", help=typed_help)
    p.add_argument("--model", choices=converse.MODELS)
    p = sub.add_parser("run"); p.add_argument("slug"); p.add_argument("build"); p.add_argument("--brief")
    p.add_argument("--model", choices=converse.MODELS); p.add_argument("--mode", choices=("parallel", "sequence"), default="parallel")
    p = sub.add_parser("say"); p.add_argument("slug"); p.add_argument("build"); p.add_argument("brief"); p.add_argument("text")
    p = sub.add_parser("stop"); p.add_argument("slug"); p.add_argument("build"); p.add_argument("brief", nargs="?")
    for name in ("merge", "discard"):
        p = sub.add_parser(name); p.add_argument("slug"); p.add_argument("build"); p.add_argument("brief")
    p = sub.add_parser("review"); p.add_argument("slug"); p.add_argument("build")
    p = sub.add_parser("open"); p.add_argument("slug"); p.add_argument("--build"); p.add_argument("--brief")
    g = p.add_mutually_exclusive_group(required=True); g.add_argument("--zed", action="store_true")
    g.add_argument("--terminal", action="store_true")
    p.add_argument("--prompt-file"); p.add_argument("--resume", action="store_true")
    p = sub.add_parser("status"); p.add_argument("slug")
    a = ap.parse_args(argv)
    if a.cmd == "plan":
        d = plan(a.slug, a.goal, a.thread, a.model, a.typed)
        print(d.relative_to(ROOT))
        if a.run and briefs(d):
            approve(a.slug, d.name)
            run(a.slug, d.name, model=a.model, mode="sequence")
    elif a.cmd == "replan":
        replan(a.slug, a.build, a.direction, a.model)
    elif a.cmd == "approve":
        approve(a.slug, a.build)
    elif a.cmd == "task":
        d = task(a.slug, a.text, a.typed)
        print(d.relative_to(ROOT))
        if a.run:
            run(a.slug, d.name, model=a.model)
    elif a.cmd == "run":
        run(a.slug, a.build, a.brief, a.model, a.mode)
    elif a.cmd == "say":
        say(a.slug, a.build, a.brief, a.text)
    elif a.cmd == "stop":
        stop(a.slug, a.build, a.brief)
    elif a.cmd == "merge":
        merge(a.slug, a.build, a.brief)
    elif a.cmd == "discard":
        discard(a.slug, a.build, a.brief)
    elif a.cmd == "review":
        review(a.slug, a.build)
    elif a.cmd == "open":
        open_in(a.slug, a.build, a.brief, a.zed, a.prompt_file, a.resume)
    elif a.cmd == "status":
        status(a.slug)


if __name__ == "__main__":
    main()
