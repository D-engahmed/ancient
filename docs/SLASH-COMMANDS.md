# Slash Commands & Compaction

Two kinds of slash commands exist in ANCIENT:

| Kind | Where handled | Examples |
|---|---|---|
| **Prompt commands** | Server — markdown templates expanded into the prompt | `/review`, `/fix`, your own |
| **UI commands** | CLI command palette | `/models`, `/compact`, `/rewind`, `/skills` |

Typing a UI command into the chat input returns a helpful error pointing you
to the palette (Ctrl+K / typing `/`).

## Prompt commands

Markdown files in `.ancient/commands/` (project) or `~/.ancient/commands/` (user).
The body is a prompt template; `$ARGUMENTS` is replaced with whatever followed
the command.

```markdown
---
name: fix-issue
description: Fix a GitHub issue by number
---

Work on issue: $ARGUMENTS
1. Fetch the issue (gh CLI or MCP)…
```

Typing `/fix-issue 142` sends the expanded template as your message. The
invocation line (`[/fix-issue 142]`) is preserved at the top so history shows
what you ran.

### Built-ins

| Command | Expands to |
|---|---|
| `/review [target]` | Severity-ranked review of files or `git diff` |
| `/fix <symptom>` | Evidence-first diagnose-then-fix flow |
| `/test <target>` | Convention-matching test writing + run |
| `/explain <thing>` | Newcomer-oriented walkthrough |
| `/commit [notes]` | Conventional-commit flow (never pushes) |

Project commands shadow globals shadow built-ins. `/prompts` in the CLI lists
them; `GET /extensions/commands?cwd=...` for the API.

## /compact — context compaction

Long sessions hit context limits and cost more every turn. `/compact`:

1. Builds a transcript of the session (capped at 40 KB).
2. Summarizes it with the **free model when configured**, else the session's model.
3. Stores the summary as a context-summary message.

From then on, history sent to the model is **the summary plus everything
after it** — earlier messages stay in the database (nothing is deleted) but
stop consuming tokens.

Run it from the palette (`/compact`) inside a session. API:
`POST /extensions/compact/:sessionId`.

## /rewind

Restores files **and** conversation to a checkpoint. See `docs/CHECKPOINTS.md`.
