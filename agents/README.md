# Agents

Role prompts for the agents that talk to each other in **threads**. Each file is one role. `tools/converse.py` loads a role, gives it only the thread and the project files it needs, runs it headless (`claude -p` on the owner's subscription, or `codex exec`), and saves its reply as a new message.

| Role | File | Scope | Job |
| --- | --- | --- | --- |
| CEO | [ceo.md](ceo.md) | Focus projects only | Gives directives, weighs trade-offs across the projects with public potential, decides or sends back. |
| COO | [coo.md](coo.md) | One project | Runs the project: researches viability, reads the code, reports back with options and costs. |
| Marketing | [marketing.md](marketing.md) | One project | Positioning, the one-line promise, customer and channels, launch plans, copy review against the brand and writing skills. |
| Research | [research.md](research.md) | One project | Market, competitors, pricing, reviews, past strategies; every claim sourced; writes research pages. |

The owner sits above all of them. A CEO decision is a recommendation until the owner approves it. Marketing and Research are specialists: they answer the one who brought them in, and the CEO can bring either onto a thread.

### Addressing a role

Any file in this folder with a `role:` is a role. Address it with `--to` when you post (`converse.py post <thread> --to marketing …`, `converse.py new <slug> "<title>" --to research …`) and run its turn with `--as` (`converse.py turn <thread> --as marketing`).

### Adding your own role

Drop `agents/<role>.md` in your hub. Front matter, then the prompt in the same plain voice as [coo.md](coo.md):

```
---
role: design-review
title: Short name
model: sonnet            # haiku | sonnet | opus; the default when a thread doesn't pick one
max_turns: 40            # cap on the agent's tool-use turns
tools: [Read, Grep, Glob, WebSearch, WebFetch]   # what it may use; omit a tool to withhold it
writes: [notes]          # folders under the project it may write; nothing else is writable
---
```

Leave out a field and the role gets the COO's defaults (Sonnet, 50 turns, the COO's read-only tools). Never grant Write or Edit in `tools`; list folders in `writes` instead, so a role can only write inside the project it's working on.

## Who sits on which project

`holding/portfolio.json` sorts projects into `focus`, `maintain`, `paused` and `undecided`.

- **Focus** (public potential): new threads get the CEO. The COO reports to the CEO, and the CEO takes decisions to the owner.
- **Everything else**: the COO and the owner work it out directly, with no CEO. The COO sends its plan to the owner as a `decision`.
- **Bringing the CEO in** on a small project: start the thread with `--to ceo`, or post to it as the owner with `--to ceo`. The CEO stays on that thread only and gets a short brief.

The CEO's portfolio view is one line per focus project. Every other project appears only as a name, and the CEO doesn't read its files unless the thread is about it. To change what the CEO carries, move a slug between the lists.

## Threads

A thread is a folder of messages, like an email chain:

```
companies/<slug>/threads/<YYYY-MM-DD>-<topic>/
  thread.md          title, status, summary, decision (frontmatter + short body)
  001-owner.md        from, to, kind, date (frontmatter) + body
  002-coo.md
  003-ceo.md
holding/threads/...  same shape, for threads about the whole company
```

