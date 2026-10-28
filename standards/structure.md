---
title: Structure
summary: "How a project is laid out: folders, agent files, env example, scripts, tests."
updated: 2026-10-28
written_by: agent
---

# Structure

Rules for how a repo is laid out. Format and levels: see [README.md](README.md).

- Every tracked repo has a hub record file (`MASTER-REPO.md`) at its root and a marked pointer block in its agent file. (public)
- Standards, reports, mockups, notes and timelines live in the hub, so project directories stay free of random files and anything old is visibly old on a timeline. (public)
- Shared types are one validated schema package or vendored per app; never copied by hand. (public)
- Split a route, page or component past about 400 lines into a folder with a thin composer. (public)
- Keep long-form context in `context/` or `docs/`, linked from the agent file instead of pasted in. (public)
- Commit an `.env.example` listing variable names; real `.env` files are never committed or read by agents. (public)
- Name scripts the same across repos: `dev`, `build`, `test`, `check`; `dev:<target>` for several apps. (public)
- Put one-off automation in `scripts/`, not the repo root. (public)
- Tests sit beside what they test or under `e2e/`. (public)
- A tool that stays small can stay a single folder of scripts with no build step. (public)
- Move a growing internal tool out of the repo it started in. (public)
- Projects don't read each other's source; they talk through contracts or HTTP. (public)
- Keep the repo root to README, agent files, config and source; move stray notes and PDFs out. (public)
- Don't dump source flat in one folder: group code by feature, and keep tests out of the folders that hold pages/components and their CSS. (public)
- Agent working-method tools live in the hub as tools, not as standalone repos. (public)
