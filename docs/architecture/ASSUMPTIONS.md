# Assumption Register

**Living document.** Every architectural assumption is recorded with evidence, failure mode,
blast radius, alternatives, decision, and test. Started with the **Execution model** audit
(per [`ARCHITECTURE.md`](../ARCHITECTURE.md) §6, this is audit order item #2 — the most
fundamental).

Each entry follows the same shape so entries are comparable:

```text
ASSUMPTION    — What are we assuming?
EVIDENCE      — Why do we believe this?
FAILURE MODE  — What happens if it is wrong?
BLAST RADIUS  — How much of the system breaks?
ALTERNATIVES  — What other designs exist?
DECISION      — Keep / Change / Delete / Defer
TEST          — How do we prove the decision?
```

**Legend:** a row is `in force` (current default), `decided` (reviewed, direction set), or
`open` (awaiting review).

---

## A-EXEC-001 — Execution is multi-agent coordination

| Field | Value |
|-------|-------|
| **ASSUMPTION** | `ExecutionEngine` must construct `ArenaCoordinator` + `AgentExecutor` + `BackendRouter` + `MessageBus`; therefore *execution = multi-agent coordination*. |
| **EVIDENCE** | `packages/agent/src/runtime/engine.ts:28-33` constructs all four collaborators in its constructor; the only wired public path is `execute(team, task)` → `ArenaCoordinator`. |
| **FAILURE MODE** | Every task type forces the arena machinery even when a single direct call would do — higher cost, latency, and coordination surface with no benefit. |
| **BLAST RADIUS** | Core — the execution engine API and every caller (`routes/agent.ts`). |
| **ALTERNATIVES** | Make execution more fundamental than agents: an `Execution Runtime` → `Execution Strategy` split, where `Direct` / `Agent Loop` / `Subagents` / `Team / Arena` are leaves. |
| **DECISION** | **Change** — introduce a strategy selector; arena becomes one strategy. |
| **TEST** | Benchmark `Direct` vs `Agent Loop` vs `Arena` on identical task classes (produce `Direct` path first). |

**Status:** decided → partial implementation in progress (this is the target architecture).

---

## A-EXEC-002 — More agents means more power

| Field | Value |
|-------|-------|
| **ASSUMPTION** | Orchestrating more agents than minimally required improves output quality. |
| **EVIDENCE** | README centers the product on teams + protocols; no benchmark shows the marginal benefit. |
| **FAILURE MODE** | Added cost, latency, context, failure points, coordination errors, duplicate work. |
| **BLAST RADIUS** | Product positioning, cost, latency budgets. |
| **ALTERNATIVES** | **Complexity must be earned**: strategy selector picks the cheapest reliable architecture. |
| **DECISION** | **Change** — implement the strategy ladder (§5 of ARCHITECTURE.md), selector-driven, not UI-driven. |
| **TEST** | Cost + latency + pass-rate comparison table across the ladder. |

**Status:** decided → pending a strategy selector.

---

## A-EXEC-003 — State management exists because `StateManager` exists

| Field | Value |
|-------|-------|
| **ASSUMPTION** | We have a working state system because `StateManager` and checkpointing exist. |
| **EVIDENCE** | `packages/agent/src/runtime/state.ts:11-12` — two in-memory `Map`s. `routes/agent.ts:10-24` documents: no restart survival, no multi-instance, no DB persistence. |
| **FAILURE MODE** | Server restart or crash loses all live executions; no durable history; cannot scale horizontally. |
| **BLAST RADIUS** | Every execution lifecycle feature: pause/resume/cancel/status, run history, audit. |
| **ALTERNATIVES** | New model: *hot runtime state → checkpoint policy → durable execution store*, with a durable lifecycle event stream (created / started / plan-updated / tool-executed / artifact-created / checkpoint-saved / paused / resumed / completed / failed). |
| **DECISION** | **Change** — design the durable execution store + lifecycle event stream. |
| **TEST** | Kill/restart a server mid-execution and confirm pause/resume/history survive. |

**Status:** open (design phase) — see [`docs/architecture/EXECUTION-STATE.md`](EXECUTION-STATE.md).

