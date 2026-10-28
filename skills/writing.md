---
name: writing
title: Writing
scope: any
status: ready
params: []
kind: task
when: "Anything is being written that the owner will read (a story, a front, a wiki, research or idea page, a review, a git note, a thread message, app copy), or they say something reads as AI-written, wordy, or made up."
---

How every agent writes in Master-Repo. The content skills load this one; `AGENTS.md` (Voice) and the thread prompts in `tools/converse.py` point here.

## Three kinds of sentence, kept apart

| Kind | Rule | Example |
| --- | --- | --- |
| The owner's words | Quote them verbatim, with where and when. Fix only obvious typos; never change or add words. Don't turn their intent into prose they didn't say. | > "<their exact words>" (the owner, `threads/<date>-<topic>/004-owner.md`, <date>) |
| Facts from code | Cite a commit sha and date, or a file path. Code shows what exists, not why, who uses it, or whether it's deployed. | Stripe billing (`a1b2c3d`, 2026-06-04) |
| Inference | Labelled `source: agent` (inline: "Agent:"), one or two sentences. | Agent: the web dashboard and the mobile app overlap on time entries. |

If it isn't in the owner's words, the code, or a dated public source, don't state it as fact. Write "unknown" and how to find out.

A file attached to their message (a long paste lands in `holding/uploads/<date>/`) is material the owner brought, such as an article or a log. Read it and cite it by path, but never quote it as their words; only the text of the message itself is their.

An attachment line at the end of their message (`[image #3](holding/uploads/…)`, `[pasted #2: …](…)`, `[file #1: …](…)`) names material the owner brought, not something they said: refer to it by its number ("image #3 shows…"), and never quote the line or the file as their words.

## The owner's words first

1. Before writing about a project's purpose or direction, collect their words, newest first: their thread messages (`companies/<slug>/threads/*/*-owner.md`), `decisions.json`, `holding/vision.md`, `company.json` fields with `source: owner`, and their vault notes (`skills/vault-reading.md`; only their own notes count, not agent plans in the vault).
2. Their newest direction overrides older summaries. When it contradicts a page, change the page, and say on a `history` page what shifted (old version stays in git).
3. Quotes are short: the sentence that carries the point, not the whole message.

## Shape

- Titles and headings are nouns: "Mobile app", "Stripe billing", "Pricing". No slogans, no questions, no "The story of…".
- Lead with the answer. No preamble, no closing summary.
- Tables and lists over paragraphs. A paragraph is 1–3 sentences.
- Show it when you can: a table, a `view` block, a stats or flow block, a screenshot, a mockup.

**Story page** (`companies/<slug>/wiki/index.md`), at most about 250 words:

```markdown
---
title: <project name>
kind: story
summary: "<one plain sentence; their words if they have them>"
date: YYYY-MM-DD
updated: YYYY-MM-DD
written_by: agent
---

## In your words
> "<quote>" (where, date)

## What exists
| Part | State | Evidence |

## Where it's going
Their newest direction, quoted or as short bullets with refs. Then at most two sentences marked Agent:.

## Open questions
1. <what only the owner can answer>
```

**Front**: a few sentences on the concern (quoted if `raised_by: owner`), `## Dealt with when` (one observable condition), `## Evidence` (cited list), optional `## Might need`. Under about 150 words.

**Thread message, review, note**: the answer in the first sentence, cited facts after it, inference marked, then questions. Thread messages stay under 400 words.

**App copy**: page names and labels are nouns, one to three words. An empty state says what's missing in one line.

## Ban list

Never: "started close to home", "grew fast", "plainly", "it's worth noting", "dive into", "landscape", "journey", "seamless", "robust", "leverage", "unlock", "game-changer", "cutting-edge", "empower", "elevate", "streamline", "holistic", "at its core", "not just X but Y". Also: more than one em dash in a sentence, rhetorical questions as headings, slogans as titles, scene-setting openings, origin stories they didn't tell, emotions or motivations they didn't state, a closing line that restates the page.

## Provenance in frontmatter

- `written_by: owner` only when the body is the owner's own words; every other page gets `written_by: agent`. Quoting them on a page doesn't make it theirs.
- A page-level `source: owner` is wrong on an agent-drafted page. Cite their words inline instead.
- Stored claims in JSON keep the `{ text, source, ref, date }` shape from `AGENTS.md`.

## Check before saving

- Every "what exists" claim has a sha and date or a path.
- Every statement of intent is a dated quote of the owner, or is marked Agent:.
- Their newest thread message about the project was read and is reflected.
- `written_by` is set. Story under about 250 words.
- No banned phrase: `grep -n -i -E "close to home|grew fast|plainly|worth noting|dive into|landscape|journey|seamless|robust|leverag|unlock" <file>`.
