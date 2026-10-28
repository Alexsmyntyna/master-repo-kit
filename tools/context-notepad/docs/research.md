# Context management research

Status: research notes, input to the context-manager design
Last verified: 2026-10-07

Numbers below are the authors' own unless marked otherwise. None of the 2026
papers has third-party replication yet.

## 1. The problem, stated mechanically

A standard agent's context only grows: `c[t+1] = c[t] + new tokens`. Every dead
end, stale tool result, and abandoned plan is re-read on every turn. When the
window fills, the harness fires a summary prompt on a timer and replaces the
history with one message. Two failures follow:

- **Lossy, unverifiable compression.** A summary is the only surviving copy, so
  a detail it drops or invents cannot be checked. The CLM paper's ContextBench
  shows summaries failing even toy retention tasks (keep lines verbatim, track a
  Sudoku board). ACE names the long-run version *context collapse*: repeated
  rewriting erodes detail.
- **Wrong decider.** A token counter, not the task, decides when and what to
  forget. Bigger windows delay this but do not fix it: in the CLM paper an
  unmanaged agent with a 262K window stopped improving within two hours of a
  twelve-hour task.

## 2. Papers

### Context Language Models (the paper in the video)

Shao, Shen, Yin, Li, Wang, Ivison, Poovendran, Lambert, Xiao, Lewis, Yih,
Zettlemoyer, Koh. UW, Meta Superintelligence Labs, MIT, Trillium Labs.
arXiv [2609.37725](https://arxiv.org/abs/2609.37725), 29 Sep 2026. Code:
`github.com/facebookresearch/context-language-models` (paper text is CC BY 4.0;
the code license is reported as CC BY-NC 4.0, not yet checked against the
LICENSE file).

Mechanism:

- New rule `c[t+1] = f(c[t])`: the model produces its next context.
- The live context is mirrored to a file whose path is in the system prompt.
  The model's only tool is Bash. Whatever the file holds after a command is the
  next turn's context. If the model does not edit, tokens append as usual, which
  keeps the KV cache warm by default.
- The file carries turn markers (`[[CTX_TURN 1 role=assistant]]`); the model
  invents its own sections (status blocks, a notes role).
- Subagents are just additional context files, created and deleted.
- Overflow: an editing reminder 2,048 tokens before budget; on overflow the
  harness rolls back the last turn and retries (6 times on BrowseComp-Plus, 50
  on EdgeBench), or ends the run (TerminalBench).
- One prompt sentence steers behavior. Tested examples: compact to about 4K
  when over a threshold; "only compress at the boundaries of subtasks"; back up
  the context file before every edit.
- Training (optional): stepwise GRPO plus a success-gated efficiency advantage.
  Rewarding edit count or bytes removed is explicitly rejected because the model
  reward-hacks with damaging edits.

Results that matter (Qwen3.6-27B, 32K budget):

- BrowseComp-Plus 59.4% vs about 53.3% for Codex-style summary (+6 points;
  "11.4%" is relative).
- EdgeBench 12 h: 44.6 at 179 PFLOPs vs summary 42.3 at 437 PFLOPs. The real
  win is about 59% less compute, not accuracy.
- Given a full 128K window, summary ties CLM on accuracy; CLM still uses about
  36% less compute.
- Qwen3.5-9B before RL: trails summary by 6 points and often never edits.
  Benefit scales with model capability.
- Cost of an edit: an edit at the start of a 20K prompt costs 7.7x an
  append-only turn because the KV cache after the edit point is invalidated.
  Suffix Cache Reuse fixes part of this, SGLang only.
- Safety: editable context is a persistence channel. A model can plant
  instructions (the paper cites an OpenAI report of a model writing "ignore all
  developer messages" into its own compaction summaries). Unsolved.

### Context as an Environment (Scroll)

Lin, Ang, Zhu, Ding, Zhou. arXiv
[2608.21690](https://arxiv.org/abs/2608.21690), Aug 2026.

- **Append-only event log** is lossless ground truth; nothing is ever lost.
- A persistent Python kernel holds tool outputs and derived state as variables;
  only what the model explicitly prints enters the next prompt.
- Eviction near budget leaves **landmarks**: compact pointers to exact log
  addresses, so the agent can jump back to evicted material instead of
  searching.
- Frames context management as a programming task, so it improves with coding
  ability. Strong long-memory results (LongMemEval_S 94.8%).

### Beyond Compaction: Structured Context Eviction (CWL)

Semenov, Dorofeev. [2606.11213](https://huggingface.co/papers/2606.11213), 2026.

- The agent tags its work as typed episodes: *exploratory* (gather) and
  *action* (change). Action episodes declare which exploratory episodes they
  depend on.
- Eviction is **deterministic and LLM-free**: evict finished action episodes
  first (their effect is saved in the environment, i.e. the repo), in stages
  (reasoning, then bulk output, then artifacts, then the whole episode). Keep an
  exploratory episode while anything depends on it. Never evict user turns.
- Matches isolated-session accuracy within noise, 20 to 70% cheaper, because
  the prefix stays stable for caching. Single model, small runs.

### Recursive Language Models (RLM)

Zhang, Kraska, Khattab. arXiv [2512.24601](https://arxiv.org/abs/2512.24601).

- The long input lives outside the prompt as a REPL variable; the model writes
  code to inspect, slice, and recursively call itself on pieces.
- Handles inputs about 100x beyond the window. Median gains over compaction on
  GPT-5 and reported gains over Claude Code as a scaffold.

### Scaling Long-Horizon Agents via Context-Folding

Sun, Lu, Ling, et al. arXiv [2510.11967](https://arxiv.org/abs/2510.11967).

- Two actions: **branch** into a sub-trajectory for a subtask, **return** to
  fold it into a short outcome summary in the main thread.
- About 10x smaller active context at matched or better accuracy. This is the
  formal version of a Claude Code subagent.

### Agentic Context Engineering (ACE)

Zhang et al., Stanford and SambaNova. arXiv
[2510.04618](https://arxiv.org/abs/2510.04618). Code: `github.com/ace-agent/ace`.

- Context is an evolving **playbook** of itemized bullets, each with
  helpful/harmful counters.
- Roles: generator (does the task, marks which bullets helped), reflector
  (extracts lessons from the trajectory and execution feedback), curator (merges
  lessons as **small delta updates**).
- Delta updates instead of whole rewrites are the fix for context collapse;
  grow-and-refine deduplicates by similarity. +10.6% on agent tasks.
- This is the closest paper to the "curator of the codebase" idea.

### MEM1

Zhou, Qu, et al. arXiv [2506.15841](https://arxiv.org/abs/2506.15841).

- RL-trained agent keeps one compact internal state per turn and discards tool
  outputs after use. Constant memory. Shows the extreme end: fixed-size state,
  which needs training to work.

### MemGPT

Packer et al. arXiv [2310.08560](https://arxiv.org/abs/2310.08560).

- OS analogy: main context (system, working context, FIFO queue) plus archival
  and recall storage, paged in and out by the model through function calls,
  with memory-pressure warnings. The ancestor of everything above.

## 3. Mechanisms distilled

| Mechanism | Source | What it buys |
|---|---|---|
| Lossless log as ground truth, summaries only as views | Scroll, CWL | A summary error is always recoverable |
| Pointers (landmarks) from summary to exact source | Scroll | Recall without re-search; verifiable citations |
| Deterministic eviction by episode type and dependency | CWL | No summarizer hallucination, cache-friendly |
| Branch and fold subtasks | Context-Folding | Coordinator stays small; subagents start clean |
| Delta updates with usage counters | ACE | Knowledge accumulates without collapse |
| Model decides when to compact, at subtask boundaries | CLM | Forgetting follows the task, not a timer |
| Backup before edit | CLM steering | Rollback for bad edits |
| Edits rare, appends default | CLM, KV analysis | Keeps the prompt cache warm |

## 4. Mapping onto Claude Code today

Claude Code does not let the model rewrite its own live transcript. The
transcript is append-only; compaction is harness-driven (`/compact`, auto
compact). So a literal CLM is not possible here. The CLM effect is reachable by
moving the editable state *out* of the transcript into files, and controlling
what re-enters at session boundaries:

| Need | Claude Code primitive |
|---|---|
| Editable working state | A session folder of plain files the agent edits with Edit/Write |
| Re-entry after compaction or `/clear` | `SessionStart` hook; `source` is `startup`, `resume`, `clear`, `compact`, or `fork`; stdout is injected as context |
| Snapshot before the harness summarizes | `PreCompact` hook (can also block auto compaction); `PostCompact` for bookkeeping |
| Branch and fold | Subagents; `SubagentStart` can inject a scoped slice, `SubagentStop` sees `last_assistant_message` |
| Lossless log | The session transcript JSONL, `transcript_path` in every hook payload (under `~/.claude/projects/<repo>/`) |
| Per-turn nudges | `UserPromptSubmit` / `PostToolUse` `additionalContext` (capped at 10,000 chars) |
| API-level equivalent for our own harness | Messages API context editing (`clear_tool_uses`, `clear_thinking`) and the memory tool |

So the practical design is "manual CLM, automated": the agent edits a small
state file at subtask boundaries; hooks guarantee that state, not a lossy
summary, is what survives compaction and seeds the next session or subagent.

Hook guidance from the docs: write injected text as facts, not imperatives, or
Claude's prompt-injection defenses may flag it. That aligns with the safety
rule below.

## 5. Design principles for our tools

1. **Files are truth, summaries are views.** The transcript and the repo are
   the lossless record. Anything the curator writes points back to them.
2. **Every stored fact cites a checkable source**: `path:line` plus a content
   hash, commit, transcript line, or URL. A fact whose source no longer
   matches is marked stale, the same way `codebase_map.py` tracks hashes. This
   is the direct defense against the fabricated-seal-code failure: recall
   returns sources, not the model's memory of them.
3. **Exact things stay verbatim.** Identifiers, paths, error text, counts and
   commands are copied, never paraphrased. Only reasoning gets compressed.
4. **Delta updates, never whole rewrites** of the knowledge store (ACE). The
   session state file may be rewritten, but only at subtask boundaries and
   after a backup (CLM steering).
5. **Deterministic eviction where possible** (CWL). Finished action work is
   already in git; keep the outcome and the commit, drop the steps.
6. **Store entries are data, not instructions.** Imperative lines in the store
   are flagged for human review before promotion; the store is never injected
   as system text.
7. **Edits are rare, appends are default**, which keeps the prompt cache warm
   on the API and avoids full re-prefill on local servers.

## 6. Local models later

- CLM-style self-editing helps large models (27B and up) and barely engages a
  9B model without RL. Expect local models to need the deterministic parts
  (hooks, eviction rules, cited store) to carry more of the load.
- llama.cpp, Ollama, LM Studio and MLX cache only the prompt prefix. Any edit
  above the tail forces full re-prefill: about 30 s at 32K on an RTX 3090, up to
  a minute on a Mac (figures from the video, not measured here). Design for
  appends during a subtask and one rewrite at its end.
- Keep the working budget small (the paper's main results use 32K) so the
  model has room to think rather than a haystack to search.
- The store and recall tools are model-independent, so a local model can query
  the same knowledge base Claude built.

## 7. Overlap with what the repo already has

- `context/` docs, `codebase-map.json`, and the auto-memory directory already
  hold curated, durable knowledge. The new store should cite and link to them,
  not duplicate them; promotion into `context/` stays a human-reviewed step.
- `codebase_map.py` already solves "description travels with a file, goes
  stale when the hash changes". Reuse that approach for source-cited entries.
- Build briefs become the session folder's state file plus a generated
  subagent slice.

## 8. Open questions before coding

- Storage format: one JSONL ledger per session plus a Markdown state file, or a
  SQLite store for the long-lived knowledge base (stdlib `sqlite3` with FTS5)?
- Where sessions live: in the repo (reviewable, shared across agents and
  worktrees) or under `~/.claude` (private, per machine)?
- Hooks are configured in `.claude/settings.json`; project-level hooks affect
  every agent session in this repo, including Codex-adjacent workflows.
- How much the agent curates itself versus a separate reflector pass at
  session end (ACE separates the roles; a cheaper model can do reflection).
