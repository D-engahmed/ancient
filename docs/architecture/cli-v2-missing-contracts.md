# CLI V2 — Phase 3: Missing Contracts Inventory

Inventory of the type/wire contracts the CLI-V2 mapping requires but that do not
exist today. Each row: what is missing, the canonical owner per Layer 17, current
status, what it unblocks, and effort. Findings `F1–F11` from `cli-v2-audit.md`.

## Contract inventory

| # | Contract | Canonical owner | Status (as-built) | Unblocks | Effort |
|---|---|---|---|---|---|
| C1 | Typed `ExecutionEvent` payloads (per-event shape, not `unknown`) | `packages/contracts/execution.ts` | `payload: unknown` today; event-name set lacks `text.delta`, `capability.*` granularity, `execution.cancelled`, `usage.recorded`, `input.requested` | CLI timeline/inspectors (Phases 6, 8) | S |
| C2 | Wire-level event envelope (`v, seq, ts, executionId, type, payload`) + zod validation | `packages/shared` (home of all wire zod schemas) | none — no events anywhere (F2) | SSE stream, replay, golden tests (Phase 5-6) | S |
| C3 | Terminal-event set (completed/failed/cancelled) | shared (runtime), contracts (types) | none | CLI knows when stream ends; tests (Phases 6, 12) | S |
| C4 | Client-safe error envelope (`code, message, retryable, retryAfterMs?, traceId`) | contracts `ErrorEnvelope` + gateway wire shape (Layer 20 §6, 02 §F) | no typed errors on the wire; regex sniffing (F6) | error UX, retry/suggested-action, traceId (Phases 11-12) | S |
| C5 | Runtime `ErrorCode` list for wire validation (`z.enum`) | contracts (runtime list mirroring the closed taxonomy) | taxonomy is a type-only union (error.ts:26-70) | shared zod schema can `z.enum` codes without duplicating 40 strings | S |
| C6 | Lifecycle **verbs** contract (pause/resume/cancel + status cut) | contracts `ExecutionStatus` + gateway | `ExecutionStatus` already full (created..cancelled); **no verbs on the wire**, engine status lacks paused (F5) | P/R/I controls (Phases 9) | S |
| C7 | Tool-execution authority contract (who runs a tool, hooks always on) | `packages/capabilities` (Layer 5) | two parallel executors, hooks bypassable client-side (F3) | server-authoritative execution (Phase 5) | M |
| C8 | Server-authoritative execution surface (`POST /executions`, `GET /executions/:id/events`, `POST .../cancel`) | `packages/server` gateway routes (Layer 2) | none (chat.ts only) | CLI consumes executions not the chat-or-chest (F1/F2, Phase 5) | M |
| C9 | Bridge durable store event ↔ canonical event (infra `LifecycleEventType` → contracts `ExecutionEventName`) | `packages/infrastructure/storage` + contracts | three vocabularies diverge: contracts / infra storage / shared chat | engine→gateway→CLI alignment (Phase 5) | M |
| C10 | Cost/usage event field (`costUsd?` + "unavailable" semantics) | contracts `usage.recorded` / `execution.completed` | no cost metadata anywhere (F2, spec: never fabricate) | cost display with honest "Cost unavailable" (Phase 10) | S |
| C11 | Execution status cut (running/paused/cancelled/completed/failed) as the V2 surface | contracts `ExecutionStatus` (already full) + gateway | full enum exists; decide/scope only | status-aware controls, honest UI (Phase 9) | S |
| C12 | `Execution` identity/`executionId` correlation across chat + timeline | contracts `Execution` | executions don't exist as durable objects yet (F8) | sessions→many executions window (Phase 6) | M |

## Decisions locked in (from Phase 2-4 review)

- **C1+C2**: type the canonical payload union in `contracts`; the SSE wire
  envelope `{v:1, seq, ts, executionId, type, payload}` lives in `shared`
  (all wire zod already lives there — `submitSchema`, `messagePartsSchema`).
  `packages/contracts` stays **zero-dependency** (its published invariant,
  package.json description); runtime zod validation intentionally lives with the
  other wire schemas in `shared`.
- **C3**: terminal set = `execution.completed | execution.failed |
  execution.cancelled`. `execution.cancelled` is added to the canonical names
  (today missing).
- **C4**: `execution.failed` payload carries the **canonical** `ErrorEnvelope`
  (Layer 20); the gateway projects the client-safe slice (`clientMessage`,
  `traceId`, `transient`/`retryableAsIs` as `retryable`). Not the coarse
  6-code enum — the closed `ErrorCode` taxonomy already satisfies "closed enum".
- **C5**: add a runtime `ERROR_CODES` list to `contracts/error.ts` so `shared`
  builds `z.enum(ERROR_CODES)` from one source (no 40-string duplication).
- **C11**: CLI V2 implements/renders only `running | paused | cancelled |
  completed | failed`. `queued | waiting_approval | checkpointed` stay in the
  type but out of the V2 surface.
- **C6/C8**: verbs (pause/resume/cancel) are **Phase 5** gateway work; this phase
  only records them in the contract types/envelope.

## Out of scope (now)

- Gateway HTTP routes, SSE server, engine wiring, AI-SDK adapter, CLI transport
  refactor → **Phase 5**.
- Durable execution store / migrations (AgentExecution tables) → infrastructure
  phase with assumption entry (F8).
- Strategies `teams`/`arena` wiring and legacy `@ANCIENT/agent` rename → rename
  now (F9), wiring later.