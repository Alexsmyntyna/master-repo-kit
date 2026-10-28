---
name: vault-reading
title: Vault reading
scope: company
status: ready
params: [project]
kind: task
when: "The owner points at their Obsidian notes, or a project's story, fronts or history are thin and their vault probably holds more."
---

The owner keeps a lot of their thinking in an Obsidian vault: kanban boards, feature plans, architecture canvases, business notes, idea write-ups. This task brings what matters into Master-Repo without copying the vault.

Vault root and the allowed and forbidden folders are in `local/owner.md`. Never read a folder it forbids.

1. Check `companies/{project}/notes/vault-sources.md` for what has already been read, and read only what's new or changed since. If `{project}` is `all`, do each project with a vault folder, then `Development-Ideas/`.
2. Canvases are JSON. Pull the node text out with a short script rather than reading the raw JSON.
3. Separate what the owner said from what an agent wrote into their vault. Their own notes are rough and unpunctuated. Agent-written plans are polished, often with a "Status:" line or tables. Only their words count as `source: owner`. An agent plan in the vault is `source: agent`, even when they approved it.
4. Put things where they belong:
   - Why they started it, and what they want it to become, goes into the story (`wiki/index.md`) as dated quotes under `## In your words` or `## Where it's going`, citing `vault:<path>`. Don't rewrite their notes into prose (`skills/writing.md`).
   - What they're worried about, or a big missing piece, becomes a front. Respect the limit of five open fronts per project.
   - Plans, pivots and re-orientations become dated `history` or `topic` pages, so they show up on the timeline.
   - New ideas go in `discovery/ideas/`.
   - Things about them go in `identity/`: lessons in their words, and patterns marked as agent observations.
5. Kanban cards are tasks. Don't import them one by one. Read a board for its shape: what keeps growing, what's stuck, and which concerns repeat.
6. Cite vault paths as `vault:<path>` in `ref`. Add each note you used to `companies/{project}/notes/vault-sources.md` with today's date.
7. Write by `skills/writing.md`: their words quoted, agent plans marked `source: agent`, pages with `written_by: agent`.
8. Tell the owner what you brought in, what you left out and why, and anything that contradicts what Master-Repo already says.
