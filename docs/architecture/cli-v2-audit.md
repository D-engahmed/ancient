# CLI V2 — Architecture Audit

Phase-1 deliverable for the CLI-V2 upgrade. As-built reality recorded here is
verified against source at commit state 2026-08-29 (uncommitted work-in-progress
included). Target references cite `docs/0X-*/README.md` (layers). Honesty rule:
every finding distinguishes **as-built** fact (with file:line evidence) from
**target** requirement, and inference is labelled as such.

- Status: baseline (pre-change). No CLI code has been modified by this effort.
- Scope: `packages/cli`, `packages/server`, `packages/agent`, `packages/database`,
  `packages/shared`, `packages/execution`, `packages/strategies`,
  `packages/infrastructure`, `packages/capabilities`, `packages/contracts`.

---

## 1. Executive summary

The CLI today is a **chat client**, not an execution console. It talks to one
endpoint (`POST /chat/:sessionId`) over an AI-SDK UI-message stream, and every
piece of platform behaviour the V2 spec and the target docs describe (executions,
events, strategy, lifecycle, pause/resume/checkpoint) does not exist on that wire.

Verified facts that dominate the audit:

1. The server imports **none** of `@ANCIENT/execution`, `@ANCIENT/strategies`,
   `@ANCIENT/capabilities`, or `@ANCIENT/infrastructure`
   (grep of `packages/server/src` → 0 hits). The new unified execution engine is
   **un-wired** in the server runtime.
2. The only streaming the server emits is the AI-SDK
   `toUIMessageStreamResponse` (chat.ts:558). There is no `text/event-stream`
   route, no `/events` endpoint, no `EventSource`, no `ReadableStream` anywhere
   in `packages/server` (grep → 0 hits). The gateway "reconnect-safe streaming"
   layer (docs/02 §E) cannot exist yet — there is nothing to reconnect to.
3. The CLI reaches the model through `useChat` + `DefaultChatTransport`
   (use-chat.ts:38-71). `apiClient.chat.send/resume` (api-client.ts:62-67) is
   **dead code** (grep for `apiClient.chat` → 0 callers).
4. The same seven filesystem/shell tools are implemented **twice**: server-side
   (`packages/server/src/tools/base.ts`, executing in the server process against
   session.cwd) and client-side (`packages/cli/src/lib/local-tools.ts`, executing
   in the CLI process against `process.cwd()`). Two processes, one behaviour,
   no ownership boundary.
5. Execution state is **in-memory only** in both places that have an engine:
   `/agent/*` (agent.ts:37-38, one `ExecutionEngine` per process) and the new
   `packages/execution` engine (un-used). No execution history survives a restart;
   the Agent* Prisma models (schema.prisma:108-173) have **no migration**
   (only 4 migrations exist; agent tables are absent from live DB).
6. A naming collision: two classes both called `ExecutionEngine` —
   `packages/agent` (team/arena orchestration, used by `/agent/*`) and
   `packages/execution` (the new unified engine, used by nothing in the server).
7. The CLI command surface is already a small registry (`COMMANDS` in
   command-menu/commands.tsx:61) — good raw material for the V2 registry, but
   lifecycle pragmatics (pause/resume/cancel), inspectors, and artifact views
   are absent.
8. "Interrupt" in the CLI and "cancel" in chat.ts are **hard stops**. There is no
   pause/resume of an in-flight turn server-side; the chat `/resume` route
   (chat.ts:668) re-runs a *pending last user message*, which is retry, not
   pause/resume. Target lifecycle (docs/03 `Running → Paused`) is not reachable.

---

## 2. As-built architecture (verified)

### 2.1 Process topology

```text
CLI (bun TUI, @opentui/react)  ──HTTP──▶  Server (Hono, port 3000)  ──▶  Prisma Postgres
   │  AI-SDK useChat over SSE-ish AI stream    │                             │
   │  local FS/shell tools run HERE            │ remote tools run HERE        │
```

