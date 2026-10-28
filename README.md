# Master-Repo

A folder of files your agents run on. It keeps track of every project and idea you've started: what each is for, where you left it, what you decided, and what's next.

It has four parts:

| Part | What it is |
| --- | --- |
| Skills | Markdown instructions that tell an agent how to run a session: re-entry, research, a new idea, a mockup review |
| Tools | Small Python scripts that read git history, check repos and build indexes |
| Standards | Generic rules project agents read before they work in a repo |
| App (optional) | A local web app to read all of it in a browser |

Your data (one folder per project: card, decisions, notes, wiki) is plain Markdown and JSON in a directory you own. It works with any agent that reads `AGENTS.md` and `CLAUDE.md`, such as Claude Code or Codex.

## Who it's for

People with too many projects and no way to organize them. A new idea starts before the last one is finished, and why you started it, what you decided and where you stopped live in your head or in a chat you can't find.

## Requirements

- git
- Python 3.12
- Node.js 20.9 or newer, only if you want the app
- An agent such as Claude Code or Codex

No account and no server. The app runs on your machine.

## Install

Clone the kit into a folder named for your private hub:

```sh
git clone https://github.com/Alexsmyntyna/master-repo-kit hq
cd hq
tools/master init --private-repo <you>/hq
```

This uses GitHub CLI (`gh`) to create your private repo, commit your data and push it. The kit remote is named `kit`. Run `tools/master init` without the flag to get the exact commands to run yourself; `--commit` commits the initial data locally.

## First session

Open an agent in the repo folder and say:

> inventory my repos

The agent reads `AGENTS.md` and `skills/INDEX.md`, picks the GitHub discovery skill, and lists what it finds. After that, say what's on your mind: "where was I with <project>?", "I have an idea for...", "what should I work on this week?"

To read what the agents wrote, start the app:

```sh
cd app && npm install && npm run dev
```

Then open http://127.0.0.1:3100.

## Where your data lives

| Path | What |
| --- | --- |
| `companies/<slug>/` | One folder per project |
| `holding/`, `identity/`, `guide/`, `queue/` | Cross-project direction, who you are as a developer, the in-app guide, saved questions |
| `local/` | Your own changes: `owner.json`, `owner.md`, `skills/`, `standards/`. Updates never touch it |

By default the data sits in the same folder as the kit. To keep it somewhere else, set `MASTER_REPO_ROOT` to that folder's absolute path. The app and every Python tool read it. A starter data directory is in `kit/starter/`. The full layout is in [DATA.md](DATA.md).

## Your own skills and rules

- `python3 tools/skills.py override <name>` copies a shipped skill to `local/skills/` so you can edit it. A local file with the same name wins.
- Set `disabled: true` in a local skill's front matter to hide a shipped one.
- Your rules go in `local/standards/`; see [standards/README.md](standards/README.md).

## Updating

```sh
tools/master update
```

`tools/master update` merges new kit releases into your private hub. Your data and history stay yours. Keep engine customizations in `local/` overrides; direct engine edits block updates.

## What it does not do yet

[CLAIMS.md](CLAIMS.md) lists each claim on the public page and whether the code backs it.

## Licence

MIT. See [LICENSE](LICENSE).
