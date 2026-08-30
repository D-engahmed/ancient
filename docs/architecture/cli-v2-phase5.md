# CLI V2 — Phase 5: Live Execution Surface + CLI Transport (as-built)

## Goal

Ship the gateway execution boundary the audit called for
(`cli-v2-audit.md` §7 step 2, `cli-v2-missing-contracts.md` C6/C8/C9):

- the execution surface (`POST /executions`, `GET /executions/:id/events` SSE,
  `POST /executions/:id/cancel`, pause/resume stubs) on `packages/server`;
- the CLI's transport moved onto that surface with **server-authoritative
  tool execution** (F3) — the legacy `/chat` round-trip and the client-side
  tool executor are gone (F4);
- the engine wired end-to-end: `ExecutionEngine` → per-execution `MemoryEventBus`
  + strategy `observe` → `ExecutionEventBridge` → typed wire envelopes → CLI.

Everything here is **as-built and verified** (typecheck exit 0, full suite
green, CLI build exit 0). This is the demonstrable "boundary" prototype the
audit sequenced for Phase 5.

---

## What shipped

### Server gateway (`packages/server/src/executions/`)

- **`bridge.ts` — `ExecutionEventBridge`.** Translates the engine's two
  channels into ONE gapless 1-based `seq` stream of typed wire envelopes:
  - lifecycle events (`infrastructure/events`) → `execution.created` ·
    `strategy.selected` + `execution.started` · `paused`/`resumed` ·
    `completed` → `execution.completed` · `failed` → `execution.failed` /
    `execution.cancelled`;
  - strategy events → `text.delta` · `capability.requested(callId)` ·
    `capability.completed(callId)` (callId pairing preserved);
  - unmapped lifecycle/strategy events are ignored (forward compat) and do
    not consume `seq`; unknown envelope types are never emitted;
  - every envelope is validated against `executionEventEnvelopeSchema`
    (throws `bridge: produced invalid envelope: …` on any violation);
  - exactly one terminal event, then the bridge closes (post-terminal events
    are dropped);
  - `snapshot(afterSeq)` serves `Last-Event-ID` replay slices.
- **`hub.ts` — `ExecutionHub`.** Owns the runnable executions:
  - builds `DEFAULT_REGISTRY` — the **single server-authoritative tool set**
    (F3): readFile/listDirectory/glob/grep/writeFile/editFile/bash/listSkills/
    useSkill/fetchUrl — the CLI never executes a tool itself;
  - `start(request)`: pre-assigns `executionId` (UUID), calls `bridge.start()`
    **before** `engine.run()` so `execution.created` is `seq 1`, subscribes the
    bus, resolves the user's model via `resolveChatModel`, and runs the unified
    `ExecutionEngine` with scope/policy/observe/bus. Failure before a session
    exists still emits `execution.failed` so SSE consumers can't hang;
  - `list` / `get` (scoped by `userId`) / `cancel` (engine `session.cancel`).
    Storage is in-memory only (A-003 / audit R2 — wired later).
- **`routes/executions.ts`.** `createExecutionsRoutes(hub)`:
  - `POST /` (202) with `executionRequestSchema` (task ≤100k, mode/model/cwd/
    allow/toolAllow);
  - `GET /` list, `GET /:id` snapshot, `POST /:id/cancel`;
  - `POST /:id/pause` | `resume` → `409` with an honest "only cancel is wired";
  - `GET /:id/events` — SSE `id: <seq>\nevent: execution\ndata: …`, honoring
    `Last-Event-ID` (header or `lastEventId` query), 25s `: ping` heartbeat,
    single-writer pump (frames can never interleave), `onAbort` cleanup,
    stream closes exactly on the terminal envelope.
- `packages/server/src/index.ts` mounts it behind `requireAuth`; the server
  package gains workspace deps on capabilities/execution/infrastructure/
  strategies.

### CLI transport (`packages/cli/`)

- **`lib/execution-stream.ts`** — pure, React-free clients of the wire:
  - `parseSseFrame` / `sseFrames` — RFC 2426 SSE decode (multi-line data,
    CRLF+LF, comment/heartbeat skip, frames split across chunks);
  - `ExecutionMessageAssembler` — folds a seq-ordered slice of envelopes into
    one assistant message: text deltas concatenated, capability calls paired
    into tool parts (`running`/`ok`/`error`), first-terminal-wins, usage and
    duration on the message metadata.
- **`lib/api-client.ts`** — `executions.start/list/get/cancel` and the
  `streamExecutionEvents(executionId, …)` async generator (auth header,
   401 clears auth, `parseExecutionEvent` at the edge). Async-iterates the
  SSE frames. **`apiClient.chat` is deleted (F4).**
