# ANCIENT 2.0 — Gap Analysis & Parity Roadmap

This document maps ANCIENT against Claude Code's feature set, records what
shipped in the 2.0 upgrade, and lays out the remaining phases.

## 1. Where ANCIENT started (v1.x audit)

| Area | v1.x state |
|---|---|
| Agent loop | Working `streamText` loop with 7 tools, dedupe, governor, token budgets |
| Modes | PLAN (read-only) + BUILD — parity already |
| Persistence | Postgres via Prisma; sessions/messages with full tool-call parts |
| Providers | 7 hosted + BYOK (OpenRouter, Ollama, LM Studio, vLLM, custom) |
| Safety | fs-safety, dangerous-commands, safe-url, BYOK rate limits |
| Skills / subagents / hooks / MCP / memory / checkpoints | **Missing entirely** |
| Cost control | None — every turn hit the selected model at full price |

## 2. Shipped in 2.0 (this upgrade)

| Feature | Claude Code equivalent | Implementation |
|---|---|---|
| Skills | `~/.claude/skills/*/SKILL.md` | `.ancient/skills/` + `~/.ancient/skills/`, frontmatter metadata, **progressive disclosure** (name+description in prompt; body loads via `useSkill` tool) — see `docs/SKILLS.md` |
| Subagents | `.claude/agents/*.md` + Task tool | `.ancient/agents/` + built-ins (`explore`, `review`, `test`), isolated context, tool allow-lists, per-agent model routing — `docs/SUBAGENTS.md` |
| Slash commands | `.claude/commands/*.md` | `.ancient/commands/` + built-ins (`/review`, `/fix`, `/test`, `/explain`, `/commit`), `$ARGUMENTS`, expanded server-side — `docs/SLASH-COMMANDS.md` |
| Hooks | `settings.json` hooks | `SessionStart`, `UserPromptSubmit`, `PreToolUse` (can block), `PostToolUse` (inject context) — `docs/HOOKS.md` |
| MCP | `.mcp.json` | Project `.mcp.json` + `~/.ancient/.mcp.json`, stdio + HTTP transports, tools as `mcp__<server>__<tool>` — `docs/MCP.md` |
| Memory | `CLAUDE.md` | `ANCIENT.md` auto-loaded (project → ancestors → user), `@import` support, token-budgeted — `docs/MEMORY.md` |
| Checkpoints / rewind | Esc-Esc rewind | Shadow-git snapshot before every BUILD turn, `/rewind` restores files + trims history — `docs/CHECKPOINTS.md` |
| Compaction | `/compact` | `/compact` summarizes history into a context-summary message; earlier messages stop consuming tokens — `docs/SLASH-COMMANDS.md` |
| Smart model routing | n/a (Claude Code is single-vendor) | `free-first` strategy: simple turns route to a free/local model, complex turns keep the premium pick; subagents can pin `model: cheap` — `docs/MODEL-ROUTING.md` |

## 3. Token-efficiency design (a 2.0 theme)

- **Progressive disclosure for skills** — a 50-skill library costs ~1,500 standing tokens instead of ~50,000.
- **Subagent isolation** — a 30-step exploration costs the main thread one report, not 30 tool exchanges.
- **Compaction** — long sessions collapse to a dense summary.
- **Free-first routing** — simple prompts never touch a paid API.
- **Budgeted blocks** — memory capped at 16 KB, skill bodies at 20 KB, MCP results at 10 KB.

## 4. Remaining gap → next phases

### Phase 3 — depth & polish
- [ ] Web tools: `webSearch`, `webFetch` (with safe-url integration)
- [ ] Background tasks: run subagents/tests asynchronously, notify on completion
- [ ] Todo-list tool with UI rendering (`todoWrite`)
- [ ] Permission modes (ask / accept-edits / auto) with per-tool rules in settings
- [ ] Mid-stream free→premium escalation on provider errors
- [ ] Session forking (`/fork`), `/export` to markdown
- [ ] Image/paste input (multimodal messages)

### Phase 4 — ecosystem & headless
- [ ] Headless/SDK mode: `ancient -p "task"` for CI, `--output-format json`
- [ ] GitHub Action + GitLab CI templates
- [ ] Plugin marketplaces: `ancient plugin add <git-url>` installing skills/agents/commands/hooks bundles
- [ ] IDE integration (VS Code extension speaking to the same server)
- [ ] Worktree isolation for parallel agent runs

### Phase 5 — SaaS layer (see `docs/BUSINESS.md`)
- [ ] Managed sync: sessions/skills/settings across devices
- [ ] Team workspaces: shared skills/agents/memory, audit log
- [ ] Usage dashboards, org-level model policies
- [ ] SSO/SAML, seat management, billing

## 5. Non-goals (deliberate)

- **No per-seat hosted lock-in for the OSS tier** — the local agent must always be fully functional offline/BYOK.
- **No unbounded tool results** — every tool output is capped; context is the scarcest resource.
- **No DB migrations for user extensions** — skills/agents/commands/settings live on the filesystem where users can git-version them.