No WebSocket. No push channel. Nothing the CLI shows is pushed to it; everything
is either streamed inside the chat POST response, or **polled** (pipeline:
commands.tsx:29-59 polls `/pipeline/status/:id` every 2s; usage/sessions are
HTTP GETs).

### 2.2 CLI internals

- Entry: `packages/cli/bin/*` loads root `.env`; `src/index.tsx` mounts
  `createCliRenderer` (60fps, `exitOnCtrlC:false`) and a `createMemoryRouter`.
  All in-memory; reload loses navigation, not data (data lives server-side).
- Key provider: `KeyboardLayerProvider` (Keyboard-layer/index.tsx) — one
  Ctrl+C handler walks a responder chain; unhandled Ctrl+C destroys the renderer
  (index.tsx:70-84). Layers: dialogs push/pop over `"base"`.
- Chat: `useChat` (hooks/use-chat.ts) wraps `useAiChat` with a
  `DefaultChatTransport` posting to `/chat/:sessionId`. On the client the hook
  executes **local tools** when the model emits tool-calls
  (use-chat.ts:77-103) and re-submits automatically after a complete assistant
  turn with tool calls (`sendAutomaticallyWhen`).
- Screens: `home`, `new-session`, `session` (screens/). Dialogs: usage, theme,
  sessions, models, extensions, agents. Command menu: `COMMANDS` registry
  (~18 commands) + `CommandMenu`.
- Prompt config: `providers/prompt-config` holds mode/model selection for the
  session input.
- Extensions surface: `/agents`, `/skills`, `/commands`, `/mcp`, `/compact`,
  `/checkpoints`, `/rewind` via `apiClient.extensions`.

### 2.3 Server internals (routes that matter)

- Mounted groups (index.ts:48-56): auth, sessions, chat, provider-connections,
  extensions, usage, agent, pipeline. `idleTimeout:255`.
- **chat.ts** (`/chat/*`): the only AI surface the CLI uses.
  - `POST /:sessionId` — validates `submitSchema`; `prepareTurn()` expands slash
    commands, runs SessionStart/UserPromptSubmit hooks, creates a BUILD-mode
    checkpoint, then free-lane routing; persists the USER message; calls
    `streamAIResponse`.
  - `streamAIResponse()` — `streamText` with: layered system prompt (memory,
    skills, agents, MCP blocks), tools from `createToolsAsync`, `stopWhen`
    `stepCountIs(50)`, 300s timeout abort, per-turn model cooldown + fallback
    breaker, quota learning, then `toUIMessageStreamResponse` with start/finish
    metadata (mode, model ref, routed reason, durationMs, usage).
  - Persistence: USER (line 746), ASSISTANT COMPLETE (line 451, parts truncated to
    200k chars), ERROR (line 519), INTERRUPTED partial (line 542).
  - `POST /:sessionId/resume` — retries the last USER message if the stream
    ended (chat.ts:668), 409 if none.
