# Delegation

## Brief contents

`notepad.py brief` generates the file; the format is:

1. Goal in one sentence.
2. The owner's relevant words, quoted verbatim from Vision (`--quotes 1,2`, numbering Vision entries from 1).
3. Owned files or folders, and what is out of scope.
4. The Next items this brief covers, by id.
5. How to verify: tests, build, or screenshots.
6. Report format: what changed, evidence per item, open questions. Short. No pasted files or logs.

The subagent gets the brief, never the whole notepad or your history.

## Roles

| Role | Does | Claude default (`roles.claude`) |
|---|---|---|
| coordinator | Sizes, routes, writes briefs, reviews diffs, owns the notepad | opus |
| builder | Implements one brief | sonnet |
| small_builder | Small well-specified briefs | haiku |
| scout | Searches, reads, mechanical edits, transcript digests | haiku |

Codex has coordinator, builder and scout entries under `roles.codex`; the owner fills in the model ids.

## Rules

- Do not read files a scout or builder already read; read their report and the diff.
- Parallel briefs need disjoint file ownership and one worktree per writing agent.
- Review each diff against the brief's items before checking them off.
- Escalation: when you reject a builder's work, retry the brief one tier up `escalation` (haiku, then sonnet, then opus) and log a `review` event with verdict `escalated`, `--escalated-to`, and `--reason`.
