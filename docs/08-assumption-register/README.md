# Architecture Assumption Register

## Purpose

Every important architectural belief must be challengeable.

## Record template

``` md
# ASSUMPTION-XXX

## Statement
What are we assuming?

## Why do we believe it?
Evidence, benchmarks, user requirements, or historical reasons.

## What fails if it is wrong?
Technical and product failure modes.

## Blast radius
What systems are affected?

## Alternatives
At least one realistic alternative.

## Decision
Keep / Change / Delete / Defer.

## Validation
How will this be tested?

## Revisit trigger
What future condition requires reviewing this decision?
```

## Initial assumptions to review

  ID      Assumption                                         Initial status
  ------- -------------------------------------------------- ------------------------
  A-001   Multi-agent should be central                      Challenge
  A-002   One execution engine can serve all experiences     Validate
  A-003   State can begin in memory                          Replace for production
  A-004   Tools, skills, MCP, commands are separate layers   Refine
  A-005   Routes can own orchestration                       Reject
  A-006   Arena protocols improve complex tasks              Benchmark
  A-007   Provider abstraction is shared everywhere          Verify
  A-008   Memory is one subsystem                            Decompose
  A-009   One monorepo package boundary is enough            Review
  A-010   More architecture equals more power                Reject

## Assumptions added by the Model & Provider Harness (Layer 19)

  ID      Assumption                                                          Initial status
  ------- -------------------------------------------------------------------- ------------------------
  A-011   Every provider, incl. BYOK/free-tier, fits one plugin contract       Validate
  A-012   Provider-neutral canonical context makes mid-session swap lossless   Benchmark
  A-013   Per-provider circuit breakers are sufficient bulkheads               Challenge

## Assumptions added by the Error & Failure Model (Layer 20)

  ID      Assumption                                                                       Initial status
  ------- --------------------------------------------------------------------------------- ------------------------
  A-014   A single closed `ErrorCode` taxonomy can cover model, tool, provider, and infra failures without becoming a junk-drawer enum   Challenge
  A-015   `idempotent` + `reversible` flags on every capability are sufficient to make retry decisions safely                            Validate
  A-016   Compensation actions can be modeled generically instead of per-capability special cases                                        Refine
  A-017   Bounded retry counts (not time-based backoff alone) are the right circuit-breaker trigger for capabilities                      Benchmark

## Decision gates

No major layer should be implemented without:

``` mermaid
flowchart LR
    Assumption --> Evidence
    Evidence --> Prototype
    Prototype --> Benchmark
    Benchmark --> Decision
    Decision --> ADR
    ADR --> Implementation
```

---

## ASSUMPTION-018 — Shared `contracts` + `reliability` packages (Phase 1 extraction)

## Statement
Contract types (`ErrorEnvelope`/`ErrorCode`, `Execution`, `Capability`,
`Strategy`, `ModelProviderPlugin`, reliability shapes) and reliability
mechanisms (retry/backoff, circuit breaker, backpressure) belong in two
zero-cost-shared packages, `packages/contracts` (pure types, zero deps)
and `packages/reliability` (mechanisms, depends only on contracts), so
every other layer consumes one canonical shape instead of duplicating
retry/circuit-breaker logic per package.

## Why do we believe it?
- Layer 17 (Package Boundaries) names `contracts/` and `reliability/`
  explicitly and notes retry/circuit-breaker logic is currently
  duplicated implicitly inside `model-runtime` and `capabilities`.
- Layer 20 demands one closed ErrorCode taxonomy and one envelope every
  layer defers to; a shared `contracts` package is the mechanical way to
  enforce that (a new error shape becomes a type error, not a review nit).
- Layer 09 Phase 1 lists contracts as the first migration step; Phase 5.5
  wires `reliability` in after it.
- Layer 21 §4 ships drop-in `makeError`, `nextDelay`/`withRetry`, and
  `CircuitBreaker` code that maps 1:1 onto these two packages.

## What fails if it is wrong?
- If the taxonomy is too small, layers start inventing local error shapes
  → stop condition (Layer 09) fires and we re-open the ADR.
- If `contracts` grows dependencies, the zero-dep guarantee collapses and
  the package-boundary diagram (Layer 17) stops being load-bearing.
- If `reliability` is allowed to import the things it protects (execution,
  capabilities, providers), circular-import smoke appears (Layer 17).

