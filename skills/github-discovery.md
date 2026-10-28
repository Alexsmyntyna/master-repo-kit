---
name: github-discovery
title: GitHub discovery
scope: holding
status: ready
params: []
kind: task
when: "The owner wants every repo inventoried so nothing is forgotten."
---

Build an inventory of the owner's repos so nothing is forgotten.

Sources (ask before widening): `gh repo list --limit 200 --json name,description,primaryLanguage,pushedAt,isArchived,isFork,isPrivate`, and the folder names in the owner's local code folders (listed in `local/owner.md`; names and `git log -1` only, no deep scan). Some local clones are other people's projects (forks, tools they downloaded). Mark those, don't count them as their work.

Write back: `discovery/repos.json` (`{ updated, built_by, sources, repos: [...] }`), one entry per repo: `{ name, local_path, remote, language, last_commit, is_fork, owned_by_owner: true|false|null, company: slug|null, guess, status: "unreviewed", commit_count: int|null, source: "local"|"github"|"both" }`. Match local clones to GitHub repos by remote URL; a GitHub repo with no clone gets `local_path: null` and its `pushedAt` date. Sort `owned_by_owner` true, then null, then false, newest first.

Don't create company folders. Add a dated "Worth a folder?" table to `discovery/leads.md` (name, commits, last commit, one line of evidence, by commit count) and let the owner choose.
