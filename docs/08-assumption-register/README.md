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

## Assumptions added by the Platform Program (Provider microkernel → white-label base)

  ID      Assumption                                                                                    Initial status
  ------- ----------------------------------------------------------------------------------------------- ------------------------
  A-021   A provider registry whose plugins produce AI-SDK LanguageModels is the right migration step      Validate
          toward the Layer 19 canonical `ModelProviderPlugin` contract
  A-022   Each company deploys its own ANCIENT; the platform default key + user BYOK cover all credentials   Keep
  A-023   A versioned public `/v1` API is the surface a white-label product (Coding/Design/Cowork) builds on  Validate
  A-024   Experiences are thin adapters translating product actions into one canonical `ExperienceRequest`    Validate

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

---

## ASSUMPTION-020 — One gateway execution = one engine run; CLI renders the wire stream (CLI-V2 Phase 5)

## Statement
The Phase-5 gateway surface treats **one execution as one engine run**:
`POST /executions` resolves a model and runs the unified `ExecutionEngine`
from `packages/execution` with server-authoritative tools (F3); the CLI then
streams the typed wire envelopes and renders them (text deltas, tool parts,
terminal) without any client-side execution or history invention. Approval is a
placeholder: the CLI auto-allows all five risk categories so tools work
end-to-end, pending the Phase-9 approval UX.

## Why do we believe it?
- The audit (`cli-v2-audit.md` §7 step 2) sequenced exactly this boundary:
  execution surface + SSE, CLI transport moved to it, `apiClient.chat` deleted
  (F4), one executor per tool on the server (F3).
- Phase-4 delivered the wire contract (ASSUMPTION-019); the Phase-5
  bridge/hub/routes consume and validate that contract, and the CLI's
  `ExecutionMessageAssembler` is unit-tested against it.
- In-memory executions match A-003 ("state begins in memory"); the durable
  event-sourced store already exists in `infrastructure/storage`.
- The legacy CLI executed every tool client-side with no approval — the
  auto-allow keeps feature parity while moving the boundary server-side.

## What fails if it is wrong?
- Auto-allow of exec/network bypasses the consent boundary the engine's
  `ApprovalPolicy` defaults enforce until Phase 9 (security regression if
  shipped without the approval UX).
- In-memory state means a server restart loses every execution (no replay) —
  the reconnect/append-only-log guarantee (Layer 2) is not met yet.
- One-execution-per-prompt with no persistence gives no cross-run continuity
  (sub-timeline, rewind) until Phase 6/7.

## Blast radius
- `packages/server` (executions hub/bridge/routes), `packages/cli`
  (transport hook, api-client, bot-message), engine additions (`observe`,
  `sessionId`) in `packages/execution`.
- `/chat` and `/sessions` remain for compatibility; not re-routed here.

## Alternatives
- CLI runs its own consent round-trip in this phase: rejected — requires the
  `approval.requested` input-answer verb (`POST /executions/:id/inputs/:requestId`)
  that belongs with the durable store; the boundary prototype keeps tools
  working via auto-allow and defers consent UX wholesale.
- CLI executes tools locally (status quo): rejected — F3 documented the two
  parallel executors and bypassable hooks; server-authoritative is the point.

## Decision
Keep. Ship the Phase-5 surface with server-authoritative tools; auto-allow
categories client-side as an explicit placeholder; wire consent UX in Phase 9.

## Validation
- Typecheck exit 0; full suite green (295 pass / 0 fail, incl. 12 bridge +
  16 CLI-stream tests); CLI build exit 0.
- SSE replay slice (`snapshot(afterSeq)`), gapless seq, exactly-one-terminal,
  callId pairing, unknown-event isolation all covered by tests.

## Revisit trigger
- Phase 9 approval UX lands (replace `CLI_ALLOW` with real consent events).
- Durable execution store wired (replace in-memory hub state; pause/resume;
  restart-safe replay via `Last-Event-ID`).

---

## ASSUMPTION-021 — Provider registry as the migration step toward the Layer 19 plugin contract

## Statement
Model resolution degrades to a registry: a `ModelResolvingPlugin` (owned by
`packages/server`, where the AI SDK lives) turns `(protocol, modelId,
baseUrl?, apiKey?, provenance)` into a `ResolvedModel` whose handle is an
AI-SDK `LanguageModel`. Every existing branch of `resolveChatModel` — env-key
builtins (openai/deepseek/mistral/groq/together/anthropic/google) and BYOK
connections (openai-compat base URLs, anthropic, gemini) — becomes a
registered plugin. Adding a provider means registering a plugin, never
touching the resolver or the engine. The canonical Layer 19
`ModelProviderPlugin` (`complete(): AsyncIterable<CompletionEvent>`,
`packages/contracts/src/model.ts`) stays the target contract; the registry is
the honest as-built bridge because the engine consumes `LanguageModel` today.

