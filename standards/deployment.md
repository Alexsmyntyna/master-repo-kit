---
title: Deployment
summary: "How things ship and who decides: go-aheads, store builds, cost review."
updated: 2026-10-28
written_by: agent
---

# Deployment

Rules for shipping. Where things are hosted is a stack choice and sits in `local/standards/`. Format and levels: see [README.md](README.md).

- Pushing the deploy branch autodeploys where hosting is wired, so a push needs the owner's go-ahead. (public)
- Agents don't deploy, publish, spend or contact anyone without the owner's go-ahead. (public)
- iOS apps ship through the App Store, with TestFlight builds first for ones still in testing (iOS projects only). (public)
- A deployment that earns nothing is a cost to review: every project records its hosting, database and monthly cost. (public)
- Contact and lead forms never drop a lead. (public)
- Docs and examples carry placeholders, never real connection strings or keys. (public)