- `kind`: `directive | report | question | reply | decision | approval`
- `status` (thread): `open` (agents talking), `awaiting-owner` (a decision needs the owner), `talking` (a talk thread, the owner's turn), `decided`, `closed`
- `mode: "talk"` makes a thread a conversation rather than a run toward a decision, and `projects` lists any other projects it's about (see "Talking" below).
- Messages stay short: at most about 400 words of prose, with a 1–2 sentence summary at the top. Long research goes in `companies/<slug>/notes/` and the message links to it.
- **Writing.** Every message and page an agent writes follows `skills/writing.md` (the owner quoted with where and when, facts cited to a commit or path, inference marked). The prompt carries a short version as `WRITING_RULE` in `tools/converse.py`.
- **One mockup over descriptions.** When a question is about look or flow, agents make one mockup review (`skills/mockup-review.md`): a self-contained HTML mockup built like the real product plus `review.md` (questions and a trade-off table) in `companies/<slug>/mockups/<date>-<topic>/`, linked with a ```mockups block. The owner opens it at `/companies/<slug>/mockups/<id>`, pins notes and answers; they land in `notes.md` and back in the thread. No variations to fill space.
- **Talk about this page.** Every page (except threads, which have their own composer) has a button that opens a chat drawer. The owner's message starts or continues one talk thread per page, carrying the page's URL and the file behind it; the CEO reads that file first and, when the owner gives it the content (facts, ideas, fonts, links, corrections), writes it into the page or elsewhere in that project's wiki and says what it changed (`tools/converse.py` PAGE_RULE).
- **Board.** A project's Board tab holds epics and one-off tasks. For an epic the COO reads the code and proposes 1–4 subtasks (coarse pieces the owner would recognise, never chore lists); the owner approves them or sends a new direction and the COO re-plans whatever hasn't run. The owner runs one card, the whole epic in sequence (each agent starts from the branch before it) or all at once. Each subtask is a Claude Code agent in its own sandboxed worktree and branch; the owner watches live, gives direction mid-way or takes it over in Ghostty, and the COO reviews the branches before the owner merges. Branches that change tool or git config are never merged from the app (`tools/build.py`).
- **Messages are drawn, not read as email.** The opening sentence is the headline; `**Label:** text` becomes a callout, a label alone over a list becomes a card (cards sit side by side), and ```stats and ```flow blocks become number tiles and a step diagram (`VISUAL_RULE` in `tools/converse.py`, parsed by `app/src/lib/brief.ts`).
- **One counterpart.** the owner always talks to the CEO. Inside its turn the CEO calls any project's COO as a tool (`converse.py consult <thread> <slug> "question"`), several at once and over several rounds, then answers the owner once. Each consult is saved in the thread's `consults/` folder and shown inside the CEO's message. Scheduled check-ins still start with the project's COO.
- **Market file.** Each project keeps `companies/<slug>/market/`: `market.md`, `competitors.json` (facts from `tools/market.py`: App Store data and screenshots, web page captures; judgment from agents: who, strengths, complaints, positioning, threat, sources) and competitor `reviews/`. COOs read it before answering about users or positioning and add what they learn; `converse.py market-check <slug> --run` (or Market → Run a market check in the app) builds or refreshes it. Screenshots stay local (`shots/` is gitignored).
- **Direction vs operations.** Direction (what a product is, who it's for, how it feels) comes to the owner as a concept with a mockup, its trade-offs and open questions. Operations inside an agreed direction are settled between CEO and COO and reported, not sent for approval.

### Decisions the owner owes

Every message of kind `decision` ends with an `options` block, so the owner can compare the choices at a glance instead of reading the whole thread:

````
```options
ask: Ship the camera app from main weekly, or restart it in React Native?
A* | Ship 1.3.x from main, then 1.4 piece by piece | time: 1 week | complexity: low | growth: medium | costs: no Android this quarter
B | Full React Native restart | time: 3-5 months | complexity: high | growth: high | costs: no releases until it lands
revisit: main can't produce a clean upload within two weeks
```
````

`*` marks the recommendation. **Time** is weeks of the owner's time; **complexity** is moving parts, risk and upkeep; **growth** is how far it moves the project toward people using or paying for it (or the owner's stated goal for it). The exact wording agents get is `OPTIONS_RULE` in `tools/converse.py`.

The app's **Decisions** page (`/decisions`, also on the Overview) lists every thread waiting on the owner, focus projects first, with the options as a table. Choosing the recommended option approves the decision. Choosing another sends it back to whoever proposed it as a directive to replan around that option, so a check-in's release card is never applied for an option the owner didn't pick. A decision with no options block gets a "Lay out the trade-offs" button that asks the agent to restate it. From the terminal: `converse.py desk`.

### Talking

Not everything is a decision. A **talk thread** (`converse.py new <slug|holding> "<title>" --talk --about <other-slug>…`, or **Talk** in the app) is the owner thinking out loud with one agent: new ideas, revisions, half-formed thoughts, about one project or several. The COO answers on a project, the CEO on the parent company; either way it answers the owner directly, and the agents don't hand it back and forth. Every project it's about gets a brief in the agent's prompt, and the thread appears on each of those projects' pages. Ideas worth keeping are written as wiki pages in `companies/<slug>/wiki/ideas/` (or `discovery/ideas/` when they belong to no project yet); changes to a story or a front are proposed in the reply, not made. When the conversation reaches something the owner has to decide, the agent sends a `decision` with the options block and it lands on their desk. The wording agents get is `TALK_RULE` in `tools/converse.py`.

### One record per project

When the owner approves a decision, `converse.py approve` appends it to `companies/<slug>/decisions.json` (or `holding/decisions.json`): what was decided, why, the options passed over, when to revisit, and the thread it came from. `converse.py record` backfills any approved thread that isn't there yet. Each project's **Decisions** page in the app shows what's waiting, what's still open (talk threads, fronts, open questions), everything decided, and how the project relates to others.

## Pulse and check-ins

`tools/portfolio.py pulse` (run by `master` on start) reads every project's git history, read-only, and writes `holding/pulse.json`. For each project it records the last commit, commits in the last 30 days, commits nobody has read yet, the work that isn't on main (uncommitted files, branches ahead of main, live worktrees), and a state:

| State | Last commit |
| --- | --- |
| active | 14 days or less |
| cooling | 60 days or less |
| dormant | 180 days or less |
| abandoned | longer ago |

The CEO's portfolio view and every project brief include this line.

A **check-in** is a thread where the COO answers up to three questions:
1. **What happened and why?** It reads a digest of the latest unread work and gives the direction and the recorded reason.
2. **What isn't on main yet?** For each branch, worktree and batch of uncommitted changes: what it's for, and whether and how it comes into main (commit, split, merge, squash, cherry-pick) and in what order, or whether to drop it.
3. **Will this reach people?** It covers whether the project is published, how it's delivered (App Store, web, GitHub, plugin), whether there's a landing page, and gives a verdict: push, maintain, park or retire.

The decision ends with a `release` block. When the owner approves, that card goes into `company.json` (`release`) and the project moves to the matching portfolio list (push → focus). A project the owner put in focus stays there until they take it out. The commits count as read, and the next check is set by the card's cadence: weekly, monthly, quarterly or none.

Check-ins are triggered by new code. A project is due when:
- it has no card yet;
- it has 3 or more new commits;
- its off-main work changed since the last approved card;
- it came back to life after going quiet;
- its cadence date arrives (the slow schedule for quiet projects).

`master schedule on` installs a launchd job that runs `portfolio.py checkin --due --run --limit 4` daily at 7:30. `master schedule off` removes it. `master due` shows what's due now, and `master checkin <slug>… --model opus` runs chosen projects in parallel.

## Models and helpers

Every turn runs on a model you pick when you send: Haiku, Sonnet or Opus. Auto means Opus for the CEO and Sonnet for the COO. The choice sticks for that role on that thread until you change it (`--model` on `new` and `post`).

The CEO and the COO each oversee smaller helper agents, defined in `HELPERS` in `tools/converse.py`:

| Helper | Model | Does |
| --- | --- | --- |
| `scout` | Haiku | Bulk read-only codebase and git work: find, read and summarize files and history. |
| `researcher` | Sonnet | Web research, returning short findings with sources. |

The overseer hands them repetitive reading so its own context stays on judgment, and it checks any claim before relying on it. Helpers only get tools the overseer itself has, never write access. Each message's usage line splits the cost by model. Turn helpers off for a thread with "Use helper agents" in the composer, or `--no-helpers`.

## Usage limits

A turn (or a Board subtask) that hits the subscription's 5-hour, weekly or rate limit doesn't fail: the thread gets `waiting` (with the CLI's reset time plus a minute, or 30 minutes when it gives none), nothing is posted, and the run goes into `holding/retries.json`. `converse.py retry --wait` (started by that run, and again by the app if the Mac slept) runs it then; "Retry now" in the app and `converse.py retry <thread>` run it at once.

## Clean context

Every turn is a fresh headless run. An agent sees only its role prompt, the project's story and open fronts, `thread.md`, and the messages in that thread. The CEO also gets the direction and the focus list described above. It doesn't see any other thread or session history. When a thread gets long, the runner sends the summary plus the last few messages.

## Coding agents in project repos

Point any agent working in a project repo back here:

```
python3 "${MASTER_REPO:-$HOME/Documents/GitHub/Master-Repo}/tools/converse.py" context <slug>
```

That prints the project's story, open fronts and open threads in one short block. To report back to a thread:

```
python3 "${MASTER_REPO:-$HOME/Documents/GitHub/Master-Repo}/tools/converse.py" post <thread-path> --as coo --kind report --body "..."
```

Set `MASTER_REPO` when Master-Repo lives somewhere else (another machine, a cloud session).

Each tracked project repo gets a `MASTER-REPO.md` and a marked block in its `CLAUDE.md` / `AGENTS.md`, rendered from [pointer.md](pointer.md) by `python3 tools/pointer.py install --all` (`check --all` finds drift).
