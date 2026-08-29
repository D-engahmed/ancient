# CLI V2 — Phase 2: CLI → Target Architecture Map

Maps every as-built CLI capability (audit §2, §3) to its canonical owning layer
from `docs/0X-*/README.md`, with a verdict per row. Gaps reference findings
`F1–F11` in `cli-v2-audit.md`. "CLI-local" means the layer's own experience
responsibility (docs/01 §1.1), not platform logic.

| # | CLI surface (as-built) | Location | Target owner (docs layer) | Verdict |
|---|---|---|---|---|
| 1 | Session list / create / get | api-client.ts:57-61, sessions-dialog | Gateway Session (Layer 2 §C) | ✅ maps — `/sessions` already exists; model session≠execution distinctly |
| 2 | Chat turn submit + stream | use-chat.ts:38-105, DefaultChatTransport → POST /chat/:sessionId | Gateway → **Execution** (Layer 3) + experience adapter intent→canonical request (Layer 1.2) | 🔄 re-map — becomes `create execution + subscribe events` (F1, F2); chat stream stays as the message body renderer |
| 3 | Tool execution (7 FS/shell tools) | local-tools.ts:32-173 (CLI process) vs server tools/base.ts (server) | Capability runtime (Layer 5) — one executor per tool **server-authoritative** | ❌ divergence — (F3) two parallel executors; decided: server-authoritative in Phase 5 |
| 4 | useSkill / task(subagent) / MCP tools | server tools/index.ts + mcp/client | Capability registry + invoke (Layer 5); subagents = strategies leaves | ✅ server-side only — no CLI duplication; keep |
| 5 | Mode (BUILD/PLAN) + model selection | prompt-config, models-dialog | Experience adapter + model policy (Layer 19); mode gates tools | ✅ CLIL-local state + server mode enum; keep |
| 6 | Model routing / cooldown / fallback / quota | server lib/models, rate-limit-breaker, fallback, quota | Model runtime harness (Layer 19) + reliability (Layer 12) | 🔄 relocate — (F7) today it's server/lib; reconcile breaker with `packages/reliability` |
| 7 | Usage dialog | usage-dialog, /usage | Tier/usage events (Layer 7/15) from `usage.recorded` events | 🔄 re-map — read from execution events, not a bespoke endpoint (F1) |
| 8 | Slash-command expansion (server) | server commands/loader, chat.ts:610-617 | Gateway command registry → canonical intent (Layer 1.2) | 🔄 keep server-side; CLI registry (F10) submits intents |
| 9 | Command menu (Ctrl+K) | command-menu/commands.tsx:61 | Experience: command registry (CLI-local) | ✅ extends — (F10) richer registry: groups, status-gated, keybind |
| 10 | Checkpoints / rewind | extensions.ts, checkpoints/store | Execution lifecycle Checkpointed (Layer 3/6) + `checkpoint.created` events | 🔄 re-map — checkpoint must be an execution event with durable store (F8) |
| 11 | Compact | extensions.ts /compact | Context management (Layer 3.3) | ✅ server-only; keep, but emit `context.ready`/degraded signals |
| 12 | Pipeline run (polled) | commands.tsx:29-59, /pipeline | An **execution** (Layer 3); events instead of poll (F2) | 🔄 re-map — pipeline becomes one execution id + event stream |
| 13 | Agent templates / execute / pause / resume / cancel | /agent/* (agent.ts) | strategies `teams`/`arena` leaves (Layer 4) + lifecycle verbs | ⏸ deferred — legacy `@ANCIENT/agent` engine; rename now (F9), wire to strategies later |
| 14 | Interrupt/abort (ESC, Ctrl+C) | session.tsx:131-136, use-chat.stop | Lifecycle cancel/pause verbs (Layer 3.1) | ❌ replace — hard stop today; needs P/R/I semantics (F5) |
| 15 | Copy output / re-send | session.tsx:147-179 (Ctrl+Shift+Y/R) | Experience local UX | ✅ keep; re-resident as commands (F10) |
| 16 | Learning store / latency p95 | lib/experience, session.tsx:192-229 | CLI-local metric; server must record its own timing (F11, R9) | 🏠 CLI-local + add server-side timing events in Phase 14 |
| 17 | Error display (regex code sniffing) | session.tsx:39-42, api-client.ts:34-45 | Gateway Error Mapper → `ErrorEnvelope` client-safe (Layer 20/2 §F) | ❌ replace — (F6) typed envelope; no invented copy |
| 18 | Auth (OAuth callback, Bearer) | lib/oauth, lib/auth | Gateway Identity (Layer 2 §B) | ✅ keep; ensure `AUTH_*` envelopes cross the wire |
| 19 | Theme / layout (OpenTUI) | layouts, theme provider | Pure rendering (Layer 1.1) | ✅ keep — no platform logic |
| 20 | Keyboard-layer responder chain | Keyboard-layer/index.tsx | Experience input capture (Layer 1.1) | ✅ keep — sound model |

## Verdict summary

- **Maps cleanly (✅)**: sessions, server-side tools, mode/model, auth, theme,
  keyboard layers, compact, extensions. These stay as-is.
- **Re-map onto executions/events (🔄)**: submission, usage, checkpoints,
  pipeline, model routing signals. These are where V2 changes the wire (F1/F2).
- **Missing in target (❌)**: server-authoritative tool execution (F3),
  lifecycle verbs pause/resume/cancel (F5), typed errors (F6).
- **Deferred/future (⏸)**: `/agent` team engine → strategies `teams`/`arena`
  leaves; only the rename happens now (F9).
- **CLI-local (🏠)**: rendering, navigation, prompt-config, learning metrics.

## Boundary rule (from docs/01, docs/02, docs/17)

The CLI may render, capture input, map intents, and consume events. It must not:
route models, select strategies, run execution state machines, execute tools
(after Phase 5), or own durable business logic. Every CLI feature survives the
"TUI replaced by web UI" test iff its logic lives server-side (execution,
events, capabilities) and the CLI only translates ExperienceRequest →
canonical wire (docs/01 §1.2).