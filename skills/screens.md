---
name: screens
title: Screens (map, capture, review)
scope: any
status: ready
params: [project]
kind: task
when: "The owner wants to see where an app is at visually (\"screenshot all of the finance app\", \"what does the camera app look like now\", \"map the screens\"), a project has no screen map yet, or frontend work changed screens that need recapturing and review."
---

Keep `{project}`'s screens mapped, captured and reviewed with `tools/screens.py`. The app shows them at `/companies/{project}/screens` and `/screens`.

1. **Map.** Write `companies/{project}/screens/screens.json` (the format is in the docstring of `tools/screens.py`). Read the project's code to list every user-visible screen grouped by feature: `id` (`feature.screen`), `title`, `source` (the file), `route` (URL path for web, or how to reach it), and the meaningful `states` (empty, populated, error, long text, small width). Leave a `gap` line for anything you can't capture yet. If the project keeps its own inventory (read(in) does), propose pointing `inventory_file` at it (in `capture.json`) instead of copying.
2. **Choose the adapter.**
   - `web`: the project runs in a browser. Set `web.base_url` to its local dev server and `web.viewports`. Capture needs the server running with test data, never production data or real accounts.
   - `delegate`: the project has its own capture pipeline (iOS simulator with fixtures, for example). Its command, runs folder and inventory file go in `capture.json`, which only the owner edits because it runs commands. Propose the exact contents in your reply and they add the file. Its runs must write `manifest.json` with `captures[]` holding `screen`, `file` and `position`. The portable contract for building one is `.agents/skills/app-screenshots/references/portable.md` in the read(in) repo.
   - Add `review`: a few lines on what a good screen looks like for this project.
3. **Capture.** `python3 tools/screens.py capture {project}` previews; add `--apply` to run. Then `sync`. Only capture with isolated test data. Ask before launching a simulator or UI test suite.
4. **Review.** `python3 tools/screens.py analyze {project} --apply` has an agent look at the latest captures and file notes. To file notes yourself, look at the actual image first, then use `note`. Resolve a note only after a new capture shows the fix.
5. **Report** in two or three lines: what's mapped, what's captured, and the worst open issues. Point the owner to `/companies/{project}/screens`.

When frontend work changes a screen, update its entry in the same change and recapture it.
