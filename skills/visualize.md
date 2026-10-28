---
name: visualize
title: Visualize
scope: any
status: ready
params: [project, what]
kind: task
when: "The owner wants to see something in a new way (a chart, a model with sliders, a redesign), or research produced numbers worth showing."
---

Build a visualization of `{what}` for `{project}` in the app. Never as a Claude artifact or standalone HTML.

1. Put the data in the repo first if it isn't there: a JSON file under `companies/{project}/` (or `holding/` for cross-project views), with sources. Views read repo data; they don't call external services.
2. Write a React component in `app/src/views/<name>.tsx`. Server components can read repo files through `src/lib/`; interactive ones use `"use client"`. Use the design tokens in `app/src/app/globals.css` (dark blue, amber accent) and add styles there.
3. Register it in `app/src/views/registry.tsx`.
4. Create or update a wiki page (`kind: visualization`, or `redesign` for a redesign) (`written_by: agent`) that says in a line or two what the view shows and where the data comes from, and embeds it with a `view` fenced block containing the view name.
5. Run `npm test`, `npm run typecheck` and `npm run build` in `app/`, and look at the page in the running app before calling it done.