## Blast radius
- New packages only; no existing consumer is forced to migrate yet.
- `packages/execution` (renamed from `packages/engine`) is the first
  candidate consumer (Phase 2), so its error surface should start
  emitting `ErrorEnvelope`-compatible shapes.

## Alternatives
- Keep retry/circuit-breaker duplicated per package (status quo): rejected
  — a fix to backoff jitter would need to land in N places (Layer 17).
- Put mechanisms in `contracts`: rejected — `contracts` must stay a pure
  types package; mechanisms belong in a separate pure library.

## Decision
Keep. Create `packages/contracts` (zero deps) and `packages/reliability`
(depends only on `contracts`) now; consume them from `packages/execution`
in the Phase 2 extraction, not from a half-migrated legacy path.

## Validation
- `bun run typecheck` exits 0 with both new packages in the script chain.
- Unit tests cover `makeError` defaults, `isTransientCode`, `nextDelay`
  (cap + jitter), `withRetry` (retry/no-retry/final-throw), circuit
  breaker closed→open→half-open→closed, and backpressure rejection/shed.
- Repo-wide `bun test` stays green (no existing test breaks).

## Revisit trigger
- The first provider plugin (Phase 4.5) or capability needs an error code
  not in the Layer 20 taxonomy, OR a consumer needs circular-import surgery
  to respect the Layer 17 arrow rules.

---

## ASSUMPTION-019 — CLI consumes a typed execution-event stream, not engine internals (CLI-V2)

## Statement
The CLI (an Experience, Layer 1) interacts with execution only through a
typed, SSE event stream and gateway verbs — never by re-implementing
routing/strategy/state or executing tools client-side. The canonical event
model lives in `@ANCIENT/contracts` (zero-dep types, `ExecutionEvent`
payload union); the wire spelling (`{v, seq, ts, executionId, type, payload}`)
lives in `@ANCIENT/shared` (zod), where all wire schemas already live.

## Why do we believe it?
- Layer 1 forbids UI-specific execution logic; Layer 2 requires
  reconnect-safe streaming with replay from an append-only event log.
- The task spec for CLI-V2 is explicit: the CLI observes the architecture,
  never re-implements the engine, and survives "TUI replaced by web UI".
- The as-built audit (cli-v2-audit F1-F6, F10) showed chat.ts is the
  canonical anti-pattern (routes = AI brain) and tool execution is split
  across two processes with hooks bypassable.
- A `z.enum(ERROR_CODES)` wire validator can be built from one runtime list
  in contracts, so the closed taxonomy (Layer 20) stays single-sourced.

## What fails if it is wrong?
- If the wire needs event shapes beyond `v:1`'s payloads, either the contract
  goes to `v:2` (breaking) or payloads become junk-drawers (`unknown` again).
- If the CLI re-gains tool execution, hooks/policy are bypassable and the
  "one engine" rule (Layer 1) breaks silently.
- If replay/Last-Event-ID is unavailable, the reconnect guarantee (Layer 2)
  fails and execution views resync by full re-fetch.

## Blast radius
- `@ANCIENT/contracts` (event union, ERROR_CODES), `@ANCIENT/shared`
  (wire schema) — new surface.
- Phase 5+ CLI transport and gateway routes; `@ANCIENT/agent` legacy engine
  (already renamed to `TeamOrchestrator`, F9).
- Server chat.ts is NOT re-routed in this phase (kept for compatibility).

## Alternatives
- CLI consumes the AI-SDK UI stream for events too: rejected — couples the
  contract to a presentation format outside our versioning control.
- Docs-only / defer the wire: rejected — the CLI currently has no execution
  surface at all; the wire is the audit gap, not a nicety.
- Coarse 6-code error enum on the wire: rejected — the closed `ErrorCode`
  taxonomy already exists and is the single source.

## Decision
Keep. Ship the typed event contract (contracts + shared) first; wire the
SSE server + CLI transport in Phase 5.

## Validation
- `packages/shared/execution-events.test.ts`: golden transcript parses,
  seq gapless, exactly one terminal event, unknown types rejected,
  `capability.requested` precedes `capability.completed`.
- Full repo `bun test` green; `bun run typecheck` exit 0.

## Revisit trigger
- A new event type cannot be expressed as an additive payload field (→ v:2).
- A non-CLI experience needs a wire shape the CLI contract can't carry.