- **agent.ts** (`/agent/*`): templates, `POST /execute` (202; runs
  `@ANCIENT/agent`'s team engine in the background), `GET /status/:id` (poll),
  `POST /pause|/resume|/cancel/:id`. In-memory only (agent.ts:37 — the file's own
  header documents the single-process/restart limitation).
- **pipeline.ts** (`/pipeline/*`): `POST /` 202 + background `jobRunner`;
  `GET /status/:id` returns only a status string (+ result at terminal).
- **extensions.ts**: skills/agents/commands/MCP listing, `/compact`,
  `/checkpoints`, `/rewind` (filesystem checkpoints).
- **models.ts / provider-connections.ts / rate-limit-breaker.ts / fallback.ts /
  quota.ts**: the model/harness + resilience machinery lives in `server/src/lib`
  — i.e. duplicated concept for Layer 19 (model-runtime) and Layer 12's breaker.

### 2.4 The two engines

| Package | Class | Purpose | Wired? |
|---|---|---|---|
| `packages/execution` | `ExecutionEngine` (engine.ts:29) | unified engine: profiler → selector → strategy → StrategyRuntime (docs/03) | **not wired in server** |
| `packages/agent` | `ExecutionEngine` (agent package) | legacy team/arena orchestration | wired at `/agent/*` only |
| — | `ArenaCoordinator` | team run | via `/agent/execute` |

Evidence of the gap: `packages/execution/src/engine.ts` publishes lifecycle events
onto an EventBus (engine.ts:206-215), records strategy events for replay, and
implements cancellation (engine.ts:114, 225-230). None of those events are
reachable by the CLI or any HTTP route today. Nothing in the server imports the
package (grep, earlier section).

---

## 3. Actual execution flow (verified trace)

One user turn through the CLI (CLI-V2's primary persona):

```text
1. User types in input-bar, presses Enter
2. usePromptConfig provides mode + modelSelection (CLI-local state)
3. useChat.submit() → chat.sendMessage({text, metadata:{mode, model}})  (use-chat.ts:116)
4. DefaultChatTransport POSTs {content, mode, model} → /chat/:sessionId   (use-chat.ts:63-68)
5. server prepareTurn(): expandSlashCommand → hooks → (BUILD) checkpoint → routeTurn()
   → persist USER message                                              (chat.ts:595-664, 746)
6. streamAIResponse(): resolve model (+cooldown check/fallback) → build system prompt
   → createToolsAsync (7 base tools + useSkill + task + MCP, hook-wrapped) → streamText  (chat.ts:184-588)
7. streamText drives model; server-side tool execute runs in the SERVER process
   for tools with execute; streamText emits parts: text-delta, reasoning-delta,
   tool-call, tool-result
8. CLI receives AI stream; for tool-call parts its onToolCall fires → executeLocalTool
   runs the SAME seven tools in the CLI process against process.cwd() → addToolResult
   → sendAutomaticallyWhen re-submits the turn   (use-chat.ts:77-105, local-tools.ts)
9. onFinish → persist ASSISTANT COMPLETE (+truncation, BUILD no-tool warning)
10. toUIMessageStreamResponse returns start/finish metadata (mode/model/routed/usage)
11. CLI renders message parts; status transitions submitted→streaming→ready
12. ESC (status streaming) or Ctrl+C → chat.stop → abort signal → server onAbort persists INTERRUPTED
```

Two-step caveat is a real finding: **who executes a tool depends on whether the
SDK calls the server tool's `execute` or the client's `onToolCall`**, and the two
implementations are separate code in separate processes. The seven tool names are
identical; the cwd, dedupe cache, and truncation caps differ (see F4).

A `/pipeline` run (commands.tsx:268-284) is the only other long-lived thing:
POST 202 → CLI polls every 2s for ≤120s → toast on terminal status. No events.

An `/agent/execute` run (agent.ts:95-136) is completely invisible to the CLI:
202 with an id, then a poll contract the CLI never calls. The CLI has no
execution view at all.

---

## 4. Findings (per finding: Problem / Evidence / Impact / Recommended / Risk / Validation)

### F1 — The CLI is not connected to any execution engine

- **Problem**: The chat wire is a single-turn message loop (`streamText` per
  request). There is no Execution, no strategy selection, no lifecycle, no event
  stream. The platform's core model (docs/03) is bypassed by its default client.
- **Evidence**: `streamAIResponse` in chat.ts:184 is plain `streamText` (no
  strategy selector import — grep of chat.ts for strategies/engine → 0);
  server imports no architecture packages (§1.1); `packages/execution` wired nowhere.
- **Impact**: Every V2 feature (inspectors, timeline, controls, artifacts) has no
  data source. CLI cannot show "what is the engine doing" because nothing calls
  the engine. Strategy selection silently doesn't happen (A-STRAT-001 un-enforced
  in the live path).
- **Recommended**: introduce a gateway execution surface (`POST /executions`,
  `/executions/:id/events` SSE replay+live per docs/02 §E) that wraps the
  `@ANCIENT/execution` engine (or, in the phase 2-4 mapping, the minimal
  execution/event contracts the CLI can consume). The CLI consumes
  `ExecutionEvent`s (packages/contracts) — it does not re-implement routing.
- **Risk of changing**: moving chat over the engine changes turn semantics
  (tool stream shape, abort behavior). Mitigate: keep `/chat` for compatibility;
  add execution surface alongside, wire CLI to it in a later phase.
- **Validation**: a `POST /executions` returns an id; CLI inspector shows
  `execution.*` events live; strategy id present in stream (event `strategy.selected`).

### F2 — No event stream channel at all (no SSE / no WS / no reconnect)

- **Problem**: Target "reconnect-safe streaming" (docs/02 §E) — event log replay
  after disconnect — is impossible. All client updates are pull-based (HTTP) or
  tied to the single chat response.
- **Evidence**: grep `text/event-stream|EventSource|ReadableStream` in
  packages/server → 0 hits. Only AI-SDK stream (chat.ts:558). Pipeline polled
  (commands.tsx:29-59).
- **Impact**: a dropped chat connection loses the live view; executions (once they
  exist) would have no durable event log to replay; background jobs (pipeline
  today, executions tomorrow) can only be polled, which the target explicitly
  rejects.
- **Recommended**: add a durable append-only execution event log (docs/14, docs/06)
  and expose `GET /executions/:id/events` (SSE, `Last-Event-ID` replay). Start
  minimal: in-memory ring buffer + DB persist later; the *contract* is what
  matters for the CLI.
- **Risk**: SSE through Hono is fine, but auth middleware must permit stream
  upgrade; reconnect replay requires an offset the CLI keeps.
- **Validation**: connect, drop, reconnect → missed events replayed; CLI timeline
  shows contiguous seq.

### F3 — Duplicate tool execution in two processes (ownership vacuums)

- **Problem**: Identical seven tools exist server-side (has `execute`,
  PreToolUse/PostToolUse hooks, per-turn dedupe, session.cwd) and client-side
  (`executeLocalTool`, hooks absent, no dedupe, `process.cwd()`).
- **Evidence**: server tools base.ts:31-50; hooks wrapper tools/index.ts:32-51;
  client local-tools.ts:32-173; wired into onToolCall use-chat.ts:77-103.
- **Impact**: (a) Same command may read/write different directories depending on
  which process runs it — the CLI process cwd vs the session cwd; tools'
  `resolveInsideCwd` uses `process.cwd()` (local-tools.ts:16-23), while server
  tools bake in `cwd` per session. (b) Tool-side hooks (PreToolUse policy,
  PostToolUse context) can be silently bypassed on the client path. (c) Two code
  paths to drift (a "fix once in two places" problem docs/17 §reliability calls
  out).
- **Recommended**: single authority per tool. The capability architecture
  (docs/05 + packages/capabilities) should own tool *contracts*; execution
  belongs to one executor per tool. Near-term minimal: CLI stops self-executing —
  sends tool-calls to the server for execution (gateway capability boundary) and
  receives results in the stream — OR the server stops declaring `execute` and
  the CLI's local implementation becomes the sanctioned repo-tools executor.
  Decide via the capabilities contract; do not have two parallel `execute`s.
- **Risk**: moving execution to server changes latency and auth semantics; keep a
  clear "executes here" matrix in the capability registry.
- **Validation**: a tool call executes in exactly one process; hooks always fire;
  a note of executor per tool in the docs.

### F4 — `apiClient.chat.send/resume` is dead code

- **Problem**: The only non-SDK chat client methods are unused.
- **Evidence**: api-client.ts:62-67 defined; grep `apiClient.chat` in cli → 0.
- **Impact**: maintenance surface; documents a request/response shape the server
  still supports but nothing uses. Mild; flagged for cleanliness, not urgency.
- **Recommended**: either delete, or keep in the new absolute-URL-free transport
  layer if V2 reintroduces a manual trampoline. Default: delete with a test that
  the transport covers the contract.
- **Risk**: none (dead).
- **Validation**: repo grep shows no callers; tests green.

### F5 — Pause/resume/cancel are not real

- **Problem**: CLI "interrupt" = `chat.stop` (hard abort; use-chat.ts:124-125)
  → server onAbort persists INTERRUPTED (chat.ts:532-555). No pause; `/chat/resume`
  re-runs a last message (chat.ts:668) — retry semantics, not lifecycle. Engine
  session `cancel()` is a stop-flag (engine.ts:225-230) — there is no "paused"
  in `ExecutionStatus` (types.ts:58-63) nor in the new engine's status set.
- **Evidence**: types.ts:58-63 (created|running|completed|failed|cancelled — no
  paused/queued/waiting-approval); docs/03 state machine (Paused, WaitingApproval,
  Checkpointed) un-buildable on the current status enum; agent.ts pause/resume are
  the team engine only and non-durable.
- **Impact**: The V2 spec's signature controls (P pause / R resume / I interrupt)
  need back-end semantics that don't exist. A pause implemented UI-only would be
  exactly the "fake control" the task forbids.
- **Recommended**: extend the status model (queue/pause/wait-approval/checkpoint)
  in contracts; implement engine-side pause (stop consuming the strategy stream,
  keep state; resume continues from last recorded event or checkpoint —
  docs/03 Checkpointed) and gateway verbs. CLI renders controls from streamed
  status events, never from local fiction.
- **Risk**: engine pause across async provider calls is the hard part; scope V2 to
  "pause between turns / at checkpoint", not mid-token.
- **Validation**: sequence test: pause → running→paused event → resume →
  checkpoint.created → continue; CLI buttons only enable per status.

### F6 — No error contract on the wire (message strings, not envelopes)

- **Problem**: CLI surfaces `error.message` strings (input-bar / session toast)
  and extracts error codes by regex (`extractErrorCode`, session.tsx:196).
  Server maps errors to human text (sanitizeError, chat.ts:321) and returns
  `{error: msg}` with HTTP status (chat.ts:713-714, 786-789). No `ErrorEnvelope`
  (docs/20) code, traceId, retryable, or suggestedAction crosses the wire.
- **Evidence**: chat.ts error responses (429 with Retry-After, 500 generic);
  api-client.ts:29-45 surface via `(data as {error?})` and `response.statusText` —
  no typed envelope; CLI regex-based code sniffing (session.tsx:39-42).
- **Impact**: retryability/suggested action (switch model, re-auth) can't be shown
  reliably; alerts/dashboards can't classify (docs/20). CLI error UX becomes
  guesswork; the V2 spec's "no invented error copy" is unachievable.
- **Recommended**: gateway Error Mapper (docs/02 §F) emitting
  `{error:{code,message,retryable,retryAfterMs,traceId}}`; CLI maps `ErrorCode →`
  presentation via `makeError`/`ErrorEnvelope` from packages/contracts (already
  built). Keep `traceId` always present and logged.
- **Risk**: changing error JSON shape is a breaking API change for any other
  consumer; coordinate with server route refactor. Low risk otherwise.
- **Validation**: a 429 returns envelope with `retryable:true`+`retryAfterMs`;
  CLI switches presentation per code; traceId round-trips.

### F7 — Model/provider/harness logic lives in server/lib, duplicated from the platform

- **Problem**: model resolution, cooldown breaker, fallback pick, quota —
  `server/src/lib/models.ts`, `rate-limit-breaker.ts`, `fallback.ts`, `quota.ts` —
  re-implement things the platform targets for Layer 19 (model-runtime) and
  Layer 12 (reliability). `packages/reliability` (retry/circuit-breaker) exists
  and is unused here.
- **Evidence**: chat.ts imports only `server/src/lib/*` (chat.ts:20-21, 31);
  trust the explore audit for lib contents verified during Phase 1; the new
  `packages/reliability/src/circuit-breaker.ts` has no server importer (grep).
- **Impact**: breaker/cooldown correctness diverges between server chat path and
  the platform's canonical mechanisms; a fix to backoff jitter lands in two
  places again (docs/12/17 explicitly warn). V2's reliability phase should align.
- **Recommended**: long-term, model-runtime package owns this. Near-term:
  `server/lib/rate-limit-breaker.ts` state can remain but document it as the
  transitional harness; do not duplicate into the CLI (the CLI must not route).
- **Risk**: low if left; higher if churned without the model-runtime landing.
- **Validation**: after alignment, a cooldown in server/lib trips the same
  circuit-breaker contract (packages/reliability) test suite passes.

### F8 — Agent/execution state is in-memory and un-durable

- **Problem**: `/agent/*` engine is per-process in-memory (agent.ts:37) — the
  file's own header says so (agent.ts:10-17); executions die on restart, and the
  Agent* tables (schema.prisma:108-173) have **no migration** (only 4 migrations
  exist in `prisma/migrations/`; the schema models are orphans). Chat history is
  durable (Message table) but execution/run history is not.
- **Evidence**: migrations dir listing (4 migrations); agent models
  schema.prisma:108-173 with no corresponding migration file; agent.ts:37 + header.
- **Impact**: follow-up of an execution after restart impossible; multi-instance
  deployment broken for `/agent`; the V2 execution timeline cannot show older
  runs or artifacts. This is also an honesty gap: README/docs may claim
  execution persistence that isn't real.
- **Recommended**: add migration(s) for AgentExecution/AgentCheckpoint (or a
  generic Execution + EventLog per docs/14), plus a store that survives restarts;
  the execution event log (F2) should be the durable record. Do this as an
  infrastructure/state deliverable, not inside the CLI.
- **Risk**: schema work touches database package — gate behind assumption entry
  (register) per Phase-1 gate. Medium (data migration).
- **Validation**: restart server → `GET /executions/:id` still returns run; a
  migration SQL exists and `prisma migrate` applies cleanly.

### F9 — Naming collision: two `ExecutionEngine`s

- **Problem**: `packages/agent` and `packages/execution` each export a class named
  `ExecutionEngine` with different semantics (team orchestration vs unified
  engine). Any import is ambiguous; reviewers and tooling can't tell which is real.
- **Evidence**: engine.ts:29 (`packages/execution`) vs agent.ts:31 import from
  `@ANCIENT/agent`; both named `ExecutionEngine`.
- **Impact**: risk of wiring the wrong engine into a gateway surface later; docs
  say "execution engine" (§4) while code has two.
- **Recommended**: rename the legacy one (e.g. `ArenaEngine`/`TeamOrchestrator` in
  agent package) or document `@ANCIENT/agent` as the *legacy* multi-agent engine
  en route to strategies' `teams`/`arena` leaves. Keep `@ANCIENT/execution`'s name.
- **Risk**: low; rename touches agent + tests.
- **Validation**: repo grep for `class ExecutionEngine` returns exactly one.

### F10 — CLI already has a command registry worth extending (positive finding)

- **Problem** (opportunity): `COMMANDS: Command[]` with name/value/description/
  action + `ctx {navigate, dialog, setMode, toast, sessionId, cwd, exit}` is a
  solid base. But it's flat, not namespaced, has no hidden/by-hotkey commands, and
  keyboard shortcuts (Ctrl+Shift+Y/R, ESC) live in screens (session.tsx:131-179)
  not the registry.
- **Evidence**: command-menu/commands.tsx:61-322; session.tsx keyboard handlers.
- **Impact**: V2 registry can grow from this cleanly (add namespace, metadata,
  availability-by-status). Shortcut-to-command mapping centralizes discoverability.
- **Recommended**: in Phase 7, refactor to a richer registry with groups, keybind,
  `when` (status gating), and one dispatch path; keep actions thin (call gateway).
- **Risk**: low.
- **Validation**: every key handler is testable as a command action; `/help`
  enumerates from the registry.

### F11 — Learning/telemetry lives in CLI process, duplicated + not privacy-governed

- **Problem**: session.tsx writes a workspace learning store (mode/model/error
  codes) and `cliLatency` p95 ('server' target <50ms) — client-side telemetry with
  no consent or endpoint. Useful, but it is local-only and unreviewable.
- **Evidence**: session.tsx:192-229; lib/experience.
- **Impact**: metrics (latency) are reported by the client only — a second
  observer; the server has no similar counters. For Phase 13 (performance) both
  sides should record; decide governance.
- **Recommended**: keep CLI-side as UX metric; add server-side execution-latency
  events (model.called timing) in Phase 14; document privacy in data/state doc.
- **Risk**: none immediately.
- **Validation**: latency reported matches server event log nearly.

---

## 5. Coupling / state / streaming / error / UX analysis

### 5.1 Coupling

- CLI ↔ server chat is coupled through the AI SDK wire format and `submitSchema`
  (shared). The CLI also imports `ToolContracts`, `toolInputSchemas`,
  `ModeType`, `ChatModelSelection` from `@ANCIENT/shared` — so the *client* owns
  tool input schemas (shared/schemas.ts:26-60), while the *server* owns tool
  implementations. Tool contract ownership is split too.
- The gateway's job (docs/02 "Do not let routes become the AI brain") is directly
  violated by chat.ts's breadth: it builds prompts, routes models, runs tools,
  persists messages, applies hooks, and maps errors in one file (~790 lines).
  This is the target's canonical anti-pattern (docs/02 anti-pattern block).

### 5.2 State

- Chat/session/message state: durable (Postgres).
- Execution state: none (F5, F8). CLI view state: in-memory React/mem router.
- Checkpoints: filesystem-only (checkpoints/store). Not part of any execution
  event stream; a "checkpoint.created" event does not exist on the wire.

### 5.3 Streaming

- Only the chat AI stream. No execution events. No reconnect/replay (F2).

### 5.4 Error UX

- Strings + regex sniffing (F6). Latency/rate-limit are partially surfaced well
  (Retry-After import is not rendered as a countdown). "Cost unavailable" problem
  in the spec: no cost metadata currently; V2 must never fabricate.

### 5.5 UX surface vs V2 spec

Existing (fine): registry; dialogs; identity; model/agent selection; checkpoint
rewind; bounded-ish tool output truncation (local-tools caps exist).
Missing (spec): execution timeline; inspector views; artifacts/results; status-
aware controls (P/R/I); progressive disclosure; cost with "unavailable" default;
many-list rendering safeguards; performance measurement phase; engine-vs-UI
honesty. No "If TUI replaced by web, engine unchanged" — today TUI *is* the
implementation of the loop client-side (local tool exec, F3), which violates the
rule.

---

## 6. Reliability / security / performance risk register

| Id | Risk | As-built severity | Mitigation path |
|---|---|---|---|
| R1 | Client tool exec (F3) bypasses PreToolUse policy hooks | High | single executor per tool (capability boundary) |
| R2 | Execution state in process memory (F8) — single-instance only | High | durable execution store + event log |
| R3 | No event replay on (re)connect (F2) | Med | SSE + Last-Event-ID over append-only log |
| R4 | Regex error sniffing + string errors (F6) | Med | typed ErrorEnvelope + traceId |
| R5 | No auth/tenancy on file tools beyond session cwd assumption (F3) | Med | executor-enforced cwd boundary; contract test |
| R6 | 300s chat timeout with no visibility | Med | lifecycle events timeouts; degraded/failed classification |
| R7 | `sanitizeError` redacts apiKey from message but raw key may appear in log via `responseBody` | Low-Med | server-side log redactor at boundary (packages/infrastructure has redactor contract) |
| R8 | Pipeline poll churn (2s × 120s) + no events | Low | move to execution events once F2 lands |
| R9 | Latency p95 tracked only client-side (F11) | Low | server event timing in Phase 14 |
| R10 | Two engines / naming collision (F9) | Med (future) | rename legacy engine / wire unified correctly |

---

## 7. Recommended sequence (maps to spec phases 2-14)

1. **Phases 2-4 (contracts first).** Can map to `packages/contracts` additions:
   execution/event contract already drafted there (ExecutionEventName etc.);
   extend status set (queued/paused/waiting-approval/checkpointed), add
   `ExecutionDTO` for the CLI (id, status, task, strategy, lastEvent, error
   envelope, cost "unavailable" optional). Define the gateway event wire shape.
2. **Phase 5 (boundary).** Introduce gateway execution surface + event SSE
   (F1/F2). Move the CLI's transport to it; delete `apiClient.chat` (F4).
   Resolve tool-exec ownership (F3) — one executor per tool, hooks always on.
3. **Phase 6 (timeline).** CLI renders execution events (seq, type, payload)
   from the stream; no local history invention.
4. **Phase 7 (registry).** Extend COMMANDS (F10) with namespaces/status-gating.
5. **Phases 8-10 (inspector/controls/artifacts).** Everything reads from events;
   controls enabled only by status events (F5). Cost renders "Cost unavailable"
   when no value is streamed.
6. **Phases 11-12.** Align error/reliability with contracts+reliability packages
   (F6/F7); add fault injection tests around transport/SSE.
7. **Phase 13-14.** Latency event timing server-side (F11/R9) + final review doc.

## 8. What NOT to change

- The seven core tool **schemas** (`shared/schemas.ts` `toolInputSchemas`) — keep
  as the canonical tool input contract; change only who *executes* (F3).
- Chat **persistence** (Message table, session flow) — the durable session history
  is good and should remain.
- Free-lane routing + cooldown/fallback **behavior** of chat.ts — keep semantics;
  relocate provenance only if/when model-runtime lands (F7).
- **Keyboard-layer responder chain** and dialog stack — the layering model is
  sound and reused by V2 controls.
- `@ai-sdk/react` usage as the render/stream primitive *if* the gateway event
  stream stays AI-SDK-compatible; do not fork a parallel message pipeline.

---

## 9. Open questions for decision

- Gateway event wire: SSE (Hono) vs reuse AI-SDK UI stream shape for execution
  events. Recommend: SSE with structured `ExecutionEvent` JSON, AI-SDK stays for
  chat messages only.
- Tool-execution ownership (F3): server-authoritative execution of the seven tools
  (recommended) vs CLI remains executor for repo tools. This decides whether
  hooks/policy are enforceable client-side.
- Status-model breadth for V2: implement full docs/03 (queued/paused/waiting-
  approval/checkpointed) or a cut (running/paused/cancelled/completed) first.
- `@ANCIENT/agent` rename scope (F9) — accept as legacy or rename now.

---

## Appendix A — Evidence file map

- chat.ts:184-588 (streamText), :595-664 (prepareTurn), :668-716 (resume),
  :718-791 (POST), :451/:519/:542 (persist), :558 (UI stream)
- use-chat.ts:38-71 (transport), :77-103 (client tool exec), :116-125 (submit/abort)
- api-client.ts:62-67 (dead chat), :56-114 (registry surface)
- local-tools.ts:16-24 (cwd resolution), :32-173 (tool switch)
- tool base.ts:31-50 (server tools), tools/index.ts:32-51 (hooks),
  tools/index.ts:93-101 (MCP async)
- agent.ts:31 (:37 engine), :38 (in-memory), :95-136 (execute), :151-167 (pause/resume/cancel)
- pipeline.ts:72-96 (poll contract)
- shared/schemas.ts:26-60 (tool contracts)
- execution/engine.ts:29 (class), :206-215 (bus publish), :225-230 (cancel),
  execution/types.ts:58-63 (status enum)
- strategies/registry.ts:34-40 (catalog wired/unwired), selector.ts (rules)
- server/src/index.ts:48-56 (routes)
- schema.prisma:108-173 (orphan agent models); prisma/migrations (4 only)
- Keyboard-layer/index.tsx:70-84 (Ctrl+C)
- session.tsx:131-179 (keys), :192-229 (learning/latency), :39-42 (error regex)
- command-menu/commands.tsx:29-59 (Pipeline poll), :61-322 (registry)
- docs: 01 (experiences), 02 (gateway+SSE), 03 (engine lifecycle), 17 (boundaries),
  20 (errors). All as-built claims marked as such.