---

## A-EXEC-004 — The server can hold all AI capabilities

| Field | Value |
|-------|-------|
| **ASSUMPTION** | Keeping all AI behavior in the server is sustainable. |
| **EVIDENCE** | `routes/chat.ts` ≈ 30KB / ~712 lines; server hosts `agents/`, `checkpoints/`, `commands/`, `hooks/`, `mcp/`, `memory/`, `skills/`, `tools/`; `BackendRouter` explicitly does not execute tools. |
| **FAILURE MODE** | The server becomes the "AI brain" — monolith, hard to test, hard to add design/browser/document/realtime/voice capabilities. |
| **BLAST RADIUS** | Packaging, deployment, team ownership, extensibility. |
| **ALTERNATIVES** | Thin **interface gateway** (API, auth, session boundary, streaming, transport) + a **capability runtime** for tools/skills/MCP/commands/computer-use. |
| **DECISION** | **Change** (long-term) — do not scuttle current code, but stop growing route handlers; carve capability boundaries a step at a time. |
| **TEST** | A new capability (e.g. computer-use) can be added as a runtime module without touching a chat handler. |

**Status:** decided → incremental.

---

## A-LAYER-001 — One physical package per target layer

| Field | Value |
|-------|-------|
| **ASSUMPTION** | Each of the 7 target layers is its own workspace package, mirroring the layered diagram, so dependency direction is explicit and enforceable. |
| **EVIDENCE** | Target architecture (ARCHITECTURE.md §4) draws 7 distinct layers; current repo packs engine+arena+teams+tasks+backends into one `@ANCIENT/agent` package (engine.ts:28-33), blurring the execution-strategy boundary. |
| **FAILURE MODE** | Layer-crossing imports slip through (engine importing capability details, etc.); boundaries erode silently. |
| **BLAST RADIUS** | Import graph, ownership, testing, packaging, and every future layer addition. |
| **ALTERNATIVES** | (a) Layered folders inside a shared package — rejected: boundaries stay soft; (b) rename existing packages to layer names — rejected: keeps the arena-engine coupling. One-package-per-layer chosen. |
| **DECISION** | **Change** — target package map: `cli`(EXPERIENCES only) · `gateway` · `engine`(+runtimes) · `strategies` · `capabilities` · `infrastructure` · with `shared`/`database` as cross-cutting base. |
| **TEST** | `npm run typecheck` stays green after each package is created; a `capabilities`→`engine` upward import is rejected (types don't exist / lint-unwired). |

**Status:** decided → in progress (build order bottom-up: infrastructure → capabilities → strategies → engine → gateway; cli stays the only EXPERIENCE).

---

## A-LAYER-002 — Dependency direction is top-down, never upward

| Field | Value |
|-------|-------|
| **ASSUMPTION** | Experiences → Gateway → Engine → Strategies → Capabilities → Infrastructure. No layer imports a layer above it. |
| **EVIDENCE** | Target diagram (ARCHITECTURE.md §4) shows a unidirectional funnel; A-LAYER-001's package-per-layer setup is only meaningful if the arrows point one way. |
| **FAILURE MODE** | A capability reaching into the engine to force behavior creates cycles and couples a leaf to the trunk. |
| **BLAST RADIUS** | Every cross-package import; build/typecheck health. |
| **ALTERNATIVES** | Bidirectional imports (rejected: coupling); event-sourced upward communication via the infra event bus (accepted for capability→engine needs). |
| **DECISION** | **Change** — enforce one-directional deps; make cross-layer communication event-driven via `infrastructure` when a lower layer must react upstream. |
| **TEST** | Typecheck + an import-graph lint pass; spot-check no `capabilities → engine` import path exists. |

**Status:** decided → applied during each layer's build.

---

## Register policy (Phase 1 — freeze)

While the review is open, gate **major** new features: a feature may proceed only after its
assumption entry exists (assumption + decision + test) in this register. Bug fixes and small
refactors are unaffected.

To add an entry, copy the template block above and append `A-<SUBSYSTEM>-<NNN>`.
