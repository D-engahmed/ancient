# ANCIENT
=======
# ancient
 main

**An AI coding agent, built to replace a subscription instead of paying for one.**

## The problem

Every seat of a hosted AI coding assistant is a recurring cost. Most of them are the same idea underneath: an LLM, a loop, and a handful of tools to read, write, and run code. That's a buildable thing, not just a buyable one.

## The origin

This started as **HaMan**, built while I was on the team at MedixAI, to cut the cost of paying per-seat for AI coding tools. It grew into a real agent runtime — not a wrapper: an agentic loop, eleven built-in tools, MCP support, subagents, hooks, safety approval policies, session persistence. It ran on a free open-weights model (`mistralai/devstral-2512:free` via OpenRouter) instead of a paid API, so the running cost was close to zero.

`ANCIENT` is that same project, rebuilt as my own — the terminal UI rewritten in Bun/TypeScript/React, with the agent core that made HaMan actually work being merged in around it.
=======
`ancient` is that same project, rebuilt as my own — the terminal UI rewritten in Bun/TypeScript/React, with the agent core that made HaMan actually work being merged in around it.
 main

## Status

Honest snapshot, not a feature-complete pitch:

| Piece | Status |
|---|---|
| Terminal UI (Bun, TypeScript, React, OpenTUI) — screens, routing, theming | **Live** |
| Agentic loop + LLM client | Merging in from HaMan |
| Built-in tools (file read/write/edit, shell, grep, glob, web search/fetch, todo, memory) | Merging in from HaMan |
| MCP integration (stdio + HTTP/SSE) | Merging in from HaMan |
| Subagents (codebase investigator, code reviewer) | Merging in from HaMan |
| Context compaction + loop detection | Merging in from HaMan |
| Safety approval policies + dangerous-command detection | Merging in from HaMan |
| Session save/resume/checkpoint | Merging in from HaMan |
| Hooks (before/after agent, before/after tool, on error) | Merging in from HaMan |

## Architecture (target)

```
packages/cli/          # terminal UI — screens, layouts, components, providers
packages/agent/         # agent loop, LLM client, context management (in progress)
  tools/                 # built-in tools + MCP client + subagents
  safety/                 # approval policies, dangerous-command detection
  hooks/                   # lifecycle hooks
```

## Why it matters

The pitch isn't "another AI coding agent" — it's a working answer to "why am I paying per seat for something a small, well-scoped codebase can do on a free model." That's what made HaMan worth building the first time, and it's what `ANCIENT` is built to carry forward as its own thing.
=======
The pitch isn't "another AI coding agent" — it's a working answer to "why am I paying per seat for something a small, well-scoped codebase can do on a free model." That's what made HaMan worth building the first time, and it's what `ancient` is built to carry forward as its own thing.
 main

## About the creator

Built by **Ahmed** — final-year Electronics & Communications Engineering student at Helwan University, with several years of production ML and backend experience across Python, PyTorch, FastAPI, and RAG pipelines. Founder of **NXG AI Solutions**, and a contract contributor to **BiMediX2** at MBZUAI (UAE).

- GitHub: [github.com/D-engahmed](https://github.com/D-engahmed)
- Hugging Face: [D-engahmed](https://huggingface.co/D-engahmed)

---

*Actively being merged from HaMan into a standalone project — the status table above will move to "Live" line by line rather than all at once.*
=======
*Actively being merged from HaMan into a standalone project — the status table above will move to "Live" line by line rather than all at once.*
main
