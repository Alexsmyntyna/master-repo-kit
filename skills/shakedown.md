---
name: shakedown
title: Shakedown
scope: any
status: ready
params: []
kind: session
when: "Trying out and refining Master-Repo itself during its first sessions."
---

This is one of the first sessions in Master-Repo. The goal is to use the system for real and fix whatever doesn't work, not to finish every project.

1. **Orient.** Read `AGENTS.md` and do what it says. Then give the owner a short walkthrough of how the repo is laid out and how a session flows. Keep it to what they need to steer. Ask if anything about the setup feels wrong before going on.

2. **Pilot one project end to end.** Pick up `queue/2026-09-25-migrate-pilots.md`. Ask the owner which project to start with (`local/owner.md` may suggest one). For that project:
   - Run `skills/migrate-legacy.md`.
   - Show the owner what the filled `company.json` says and what's still empty.
   - Move into `skills/company-ceo.md` and work through the open questions with them, one at a time.
   - Check the code where it settles a question (`skills/investigate-repo.md`).

3. **Refine as you go.** Keep a running list of friction:
   - template fields that are missing, useless, or badly shaped;
   - prompts that were unclear or wrong;
   - rules in `AGENTS.md` that got in the way;
   - things you wished existed.

   Fix small things right away. For anything structural (renaming shared fields, new top-level folders), ask the owner first.

4. **Wrap up.** Write `holding/reviews/YYYY-MM-DD-shakedown.md` with:
   - what worked;
   - what changed in the system;
   - what's still awkward;
   - what the frontend will need to show, based on how the data actually came out.

   Update the queue item's status. Summarize changed files and ask the owner whether to commit and push.
