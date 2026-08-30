# Layer 3 --- Unified Execution Engine

## Purpose

The execution engine owns the lifecycle of work --- including the
lifecycle of its failures.

``` mermaid
stateDiagram-v2
    [*] --> Created
    Created --> Queued
    Queued --> Running
    Running --> WaitingApproval
    WaitingApproval --> Running
    Running --> Paused
    Paused --> Running
    Running --> Checkpointed
    Checkpointed --> Running
    Running --> Completed
    Running --> Failed
    Running --> Cancelled
    Paused --> Cancelled
    Failed --> Queued: retry (if retryable)
```

Note the new transition: `Failed --> Queued` exists **only** when the
failure is classified as retryable (Layer 20). A non-retryable failure
is terminal, full stop --- the engine must never silently retry
something like a bad tool argument or a policy denial.

## Core question

> What is an execution?

An execution is the durable identity of one unit of AI work.

``` ts
interface Execution {
  id: string
  status: ExecutionStatus
  request: ExecutionRequest
  contextRef: string
  strategy: StrategySelection
  createdAt: Date
  updatedAt: Date
  lastError?: ErrorEnvelope       // NEW: last classified failure, if any
  retryCount: number              // NEW: bounded retry tracking
  checkpointRef?: string          // NEW: most recent recoverable checkpoint
}
```

## Core services

### 3.1 Execution lifecycle manager

Owns:

-   create
-   queue
-   start
-   pause
-   resume
-   cancel
-   complete
-   fail

**Failure ownership:** this is the *only* component allowed to write
`status: Failed`. A capability, strategy, or provider plugin may
*report* a failure upward; only the lifecycle manager decides whether
that failure terminates the execution, triggers a retry, or triggers a
fallback (Layer 20 decision table).

### 3.2 Execution orchestrator

Coordinates the engine but does not contain every strategy
implementation.

``` mermaid
flowchart TB
    Request --> Orchestrator
    Orchestrator --> Context
    Orchestrator --> Model
    Orchestrator --> Strategy
    Strategy --> Capability
    Capability --> Events
    Strategy -.error.-> Orchestrator
    Capability -.error.-> Orchestrator
    Model -.error.-> Orchestrator
    Orchestrator -.ErrorEnvelope.-> LifecycleManager[Lifecycle Manager]
```

**Error propagation contract:** every downstream failure (model,
capability, strategy) must bubble up to the orchestrator as a typed
`ErrorEnvelope`, never as a raw exception, a `null`, or a swallowed
`console.error`. The orchestrator's only responsibility on error is to
attach execution context (execution id, strategy, step) and forward to
the lifecycle manager --- it does not decide retry policy itself (that's
Layer 20 + Layer 12).

### 3.3 Context manager

Builds the execution context.

Sources:

-   user input
-   workspace
-   session
-   memory
-   files
-   artifacts
-   strategy requirements

It must support:

-   budget limits
-   compression
-   isolation
-   provenance

**Failure behavior:** a context-assembly failure (missing file, memory
service down, budget exceeded) is `CONTEXT_*` and is almost always
retryable with degraded context (Layer 12.10 graceful degradation) ---
e.g. proceed without long-term memory rather than fail the whole
execution.

### 3.4 Model runtime

Responsible for model selection, capability matching, provider
fallback, cost policy, latency policy, and token accounting. Its full
failure-handling design (circuit breakers, fallback chains, BYOK) lives
in [Layer 19 --- Model & Provider Harness](../19-model-provider-harness/README.md).

The model runtime should not know whether it is serving coding or
design, and it should not know whether the current failure will end up
being retried, escalated, or degraded --- it only reports
`ProviderFailure` upward with an honest classification.

### 3.5 Strategy selector

Chooses the least complex reliable strategy.

``` mermaid
flowchart TD
    T[Task] --> C{Complexity}
    C -->|Low| Direct
    C -->|Medium| AgentLoop
    C -->|High independent work| Subagents
    C -->|Coordinated work| Team
    C -->|Explicit competition| Arena
```

**Failure behavior:** if a chosen strategy fails in a way that suggests
the *strategy* was wrong (not the task) --- e.g. an agent loop blocked on
a task that clearly needed subagent delegation --- the selector may be
asked to re-select once, with the previous strategy excluded and the
failure reason attached. This is bounded to a single re-selection to
avoid strategy-thrashing loops.

## Event model

The engine should emit canonical events:

``` text
execution.created
execution.started
context.ready
strategy.selected
model.called
capability.requested
capability.completed
approval.requested
checkpoint.created
execution.paused
execution.resumed
execution.completed
execution.failed
execution.retrying          # NEW
execution.degraded          # NEW: succeeded, but with reduced capability
execution.fallback_engaged  # NEW: e.g. provider or model swapped mid-run
```

The last three exist specifically so that Observability (Layer 7) can
distinguish "worked perfectly," "worked after recovering," and "did not
work" --- collapsing these into one `execution.completed` event hides
exactly the signal operators need to see if the system is quietly
struggling.

## Hard rules

-   No subsystem should require the caller to know whether execution is
    single-agent or multi-agent.
-   No subsystem other than the Lifecycle Manager may set terminal
    status.
-   Every non-terminal failure must be classified against the shared
    `ErrorCode` taxonomy (Layer 20) before it is allowed to trigger a
    retry, fallback, or degradation path.

------------------------------------------------------------------------

## AS-BUILT status (2026-08-30) --- what this layer does today

`packages/execution` is the unified execution engine the layer describes.
Honest map of target vs. running reality:

| Claim in this doc | As-built | Where |
| ----------------- | -------- | ----- |
| §3.1 Lifecycle Manager is the only terminal-status writer | **wired** | `engine.ts` -- strategy/capability failures arrive as typed `ErrorEnvelope`s; the engine classifies and is the sole writer of `completed \| failed \| cancelled` |
| §3.1 `Failed → Queued` exists only for retryable failures | **wired** | `engine.ts` classifies via `isTransientCode` (Layer 20 §3), bounded by `RetryBudget` (default 2 attempts); non-transient (`POLICY_*`, bad args) settle immediately. `retryCount` on `RunResult` + `execution.retrying` wire event emitted per retry |
| §3.2 error propagation contract (typed envelope, never raw/null/swallowed) | **wired** | strategies (`strategies/src/errors.ts` `asEnvelope`/`makeError`) → engine (`#consume`) → `strategies/src/types.ts` (strategy `error` events carry `error: ErrorEnvelope`) |
| Lifecycle state machine incl. `queued` | **wired** | `ExecutionStatus` (9 states) in `engine/types` + infra `storage/types`; live gateway surface collapses to five via `hub.ts` `toSurfaceStatus` |
| §3.3 Context manager (budget/compression/provenance) | **wired** | `engine/context.ts` (A-ENG-002) -- engine-owned ctx, trimming, task-brief guarantee; failure-isolation of §3.3 (CONTEXT_\* degrade) not yet a live path |
| §3.5 strategy re-selection on strategy-wrong failure | **not wired** | selector returns one choice; bounded re-selection is a planned edge |
| Checkpoint / pause / resume (WaitingApproval, Paused, Checkpointed) | **not wired** | statuses exist in the union + infra events; no orchestrator drives them yet (docs/06 store bridge is in-memory) |
| `execution.degraded` / `execution.fallback_engaged` | **not wired** | wire envelopes exist (`shared/execution-events`); the engine does not emit them yet |

Retry behavior is verifiable in `engine.test.ts`: transient `PROVIDER_*`
envelopes round-trip through a retry (re-queued, `retrying`, healed);
non-transient envelopes fail on the first attempt with `lastError`
preserved.
