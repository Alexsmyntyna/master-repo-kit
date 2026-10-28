---
name: tech-map
title: Tech map
scope: identity
status: ready
params: [project]
kind: task
when: "The owner wants to record what technologies and techniques a project shows."
---

Extract what `{project}` shows about the owner's technical range.

From the repo (read-only): languages, frameworks, notable libraries, platforms/services, and techniques (e.g. offline sync, snapshotting, on-device ML, IPC, subdomain routing). For each, where it appears (file/area) and roughly how deep the use is: `touched | used | built-on | custom-work`. Remember that a dependency doing the heavy lifting isn't the same as the owner implementing it.

Write back: `companies/{project}/company.json` → `developer.technologies` / `developer.techniques`, then merge into `identity/technologies.json` (one entry per technology with a `projects` list). Lessons only come from the owner. Ask them if the session allows.
