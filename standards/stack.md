---
title: Stack
summary: "Stack rules that hold in any repo: keys on the server, cheap scripts, no tooling sprawl."
updated: 2026-10-28
written_by: agent
---

# Stack

Rules about tools that hold regardless of which languages or frameworks a repo uses. Preferred stacks sit in `local/standards/stack.md`. Format and levels: see [README.md](README.md).

- Provider keys and model choice stay on the server, never accepted from a client. (public)
- Keep a cheap deterministic script for repetitive work that doesn't need agents. (public)
- Avoid tooling sprawl: no new database, queue, runtime or scraping layer without an ADR. (public)