## Why do we believe it?
- The engine (`packages/execution`) only ever sees a `LanguageModel` via
  `createAiModelChat`; strategies/capabilities never see a provider. Keeping
  that port unchanged means the migration is mechanical and zero-risk.
- The audit pattern is proven in this codebase: `models.ts:84`
  (OPENAI_COMPATIBLE_PROVIDERS table) already expressed provider differences
  as data; the registry generalizes that to behavior.
- `docs/19` invariant #2 demands "a provider is a plugin, not a special case
  in the core"; every future platform company plugs in exactly one plugin.

## What fails if it is wrong?
- If plugins need capabilities the `LanguageModel` port can't express (e.g.
  reasoning-effort, embeddings), we must extend `ResolvedModel` — visible on
  the first such provider, not silently.
- If the registry grows provider-specific branches to preserve old quirks
  (Gemini's baseUrl no-op, OpenRouter model-fallback), it re-creates the
  if/else chain it replaced.

## Blast radius
- `packages/server/src/lib/models.ts` (resolver delegates to registry),
  `packages/server/src/lib/provider-registry.ts` (new), hub/task/extensions/
  chat (importers of `resolveChatModel`/`resolveFreeModel` — unchanged API).
- `ResolvedModel` relocates to the registry module and is re-exported from
  `models.ts`, so `fallback.ts` and route importers stay untouched.

## Alternatives
- Implement the full canonical `CompletionEvent` contract now: rejected for
  this phase — it rewrites the engine/strategies model port before any
  provider lands on it (big blast radius, no near-term consumer).
- Keep the if/else chain: rejected — it is exactly the antipattern Layer 19
  outlaws and the platform program is built on plugin-installable providers.

## Decision
Keep. Ship the registry (`ModelResolvingPlugin` → `LanguageModel`) now;
migrate the resolver branches onto it; keep the canonical Layer 19 contract
as the documented target.

## Validation
- `bun test` (server package): registry tests prove env resolution, BYOK
  resolution, local-providers-require-connection, and the plugin-install
  invariant (test registers a bespoke plugin and resolves through it).
- Full repo typecheck exit 0; CLI build exit 0; existing suite stays green.

## Revisit trigger
- A provider needs a capability `LanguageModel` cannot carry → open the
  canonical `CompletionEvent` path (A-011).
- The engine's `ModelChat` port exposes a `complete()`-style async-iterable
  contract → switch the registry's plugin surface to match.

---

## ASSUMPTION-022 — One deployment per company; platform default key + user BYOK cover all credentials

## Statement
"ANCIENT as a base platform for any AI company" means each company deploys
its own ANCIENT (white-label), not a shared multitenant SaaS. That company's
own model key is the platform default (env-configurable, e.g. OpenAI/Anthropic/
OpenRouter), and each of its end users may BYOK on top. Resolution order:
user's BYOK key first, platform default next, free/local last. No tenant
tables, no metering at the platform boundary.

## Why do we believe it?
- BYOK already exists per-user (`ProviderConnection` + AES-256-GCM at rest);
  builtin env-key resolution already exists (OPENAI_COMPATIBLE_PROVIDERS et
  al.) — those two are literally "end-user first, platform default second"
  with no schema change.
- Single-deploy keeps isolation, outbound SSRF guard (`assertSafeBaseUrl`),
  and rate limits simple; true multitenancy multiplies every security surface
  before a company has shipped.

## What fails if it is wrong?
- A company needs per-end-user metering/billing on shared infra → would
  require tenant tables after all (defer, don't build now).
- "Company adds its own model" is more than an env var (e.g. a fine-tuned
  model behind a private endpoint) → the plugin registry (A-021) is the
  escape hatch: the company provider is just another plugin.

## Blast radius
- Config/docs only (`.env` variables, settings.json `modelRouting`), plus the
  registry's env-credential convention. No schema change.

## Alternatives
- Multitenant SaaS now: rejected — heavy (tenant isolation, metering, quota
  enforcement) before any product exists on the base.
- Reverse precedence (platform default wins over user BYOK): rejected — the
  user's own key is cheaper to the company and already policy-preferred in
  `docs/19`'s routing flowchart.

## Decision
Keep. Single-deploy white-label; explicit precedence user-BYOK → platform
default → free/local.

## Validation
- Phase 2 ships a documented `PLATFORM_MODEL`/env-key default and the
  precedence logic, covered by registry/env tests where meaningful; the
  existing chat/hub fallback order already implements the tail end.

## Revisit trigger
- A real company asks for shared-infrastructure multitenancy or cross-tenant
  usage billing → reopen A-022 and design tenant scoping.

---

## ASSUMPTION-023 — A versioned `/v1` API is the surface a white-label product builds on

## Statement
The public integration point for products built on ANCIENT is a versioned
`/v1` API — models catalogue, execution start/stream/cancel, usage — secured
by a platform API key (`ANCIENT_PLATFORM_API_KEY`), independent of the
interactive user routes (`/executions` requires `requireAuth`). The typed wire
contracts (`@ANCIENT/shared` envelopes) are the same ones the CLI uses, so a
Coding/Design/Cowork experience is a client of the API, not a fork.

## Why do we believe it?
- The CLI-V2 execution surface already IS that contract (ASSUMPTION-019/020);
  `/v1` is an auth + versioning shim over the same hub, so it inherits tested
  semantics rather than inventing a parallel API.
- `docs/01-experiences` already forces experiences to go through the Gateway;
  a stable `/v1` is that gateway's public face.

## What fails if it is wrong?
- Public API keys leak or are unrotatable → OpSec regression; mitigation is
  env-based single key with documented rotation, and per-process `requireAuth`
  stays for interactive routes.
- The versioned surface diverges from the internal wire envelopes → two
  contracts to maintain; the build rule is "map `/v1` onto `@ANCIENT/shared`
  types, always".

## Blast radius
- New `packages/server/src/routes/v1.ts` + `require-api-key` middleware,
  mounted in `src/index.ts`; the hub stays the single execution authority.
- `/executions` interactive routes unchanged.

## Alternatives
- Expose the internal routes and call them "the API": rejected — no version
  contract, breaking changes become silent, and the interactive auth
  (Clerk OAuth) is not a platform-auth story.
- Build a separate SDK-first server package: rejected — duplicates the hub/
  engine lifecycle the base platform is supposed to centralize.

## Decision
Keep. Ship `/v1` as a thin, versioned, API-key-guarded projection of the hub
onto the shared wire envelopes.

## Validation
- Route-level tests: 401 without the platform key, 200 catalog, execution
  start/cancel round-trip, SSE stream framing matches the CLI's parsers.
- Typecheck green; CLI build unaffected.

## Revisit trigger
- A product needs resource scoping below "one execution per request" (realms,
  projects) → extend `/v1` with scoping fields, still on shared envelopes.

---

## ASSUMPTION-024 — Experiences are thin adapters over a canonical `ExperienceRequest`

## Statement
Coding, Design, Cowork, and General are not engines (Layer 1 rule: one engine,
many experiences). Each is a thin adapter that maps product actions (a task, a
scope/home, a mode, an allow-set, an optional model) onto a canonical
`ExperienceRequest` that the `/v1` API consumes. The adapter registry lives in
`packages/shared` (pure types) with server-side validation, so a new
experience is a one-file registration, not a new execution path.

## Why do we believe it?
- CLI-V2 proved a single execution surface can power a product; Coding/Design
  add only policy differences (which tools, which risk allow-set), all of
  which already exist in `ExecutionStartRequest`.
- `docs/01-experiences` names the exact failure ("must not create
  CodingEngine/DesignEngine forks"); a type + registry makes that a compile
  boundary instead of a review nit.

## What fails if it is wrong?
- If experiences need genuinely different capabilities (Design drawing canvas,
  Cowork presence), the adapter model leaks and the registry becomes a
  drawer of stringly-typed options.

## Blast radius
- New types in `packages/shared` (used by `/v1`); optional server infra to
  validate/route by experience id. No engine change.

## Alternatives
- Per-experience engines (status quo of the industry): rejected — duplicates
  tool-binding, policies, streaming, and recovery per product.
- Adapters live in each product's repo: rejected — the platform must ship the
  boundary, else every company reinvents it.

## Decision
Keep. Ship `ExperienceRequest` + registry as shared contracts now; adapters
for Coding/Design/Cowork follow as thin mappings.

## Validation
- Typecheck + unit tests on the schema/registry (round-trip, unknown
  experience rejection); no engine or hub change.

## Revisit trigger
- Any experience needs a capability outside the single execution surface
  (e.g. real-time co-editing) → design that capability into the engine, never
  a fork (A-002).
