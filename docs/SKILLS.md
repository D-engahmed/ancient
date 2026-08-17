# Skills

Skills are reusable instruction packages — the unit of ANCIENT's extension
ecosystem. They teach the agent *how* to do a class of task (code review,
writing tests, security audits) without burning tokens on every session.

## How they work: progressive disclosure

A skill is a folder with a `SKILL.md`. Only the **name and description** are
injected into the system prompt — one line per skill. When the model decides a
task matches, it calls the `useSkill` tool and the full instructions load into
context. Skills that are never relevant cost almost nothing.

```
1. Prompt contains:  "code-review — Rigorous review of changes…"   (~20 tokens)
2. User: "review my changes"
3. Model calls useSkill({ name: "code-review" })
4. Full checklist loads; the review follows it
```

## Anatomy

```
.ancient/skills/code-review/
├── SKILL.md          # required
└── checklist.md      # optional bundled resources (read via readFile)
```

```markdown
---
name: code-review                      # defaults to the folder name
description: Rigorous code review…     # the trigger — write it for the model
allowed-tools: readFile, grep, bash    # optional advisory allow-list
---

# Code Review
1. Correctness — …
```

### Frontmatter fields

| Field | Required | Meaning |
|---|---|---|
| `name` | no (folder name) | Unique identifier; project skills shadow global ones |
| `description` | strongly recommended | What it does + **when to use it** — this is what the model matches on |
| `allowed-tools` | no | Advisory list of tools the skill expects; documents intent |

## Locations & precedence

| Location | Scope |
|---|---|
| `~/.ancient/skills/` | All your projects |
| `<project>/.ancient/skills/` | This project only — **shadows global skills of the same name** |

Same-name shadowing lets a project customize a global skill without forking it.

## Budgets

- Skill index line: description truncated at 300 chars
- Skill body: capped at 20,000 chars when loaded
- Bundled resources: listed (max 50), read on demand — never auto-loaded

## Writing good skills

1. **The description is a trigger, not marketing.** "Use when the user asks to review code, before committing, or after large edits" beats "An amazing review skill."
2. **Put procedure in the body, in order.** Numbered checklists work well.
3. **Define the output format.** Skills that specify a report shape get consistent results.
4. **Keep it under ~500 lines.** If it's bigger, split reference material into bundled files and point at them.
5. **Bundle scripts for anything fiddly.** A `run.sh` in the skill folder beats five paragraphs of shell instructions.

## Managing skills

- `/skills` in the CLI lists everything the server sees, with source badges.
- Server endpoint: `GET /extensions/skills?cwd=...`, `GET /extensions/skills/:name`.
- Starter pack: `examples/skills/` (code-review, test-writer, commit, refactor, security-audit, doc-writer). Copy any of them to `~/.ancient/skills/`.
