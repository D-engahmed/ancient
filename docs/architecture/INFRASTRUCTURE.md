# Infrastructure layer — as-built

**Branch:** `layer/07-infrastructure` · **Status:** in progress (sub-01 providers wired) ·
**Register:** [A-LAYER-001](ASSUMPTIONS.md), [A-LAYER-002](ASSUMPTIONS.md)

The **bottom base** of the layered architecture (ARCHITECTURE.md §4). Everything else leans on
infrastructure; it never imports a layer above it (A-LAYER-002).

```mermaid
flowchart LR
    subgraph INFRA["@ANCIENT/infrastructure (Bottom base)"]
        P["providers — BYOK, routing, fallback, breaker, cost"]
        M["memory — (pending sub-branch)"]
        S["storage — (pending sub-branch)"]
        E["events — (pending sub-branch)"]
        SEC["security — (pending sub-branch)"]
    end
    subgraph BASE["Cross-cutting"]
        SHARED["@ANCIENT/shared"]
        DB["@ANCIENT/database"]
    end
    INFRA --> SHARED
    INFRA --> DB
```

Sub-layers are added one per sub-branch under `sub/07/*`, then merged here. `providers`
(commit `8efd708`), `memory` (commit `06604d7`), and `storage` (commit `0af8197`) are wired so
far.

---

## Sub-01 — Providers (done)

Canonical **provider runtime**, promoted up from `server/src/lib` and made framework-agnostic,
plus NEW cost accounting:

| File | Owning responsibility |
|------|------------------------|
| `src/providers/connection.ts` | `ProviderConnection` shape + `ProviderKeyCipher` (AES-256-GCM, injectable secret, fail-fast sync key-length validation) — BYOK keys at rest. |
| `src/providers/breaker.ts` | Per-`(provider,model)` rate-limit circuit breaker (`modelKey`, `checkCooldown`, `recordRateLimitFailure`, `RateLimitCooldownError`, `isRateLimitError`). |
| `src/providers/fallback.ts` | `pickHealthyFallback` / `asFallbackCandidate` — graceful rate-limit downgrade, type-agnostic (candidates carry an opaque resolved value). |
| `src/providers/router.ts` | `classifyPrompt` / `routeTurn` — cost/token efficiency heuristic (free-first lane). |
| `src/providers/cost.ts` | `pricingFor` / `costFor` / `sumCosts` over `@ANCIENT/shared` `SUPPORTED_CHAT_MODELS` pricing — per-execution spend. |
| `src/providers/index.ts` | Public surface. |
| `src/providers/providers.test.ts` | 16 tests (router, fallback, breaker, cost, cipher). |

**Design decisions:**
- **Dependency-light** by design — only depends on `@ANCIENT/shared` (+ node builtins). Routing,
  fallback, breaker, cost, and crypto are pure and testable with no DB or AI-SDK coupling.
- **Single source of truth** for provider *data* stays in `@ANCIENT/shared` (the catalog); this
  package owns provider *behavior*. This respects A-LAYER-002 (infra imports shared, not
  vice-versa).
- **DB-backed model resolution** is intentionally NOT here — it's a storage/DB integration later
  that implements the interfaces defined here (`ProviderConnection`), keeping this layer unit-testable.

**Why promoted here:** provider/model architecture (BYOK, fallback, routing, cost) is audit order
#6 and the natural base; sharing one implementation across engine, strategies, and gateway avoids
each keeping its own router/breaker/crypto copies.

---

## Sub-02 — Memory (done)

Canonical **memory** module for the `ANCIENT.md` project/user-memory convention, ported from
`server/src/memory` and made portable:

| File | Owning responsibility |
|------|------------------------|
| `src/memory/types.ts` | `MemoryFile` / `MemoryScope` / `MemoryBudget` / `MemoryOptions`; `DEFAULT_MEMORY_BUDGET` (6k/file, 16k total). |
| `src/memory/loader.ts` | `loadMemory` (user-global → ancestor → project, highest precedence last), one-level `@import` expansion, per-file truncation, global-budget dropping; `buildMemoryPromptBlock`. |
| `src/memory/memory.test.ts` | 6 tests over temp dirs. |

Design: injectable `homedir`/`budget` for tests; depends only on node builtins — same
dependency-light rule as providers.

---

## Sub-03 — Storage (done)

Durable **execution store** that closes assumption A-EXEC-003 (the agent package's in-memory
`Map`). Implements the `EXECUTION-STATE.md` "event stream is the source of truth" model.

| File | Owning responsibility |
|------|------------------------|
| `src/storage/types.ts` | `ExecutionRecord` (projection), `LifecycleEventType`/`ExecutionEvent` (append-only durable truth), `CheckpointRecord`. |
| `src/storage/store.ts` | `ExecutionStore` interface + `EventSourcedExecutionStore` reference implementation — append-only, replayable via `applyEvent()`. |
| `src/storage/checkpoints.ts` | pure `shouldCheckpoint()` policy (every-N-seqs, always-on types, min interval) so callers never block on I/O unless a checkpoint is due. |
| `src/storage/storage.test.ts` | 9 tests (replay, completion, cost rollup, ordering, checkpoints, policy). |

A Postgres/Prisma implementation later implements the same `ExecutionStore` interface without
touching callers.

## Verification

- `npm run typecheck` — exit 0 (all 6 packages incl. `infrastructure`).
- Full suite — **68 pass** (52 baseline + 16 new), 0 fail.
