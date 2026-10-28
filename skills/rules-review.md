---
name: rules-review
title: Rules review
scope: holding
status: ready
params: []
kind: task
when: "The owner asks to clean up, audit or trim the rules or lessons, or `tools/rules.py audit` or the refresh report says the last condense was over 30 days ago."
---

Condense the standards: fewest words that keep every distinct lesson. Rules live at three levels (`standards/README.md`): `standards/` generic, `local/standards/` the owner's, `companies/<slug>/standards.md` per project.

1. Run `python3 tools/rules.py audit`. It lists duplicates, project names in generic rules, missing evidence, stale rules and each file's size against its budget. Read `holding/rules-condensed.json` for the last condense and its token counts.
2. Propose. Walk the findings and the files, and for each rule decide one of:
   - **Merge** duplicates. Keep the stronger wording and both evidence refs, at the lowest level that still fits.
   - **Trim** wording: same lesson, fewer words.
   - **Drop** a rule that nothing has confirmed and the code no longer shows. Check the evidence path still exists first.
   - **Promote** a project or owner rule that now holds in a repo with none of the owner's projects. Reword it with no names, put it in `standards/` marked `(public)`, and move the sourced original to `local/standards/evidence.md`.
   - **Demote** a generic rule that turned out to be about one project or one taste, to `companies/<slug>/standards.md` or `local/standards/`.
   - **Cut toward budget** in each file over its budget, starting with the longest lines.
3. Show the owner one short before/after list: one line per change, the old text and the new (or "dropped"), with the token total before and after. Group by file. Nothing is deleted without their yes; ask for a yes per change or per file, not per line of reasoning.
4. Apply only what they approved. Keep the line format and the provenance tag; move evidence with the rule, never lose it. A rule that is dropped is struck (`~~...~~`) once, with the date, unless the owner says to delete it outright.
5. Write `holding/rules-condensed.json`: `{"date": "YYYY-MM-DD", "before_tokens": n, "after_tokens": n}` using the totals `tools/rules.py audit` prints before and after.
6. Re-run `python3 tools/rules.py audit` and report the counts in a sentence.

Plain voice. Don't add rules here, don't rewrite the owner's meaning to make it shorter, and don't touch rules you weren't asked about.
