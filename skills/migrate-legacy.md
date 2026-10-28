---
name: migrate-legacy
title: Migrate legacy notes
scope: company
status: ready
params: [project]
kind: task
when: "A project's company.json is mostly empty and archive notes exist for it."
---

Move `{project}`'s old notes into its new model.

Read each path in `companies/{project}/company.json` → `legacy_notes`, plus relevant entries in `archive/career-coach-2026-09/evidence/claims.md`, `product-development.md`, and `ideas.md`.

Fill `company.json` fields from them, keeping provenance (the archive notes separate the owner's account, code inspection, and public claims; preserve that). Don't upgrade anything's certainty. Carry qualifications forward. Put decisions into `decisions.json`. Anything that doesn't fit a field goes in `notes/legacy-summary.md`.

When done, list what's still empty so the owner knows what the CEO session should ask about. Leave `legacy_notes` in place; add `"migrated": "YYYY-MM-DD"` at the top level.
