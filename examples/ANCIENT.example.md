# Project Memory Example
# Copy to ANCIENT.md in your project root. It loads into every session automatically.

## Commands
- Install: `bun install` (never npm/yarn)
- Dev server: `bun run dev:server`
- CLI: `bun run dev:cli`
- DB migrate: `bun run --cwd packages/database db:migrate`

## Conventions
- TypeScript strict; no `any` without a comment explaining why
- Tool results must be capped — never return unbounded file/log content to the model
- New agent-facing config goes in `.ancient/` — not the database

## Constraints
- The server must stay self-hostable: no hard dependency on any single hosted provider
- Keep the standing system prompt lean; anything big loads on demand (progressive disclosure)
