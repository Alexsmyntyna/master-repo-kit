---
title: How to use Master-Repo
---

# How to use Master-Repo

Master-Repo is where every project's story lives while you're building it: why you started it, how the idea has shifted, what's in its way, and what it would need to become the thing you want. When you drop a project for a while, the reasons are still here when you come back.

You use it in two places. You **talk** in a terminal session with an agent, and you **read** in the app.

## Talking

Open your agent in the Master-Repo folder (for example `claude` or `codex`) and say what's on your mind. The agent reads `AGENTS.md` and the [skill index](../skills/INDEX.md), works out which skill fits, and loads it.

| You say something like | Skill | What shows up |
| --- | --- | --- |
| "Inventory my repos." | github-discovery | A list of every repo, so nothing is forgotten |
| "Let's write down why <project> exists." | story | The project's landing page |
| "I'm not confident about the payments code." | concern | A front card on the project page |
| "Where was I with <project>?" | re-entry | Where you stopped and what was next |
| "I have an idea for..." | new-idea | A recommendation: own project, part of another, or a small tool |
| "What should I focus on?" | holding-review | Updated direction across projects |
| "Who else does this and how do they charge?" | research | A research page |
| "Mock up the end-of-shift screen." | mockup-review | A mockup you can pin notes on |

## Reading

```sh
cd app && npm install && npm run dev
```

Open http://127.0.0.1:3100. After an agent changes something, press the refresh button in the top bar.

## Fronts, not tasks

A front is one of the few big things between a project and what you want it to be. Each is a paragraph, not a checklist. At most five open per project.

## Where things live

| What | Where |
| --- | --- |
| A project's story and pages | `companies/<slug>/wiki/` |
| Its model and decisions | `companies/<slug>/company.json`, `decisions.json` |
| Your vision | `holding/vision.md` |
| Skills | `skills/<name>.md`; your own in `local/skills/` |
| Rules every agent follows | `AGENTS.md` |
