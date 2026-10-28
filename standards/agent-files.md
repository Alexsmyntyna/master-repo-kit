---
title: Agent files
summary: "What a clean CLAUDE.md or AGENTS.md in a project repo holds, what stays out, and how long it runs."
updated: 2026-10-28
written_by: agent
---

# Agent files

Rules for the agent files in every project repo. Format and levels: see [README.md](README.md).

## Keep clean

- Keep every repo's agent files (CLAUDE.md, AGENTS.md) clean of the crud that builds up over time. (public)

## What belongs

- Agent file says how to run it: install, dev, build commands, ports. (public)
- Agent file says how to test and what "green" means for this repo. (public)
- Agent file says how to deploy and which server manual testing uses. (public)
- The hub pointer block is rendered by `tools/pointer.py` between `<!-- master-repo:start -->` and `<!-- master-repo:end -->`; never hand-edited. (public)
- Agent file lists gotchas that bite a fresh agent: schema migration rules, frozen identifiers, naming bans. (public)
- Code style a linter can't enforce goes in as one-line rules. (public)
- State the repo's git behavior: branch or not, commit or push only when asked. (public)
- Point to longer docs (current state, ADRs, design system) instead of copying them in. (public)

## What doesn't

- Keep session logs, "what I did today" and progress notes out of agent files. (public)
- Keep task lists, roadmaps and TODOs out; they go to the project's board in the hub. (public)
- Keep mockups, screenshots, design essays, market and pricing notes out. (public)
- Keep dated facts ("as of ...", "renamed on ...") out; they belong in the hub archive. (public)
- Keep product vision and strategy out; link the story page at most. (public)
- Never put credentials, connection strings or tokens in an agent file, even as examples. (public)

## One source, one pointer

- Put content in one file and import or point to it from the other; two long copies drift. (public)
- A scoped AGENTS.md in a subfolder is fine for an area with its own rules. (public)

## Length

- Aim for 80 lines or fewer; past 120, split detail into `docs/` and link it. (public)

## Cleanup on sight

- Move session-era content into hub notes (cited, dated) and leave a link rather than deleting it. (public)
