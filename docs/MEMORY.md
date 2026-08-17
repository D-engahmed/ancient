# Memory — ANCIENT.md

Memory files are standing instructions the agent reads every session:
project conventions, build commands, architectural constraints, your personal
preferences. The CLAUDE.md equivalent, named `ANCIENT.md`.

## Discovery order

For a session with working directory `<cwd>`:

1. `~/.ancient/ANCIENT.md` — your **user memory** (all projects)
2. `ANCIENT.md` in each **ancestor** directory (monorepo-root conventions)
3. `<cwd>/ANCIENT.md` — **project memory** (highest precedence, listed last)

All found files are included; they're labeled by scope in the prompt.

## What to put in project memory

```markdown
## Commands
- Test: `bun test`      (never jest directly)
- DB: `bun run db:migrate`

## Conventions
- TypeScript strict; no `any` without a comment
- API routes validate input with zod

## Constraints
- The server must stay self-hostable
```

Good memory is **short, imperative, and checkable**. If a rule can't be
verified in code or a command, it probably belongs in docs instead.

## Imports

A line containing only `@path/to/file.md` (relative to the memory file)
inlines that file — one level deep:

```markdown
Always use bun.
@docs/team-conventions.md
```

## Budgets (memory must stay cheap)

| Cap | Value |
|---|---|
| Per file | 6,000 chars |
| Total across files | 16,000 chars (least-specific files dropped first) |
| Import depth | 1 level |

## Interaction with skills

Memory is *always on*; skills load *on demand*. Put universal rules in memory,
procedural how-to in skills. A project memory line like
"review every PR with the code-review skill" combines both.
