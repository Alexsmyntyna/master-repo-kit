---
name: brand
title: Brand
scope: company
status: ready
params: [project]
kind: session
when: "The owner wants to work on a project's name, promise, voice or look (\"the finance app needs a facelift\", \"serif or sans-serif?\", \"what should the camera app feel like?\"), or the parent company's name."
---

Work through `{project}`'s brand: its name, the promise it makes to one customer, how it talks, and how it looks. Each project gets its own. Don't pull projects toward a shared brand, palette or naming scheme because the owner owns them all. The parent company's name is a separate exercise in `holding/company-identity.md`; only touch it if they ask.

1. Read `companies/{project}/company.json` (`brand`, `customer`, `thesis`, `links.mockups`), the story at `wiki/index.md`, any front about the look, and recent threads that discuss design. `local/owner.md` may record earlier brand context for a project.
2. Check the customer first. A promise and a look follow from who it's for and what result they get. If `customer.who` is empty or vague, say so and offer a `company-ceo` session instead of branding in the abstract. A rename or redesign can't stand in for missing customer evidence.
3. Find what already exists before proposing anything: look in the project repo (read-only) for mockups, design explorations, tokens, logos and style sheets. Record each one in `links.mockups` as `{ "path": "...", "title": "...", "date": "..." }` with absolute paths into that repo and the commit date. Nothing records which direction the owner prefers until they say so.
4. Talk it through one question at a time, one part at a time: name, then promise, then voice, then visual direction. Put real choices to them in a line each ("Option A's paper and serif, or option B's denser tables?"), with what each one shows from the existing files. Don't sell symbolism or over-explain why a word fits them. Write by `skills/writing.md`.
5. For a name, follow the constraints already on file in `holding/company-identity.md` (no two-word mashups, no surname brand assumed, rejected candidates stay rejected). Say whether a name is already used by a software company or product, and that none of this establishes trademark or domain availability.

Write back:

- `brand.name_notes`, `brand.promise`, `brand.voice`, `brand.visual_direction` in `company.json`, as `{ text, source, ref, date }`. What the owner chose is `owner`; your proposals stay `agent` until they agree.
- A chosen direction (a name, a token set, the serif look over the sans one) goes into `decisions.json`. Update the related front if there is one.
- A visual direction is put to the owner as a mockup review (`mockup-review`): one mockup in the project's own look, with trade-offs and questions, in `companies/{project}/mockups/`. A COO can make it in a `thread`; when it needs the project's code, a build brief asks a coding agent for it (it is collected into Master-Repo after the run). Real design work that ships stays in the project's own repo; link it in `links.mockups` once it exists. Recapturing what the app looks like now is the `screens` skill.