- **`hooks/use-execution.ts`** — the hook `session.tsx` consumes. Per submit:
  POST `/executions` → stream envelopes → live upsert of the assistant message
  (text streams as deltas arrive, tools appear as they run). Status surface
  preserved (`idle | submitted | streaming | ready | error`). `interrupt()`
  POSTs a server-side cancel and a 5s watchdog drops the stream if no terminal
  arrives. One execution per prompt; double-submit guarded.
- **`components/messages/bot-message.tsx`** — renders the closed wire part
  model (text/tool) with a tolerant read for the legacy persisted shapes, so
  historical transcripts still display.
- **Deleted:** `hooks/use-chat.ts` (AI-SDK `useChat` transport) and
  `lib/local-tools.ts` (client-side executor) — dead after the move (F3/F4).
  `ai` / `@ai-sdk/react` are no longer part of the chat loop.

### Engine (inside the uncommitted stage-1 `packages/execution/`)

- `RunRequest.observe?(event)` — a live strategy-event observer the hub
  bridges to the wire; `RunRequest.sessionId?` lets the hub pre-assign the
  contract's `executionId` so `seq 1` is `execution.created` before the engine
  emits (`EngineSession(bus, request, id?)`).

---

## Wire contract (what the CLI actually consumes)

| Engine/Bus | Bridge envelope(s) | CLI render |
|---|---|---|
| `started` (lifecycle) | `strategy.selected` → `execution.started` | — |
| strategy `text-delta` | `text.delta` | appended text part (live) |
| strategy `tool-call` | `capability.requested(callId, capability, args)` | tool part `running` |
| strategy `tool-result` | `capability.completed(callId, ok, result/error)` | tool part `ok`/`error` |
| `completed` (lifecycle) | `execution.completed(summary?, output?, usage?)` | terminal; usage+duration metadata |
| `failed` (lifecycle) | `execution.failed(error: ClientSafeError)` | terminal; error (code/traceId) |
| `failed{cancelled}` | `execution.cancelled(reason?)` | terminal `cancelled` |
| everything else | ignored (no seq consumed) | — |

Sequencing/termination invariants (from `cli-v2-missing-contracts.md` C1-C3):
`seq` 1-based and gapless; exactly one terminal event; unknown types ignored;
`capability.requested` always precedes its `capability.completed`.

## Tests (new; all green)

- `packages/server/src/executions/bridge.test.ts` (12) — gapless seq across
  happy/failed/cancelled/failure paths, callId pairing, output accumulate,
  usage on terminal, replay slices, post-terminal and unknown-event isolation,
  live-subscriber semantics.
- `packages/cli/src/lib/execution-stream.test.ts` (16) — SSE frame parsing
  (multi-line, CRLF, heartbeats, chunk splits, trailing frame), assembler
  (delta concat, tool pairing ok/error, first-terminal-wins, failed envelope,
  cancelled, unknown-type isolation, duration).
- Full suite: **295 pass / 0 fail** (was 267 at the Phase-4 baseline);
  `bun run typecheck` exit 0 across all 11 packages; CLI `bun build` exit 0.

---

## Honest gaps (deferred, by design)

| Gap | Why it's OK now | Wired when |
|---|---|---|
| **Approval is placeholder**: the CLI auto-allows all five risk categories (`CLI_ALLOW`) so tools work end-to-end; there is no consent UX | matches legacy CLI behavior (client executor ran everything unfettered); the engine would deny/require-consent by default | Phase 9 (approval UX + `approval.requested` wire event) |
| **Executions are in-memory** — no durable event log, list resets on restart | A-003 "state begins in memory"; infra/storage already has the event-sourced store | Phase 6+ (durable execution store + replay) |
| **No pause/resume** (routes 409) | engine exposes cancellation only today (audit F2/F5) | with the durable store |
| **Rollup output is the joined text deltas** — no history invention yet | correct single-run view for the boundary prototype | Phase 6 timeline (per-run, seq/type/payload) |
| `/chat` routes kept for compatibility; `/sessions` history is display-only | not re-routed in this phase (A-019 blast radius) | Phase 6/7 |
| `usage.recorded` is defined on the wire but the bridge doesn't emit it | cost must never be fabricated; usage rides on `execution.completed` for now | Phase 10 (cost display / C10) |

## Verification

```text
bun run typecheck   # exit 0 (11 packages)
bun test            # 295 pass / 0 fail (32 files)
cd packages/cli && npm run build   # exit 0
```

## Related

- `docs/architecture/cli-v2-audit.md` §7 (sequence), `cli-v2-mapping.md`
  (F3 divergence), `cli-v2-missing-contracts.md` (C6/C8/C9/C10).
- `docs/08-assumption-register/README.md` → **ASSUMPTION-019** (wire
  contract) and **ASSUMPTION-020** (this surface).
- `packages/shared/src/execution-events.ts` (the wire spelling, Phase 4).