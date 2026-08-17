# Subagents

Subagents are specialized agents the main agent delegates to via the `task`
tool. Each runs in its **own isolated context window** — its 30 tool calls of
searching never enter your main conversation, which is the single biggest
token saver in agentic coding. Only its final report comes back.

## Built-in agents

| Agent | Purpose | Tools | Model |
|---|---|---|---|
| `explore` | Read-only codebase investigation ("where is X, how does Y work") | readFile, listDirectory, glob, grep | **cheap** (free/local when configured) |
| `review` | Senior code review of changes, severity-ranked findings | read-only + bash | inherit |
| `test` | Write/run tests, summarize failures | all | inherit |

## Defining your own

Markdown files in `.ancient/agents/` (project) or `~/.ancient/agents/` (user):

```markdown
---
name: debugger
description: Root-cause investigator. Give it the error + symptoms.
tools: readFile, listDirectory, glob, grep, bash   # omit = all tools in mode
model: cheap                                        # cheap | inherit
---

You are a debugging specialist. Given an error report…
```

### Frontmatter fields

| Field | Meaning |
|---|---|
| `name` | Defaults to filename. Project agents shadow global/built-ins. |
| `description` | Shown to the main agent — it's how delegation decisions are made. Include *when* to use it. |
| `tools` | Allow-list. Omit for all tools available in the current mode. PLAN mode still strips write tools no matter what. |
| `model` | `inherit` (session's model) or `cheap` (the configured free/local model — see `docs/MODEL-ROUTING.md`). |

## How delegation works

```
main agent ──task({ agent: "explore", prompt: "…" })──▶ subagent
                                                          │ own system prompt
                                                          │ own message history
                                                          │ restricted tool set
                                                          │ max 30 steps
main agent ◀────────────── final report ◀─────────────────┘
```

Rules the main agent is told:

- The brief must be **complete and self-contained** — the subagent cannot see
  the conversation.
- Reports are capped at 12,000 chars.
- Subagent failures return as tool errors, never crash the turn.

## When to delegate (guidance baked into the system prompt)

- Broad exploration needing > ~5 search/read calls → `explore`
- Post-implementation sanity check → `review`
- Test generation / suite runs → `test`

## Managing

- `/subagents` in the CLI lists agents with source badges.
- `GET /extensions/agents?cwd=...`
- Examples: `examples/agents/debugger.md`, `examples/agents/planner.md`.
