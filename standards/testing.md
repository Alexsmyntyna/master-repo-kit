---
title: Testing
summary: "How flows are verified and when a build counts as releasable."
updated: 2026-10-28
written_by: agent
---

# Testing

Rules for verifying work before it is called done. Format and levels: see [README.md](README.md).

- Keep main releasable: a stable build every week. (public)
- Hand-test the happy path of each flow before calling a project done; an untested flow is what stalls a project. (public)
- Check things off only after a real verification pass, not from memory. (public)
- Before publishing, the owner verifies the changes on every platform the app ships on. (public)
- Sent-off work must be visible or testable by the owner before merge: a PR plus a way to see it. (public)
- Nothing reaches a project's main until the owner merges it; coding agents work in a worktree. (public)
- Manual testing runs against the hosted server; automated tests run locally and never touch it. (public)
- Test the flows where bugs aren't visible on screen: data safety, sync, schema migration, persisted formats, money. (public)
- A change is done at a green build plus green targeted tests for the code touched. (public)
- A browser preview isn't native verification, and a mock isn't a live integration; say which was run. (public)
- State which checks were not run (device, credentials) instead of implying they passed. (public)
- Audit forms and sync paths regularly; losing a submission is a failure. (public)
- Test an external integration in its sandbox first, then production. (public)
- Release builds are cut from a clean tree with the project's own check command. (public)
- Run end-to-end tests where a project already has them. (public)
- On mobile, real-device performance is part of the check, not only the simulator. (public)
- UI changes are not done until their key states have been seen rendered (screenshots reviewed before merge); unit tests alone are not acceptance. (public)
