---
title: Design
summary: "Visual and interaction rules that hold in any product."
updated: 2026-10-28
written_by: agent
---

# Design

Rules for UI and interaction in any product. Taste and per-project design rules sit in `local/standards/design.md` and `companies/<slug>/standards.md`. Format and levels: see [README.md](README.md).

- Cut fluff: simplify first, add later. (public)
- Design the app before building it: mockups first, with inputs suited to phone versus desktop and parity of visuals. (public)
- Unsettled interactions get an HTML mockup and the owner's sign-off before new code. (public)
- Mockups for a project go to the hub's `companies/<slug>/mockups/`, not into the project repo. (public)
- Everything an agent can do must also be editable by hand; nothing locked behind the agent. (public)
- Never lose typed input: every text field keeps a local draft across reload and failed submit. (public)
- Check spelling on send without blocking it; keep the original. (public)
- Use design tokens, not literal colours, and extend the design-system doc before inventing a pattern. (public)
- Sample content is labelled as such on the page and set to noindex until real content is in. (public)
- Destructive confirmations put cancel first and the destructive action last. (public)
- Things that need attention (blockers, fixes, questions, low-confidence values) use warning or danger colour and are prominent; info stays neutral. (public)
- Keep one visible next step per item; a disabled action names its reason. (public)
- Personal-data deletion redacts the person's details to null and keeps the business record (sale, order, item, money) with a redacted marker; never delete inventory or ledger data to comply. (public)
- An action button does its action where it was pressed: no switch to another tab, no scroll elsewhere, no second click. Its working state and any refusal show at that button. (public)
- Action buttons go at the top of a page or tab, not under the content. (public)
- Solve each UI element once: one modal, one tab bar, one segmented control, one section header, one list row, one form field, used everywhere; a new need becomes a shared primitive first. (public)
- Nothing scrolls sideways inside a modal or card; content fits the width or wraps. (public)
- Marketing pages never use invented placeholder images or drawings standing in for photos; use real product screens or real photos only. (public)
